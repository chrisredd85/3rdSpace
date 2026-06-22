import type { EventArchetypeConfig, MatchingField, ServiceType, VendorStackItem } from '@/lib/planner/archetypes'
import { readPlanVendorNeedStatus } from '@/lib/planner/vendorNeedStatus'
import type { Plan } from '@/lib/types'

type MutableVendorStackItem = VendorStackItem

export function buildPlanVendorStack(
  archetype: EventArchetypeConfig,
  plan: Plan
): VendorStackItem[] {
  if (readPlanVendorNeedStatus(plan) === 'none') return []

  const stack = archetype.vendor_stack.map((item) => ({ ...item }))
  const musicFormat = normalizeSignal(readPlanMatchingSignal(plan, 'music_format'))
  const photoVideoPriority = normalizeSignal(readPlanMatchingSignal(plan, 'photo_video_priority'))
  const cateringStyle = normalizeSignal(readPlanMatchingSignal(plan, 'catering_style'))
  const securityNeeds = normalizeSignal(readPlanMatchingSignal(plan, 'security_needs'))
  const avIntensity = normalizeSignal(readPlanMatchingSignal(plan, 'av_intensity'))
  const decorIntensity = normalizeSignal(readPlanMatchingSignal(plan, 'decor_intensity'))
  const checkInNeeds = normalizeSignal(readPlanMatchingSignal(plan, 'check_in_needs'))
  const barRequired = readPlanMatchingBoolean(plan, 'bar_required')

  if (musicFormat === 'dj') {
    ensureStackItem(stack, 'dj', 'required', 'DJ requested for this plan.')
    removeStackItem(stack, 'music_coordinator')
  } else if (musicFormat === 'live') {
    removeStackItem(stack, 'dj')
    ensureStackItem(stack, 'music_coordinator', 'required', 'Live music coordination requested for this plan.')
  } else if (musicFormat === 'both') {
    ensureStackItem(stack, 'dj', 'required', 'DJ requested for this plan.')
    ensureStackItem(stack, 'music_coordinator', 'recommended', 'Live music coordination may be needed for this plan.')
  } else if (musicFormat === 'none') {
    removeStackItem(stack, 'dj')
    removeStackItem(stack, 'music_coordinator')
  }

  if (photoVideoPriority === 'both') {
    ensureStackItem(stack, 'photographer', 'required', 'Photo coverage requested for this plan.')
    ensureStackItem(stack, 'videographer', 'required', 'Video coverage requested for this plan.')
  } else if (photoVideoPriority === 'video') {
    ensureStackItem(stack, 'videographer', 'required', 'Video coverage requested for this plan.')
    demoteStackItem(stack, 'photographer', 'optional')
  } else if (photoVideoPriority === 'photographer') {
    ensureStackItem(stack, 'photographer', 'required', 'Photo coverage requested for this plan.')
  } else if (photoVideoPriority === 'none') {
    removeStackItem(stack, 'photographer')
    removeStackItem(stack, 'videographer')
  }

  if (cateringStyle === 'outside') {
    ensureStackItem(stack, 'catering', 'required', 'Outside catering requested for this plan.')
  } else if (cateringStyle === 'venue_handles') {
    removeStackItem(stack, 'catering')
  } else if (cateringStyle === 'sponsor_provided') {
    demoteStackItem(stack, 'catering', 'optional')
  }

  if (securityNeeds === 'full_staff') {
    ensureStackItem(stack, 'security', 'required', 'Full security staffing requested for this plan.')
  } else if (securityNeeds === 'door') {
    ensureStackItem(stack, 'security', 'recommended', 'Door staff requested for this plan.')
  } else if (securityNeeds === 'none') {
    removeStackItem(stack, 'security')
  }

  if (avIntensity === 'heavy') {
    ensureStackItem(stack, 'av_production', 'required', 'Heavy AV or production requested for this plan.')
  } else if (avIntensity === 'standard') {
    ensureStackItem(stack, 'av_production', 'recommended', 'Standard AV requested for this plan.')
  }

  if (decorIntensity === 'full_production') {
    ensureStackItem(stack, 'decor', 'required', 'Full decor or brand production requested for this plan.')
  } else if (decorIntensity === 'themed') {
    ensureStackItem(stack, 'decor', 'recommended', 'Themed decor requested for this plan.')
  }

  if (checkInNeeds === 'ticket_scan') {
    ensureStackItem(stack, 'check_in', 'recommended', 'Ticket scan check-in requested for this plan.')
  } else if (checkInNeeds === 'walk_in_list') {
    ensureStackItem(stack, 'check_in', 'optional', 'Walk-in list support may help this plan.')
  } else if (checkInNeeds === 'none') {
    removeStackItem(stack, 'check_in')
  }

  if (barRequired === true) {
    ensureStackItem(stack, 'bartending', 'recommended', 'Bar support requested for this plan.')
  } else if (barRequired === false) {
    removeStackItem(stack, 'bartending')
  }

  return stack
}

export function withPlanVendorStack(
  archetype: EventArchetypeConfig,
  plan: Plan
): EventArchetypeConfig {
  return {
    ...archetype,
    vendor_stack: buildPlanVendorStack(archetype, plan),
  }
}

export function applyArchetypeDefaultFills(plan: Plan, archetype: EventArchetypeConfig): Plan {
  const existingMetadata = readRecord(plan.metadata) ?? {}
  const existingSignals = readRecord(existingMetadata.matching_signals) ?? {}
  const nextSignals = { ...existingSignals }
  let changed = false

  for (const [field, value] of Object.entries(archetype.default_fills) as Array<[MatchingField, unknown]>) {
    if (value === undefined || value === null) continue
    if (readPlanMatchingSignal(plan, field) !== null) continue
    nextSignals[field] = value
    changed = true
  }

  if (!changed) return plan

  return {
    ...plan,
    metadata: {
      ...existingMetadata,
      matching_signals: nextSignals,
    } as Plan['metadata'],
  }
}

export function readPlanMatchingSignal(plan: Plan, field: MatchingField): unknown {
  if (field === 'event_type') return plan.event_type
  if (field === 'neighborhood') return plan.neighborhood
  if (field === 'guest_count') return plan.guest_count
  if (field === 'date_window') return plan.date_window_start ?? plan.date_window_end
  if (field === 'budget_cap_cents') return plan.budget_cap_cents
  if (field === 'ticketed') return plan.ticketed
  if (field === 'food_responsibility') return plan.food_responsibility

  const metadata = readRecord(plan.metadata)
  const direct = metadata?.[field]
  if (direct !== undefined && direct !== null) return direct
  const matchingSignals = readRecord(metadata?.matching_signals)
  const matchingValue = matchingSignals?.[field]
  if (matchingValue !== undefined && matchingValue !== null) return matchingValue
  const eventRequirements = readRecord(metadata?.event_requirements)
  const requirementValue = eventRequirements?.[field]
  if (requirementValue !== undefined && requirementValue !== null) return requirementValue
  return null
}

export function readPlanMatchingBoolean(plan: Plan, field: MatchingField): boolean | null {
  const value = readPlanMatchingSignal(plan, field)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = normalizeSignal(value)
    if (['true', 'yes', 'required', 'needed'].includes(normalized)) return true
    if (['false', 'no', 'none', 'not_needed'].includes(normalized)) return false
  }
  return null
}

export function normalizeSignal(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function ensureStackItem(
  stack: MutableVendorStackItem[],
  serviceType: ServiceType,
  necessity: VendorStackItem['necessity'],
  notes: string
): void {
  const existing = stack.find((item) => item.service_type === serviceType)
  if (!existing) {
    stack.push({ service_type: serviceType, necessity, notes })
    return
  }

  existing.necessity = strongerNecessity(existing.necessity, necessity)
  existing.notes = existing.notes ?? notes
}

function removeStackItem(stack: MutableVendorStackItem[], serviceType: ServiceType): void {
  const index = stack.findIndex((item) => item.service_type === serviceType)
  if (index >= 0) stack.splice(index, 1)
}

function demoteStackItem(
  stack: MutableVendorStackItem[],
  serviceType: ServiceType,
  necessity: VendorStackItem['necessity']
): void {
  const existing = stack.find((item) => item.service_type === serviceType)
  if (existing) existing.necessity = necessity
}

function strongerNecessity(
  first: VendorStackItem['necessity'],
  second: VendorStackItem['necessity']
): VendorStackItem['necessity'] {
  const rank: Record<VendorStackItem['necessity'], number> = { optional: 0, conditional: 1, recommended: 2, required: 3 }
  return rank[first] >= rank[second] ? first : second
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
