export const ADJACENT_CITIES: Record<string, string[]> = {
  Oakland: ['Berkeley', 'Emeryville', 'Alameda', 'San Francisco'],
  Berkeley: ['Oakland', 'Emeryville', 'Albany', 'El Cerrito'],
  'San Francisco': ['Oakland', 'Berkeley', 'Daly City'],
  'San Jose': ['Santa Clara', 'Sunnyvale', 'Campbell', 'Milpitas'],
  'Santa Clara': ['San Jose', 'Sunnyvale', 'Milpitas'],
  Sunnyvale: ['Santa Clara', 'Mountain View', 'San Jose'],
  'Mountain View': ['Sunnyvale', 'Palo Alto', 'Los Altos'],
  'Palo Alto': ['Menlo Park', 'Mountain View', 'Redwood City'],
  'Redwood City': ['Palo Alto', 'Menlo Park', 'San Mateo'],
  'San Mateo': ['Burlingame', 'Redwood City', 'South San Francisco'],
  Alameda: ['Oakland', 'Emeryville', 'Berkeley'],
  Emeryville: ['Oakland', 'Berkeley', 'Alameda'],
  'Daly City': ['San Francisco', 'South San Francisco'],
}

const NEIGHBORHOOD_CITY_ALIASES: Array<{ city: string; aliases: string[] }> = [
  {
    city: 'Oakland',
    aliases: ['oakland', 'downtown oakland', 'uptown oakland', 'rockridge', 'jack london', 'jack london square', 'temescal', 'lake merritt'],
  },
  {
    city: 'San Francisco',
    aliases: ['san francisco', 'sf', 'the city', 'mission', 'soma', 'south of market', 'castro', 'marina', 'fillmore', 'north beach', 'outer sunset', 'sunset', 'hayes valley', 'dogpatch', 'fidi', 'financial district', 'embarcadero', 'nopa', 'nob hill'],
  },
  {
    city: 'Berkeley',
    aliases: ['berkeley', 'downtown berkeley', 'north berkeley', 'south berkeley'],
  },
  {
    city: 'San Jose',
    aliases: ['san jose', 'downtown san jose'],
  },
  {
    city: 'Santa Clara',
    aliases: ['santa clara'],
  },
  {
    city: 'Sunnyvale',
    aliases: ['sunnyvale'],
  },
  {
    city: 'Palo Alto',
    aliases: ['palo alto'],
  },
  {
    city: 'San Mateo',
    aliases: ['san mateo'],
  },
  {
    city: 'Alameda',
    aliases: ['alameda'],
  },
  {
    city: 'Emeryville',
    aliases: ['emeryville'],
  },
]

export type VendorLocationPolicyPlan = {
  neighborhood?: string | null
  event_city?: string | null
  vendor_same_city_required?: boolean | null
  vendor_out_of_city_approved?: boolean | null
  vendor_approved_adjacent_cities?: string[] | null
  special_supply_radius_miles?: number | null
  metadata?: unknown
}

export type VendorLocationCandidate = {
  city?: string | null
  formatted_address?: string | null
  address?: string | null
  service_area?: string | null
  regions_served?: string | null
  availability_notes?: string | null
  neighborhood?: string | null
}

export function deriveEventCity(neighborhoods: Array<string | null | undefined> | string | null | undefined): string | null {
  const values = Array.isArray(neighborhoods) ? neighborhoods : [neighborhoods]
  for (const value of values) {
    const city = extractCity(value)
    if (city) return city
  }
  return null
}

export function getAdjacentCities(city: string | null | undefined): string[] {
  const normalized = canonicalCity(city)
  return normalized ? ADJACENT_CITIES[normalized] ?? [] : []
}

export function extractCity(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  for (const entry of NEIGHBORHOOD_CITY_ALIASES) {
    if (entry.aliases.some((alias) => normalized.includes(alias))) return entry.city
  }
  return null
}

export function canonicalCity(value: string | null | undefined): string | null {
  if (!value) return null
  const direct = NEIGHBORHOOD_CITY_ALIASES.find((entry) => normalizeText(entry.city) === normalizeText(value))
  if (direct) return direct.city
  return extractCity(value)
}

export function vendorServiceAreaIncludes(vendor: VendorLocationCandidate, city: string | null | undefined): boolean {
  const normalizedCity = normalizeText(city)
  if (!normalizedCity) return false
  const serviceText = normalizeText([
    vendor.service_area,
    vendor.regions_served,
    vendor.availability_notes,
  ].filter(Boolean).join(' '))
  if (!serviceText) return false
  if (serviceText.includes('bay area')) return true
  return serviceText.includes(normalizedCity)
}

export function computeVendorLocationScore(vendor: VendorLocationCandidate, plan: VendorLocationPolicyPlan): number {
  const eventCity = canonicalCity(plan.event_city) ?? deriveEventCity(plan.neighborhood)
  if (!eventCity) return 0

  const vendorCity =
    canonicalCity(vendor.city) ??
    extractCity(vendor.formatted_address) ??
    extractCity(vendor.address)

  if (!vendorCity) {
    return vendorServiceAreaIncludes(vendor, eventCity) ? -6 : -12
  }

  if (vendorCity === eventCity) {
    const eventArea = normalizeText(plan.neighborhood)
    const vendorArea = normalizeText([vendor.neighborhood, vendor.formatted_address, vendor.address].filter(Boolean).join(' '))
    return eventArea && vendorArea.includes(eventArea) ? 2 : 0
  }

  if (plan.vendor_out_of_city_approved) {
    const approvedCities = new Set((plan.vendor_approved_adjacent_cities ?? []).map(canonicalCity).filter(Boolean))
    return approvedCities.has(vendorCity) ? -3 : -8
  }

  if (vendorServiceAreaIncludes(vendor, eventCity)) return -10

  return -50
}

export function isVendorEligibleForDefaultCityPolicy(vendor: VendorLocationCandidate, plan: VendorLocationPolicyPlan): boolean {
  return computeVendorLocationScore(vendor, plan) > -50
}

export function formatVendorLocationContext(vendor: VendorLocationCandidate, plan: VendorLocationPolicyPlan): string | null {
  const eventCity = canonicalCity(plan.event_city) ?? deriveEventCity(plan.neighborhood)
  const vendorCity = canonicalCity(vendor.city) ?? extractCity(vendor.formatted_address) ?? extractCity(vendor.address)
  if (!vendorCity) return null
  if (!eventCity || vendorCity === eventCity) return vendor.neighborhood ?? vendorCity
  if (plan.vendor_out_of_city_approved) return `${vendorCity} - approved`
  if (vendorServiceAreaIncludes(vendor, eventCity)) return `${vendorCity} - serves ${eventCity}`
  return `${vendorCity} - confirm if you want vendors from outside ${eventCity}`
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}
