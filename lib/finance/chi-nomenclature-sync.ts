export const LEGACY_EVENT_REVENUE_TERM_TYPES = [
  'venue_kickback',
  'vendor_rev_share',
] as const

export const CHI_EVENT_REVENUE_TERM_TYPES = [
  'venue_chi',
  'vendor_consumption_share',
] as const

export type LegacyEventRevenueTermType = typeof LEGACY_EVENT_REVENUE_TERM_TYPES[number]
export type ChiEventRevenueTermType = typeof CHI_EVENT_REVENUE_TERM_TYPES[number]

const LEGACY_TO_CHI_TERM_TYPE: Record<LegacyEventRevenueTermType, ChiEventRevenueTermType> = {
  venue_kickback: 'venue_chi',
  vendor_rev_share: 'vendor_consumption_share',
}

const CHI_TO_LEGACY_TERM_TYPE: Record<ChiEventRevenueTermType, LegacyEventRevenueTermType> = {
  venue_chi: 'venue_kickback',
  vendor_consumption_share: 'vendor_rev_share',
}

export function canonicalizeEventRevenueTermType<T extends string>(termType: T): T | ChiEventRevenueTermType {
  if (isLegacyEventRevenueTermType(termType)) return LEGACY_TO_CHI_TERM_TYPE[termType]
  return termType
}

export function legacyEventRevenueTermType<T extends string>(termType: T): T | LegacyEventRevenueTermType {
  if (isChiEventRevenueTermType(termType)) return CHI_TO_LEGACY_TERM_TYPE[termType]
  return termType
}

export function isVenueChiTerm(termType: string) {
  const canonical = canonicalizeEventRevenueTermType(termType)
  return canonical === 'venue_chi'
}

export function isVendorConsumptionShareTerm(termType: string) {
  const canonical = canonicalizeEventRevenueTermType(termType)
  return canonical === 'vendor_consumption_share'
}

export function withConsumptionShareFlag<T extends Record<string, unknown>>(payload: T): T & {
  is_legacy_consumption_share: boolean
  is_legacy_revenue_share: boolean
} {
  const flag = Boolean(payload.is_legacy_consumption_share ?? payload.is_legacy_revenue_share ?? false)
  return {
    ...payload,
    is_legacy_consumption_share: flag,
    is_legacy_revenue_share: flag,
  }
}

function isLegacyEventRevenueTermType(value: string): value is LegacyEventRevenueTermType {
  return (LEGACY_EVENT_REVENUE_TERM_TYPES as readonly string[]).includes(value)
}

function isChiEventRevenueTermType(value: string): value is ChiEventRevenueTermType {
  return (CHI_EVENT_REVENUE_TERM_TYPES as readonly string[]).includes(value)
}
