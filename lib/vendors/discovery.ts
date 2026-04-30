import { normalizeVendorProfile } from '@/lib/vendors/profile-adapter'
import type { Vendor } from '@/lib/types'

export type VendorSearchSort = 'rating' | 'price' | 'popularity'

export interface VendorDiscoveryService {
  id: string
  vendor_id: string
  name: string
  description: string | null
  base_price: number
  duration_hours: number | null
  service_category: string
  max_capacity: number | null
  portfolio_images: string[]
  equipment_included: string[]
  type: 'offering' | 'package'
}

export interface VendorDiscoveryResult extends Vendor {
  rating: number
  review_count: number
  total_bookings: number
  starting_price: number | null
  services: VendorDiscoveryService[]
  is_available_on_date?: boolean
}

type VendorRow = Record<string, any>
type ServiceRow = Record<string, any>

const TYPE_ALIASES: Record<string, string> = {
  dj: 'dj',
  'dj / music': 'dj',
  music: 'dj',
  catering: 'catering',
  caterer: 'catering',
  bartending: 'bartending',
  bartender: 'bartending',
  photography: 'photography',
  photographer: 'photography',
  videography: 'videography',
  av: 'av_tech',
  'av tech': 'av_tech',
  'av/tech': 'av_tech',
  audio: 'av_tech',
  'audio visual': 'av_tech',
  event_planning: 'event_planning',
  planning: 'event_planning',
  florist: 'florist',
  floral: 'florist',
  other: 'other',
}

/**
 * Normalizes user-facing service type labels into internal service_type values.
 *
 * @param value - Raw service type query value.
 * @returns Internal service type or null.
 */
export function normalizeVendorType(value: string | null) {
  if (!value) return null
  return TYPE_ALIASES[value.trim().toLowerCase().replace(/-/g, '_')] || TYPE_ALIASES[value.trim().toLowerCase()] || value
}

/**
 * Converts vendor_offerings rows into discovery service cards.
 *
 * @param rows - Raw offering rows.
 * @returns Discovery services.
 */
export function normalizeOfferingRows(rows: ServiceRow[]) {
  return rows.map((row) => ({
    id: row.id,
    vendor_id: row.vendor_id,
    name: row.offering_name,
    description: row.description ?? null,
    base_price: Number(row.base_price || 0),
    duration_hours: row.duration_hours == null ? null : Number(row.duration_hours),
    service_category: row.service_category || 'other',
    max_capacity: row.max_capacity ?? null,
    portfolio_images: row.portfolio_images || [],
    equipment_included: row.equipment_included || [],
    type: 'offering' as const,
  }))
}

/**
 * Converts vendor_packages rows into discovery service cards.
 *
 * @param rows - Raw package rows.
 * @returns Discovery services.
 */
export function normalizePackageRows(rows: ServiceRow[]) {
  return rows.map((row) => ({
    id: row.id,
    vendor_id: row.vendor_id,
    name: row.package_name,
    description: row.description ?? null,
    base_price: Number(row.price || row.base_price || 0),
    duration_hours: row.duration_hours == null ? null : Number(row.duration_hours),
    service_category: 'package',
    max_capacity: null,
    portfolio_images: [],
    equipment_included: Array.isArray(row.inclusions) ? row.inclusions.filter((item: unknown) => typeof item === 'string') : [],
    type: 'package' as const,
  }))
}

/**
 * Builds a discovery result from a vendor profile and its services.
 *
 * @param row - Raw vendor profile row.
 * @param services - Service/package rows for this vendor.
 * @param availableOnDate - Availability flag for date-filtered searches.
 * @returns Enriched vendor discovery result.
 */
export function buildVendorDiscoveryResult(
  row: VendorRow,
  services: VendorDiscoveryService[],
  availableOnDate?: boolean
): VendorDiscoveryResult {
  const vendor = normalizeVendorProfile(row)
  const prices = [
    ...services.map((service) => service.base_price).filter((price) => price > 0),
    Number(row.base_rate || 0),
    Number(row.hourly_rate || 0),
  ].filter((price) => price > 0)

  return {
    ...vendor,
    rating: Number(row.average_rating ?? row.rating ?? 0),
    review_count: Number(row.review_count ?? 0),
    total_bookings: Number(row.total_bookings ?? row.total_gigs ?? 0),
    starting_price: prices.length > 0 ? Math.min(...prices) : null,
    services,
    is_available_on_date: availableOnDate,
  }
}

/**
 * Sorts vendor discovery results for marketplace display.
 *
 * @param vendors - Vendors to sort.
 * @param sort - Sort strategy.
 * @returns Sorted vendors.
 */
export function sortVendorDiscoveryResults(vendors: VendorDiscoveryResult[], sort: VendorSearchSort) {
  return [...vendors].sort((a, b) => {
    if (sort === 'price') {
      return (a.starting_price ?? Number.MAX_SAFE_INTEGER) - (b.starting_price ?? Number.MAX_SAFE_INTEGER)
    }
    if (sort === 'popularity') {
      return b.total_bookings - a.total_bookings
    }
    return b.rating - a.rating
  })
}
