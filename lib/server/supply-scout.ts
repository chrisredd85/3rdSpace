import 'server-only'

import { z } from 'zod'
import type { Json } from '@/lib/types'

export const supplyScoutSourcePlatformSchema = z.enum([
  'eventbrite',
  'posh',
  'luma',
  'partiful',
  'google_search',
  'city_source',
  'reddit',
  'manual',
  'other',
])

export const supplyScoutBookingLikelihoodSchema = z.enum([
  'public_bookable',
  'commercial_likely_bookable',
  'event_proven_unverified',
  'not_suitable',
])

export const supplyScoutReviewStatusSchema = z.enum([
  'needs_review',
  'approved',
  'rejected',
  'duplicate',
])

export const supplyScoutLeadCreateSchema = z.object({
  name: z.string().trim().min(1).max(180),
  address: z.string().trim().min(4).max(280),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1).max(120).default('San Francisco'),
  state: z.string().trim().min(1).max(20).default('CA'),
  source_platform: supplyScoutSourcePlatformSchema,
  source_url: z.string().trim().url().max(800).nullable().optional(),
  event_title: z.string().trim().max(220).nullable().optional(),
  event_type: z.string().trim().max(120).nullable().optional(),
  evidence_summary: z.string().trim().min(8).max(2000),
  booking_signals: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  disqualifiers: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  website: z.string().trim().url().max(800).nullable().optional(),
  capacity_hint: z.number().int().nonnegative().nullable().optional(),
  price_hint_cents_low: z.number().int().nonnegative().nullable().optional(),
  price_hint_cents_high: z.number().int().nonnegative().nullable().optional(),
  booking_likelihood: supplyScoutBookingLikelihoodSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  operator_notes: z.string().trim().max(2000).nullable().optional(),
})

export const supplyScoutLeadUpdateSchema = z.object({
  id: z.string().uuid(),
  review_status: supplyScoutReviewStatusSchema,
  booking_likelihood: supplyScoutBookingLikelihoodSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  operator_notes: z.string().trim().max(2000).nullable().optional(),
})

export type SupplyScoutLeadCreateInput = z.infer<typeof supplyScoutLeadCreateSchema>
export type SupplyScoutLeadUpdateInput = z.infer<typeof supplyScoutLeadUpdateSchema>
export type SupplyScoutBookingLikelihood = z.infer<typeof supplyScoutBookingLikelihoodSchema>

export type SupplyScoutLeadRow = {
  id: string
  name: string
  address: string
  normalized_name: string
  normalized_address: string
  neighborhood: string | null
  city: string
  state: string
  source_platform: string
  source_url: string | null
  event_title: string | null
  event_type: string | null
  evidence_summary: string
  booking_signals: string[]
  disqualifiers: string[]
  website: string | null
  capacity_hint: number | null
  price_hint_cents_low: number | null
  price_hint_cents_high: number | null
  booking_likelihood: SupplyScoutBookingLikelihood
  confidence: number
  review_status: string
  discovery_venue_id: string | null
  duplicate_of_lead_id: string | null
  created_by: string | null
  reviewed_by: string | null
  metadata: Json | null
  captured_at: string
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

type DiscoveryVenueMatch = {
  id: string
  name: string | null
  address: string | null
  metadata?: unknown
}

const PUBLIC_BOOKABLE_SIGNALS = new Set([
  'official_rental_page',
  'public_reservation_page',
  'permit_page',
  'city_booking_page',
  'library_room',
  'park_permit',
])

const COMMERCIAL_BOOKABLE_SIGNALS = new Set([
  'private_events_page',
  'booking_form',
  'contact_or_booking_form',
  'large_group_language',
  'bar_or_restaurant',
  'abc_license',
  'hosted_similar_event',
  'repeated_events',
])

const HARD_DISQUALIFIERS = new Set([
  'private_home',
  'residential',
  'no_public_address',
  'invite_only_only',
  'school_or_restricted',
])

/**
 * Normalizes venue and address strings for duplicate checks.
 */
export function normalizeScoutText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(street|str)\b/g, 'st')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd')
    .replace(/\b(suite|ste|unit|#)\s*[a-z0-9-]+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeAddress(value: string | null | undefined) {
  return normalizeScoutText(value)
    .replace(/\b(san francisco|sf|california|ca|usa|united states)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasSameNormalizedAddress(
  first: string | null | undefined,
  second: string | null | undefined
) {
  const left = normalizeAddress(first)
  const right = normalizeAddress(second)
  return Boolean(left && right && left === right)
}

/**
 * Classifies booking likelihood from visible evidence only.
 */
export function classifySupplyScoutLead(input: Pick<
  SupplyScoutLeadCreateInput,
  'booking_signals' | 'disqualifiers' | 'source_url' | 'website' | 'evidence_summary' | 'booking_likelihood' | 'confidence'
>) {
  const signals = normalizeTags(input.booking_signals)
  const disqualifiers = normalizeTags(input.disqualifiers)
  const hardDisqualified = disqualifiers.some((tag) => HARD_DISQUALIFIERS.has(tag))

  let bookingLikelihood: SupplyScoutBookingLikelihood = input.booking_likelihood ?? 'event_proven_unverified'
  if (hardDisqualified) {
    bookingLikelihood = 'not_suitable'
  } else if (signals.some((tag) => PUBLIC_BOOKABLE_SIGNALS.has(tag))) {
    bookingLikelihood = 'public_bookable'
  } else if (signals.some((tag) => COMMERCIAL_BOOKABLE_SIGNALS.has(tag))) {
    bookingLikelihood = 'commercial_likely_bookable'
  }

  let confidence = input.confidence ?? 0.45
  confidence += Math.min(0.24, signals.length * 0.06)
  confidence -= Math.min(0.3, disqualifiers.length * 0.1)
  if (input.source_url) confidence += 0.08
  if (input.website) confidence += 0.06
  if (input.evidence_summary.length >= 120) confidence += 0.06
  if (bookingLikelihood === 'public_bookable') confidence += 0.08
  if (bookingLikelihood === 'not_suitable') confidence = Math.min(confidence, 0.35)

  return {
    booking_likelihood: bookingLikelihood,
    confidence: roundToTwo(Math.max(0, Math.min(1, confidence))),
  }
}

export function buildSupplyScoutLeadInsert(
  input: SupplyScoutLeadCreateInput,
  createdBy: string,
  duplicate?: { leadId?: string | null; discoveryVenueId?: string | null }
) {
  const classification = classifySupplyScoutLead(input)
  const normalizedName = normalizeScoutText(input.name)
  const normalizedVenueAddress = normalizeAddress(input.address)
  const isDuplicate = Boolean(duplicate?.leadId || duplicate?.discoveryVenueId)

  return {
    name: input.name,
    address: input.address,
    normalized_name: normalizedName,
    normalized_address: normalizedVenueAddress,
    neighborhood: input.neighborhood ?? null,
    city: input.city,
    state: input.state,
    source_platform: input.source_platform,
    source_url: input.source_url ?? null,
    event_title: input.event_title ?? null,
    event_type: input.event_type ?? null,
    evidence_summary: input.evidence_summary,
    booking_signals: normalizeTags(input.booking_signals),
    disqualifiers: normalizeTags(input.disqualifiers),
    website: input.website ?? null,
    capacity_hint: input.capacity_hint ?? null,
    price_hint_cents_low: input.price_hint_cents_low ?? null,
    price_hint_cents_high: input.price_hint_cents_high ?? null,
    booking_likelihood: classification.booking_likelihood,
    confidence: classification.confidence,
    review_status: isDuplicate ? 'duplicate' : 'needs_review',
    duplicate_of_lead_id: duplicate?.leadId ?? null,
    discovery_venue_id: duplicate?.discoveryVenueId ?? null,
    created_by: createdBy,
    metadata: {
      supply_scout: {
        operator_notes: input.operator_notes ?? null,
        source_urls: input.source_url ? [input.source_url] : [],
        personal_research_session: true,
        duplicate_detected: isDuplicate,
        duplicate_discovery_venue_id: duplicate?.discoveryVenueId ?? null,
        evidence: [
          {
            platform: input.source_platform,
            source_url: input.source_url ?? null,
            event_title: input.event_title ?? null,
            event_type: input.event_type ?? null,
            summary: input.evidence_summary,
            captured_at: new Date().toISOString(),
          },
        ],
      },
    } satisfies Json,
  }
}

export function buildDiscoveryVenueInsertFromLead(lead: SupplyScoutLeadRow, reviewedBy: string) {
  const metadata = readRecord(lead.metadata)
  const supplyScout = readRecord(metadata?.supply_scout)
  const nowIso = new Date().toISOString()

  return {
    name: lead.name,
    address: lead.address,
    neighborhood: lead.neighborhood,
    city: lead.city,
    state: lead.state,
    website: lead.website,
    capacity_standing: lead.capacity_hint,
    capacity_cocktail: lead.capacity_hint,
    price_hint_cents_low: lead.price_hint_cents_low,
    price_hint_cents_high: lead.price_hint_cents_high,
    source: 'scrape',
    source_external_id: `supply_scout:${lead.id}`,
    vibe_tags: buildDiscoveryVibeTags(lead),
    metadata: {
      ...metadata,
      supply_scout: {
        ...supplyScout,
        lead_id: lead.id,
        review_status: 'approved',
        booking_likelihood: lead.booking_likelihood,
        confidence: Number(lead.confidence),
        reviewed_by: reviewedBy,
        reviewed_at: nowIso,
      },
    } satisfies Json,
    last_verified_at: nowIso,
  }
}

export function findDuplicateLead(
  input: SupplyScoutLeadCreateInput,
  existingLeads: Array<Pick<SupplyScoutLeadRow, 'id' | 'normalized_address' | 'review_status'>>
) {
  const normalized = normalizeAddress(input.address)
  return existingLeads.find((lead) => (
    lead.normalized_address === normalized &&
    lead.review_status !== 'rejected'
  )) ?? null
}

export function findDuplicateDiscoveryVenue(
  input: SupplyScoutLeadCreateInput,
  existingVenues: DiscoveryVenueMatch[]
) {
  return existingVenues.find((venue) => hasSameNormalizedAddress(input.address, venue.address)) ?? null
}

export function normalizeTags(values: string[] | null | undefined) {
  return Array.from(new Set(
    (values ?? [])
      .map((value) => normalizeScoutText(value).replace(/\s+/g, '_'))
      .filter(Boolean)
  ))
}

function buildDiscoveryVibeTags(lead: SupplyScoutLeadRow) {
  const tags = new Set<string>()
  normalizeTags([lead.event_type ?? '', ...lead.booking_signals]).forEach((tag) => tags.add(tag))
  tags.add(lead.booking_likelihood)
  tags.add(`source_${lead.source_platform}`)
  return Array.from(tags).slice(0, 16)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100
}
