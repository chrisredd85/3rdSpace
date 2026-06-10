import type { Database, Json } from '@/lib/types/database-generated'
import type { ExtractedEmail, ExtractionResult } from '@/lib/server/venue-website-extractor'

export type DiscoveryVenueRow = Pick<
  Database['public']['Tables']['discovery_venues']['Row'],
  | 'contact_email'
  | 'extracted_emails'
  | 'website'
  | 'website_extraction_status'
  | 'website_extraction_attempts'
>

export type DiscoveryVenueContactEmail = {
  email: string
  source: 'places' | 'website'
  confidence: number
  is_likely_booking_contact: boolean
}

const RETRYABLE_EXTRACTION_STATUSES = new Set<string | null>([
  null,
  'never_attempted',
  'fetch_failed',
  'no_emails_found',
  'rate_limited',
  'timeout',
])

export function getDiscoveryVenueContactEmails(row: DiscoveryVenueRow): DiscoveryVenueContactEmail[] {
  const placesEmail = row.contact_email?.trim()
  if (placesEmail) {
    return [{
      email: placesEmail,
      source: 'places',
      confidence: 1,
      is_likely_booking_contact: true,
    }]
  }

  return parseExtractedEmails(row.extracted_emails)
    .sort((a, b) => {
      if (a.is_likely_booking_contact !== b.is_likely_booking_contact) {
        return a.is_likely_booking_contact ? -1 : 1
      }
      return b.confidence - a.confidence || a.email.localeCompare(b.email)
    })
    .map((email) => ({
      email: email.email,
      source: 'website' as const,
      confidence: email.confidence,
      is_likely_booking_contact: email.is_likely_booking_contact,
    }))
}

export function shouldAttemptWebsiteExtraction(row: DiscoveryVenueRow) {
  if (!row.website?.trim()) return false
  if (row.contact_email?.trim()) return false
  if (parseExtractedEmails(row.extracted_emails).length > 0) return false
  if (!RETRYABLE_EXTRACTION_STATUSES.has(row.website_extraction_status)) return false
  return (row.website_extraction_attempts ?? 0) < 3
}

export function buildWebsiteExtractionUpdate(
  result: ExtractionResult,
  attempts: number | null | undefined,
  attemptedAt: string
): Database['public']['Tables']['discovery_venues']['Update'] {
  return {
    extracted_emails: toJson(result.emails),
    website_extraction_attempted_at: attemptedAt,
    website_extraction_status: result.status,
    website_extraction_metadata: toJson(result.metadata),
    website_extraction_attempts: (attempts ?? 0) + 1,
    updated_at: attemptedAt,
  }
}

export function parseExtractedEmails(value: Json | null | undefined): ExtractedEmail[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const email = typeof record.email === 'string' ? record.email.trim() : ''
    const confidence = typeof record.confidence === 'number' ? record.confidence : 0
    const sourcePath = typeof record.source_path === 'string' ? record.source_path : '/'
    const extractedAt = typeof record.extracted_at === 'string' ? record.extracted_at : ''
    const isLikelyBookingContact = record.is_likely_booking_contact === true

    if (!email) return []
    return [{
      email,
      confidence: Math.min(1, Math.max(0, confidence)),
      source_path: sourcePath,
      extracted_at: extractedAt,
      is_likely_booking_contact: isLikelyBookingContact,
    }]
  })
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
