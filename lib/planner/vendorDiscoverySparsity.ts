import type { VendorLocationPolicyPlan } from '@/lib/planner/geography'
import { canonicalCity, deriveEventCity, getAdjacentCities } from '@/lib/planner/geography'

export type VendorPoolSparsityResult = {
  sparse: boolean
  in_city_count: number
  in_city_threshold: number
  adjacent_cities: string[]
  suggested_prompt: string | null
}

export type VendorPoolCandidate = {
  city?: string | null
  formatted_address?: string | null
  service_type?: string | null
}

const DEFAULT_IN_CITY_THRESHOLD = 3

export function evaluateVendorPoolSparsity(opts: {
  plan: VendorLocationPolicyPlan
  serviceType: string
  results: VendorPoolCandidate[]
  threshold?: number
}): VendorPoolSparsityResult {
  const eventCity = canonicalCity(opts.plan.event_city) ?? deriveEventCity(opts.plan.neighborhood)
  const threshold = opts.threshold ?? DEFAULT_IN_CITY_THRESHOLD
  const inCityCount = eventCity
    ? opts.results.filter((candidate) => {
      const city = canonicalCity(candidate.city) ?? canonicalCity(candidate.formatted_address)
      return city === eventCity
    }).length
    : opts.results.length
  const adjacentCities = getAdjacentCities(eventCity)
  const sparse = Boolean(
    eventCity &&
    inCityCount < threshold &&
    !opts.plan.vendor_out_of_city_approved &&
    adjacentCities.length > 0
  )

  return {
    sparse,
    in_city_count: inCityCount,
    in_city_threshold: threshold,
    adjacent_cities: adjacentCities,
    suggested_prompt: sparse
      ? buildSparsePrompt({
        serviceType: opts.serviceType,
        eventCity: eventCity ?? 'the event city',
        inCityCount,
        adjacentCities,
      })
      : null,
  }
}

export function buildSparsePrompt(input: {
  serviceType: string
  eventCity: string
  inCityCount: number
  adjacentCities: string[]
}): string {
  const serviceLabel = input.serviceType.replace(/_/g, ' ')
  const adjacent = formatCityList(input.adjacentCities.slice(0, 4))
  const countLabel = input.inCityCount === 1 ? '1 in-city option' : `${input.inCityCount} in-city options`
  return `I found only ${countLabel} for ${serviceLabel} in ${input.eventCity}. Want me to widen vendor sourcing to nearby cities like ${adjacent}? I will not send outreach until you approve the updated shortlist.`
}

function formatCityList(cities: string[]): string {
  if (cities.length === 0) return 'nearby cities'
  if (cities.length === 1) return cities[0] ?? 'nearby cities'
  if (cities.length === 2) return `${cities[0]} or ${cities[1]}`
  return `${cities.slice(0, -1).join(', ')}, or ${cities[cities.length - 1]}`
}
