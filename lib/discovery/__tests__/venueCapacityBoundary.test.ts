jest.mock('server-only', () => ({}))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))
jest.mock('../inferCapacity', () => ({ inferVenueCapacity: jest.fn(), shouldSkipVenueCapacityInference: jest.fn(() => false) }))

import { runVenueCapacityInferenceJob, type VenueCapacityJobClient } from '../venueCapacityJobs'
import { independentVenueEvidence } from '../venueRepository'
import { inferVenueCapacity } from '../inferCapacity'
import { completeJob, enqueueJob, failJob, type AppJob, type SupabaseJobClient } from '@/lib/server/job-queue'

const originalKey = process.env.OPENAI_API_KEY
beforeEach(() => { jest.clearAllMocks(); process.env.OPENAI_API_KEY = 'local-fake-model-key' })
afterAll(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey })
function capacityDb(independent: boolean) {
  const row = { id: 'venue-one', source: 'google_places', source_external_id: 'place-one', name: independent ? 'Independent Hall' : 'GOOGLE_CANARY', website: independent ? 'https://hall.example/events' : 'https://GOOGLE_CANARY.example', google_rating: 4.9, metadata: independent ? { field_provenance: {
    name: independentVenueEvidence('venue_site', 'https://hall.example/events'), website: independentVenueEvidence('venue_site', 'https://hall.example/events'),
  } } : {} }
  const query = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }) }
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
  const rpc = jest.fn().mockResolvedValue({ data: null, error: null })
  return { db: { from: jest.fn().mockReturnValue(query), rpc } as unknown as VenueCapacityJobClient, rpc }
}
it('does not send an unresolved legacy venue or raw queued snippet to inference', async () => {
  const legacy = capacityDb(false)
  expect(await runVenueCapacityInferenceJob(legacy.db, { discoveryVenueId: 'venue-one' })).toMatchObject({ reason: 'independent_evidence_required' })
  const independent = capacityDb(true)
  await expect(runVenueCapacityInferenceJob(independent.db, { discoveryVenueId: 'venue-one', websiteSnippet: 'GOOGLE_CANARY' })).rejects.toThrow('Unversioned')
  expect(inferVenueCapacity).not.toHaveBeenCalled()
  expect(legacy.rpc).not.toHaveBeenCalled(); expect(independent.rpc).not.toHaveBeenCalled()
})
it('writes only independently derived capacity, with exact parent evidence and no raw model prose', async () => {
  const { db, rpc } = capacityDb(true)
  ;(inferVenueCapacity as jest.Mock).mockResolvedValue({ standing: 80, seated: 40, confidence: 0.75, source_quote: 'RAW_MODEL_CANARY', model: 'fake-model' })
  const result = await runVenueCapacityInferenceJob(db, { discoveryVenueId: 'venue-one' })
  expect(result).toMatchObject({ processed: true, standing: 80, seated: 40 })
  expect(inferVenueCapacity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Independent Hall', google_types: [] }), null)
  const [name, args] = rpc.mock.calls[0]
  expect(name).toBe('write_discovery_venue_independent_facts')
  expect(args.p_values).toEqual({ inferred_capacity_standing: 80, inferred_capacity_seated: 40 })
  expect(args.p_field_provenance.inferred_capacity_standing).toMatchObject({ source: 'derived', confirmation_status: 'unconfirmed', confidence: 0.75, lineage: [expect.objectContaining({ field: 'name' }), expect.objectContaining({ field: 'website' })] })
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/RAW_MODEL_CANARY|google_rating|GOOGLE_CANARY/)
})
it('rejects live content at actual job enqueue/completion and keeps retry errors operational', async () => {
  const eq = jest.fn().mockResolvedValue({ error: null }); const update = jest.fn().mockReturnValue({ eq }); const from = jest.fn().mockReturnValue({ update })
  const db = { from } as unknown as SupabaseJobClient
  await expect(enqueueJob(db, { jobType: 'infer_venue_capacity', payload: { google_live: { name: 'GOOGLE_CANARY' } } })).rejects.toThrow()
  await expect(completeJob(db, 'job-one', { google_live: { name: 'GOOGLE_CANARY' } })).rejects.toThrow()
  expect(from).not.toHaveBeenCalled()
  await failJob(db, { id: 'job-one', job_type: 'infer_venue_capacity', attempts: 1, max_attempts: 3 } as AppJob, new Error('GOOGLE_CANARY'))
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', error: 'Venue enrichment failed', completed_at: null }))
  expect(JSON.stringify(update.mock.calls)).not.toContain('GOOGLE_CANARY')
  await completeJob(db, 'job-one', { standing: 80, seated: 40, processed: true })
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'succeeded', result: { standing: 80, seated: 40, processed: true } }))
})
