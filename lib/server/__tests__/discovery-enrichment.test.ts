import {
  getDiscoveryVenueContactEmails,
  shouldAttemptWebsiteExtraction,
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
  it('prefers an existing Places contact email over cached website emails', () => {
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
      source: 'places',
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
})
