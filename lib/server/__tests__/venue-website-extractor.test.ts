jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearVenueWebsiteRateLimits,
  decodeHtmlEntities,
  extractContactFormsFromHtml,
  extractEmailsFromHtml,
  extractVenueContacts,
  isPathAllowedByRobots,
  scoreEmailConfidence,
} from '@/lib/server/venue-website-extractor'

const fixtureDir = join(__dirname, 'fixtures', 'venue-html')
const homepageHtml = readFileSync(join(fixtureDir, 'homepage.html'), 'utf8')
const contactHtml = readFileSync(join(fixtureDir, 'contact.html'), 'utf8')

describe('venue website extractor', () => {
  beforeEach(() => {
    clearVenueWebsiteRateLimits()
  })

  it('decodes HTML entity encoded emails before extraction', () => {
    const decoded = decodeHtmlEntities('events&#64;venue.com and booking&#x40;venue.com')
    expect(decoded).toContain('events@venue.com')
    expect(decoded).toContain('booking@venue.com')

    const emails = extractEmailsFromHtml('Reach events&#64;venue.com or info&commat;venue.com', '/contact')
    expect(emails.map((email) => email.email)).toEqual(['events@venue.com', 'info@venue.com'])
  })

  it('skips obvious non-contact addresses and dedupes per page', () => {
    const emails = extractEmailsFromHtml(
      [
        'events@venue.com',
        'events@venue.com',
        'noreply@venue.com',
        'webmaster@venue.com',
        'test@venue.com',
        'hello@example.com',
        'alerts@sentry.io',
      ].join(' '),
      '/events'
    )

    expect(emails).toHaveLength(1)
    expect(emails[0].email).toBe('events@venue.com')
  })

  it('scores likely booking contacts higher than generic addresses when alternatives exist', () => {
    expect(scoreEmailConfidence('events@venue.com', '/private-events', true)).toBe(0.8)
    expect(scoreEmailConfidence('info@venue.com', '/contact', true)).toBe(0.5)
    expect(scoreEmailConfidence('info@venue.com', '/contact', false)).toBe(0.7)
  })

  it('distinguishes observed contact forms from unverified request links', () => {
    const forms = extractContactFormsFromHtml(`
      <form id="catering-request" action="/submit"><input name="email"><button>Request quote</button></form>
      <a href="/private-events/request">Request a private event quote</a>
      <form id="newsletter" action="/subscribe"></form>
    `, '/private-events', new URL('https://lacorneta.example/page/catering-request'))

    expect(forms).toHaveLength(2)
    expect(forms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://lacorneta.example/page/catering-request',
        label: 'catering request',
        evidence_kind: 'observed_form',
        source_url: 'https://lacorneta.example/page/catering-request',
      }),
      expect.objectContaining({
        url: 'https://lacorneta.example/private-events/request',
        label: 'Request a private event quote',
        evidence_kind: 'contact_link',
      }),
    ]))
  })

  it('never labels a booking anchor, ticket checkout, or empty form as an observed contact form', () => {
    const contacts = extractContactFormsFromHtml(`
      <a href="/book">Book</a>
      <a href="https://tickets.example/event">Book tickets</a>
      <form id="event-request"></form>
    `, '/', new URL('https://venue.example/'))
    expect(contacts).toHaveLength(2)
    expect(contacts.every((contact) => contact.evidence_kind === 'contact_link')).toBe(true)
  })

  it.each([
    [429, 'rate_limited'],
    [403, 'fetch_failed'],
    [500, 'fetch_failed'],
  ])('preserves early independent contacts after a later HTTP %s interruption', async (httpStatus, status) => {
    let time = 0
    const fetchImpl = jest.fn(async (input: string | URL) => {
      const path = new URL(input.toString()).pathname
      if (path === '/robots.txt') return new Response('', { status: 404 })
      if (path === '/') return new Response('<p>events@venue.test</p><form id="booking"><input name="email"><button>Request quote</button></form>')
      return new Response('', { status: path === '/contact' ? Number(httpStatus) : 404 })
    })
    const result = await extractVenueContacts('https://venue.test', {
      fetchImpl, maxRetries: 0, totalBudgetMs: 120_000,
      now: () => time, sleep: async (ms) => { time += ms },
    })
    expect(result.status).toBe(status)
    expect(result.emails).toEqual([expect.objectContaining({ email: 'events@venue.test', source: 'business_website', source_url: 'https://venue.test/' })])
    expect(result.contact_forms).toEqual([expect.objectContaining({ url: 'https://venue.test/', evidence_kind: 'observed_form', source_url: 'https://venue.test/' })])
    expect(result.metadata).toMatchObject({ partial: true, paths_successful: ['/'] })
  })

  it.each(['between_paths', 'during_request'])('preserves contacts when the total budget expires %s and skips model disambiguation', async (mode) => {
    let time = 0
    const disambiguate = jest.fn()
    const fetchImpl = jest.fn(async (input: string | URL) => {
      const path = new URL(input.toString()).pathname
      if (path === '/robots.txt') return new Response('', { status: 404 })
      if (path === '/') {
        if (mode === 'between_paths') time = 5_000
        return new Response('<p>events@venue.test booking@venue.test</p>')
      }
      time = 5_000
      throw new Error('secret locator must not be persisted')
    })
    const result = await extractVenueContacts('https://venue.test', {
      fetchImpl, disambiguate, totalBudgetMs: 5_000,
      now: () => time, sleep: async (ms) => { time += ms },
    })
    expect(result.status).toBe('timeout')
    expect(result.emails.map((entry) => entry.email).sort()).toEqual(['booking@venue.test', 'events@venue.test'])
    expect(result.metadata.partial).toBe(true)
    expect(disambiguate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret locator')
  })

  it('respects robots.txt allow and disallow rules', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /private-events',
      'Allow: /private-events/public',
      '',
      'User-agent: 3rdPlace-Venue-Inquiry-Bot',
      'Disallow: /rentals',
    ].join('\n')

    expect(isPathAllowedByRobots(robots, '3rdPlace-Venue-Inquiry-Bot/1.0', '/contact')).toBe(true)
    expect(isPathAllowedByRobots(robots, '3rdPlace-Venue-Inquiry-Bot/1.0', '/rentals')).toBe(false)
    expect(isPathAllowedByRobots(robots, 'OtherBot/1.0', '/private-events')).toBe(false)
    expect(isPathAllowedByRobots(robots, 'OtherBot/1.0', '/private-events/public')).toBe(true)
  })

  it('fetches homepage then contact paths, rate limits per domain, and marks the AI-ranked booking contact', async () => {
    let currentTime = 0
    const requestTimes: number[] = []
    const requestedPaths: string[] = []
    const fetchImpl = jest.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      requestTimes.push(currentTime)
      requestedPaths.push(url.pathname)
      if (url.pathname === '/robots.txt') return new Response('', { status: 404 })
      if (url.pathname === '/') return new Response(homepageHtml, { status: 200 })
      if (url.pathname === '/contact') return new Response(contactHtml, { status: 200 })
      return new Response('', { status: 404 })
    })

    const result = await extractVenueContacts('northpier.test', {
      venueName: 'North Pier Hall',
      fetchImpl,
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms
      },
      disambiguate: async () => ({
        ranked_emails: [
          {
            email: 'events@northpier.test',
            likelihood_booking_contact: 0.96,
            reasoning: 'Events local-part and private-events page context.',
          },
          {
            email: 'info@northpier.test',
            likelihood_booking_contact: 0.2,
            reasoning: 'Generic contact.',
          },
        ],
      }),
    })

    expect(result.status).toBe('successful')
    expect(result.emails.map((email) => email.email)).toEqual(['events@northpier.test', 'info@northpier.test'])
    expect(result.contact_forms).toEqual(expect.any(Array))
    expect(result.emails.find((email) => email.email === 'events@northpier.test')?.is_likely_booking_contact).toBe(true)
    expect(requestedPaths.slice(0, 3)).toEqual(['/robots.txt', '/', '/contact'])
    expect(requestTimes.slice(0, 3)).toEqual([0, 1000, 2000])
  })

  it('returns blocked_by_robots when every extraction path is disallowed', async () => {
    const fetchImpl = jest.fn(async (input: string | URL) => {
      const url = new URL(input.toString())
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /', { status: 200 })
      }
      return new Response('', { status: 500 })
    })

    const result = await extractVenueContacts('https://blocked.example.test', {
      fetchImpl,
      sleep: async () => undefined,
    })

    expect(result.status).toBe('blocked_by_robots')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns rate_limited immediately on 429 responses', async () => {
    const fetchImpl = jest.fn(async () => new Response('', { status: 429 }))

    const result = await extractVenueContacts('https://busy.example.test', {
      fetchImpl,
      sleep: async () => undefined,
    })

    expect(result.status).toBe('rate_limited')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('enforces the total extraction budget', async () => {
    let currentTime = 0
    const fetchImpl = jest.fn(async () => {
      currentTime += 40
      return new Response('', { status: 404 })
    })

    const result = await extractVenueContacts('https://slow.example.test', {
      fetchImpl,
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms
      },
      totalBudgetMs: 30,
      requestTimeoutMs: 100,
    })

    expect(result.status).toBe('timeout')
  })
})
