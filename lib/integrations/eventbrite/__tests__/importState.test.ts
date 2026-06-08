import {
  deriveEventbritePlannerImportStatus,
  eventbriteBackfillUniqueKey,
} from '@/lib/integrations/eventbrite/importState'

describe('Eventbrite import state', () => {
  it('treats imported planner data as the source of truth over job state', () => {
    expect(deriveEventbritePlannerImportStatus({ imported: true, latestJobStatus: 'running' })).toBe('imported')
    expect(deriveEventbritePlannerImportStatus({ imported: true, latestJobStatus: 'failed' })).toBe('imported')
  })

  it('derives visible planner import status from queued job state before import exists', () => {
    expect(deriveEventbritePlannerImportStatus({ imported: false, latestJobStatus: 'pending' })).toBe('queued')
    expect(deriveEventbritePlannerImportStatus({ imported: false, latestJobStatus: 'running' })).toBe('running')
    expect(deriveEventbritePlannerImportStatus({ imported: false, latestJobStatus: 'dead' })).toBe('failed')
    expect(deriveEventbritePlannerImportStatus({ imported: false, latestJobStatus: null })).toBe('ready')
  })

  it('builds a stable per-builder import job key', () => {
    expect(eventbriteBackfillUniqueKey('builder-1', 'eventbrite-1')).toBe(
      'eventbrite-backfill:builder-1:eventbrite-1'
    )
  })
})
