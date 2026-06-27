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

  it('extracts likely booking contact forms and request links', () => {
    const forms = extractContactFormsFromHtml(`
      <form id="catering-request" action="/page/catering-request#catering-form"></form>
      <a href="/private-events/request">Request a private event quote</a>
      <form id="newsletter" action="/subscribe"></form>
    `, '/private-events', new URL('https://lacorneta.example/page/catering-request'))

    expect(forms).toHaveLength(2)
    expect(forms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://lacorneta.example/page/catering-request#catering-form',
        label: 'catering request',
      }),
      expect.objectContaining({
        url: 'https://lacorneta.example/private-events/request',
        label: 'Request a private event quote',
      }),
    ]))
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
