import type { Database, Json } from '@/lib/types/database-generated'
import type { ExtractedContactForm, ExtractedEmail, ExtractionResult } from '@/lib/server/venue-website-extractor'

export type DiscoveryVenueRow = Pick<
  Database['public']['Tables']['discovery_venues']['Row'],
  | 'contact_email'
  | 'extracted_emails'
  | 'website'
  | 'website_extraction_status'
  | 'website_extraction_attempts'
> & {
  extracted_contact_forms?: Json | null
  organizer_provided_emails?: Json | null
  source?: string | null
  source_external_id?: string | null
}

export type DiscoveryVenueContactEmail = {
  email: string
  source: 'direct' | 'website'
  confidence: number
  is_likely_booking_contact: boolean
}

const RETRYABLE_EXTRACTION_STATUSES = new Set<string | null>([
  null,
  'never_attempted',
  'fetch_failed',
  'rate_limited',
  'timeout',
])

export function getDiscoveryVenueContactEmails(row: DiscoveryVenueRow): DiscoveryVenueContactEmail[] {
  const directEmail = row.contact_email?.trim()
  if (directEmail) {
    return [{
      email: directEmail,
      source: 'direct',
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

export function shouldAttemptWebsiteExtraction(row: DiscoveryVenueRow, options: { googleHydrationEnabled?: boolean } = {}) {
  const canHydrate = options.googleHydrationEnabled === true && row.source === 'google_places' && Boolean(row.source_external_id?.trim())
  if (!row.website?.trim() && !canHydrate) return false
  if (row.contact_email?.trim()) return false
  if (Array.isArray(row.organizer_provided_emails) && row.organizer_provided_emails.some((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && isContactEmail(entry.email))) return false
  if (getUsableExtractedEmails(row.extracted_emails).length > 0) return false
  if (getUsableContactForms(row.extracted_contact_forms).some((form) => form.evidence_kind === 'observed_form')) return false
  if (!RETRYABLE_EXTRACTION_STATUSES.has(row.website_extraction_status)) return false
  return (row.website_extraction_attempts ?? 0) < 3
}

export function getUsableExtractedEmails(value: Json | null | undefined) {
  return parseExtractedEmails(value).filter((email) => isContactEmail(email.email)
    && (email.is_likely_booking_contact || email.confidence >= 0.7))
}

export function getUsableContactForms(value: Json | null | undefined) {
  return parseExtractedContactForms(value).filter((form) => form.confidence >= 0.55)
}

function isContactEmail(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return false
  const [local, domain] = value.trim().toLowerCase().split('@')
  return !['user', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'webmaster'].includes(local)
    && !['domain.com', 'example.com'].includes(domain) && !domain.endsWith('.sentry-next.wixpress.com')
}

export function buildWebsiteExtractionUpdate(
  result: ExtractionResult,
  attempts: number | null | undefined,
  attemptedAt: string,
  existing?: Pick<DiscoveryVenueRow, 'extracted_emails' | 'extracted_contact_forms'>
): Database['public']['Tables']['discovery_venues']['Update'] & { extracted_contact_forms: Json } {
  return {
    extracted_emails: toJson(mergeEvidence(parseExtractedEmails(existing?.extracted_emails), result.emails, (entry) => entry.email.toLowerCase())),
    extracted_contact_forms: toJson(mergeEvidence(parseExtractedContactForms(existing?.extracted_contact_forms), result.contact_forms ?? [], (entry) => entry.url)),
    website_extraction_attempted_at: attemptedAt,
    website_extraction_status: result.status,
    website_extraction_metadata: toJson(result.metadata),
    website_extraction_attempts: (attempts ?? 0) + 1,
    updated_at: attemptedAt,
  }
}

function mergeEvidence<T>(previous: T[], next: T[], key: (entry: T) => string): T[] {
  const merged = new Map(previous.map((entry) => [key(entry), entry]))
  next.forEach((entry) => merged.set(key(entry), entry))
  return [...merged.values()]
}

export function parseExtractedContactForms(value: Json | null | undefined): ExtractedContactForm[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : 'Contact page'
    const confidence = typeof record.confidence === 'number' ? record.confidence : 0
    const sourcePath = typeof record.source_path === 'string' ? record.source_path : '/'
    const extractedAt = typeof record.extracted_at === 'string' ? record.extracted_at : ''
    const isLikelyBookingContact = record.is_likely_booking_contact === true

    if (!/^https?:\/\//i.test(url)) return []
    return [{
      url,
      label,
      confidence: Math.min(1, Math.max(0, confidence)),
      source_path: sourcePath,
      extracted_at: extractedAt,
      is_likely_booking_contact: isLikelyBookingContact,
      evidence_kind: record.evidence_kind === 'observed_form' ? 'observed_form' : 'contact_link',
      ...(record.source === 'business_website' ? { source: 'business_website' as const } : {}),
      ...(typeof record.source_url === 'string' ? { source_url: record.source_url } : {}),
    }]
  })
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
      ...(record.source === 'business_website' ? { source: 'business_website' as const } : {}),
      ...(typeof record.source_url === 'string' ? { source_url: record.source_url } : {}),
    }]
  })
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
