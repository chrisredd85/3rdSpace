export type EventbriteImportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'

export type EventbritePlannerImportStatus = 'ready' | 'queued' | 'running' | 'imported' | 'failed'

export type EventbriteImportStatusInput = {
  imported: boolean
  latestJobStatus?: EventbriteImportJobStatus | null
}

/**
 * Imported records are the source of truth; active jobs only describe work that
 * has not produced planner-visible Eventbrite data yet.
 */
export function deriveEventbritePlannerImportStatus({
  imported,
  latestJobStatus,
}: EventbriteImportStatusInput): EventbritePlannerImportStatus {
  if (imported) return 'imported'
  if (latestJobStatus === 'pending') return 'queued'
  if (latestJobStatus === 'running') return 'running'
  if (latestJobStatus === 'failed' || latestJobStatus === 'dead') return 'failed'
  return 'ready'
}

export function eventbriteBackfillUniqueKey(builderId: string, eventbriteEventId: string) {
  return `eventbrite-backfill:${builderId}:${eventbriteEventId}`
}
