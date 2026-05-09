import type { EventArchetypeConfig, ServiceType, VendorStackItem } from '@/lib/planner/archetypes/types'
import type { Plan } from '@/lib/types'

export type Vendor = Record<string, unknown> & {
  id: string
  service_type?: string | null
  vendor_type?: string | null
  is_published?: boolean | null
  service_area?: string | null
  regions_served?: string | null
  availability_status?: string | null
  base_rate?: number | null
  hourly_rate?: number | null
  has_insurance?: boolean | null
  manual_availability_blocks?: Array<{ date: string; status: string | null }>
}

export type Venue = Record<string, unknown> & {
  id?: string | null
  city?: string | null
  neighborhood?: string | null
  address?: string | null
  base_rate?: number | null
  hourly_rate?: number | null
  minimum_hours?: number | null
  preferred_vendor_ids?: string[] | null
}

export type GateResult = {
  passes: boolean
  failed: Array<{ gate: string; reason: string }>
}

export function passesVendorGates(
  vendor: Vendor,
  plan: Plan,
  archetype: EventArchetypeConfig,
  chosenVenue: Venue | null,
  stackItem: VendorStackItem,
  remainingBudgetCents: number
): GateResult {
  const failed: GateResult['failed'] = []
  const vendorServiceType = normalizeServiceType(readString(vendor.service_type ?? vendor.vendor_type))

  if (vendorServiceType !== stackItem.service_type) {
    failed.push({
      gate: 'service_type',
      reason: `Vendor service type ${vendorServiceType ?? 'unknown'} does not match ${stackItem.service_type}.`,
    })
  }

  if (!vendorCoversVenueArea(vendor, chosenVenue)) {
    failed.push({
      gate: 'geo',
      reason: 'Vendor service area does not cover the selected venue area.',
    })
  }

  const availabilityStatus = readString(vendor.availability_status) ?? 'available'
  if (normalizeText(availabilityStatus) !== 'available') {
    failed.push({
      gate: 'availability',
      reason: `Vendor availability is ${availabilityStatus}.`,
    })
  }

  if (hasManualDateBlock(vendor, plan)) {
    failed.push({
      gate: 'availability',
      reason: 'Vendor has a manual availability block during the plan date window.',
    })
  }

  const baseRate = readMoneyCents(vendor.base_rate ?? vendor.hourly_rate)
  const maxBudgetShare = getBudgetShareLimit(stackItem.necessity)
  if (baseRate === null) {
    failed.push({
      gate: 'budget_headroom',
      reason: 'Vendor is missing a base rate.',
    })
  } else if (remainingBudgetCents > 0 && baseRate > remainingBudgetCents * maxBudgetShare) {
    failed.push({
      gate: 'budget_headroom',
      reason: `Vendor base rate ${baseRate} exceeds ${Math.round(maxBudgetShare * 100)}% of remaining budget.`,
    })
  }

  if (vendor.is_published !== true) {
    failed.push({
      gate: 'published',
      reason: 'Vendor is not published.',
    })
  }

  if (requiresInsurance(archetype, stackItem.service_type) && vendor.has_insurance !== true) {
    failed.push({
      gate: 'insurance',
      reason: `${stackItem.service_type} requires insurance for this archetype.`,
    })
  }

  return {
    passes: failed.length === 0,
    failed,
  }
}

export function normalizeServiceType(value: string | null | undefined): ServiceType | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  if (normalized === 'photography') return 'photographer'
  if (normalized === 'videography') return 'videographer'
  if (normalized === 'av' || normalized === 'av tech' || normalized === 'av_tech' || normalized === 'production') return 'av_production'
  if (normalized === 'bar' || normalized === 'bartender') return 'bartending'
  if (normalized === 'event planning' || normalized === 'event_planning') return 'staffing'
  if (normalized === 'floral') return 'florist'
  if (SERVICE_TYPES.has(normalized as ServiceType)) return normalized as ServiceType
  return null
}

export function toDbVendorServiceTypes(serviceType: ServiceType): string[] {
  if (serviceType === 'photographer') return ['photographer', 'photography']
  if (serviceType === 'videographer') return ['videographer', 'videography']
  if (serviceType === 'av_production') return ['av_production', 'av_tech']
  if (serviceType === 'check_in' || serviceType === 'security' || serviceType === 'staffing') {
    return [serviceType, 'event_planning']
  }
  if (serviceType === 'florist' || serviceType === 'decor' || serviceType === 'lighting') {
    return [serviceType, 'florist']
  }
  return [serviceType]
}

export function readMoneyCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  }
  return null
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = readString(item)
      return text ? [text] : []
    })
  }
  const text = readString(value)
  if (!text) return []
  return text.split(/[,;|]/).map((item) => item.trim()).filter(Boolean)
}

export function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ') ?? ''
}

function vendorCoversVenueArea(vendor: Vendor, chosenVenue: Venue | null): boolean {
  if (!chosenVenue) return true
  const serviceArea = normalizeText([
    vendor.service_area,
    vendor.regions_served,
    vendor.travel_radius,
  ].map((value) => (typeof value === 'string' ? value : '')).join(' '))
  if (!serviceArea) return true

  const city = normalizeText(chosenVenue.city)
  const neighborhood = normalizeText(chosenVenue.neighborhood)
  const address = normalizeText(chosenVenue.address)
  if (serviceArea.includes('bay area') || serviceArea.includes('all sf') || serviceArea.includes('san francisco')) {
    return !city || city.includes('san francisco') || city === 'sf'
  }

  return [city, neighborhood, address]
    .filter(Boolean)
    .some((target) => serviceArea.includes(target))
}

function hasManualDateBlock(vendor: Vendor, plan: Plan): boolean {
  const dateWindow = getPlanDateWindow(plan)
  if (dateWindow.length === 0) return false
  const blocks = Array.isArray(vendor.manual_availability_blocks) ? vendor.manual_availability_blocks : []
  const blockedStatuses = new Set(['blocked', 'booked', 'unavailable'])
  return blocks.some((block) =>
    dateWindow.includes(block.date) && blockedStatuses.has(normalizeText(block.status))
  )
}

function getPlanDateWindow(plan: Plan): string[] {
  const start = readString(plan.date_window_start)
  const end = readString(plan.date_window_end)
  if (!start && !end) return []
  if (!start || !end || start === end) return [start ?? end].filter((date): date is string => Boolean(date))

  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (Number.isFinite(cursor.getTime()) && Number.isFinite(last.getTime()) && cursor <= last && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function getBudgetShareLimit(necessity: VendorStackItem['necessity']): number {
  if (necessity === 'required') return 0.6
  if (necessity === 'recommended') return 0.3
  return 0.15
}

function requiresInsurance(archetype: EventArchetypeConfig, serviceType: ServiceType): boolean {
  const requiredInsurance = readStringArray((archetype as EventArchetypeConfig & { required_insurance?: string[] }).required_insurance)
  return requiredInsurance.map(normalizeServiceType).includes(serviceType)
}

const SERVICE_TYPES = new Set<ServiceType>([
  'photographer',
  'videographer',
  'dj',
  'catering',
  'bartending',
  'av_production',
  'check_in',
  'security',
  'decor',
  'staffing',
  'instructor',
  'transport',
  'cake_pastry',
  'photo_booth',
  'florist',
  'lighting',
  'permits',
  'pos_systems',
])
