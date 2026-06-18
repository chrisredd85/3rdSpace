import { readCents } from '@/lib/money'
import type { PricingModel, Venue } from '@/lib/types'

export type VenueRow = Record<string, any>

export const VENUE_SELECT_COLUMNS = `
  id,
  owner_id,
  venue_name,
  slug,
  description,
  venue_type,
  address,
  city,
  state,
  zip_code,
  latitude,
  longitude,
  square_footage,
  standing_capacity,
  seated_capacity,
  pricing_model,
  hourly_rate,
  hourly_rate_cents,
  daily_rate_cents,
  price_per_night_cents,
  minimum_hours,
  bar_revenue_percentage,
  per_head_chi_cents,
  deposit_percentage,
  deposit_due,
  is_published,
  average_rating,
  total_bookings,
  created_at,
  updated_at,
  offers_chis,
  default_kickback_type,
  stripe_account_id,
  ticket_sales_share_enabled,
  ticket_sales_share_pct,
  bar_consumption_share_enabled,
  bar_consumption_share_pct,
  sponsor_consumption_share_enabled,
  sponsor_consumption_share_pct,
  is_claimed,
  is_admin_seeded,
  requires_deposit,
  deposit_amount,
  deposit_amount_cents,
  deposit_type,
  deposit_refundable,
  deposit_terms,
  bulk_approval_enabled,
  auto_approve_threshold,
  auto_approve_conditions,
  unique_features,
  unique_features_tags
`

export const VENUE_LEGACY_SELECT_COLUMNS = `
  id,
  owner_id,
  venue_name,
  slug,
  description,
  venue_type,
  address,
  city,
  state,
  zip_code,
  latitude,
  longitude,
  square_footage,
  standing_capacity,
  seated_capacity,
  pricing_model,
  hourly_rate,
  minimum_hours,
  bar_revenue_percentage,
  per_head_chi_cents,
  deposit_percentage,
  deposit_due,
  is_published,
  average_rating,
  total_bookings,
  created_at,
  updated_at,
  offers_chis,
  default_kickback_type,
  stripe_account_id
`

export const VENUE_DETAIL_SELECT_COLUMNS = VENUE_SELECT_COLUMNS

/**
 * Normalizes the current DB venue shape into the app-facing Venue DTO.
 *
 * The database currently uses legacy column names like venue_name and
 * standing_capacity. App components use friendlier fields like name and
 * capacity, so all read paths should pass through this adapter.
 */
export function normalizeVenue(row: VenueRow): Venue {
  const standingCapacity = row.capacity ?? row.standing_capacity ?? row.seated_capacity ?? 0
  const hourlyRateCents = readCents(row.hourly_rate_cents, row.hourly_rate)
  const dailyRateCents = readCents(row.daily_rate_cents, row.daily_rate)
  const pricePerNightCents = readCents(row.price_per_night_cents, row.price_per_night)
  const depositAmountCents = readCents(row.deposit_amount_cents, row.deposit_amount)
  const perHeadChiCents =
    readCents(
      row.per_head_chi_cents,
      ((row as Record<string, unknown>).per_head_kickback_amount ??
        (row as Record<string, unknown>).per_head_kickback) as number | string | null | undefined
    ) ?? 0
  const autoApproveConditions =
    row.auto_approve_conditions && typeof row.auto_approve_conditions === 'object' && !Array.isArray(row.auto_approve_conditions)
      ? row.auto_approve_conditions as Record<string, unknown>
      : null
  const neighborhood =
    typeof row.neighborhood === 'string'
      ? row.neighborhood
      : typeof autoApproveConditions?.neighborhood === 'string'
        ? autoApproveConditions.neighborhood
        : null

  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name ?? row.venue_name ?? 'Untitled venue',
    description: row.description ?? null,
    venue_type: row.venue_type ?? 'other',
    neighborhood,
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    zip_code: row.zip_code ?? '',
    country: row.country ?? 'USA',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    capacity: standingCapacity,
    min_capacity: row.min_capacity ?? row.seated_capacity ?? null,
    max_capacity: row.max_capacity ?? standingCapacity,
    square_footage: row.square_footage ?? null,
    hourly_rate: hourlyRateCents,
    hourly_rate_cents: hourlyRateCents,
    daily_rate: dailyRateCents ?? pricePerNightCents,
    daily_rate_cents: dailyRateCents,
    price_per_night_cents: pricePerNightCents,
    pricing_model: normalizeVenuePricingModel(row.pricing_model),
    ticket_sales_share_enabled: row.ticket_sales_share_enabled ?? false,
    ticket_sales_share_percent:
      row.ticket_sales_share_percent ?? row.ticket_sales_share_pct ?? 0,
    ticket_consumption_share_percent:
      row.ticket_consumption_share_percent ?? row.ticket_sales_share_percent ?? row.ticket_sales_share_pct ?? 0,
    bar_consumption_share_enabled:
      row.bar_consumption_share_enabled ??
      (row as Record<string, unknown>).bar_revenue_share_enabled ??
      (row as Record<string, unknown>).bar_rev_share_enabled ??
      false,
    bar_consumption_share_percent:
      row.bar_consumption_share_percent ??
      (row as Record<string, unknown>).bar_revenue_share_percent ??
      row.bar_consumption_share_pct ??
      row.bar_revenue_percentage ??
      0,
    per_head_chi_cents: perHeadChiCents,
    bulk_approval_enabled: row.bulk_approval_enabled ?? false,
    auto_approve_threshold: row.auto_approve_threshold ?? null,
    auto_approve_conditions: row.auto_approve_conditions ?? null,
    unique_features: row.unique_features ?? null,
    unique_features_tags: row.unique_features_tags ?? [],
    contact_email: row.contact_email ?? null,
    is_claimed: row.is_claimed ?? false,
    claimed_user_id: row.claimed_user_id ?? null,
    is_admin_seeded: row.is_admin_seeded ?? false,
    requires_deposit: row.requires_deposit ?? depositAmountCents != null,
    deposit_amount: depositAmountCents,
    deposit_amount_cents: depositAmountCents,
    deposit_type: row.deposit_type ?? null,
    deposit_percentage: row.deposit_percentage ?? null,
    deposit_refundable: row.deposit_refundable ?? true,
    deposit_terms: row.deposit_terms ?? null,
    is_active: row.is_active ?? row.is_published ?? true,
    is_verified: row.is_verified ?? row.is_published ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function normalizeVenues(rows: VenueRow[] | null | undefined): Venue[] {
  return (rows || []).map(normalizeVenue)
}

export function toVenueRowInsert(venue: Omit<Venue, 'id' | 'created_at' | 'updated_at'>) {
  return toVenueRowUpdate(venue)
}

export function toVenueRowUpdate(updates: Partial<Omit<Venue, 'id' | 'created_at'>>) {
  const row: Record<string, unknown> = {}

  if (updates.owner_id !== undefined) row.owner_id = updates.owner_id
  if (updates.name !== undefined) row.venue_name = updates.name
  if (updates.description !== undefined) row.description = updates.description
  if (updates.venue_type !== undefined) row.venue_type = updates.venue_type
  if (updates.neighborhood !== undefined) {
    const conditions =
      updates.auto_approve_conditions && typeof updates.auto_approve_conditions === 'object' && !Array.isArray(updates.auto_approve_conditions)
        ? updates.auto_approve_conditions as Record<string, unknown>
        : {}
    row.auto_approve_conditions = {
      ...conditions,
      neighborhood: updates.neighborhood,
    }
  }
  if (updates.address !== undefined) row.address = updates.address
  if (updates.city !== undefined) row.city = updates.city
  if (updates.state !== undefined) row.state = updates.state
  if (updates.zip_code !== undefined) row.zip_code = updates.zip_code
  if (updates.latitude !== undefined) row.latitude = updates.latitude
  if (updates.longitude !== undefined) row.longitude = updates.longitude
  if (updates.capacity !== undefined) row.standing_capacity = updates.capacity
  if (updates.min_capacity !== undefined) row.seated_capacity = updates.min_capacity
  if (updates.max_capacity !== undefined) row.standing_capacity = updates.max_capacity
  if (updates.square_footage !== undefined) row.square_footage = updates.square_footage
  if (updates.hourly_rate_cents !== undefined) row.hourly_rate_cents = updates.hourly_rate_cents
  else if (updates.hourly_rate !== undefined) row.hourly_rate_cents = updates.hourly_rate
  if (updates.daily_rate_cents !== undefined) row.daily_rate_cents = updates.daily_rate_cents
  else if (updates.daily_rate !== undefined) row.daily_rate_cents = updates.daily_rate
  if (updates.price_per_night_cents !== undefined) {
    row.price_per_night_cents = updates.price_per_night_cents
  }
  if (updates.pricing_model !== undefined) row.pricing_model = updates.pricing_model
  if (updates.ticket_sales_share_enabled !== undefined) {
    row.ticket_sales_share_enabled = updates.ticket_sales_share_enabled
  }
  if (updates.ticket_sales_share_percent !== undefined) {
    row.ticket_sales_share_percent = updates.ticket_sales_share_percent
  }
  if (updates.bar_consumption_share_enabled !== undefined) {
    row.bar_consumption_share_enabled = updates.bar_consumption_share_enabled
  }
  if (updates.bar_consumption_share_percent !== undefined) {
    row.bar_consumption_share_percent = updates.bar_consumption_share_percent
  }
  if (updates.per_head_chi_cents !== undefined) {
    row.per_head_chi_cents = updates.per_head_chi_cents
  }
  if (updates.bulk_approval_enabled !== undefined) {
    row.bulk_approval_enabled = updates.bulk_approval_enabled
  }
  if (updates.auto_approve_threshold !== undefined) {
    row.auto_approve_threshold = updates.auto_approve_threshold
  }
  if (updates.auto_approve_conditions !== undefined) {
    row.auto_approve_conditions = updates.auto_approve_conditions
  }
  if (updates.unique_features !== undefined) row.unique_features = updates.unique_features
  if (updates.unique_features_tags !== undefined) {
    row.unique_features_tags = updates.unique_features_tags
  }
  if (updates.requires_deposit !== undefined) row.requires_deposit = updates.requires_deposit
  if (updates.deposit_amount_cents !== undefined) row.deposit_amount_cents = updates.deposit_amount_cents
  else if (updates.deposit_amount !== undefined) row.deposit_amount_cents = updates.deposit_amount
  if (updates.deposit_type !== undefined) row.deposit_type = updates.deposit_type
  if (updates.deposit_percentage !== undefined) {
    row.deposit_percentage = updates.deposit_percentage
  }
  if (updates.deposit_refundable !== undefined) {
    row.deposit_refundable = updates.deposit_refundable
  }
  if (updates.deposit_terms !== undefined) row.deposit_terms = updates.deposit_terms
  if (updates.is_active !== undefined) row.is_published = updates.is_active

  return row
}

function normalizeVenuePricingModel(value: unknown): PricingModel {
  if (value === 'hourly' || value === 'consumption_share' || value === 'hybrid') {
    return value
  }
  if (value === 'flat_rate' || value === 'per_person') {
    return value
  }
  return 'hourly'
}
