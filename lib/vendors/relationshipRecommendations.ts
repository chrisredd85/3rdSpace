import { normalizeVendorProfile } from '@/lib/vendors/profile-adapter'

export type VendorRecommendationTier = 'your_people' | 'warm_intro' | 'catalog'

export interface TieredVendorRecommendation {
  id: string
  name?: string | null
  service_type?: string | null
  base_rate?: number | null
  suggested_rate: number | null
  suggested_rate_unit?: 'dollars' | 'cents' | null
  suggested_rate_type: string | null
  tier: VendorRecommendationTier
  trust_tier?: string | null
  last_booked_event_name?: string | null
  [key: string]: unknown
}

export interface TieredVendorRecommendations {
  your_people: TieredVendorRecommendation[]
  warm_intro: TieredVendorRecommendation[]
  catalog: TieredVendorRecommendation[]
}

export async function getTieredVendorRecommendations(
  db: any,
  organizerUserId: string,
  opts: { serviceType?: string | null; limit?: number } = {}
): Promise<TieredVendorRecommendations> {
  const limit = opts.limit ?? 60
  const serviceType = opts.serviceType || null

  const { data: relationshipRows } = await db
    .from('organizer_vendor_relationships')
    .select(`
      vendor_id,
      trust_tier,
      vendor_profiles (
        id,
        user_id,
        name,
        vendor_type,
        service_type,
        bio,
        regions_served,
        service_area,
        availability_notes,
        pricing_model,
        hourly_rate,
        base_rate,
        per_person_rate,
        requires_deposit,
        deposit_amount,
        deposit_percentage,
        lead_time_days,
        cancellation_terms,
        emergency_available,
        emergency_rate_uplift,
        is_published,
        is_claimed,
        claimed_user_id,
        is_admin_seeded,
        average_rating,
        rating,
        review_count,
        total_bookings,
        total_gigs,
        created_at,
        updated_at
      )
    `)
    .eq('organizer_user_id', organizerUserId)

  const relationships = ((relationshipRows || []) as any[])
    .map((row) => ({
      vendor_id: row.vendor_id,
      trust_tier: row.trust_tier,
      vendor: row.vendor_profiles,
    }))
    .filter((row) => row.vendor && (!serviceType || row.vendor.service_type === serviceType))

  const vendorIds = relationships.map((row) => row.vendor_id)
  const agreementMap = await loadLatestConfirmedAgreements(db, organizerUserId, vendorIds)

  const yourPeople = relationships.map((row) => {
    const normalized = normalizeVendorProfile(row.vendor as Record<string, unknown>) as any
    const agreement = agreementMap.get(row.vendor_id)
    return {
      ...normalized,
      tier: 'your_people' as const,
      trust_tier: row.trust_tier,
      suggested_rate: agreement?.amount ?? normalizePublicBaseRate(normalized.base_rate),
      suggested_rate_unit: agreement ? 'dollars' : 'cents',
      suggested_rate_type: agreement?.rate_type ?? normalizeRateType(normalized.pricing_model),
      last_booked_event_name: agreement?.event_name ?? null,
    }
  })

  // TODO: Add warm-intro vendors once organizer network/co-attendance tables
  // expose trusted organizer graph data. Keep this empty so private rates never
  // cross organizer boundaries.
  const warmIntro: TieredVendorRecommendation[] = []

  let catalogQuery = db
    .from('vendor_profiles')
    .select(`
      id,
      user_id,
      name,
      vendor_type,
      service_type,
      bio,
      regions_served,
      service_area,
      availability_notes,
      pricing_model,
      hourly_rate,
      base_rate,
      per_person_rate,
      requires_deposit,
      deposit_amount,
      deposit_percentage,
      lead_time_days,
      cancellation_terms,
      emergency_available,
      emergency_rate_uplift,
      is_published,
      is_claimed,
      claimed_user_id,
      is_admin_seeded,
      average_rating,
      rating,
      review_count,
      total_bookings,
      total_gigs,
      created_at,
      updated_at
    `)
    .eq('is_published', true)
    .order('average_rating', { ascending: false, nullsFirst: false })
    .order('total_bookings', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (serviceType) catalogQuery = catalogQuery.eq('service_type', serviceType)
  if (vendorIds.length > 0) catalogQuery = catalogQuery.not('id', 'in', `(${vendorIds.join(',')})`)

  const { data: catalogRows } = await catalogQuery
  const catalog = ((catalogRows || []) as Record<string, unknown>[]).map((row) => {
    const normalized = normalizeVendorProfile(row) as any
    return {
      ...normalized,
      tier: 'catalog' as const,
      suggested_rate: normalizePublicBaseRate(normalized.base_rate),
      suggested_rate_unit: 'cents',
      suggested_rate_type: normalizeRateType(normalized.pricing_model),
      trust_tier: null,
      last_booked_event_name: null,
    }
  })

  return {
    your_people: yourPeople,
    warm_intro: warmIntro,
    catalog,
  }
}

export function flattenTieredVendorRecommendations(tiers: TieredVendorRecommendations) {
  return [
    ...tiers.your_people,
    ...tiers.warm_intro,
    ...tiers.catalog,
  ]
}

export function buildTieredVendorRecommendationsForTest(input: {
  organizerUserId: string
  vendors: Array<{ id: string; base_rate?: number | null; pricing_model?: string | null; [key: string]: unknown }>
  relationships: Array<{ organizer_user_id: string; vendor_id: string; trust_tier?: string | null }>
  confirmedAgreements: Array<{ organizer_user_id: string; vendor_id: string; amount: number; rate_type: string }>
}): TieredVendorRecommendations {
  const relatedVendorIds = new Set(
    input.relationships
      .filter((relationship) => relationship.organizer_user_id === input.organizerUserId)
      .map((relationship) => relationship.vendor_id)
  )

  const yourPeople = input.relationships
    .filter((relationship) => relationship.organizer_user_id === input.organizerUserId)
    .map((relationship) => {
      const vendor = input.vendors.find((item) => item.id === relationship.vendor_id)
      if (!vendor) return null
      const agreement = input.confirmedAgreements.find(
        (item) => item.organizer_user_id === input.organizerUserId && item.vendor_id === vendor.id
      )
      return {
        ...vendor,
        tier: 'your_people' as const,
        suggested_rate: agreement?.amount ?? normalizePublicBaseRate(vendor.base_rate),
        suggested_rate_unit: agreement ? 'dollars' : 'cents',
        suggested_rate_type: agreement?.rate_type ?? normalizeRateType(vendor.pricing_model),
        trust_tier: relationship.trust_tier || 'known',
        last_booked_event_name: null,
      } as TieredVendorRecommendation
    })
    .filter((item): item is TieredVendorRecommendation => Boolean(item))

  const catalog = input.vendors
    .filter((vendor) => !relatedVendorIds.has(vendor.id))
    .map((vendor) => ({
      ...vendor,
      tier: 'catalog' as const,
      suggested_rate: normalizePublicBaseRate(vendor.base_rate),
      suggested_rate_unit: 'cents',
      suggested_rate_type: normalizeRateType(vendor.pricing_model),
      trust_tier: null,
      last_booked_event_name: null,
    } as TieredVendorRecommendation))

  return {
    your_people: yourPeople,
    warm_intro: [],
    catalog,
  }
}

async function loadLatestConfirmedAgreements(db: any, organizerUserId: string, vendorIds: string[]) {
  const agreements = new Map<string, { amount: number; rate_type: string; event_name: string | null }>()
  if (vendorIds.length === 0) return agreements

  const { data: rows } = await db
    .from('vendor_rate_agreements')
    .select('vendor_id, amount, rate_type, source_event_id, confirmed_at')
    .eq('organizer_user_id', organizerUserId)
    .eq('status', 'confirmed')
    .in('vendor_id', vendorIds)
    .order('confirmed_at', { ascending: false })

  for (const row of (rows || []) as any[]) {
    if (agreements.has(row.vendor_id)) continue
    agreements.set(row.vendor_id, {
      amount: Number(row.amount),
      rate_type: row.rate_type,
      event_name: null,
    })
  }

  const eventIds = Array.from(new Set(((rows || []) as any[]).map((row) => row.source_event_id).filter(Boolean)))
  if (eventIds.length > 0) {
    const { data: events } = await db
      .from('events')
      .select('id, event_name')
      .in('id', eventIds)
    const eventMap = new Map(((events || []) as any[]).map((event) => [event.id, event.event_name]))
    for (const row of (rows || []) as any[]) {
      const agreement = agreements.get(row.vendor_id)
      if (agreement && !agreement.event_name && row.source_event_id) {
        agreement.event_name = eventMap.get(row.source_event_id) || null
      }
    }
  }

  return agreements
}

function normalizePublicBaseRate(value: unknown) {
  return typeof value === 'number' ? value : null
}

function normalizeRateType(value: unknown) {
  if (value === 'flat_rate') return 'flat'
  if (value === 'flat' || value === 'per_person' || value === 'hourly') return value
  return null
}
