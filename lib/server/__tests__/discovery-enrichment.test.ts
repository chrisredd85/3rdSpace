import {
  getDiscoveryVenueContactEmails,
  shouldAttemptWebsiteExtraction,
  buildWebsiteExtractionUpdate,
  type DiscoveryVenueRow,
} from '@/lib/server/discovery-enrichment'

function row(overrides: Partial<DiscoveryVenueRow> = {}): DiscoveryVenueRow {
  return {
    contact_email: null,
    extracted_emails: [],
    website: 'https://venue.example',
    website_extraction_status: null,
    website_extraction_attempts: 0,
    ...overrides,
  }
}

describe('discovery enrichment helpers', () => {
  it('prefers a direct contact without claiming that Google supplied an email', () => {
    expect(getDiscoveryVenueContactEmails(row({
      contact_email: 'booking@venue.example',
      extracted_emails: [{
        email: 'events@venue.example',
        confidence: 0.9,
        source_path: '/events',
        extracted_at: '2026-06-09T00:00:00.000Z',
        is_likely_booking_contact: true,
      }],
    }))).toEqual([{
      email: 'booking@venue.example',
      source: 'direct',
      confidence: 1,
      is_likely_booking_contact: true,
    }])
  })

  it('sorts cached website emails by likely booking contact and confidence', () => {
    expect(getDiscoveryVenueContactEmails(row({
      extracted_emails: [
        {
          email: 'info@venue.example',
          confidence: 0.7,
          source_path: '/contact',
          extracted_at: '2026-06-09T00:00:00.000Z',
          is_likely_booking_contact: false,
        },
        {
          email: 'events@venue.example',
          confidence: 0.6,
          source_path: '/events',
          extracted_at: '2026-06-09T00:00:00.000Z',
          is_likely_booking_contact: true,
        },
      ],
    })).map((email) => email.email)).toEqual(['events@venue.example', 'info@venue.example'])
  })

  it('only queues rows that need extraction and have retry budget', () => {
    expect(shouldAttemptWebsiteExtraction(row())).toBe(true)
    expect(shouldAttemptWebsiteExtraction(row({ contact_email: 'booking@venue.example' }))).toBe(false)
    expect(shouldAttemptWebsiteExtraction(row({ website: null }))).toBe(false)
    expect(shouldAttemptWebsiteExtraction(row({ website_extraction_attempts: 3 }))).toBe(false)
    expect(shouldAttemptWebsiteExtraction(row({ website_extraction_status: 'successful' }))).toBe(false)
    expect(shouldAttemptWebsiteExtraction(row({ website_extraction_status: 'blocked_by_robots' }))).toBe(false)
    expect(shouldAttemptWebsiteExtraction(row({ website_extraction_status: 'fetch_failed', website_extraction_attempts: 2 }))).toBe(true)
  })

  it('allows an ID-only venue only when fresh Google hydration is enabled', () => {
    const venue = row({ website: null, source: 'google_places', source_external_id: 'place-1' })
    expect(shouldAttemptWebsiteExtraction(venue)).toBe(false)
    expect(shouldAttemptWebsiteExtraction(venue, { googleHydrationEnabled: true })).toBe(true)
    expect(shouldAttemptWebsiteExtraction({ ...venue, contact_email: 'events@venue.test' }, { googleHydrationEnabled: true })).toBe(false)
    expect(shouldAttemptWebsiteExtraction({ ...venue, organizer_provided_emails: [{ email: 'bookings@venue.test' }] }, { googleHydrationEnabled: true })).toBe(false)
  })

  it('does not let low-confidence evidence consume the remaining retry budget', () => {
    const venue = row({ website_extraction_status: 'fetch_failed', website_extraction_attempts: 1, extracted_emails: [
      { email: 'info@venue.test', confidence: 0.3, is_likely_booking_contact: false },
    ] })
    expect(shouldAttemptWebsiteExtraction(venue)).toBe(true)
    expect(shouldAttemptWebsiteExtraction({ ...venue, website_extraction_attempts: 3 })).toBe(false)
    expect(shouldAttemptWebsiteExtraction({ ...venue, website_extraction_status: 'blocked_by_robots' })).toBe(false)
  })

  it('keeps prior independent contacts when an extraction attempt returns no new evidence', () => {
    const previous = row({ extracted_emails: [{ email: 'events@venue.test', confidence: 0.9, source_path: '/events', source_url: 'https://venue.test/events', source: 'business_website', extracted_at: '2026-09-22T00:00:00Z', is_likely_booking_contact: true }] })
    const update = buildWebsiteExtractionUpdate({
      status: 'timeout', emails: [], contact_forms: [],
      metadata: { paths_attempted: ['/'], paths_successful: [], total_fetch_time_ms: 30_000, robots_txt_consulted: true },
    }, 1, '2026-09-22T01:00:00Z', previous)
    expect(update.extracted_emails).toEqual(previous.extracted_emails)
    expect(update.website_extraction_attempts).toBe(2)
    expect(update.website_extraction_status).toBe('timeout')
  })
})
