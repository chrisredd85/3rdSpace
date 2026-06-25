import { parseNeighborhoodPhrase } from '@/lib/planner/areaParsing'
import { GooglePlacesApiError, GooglePlacesConfigurationError } from '@/lib/server/google-places-client'

export function buildPlacesSearchAreas(neighborhood: string | null): string[] {
  const parsed = parseNeighborhoodPhrase(neighborhood)
  if (parsed.length > 0) return parsed.map((areaId) => areaId.replace(/_/g, ' '))
  return neighborhood ? [neighborhood] : []
}

export function classifyPlacesSearchFailure(error: unknown):
  | 'configuration'
  | 'quota_or_rate_limited'
  | 'api_error'
  | 'network_or_timeout'
  | 'unknown' {
  if (error instanceof GooglePlacesConfigurationError) return 'configuration'
  if (error instanceof GooglePlacesApiError) {
    if (error.status === 429 || error.status === 403) return 'quota_or_rate_limited'
    return 'api_error'
  }
  if (error instanceof Error && /fetch failed|network|timeout|abort/i.test(error.message)) return 'network_or_timeout'
  return 'unknown'
}
