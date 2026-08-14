/**
 * Keep this list in lockstep with discovery_change_source_check.
 * The regression test also reads the creating migration so schema and writer
 * drift fail in CI instead of surfacing in the scheduled refresh job.
 */
export const DISCOVERY_CHANGE_LOG_SOURCES = [
  'places_refresh',
  'outreach_extraction',
  'admin_override',
  'vendor_self_update',
  'stripe_account_event',
  'organizer_report',
] as const

export type DiscoveryChangeLogSource = typeof DISCOVERY_CHANGE_LOG_SOURCES[number]

export const PLACES_REFRESH_CHANGE_SOURCE = 'places_refresh' satisfies DiscoveryChangeLogSource
