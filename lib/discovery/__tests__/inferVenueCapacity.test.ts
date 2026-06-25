jest.mock('server-only', () => ({}))

import {
  buildVenueCapacityInferenceUpdate,
  enqueueVenueCapacityInferenceJob,
  inferVenueCapacity,
  readVenuePlaceTypes,
  shouldSkipVenueCapacityInference,
  VENUE_CAPACITY_INFERENCE_MODEL,
} from '@/lib/discovery/inferVenueCapacity'
import { enqueueJob } from '@/lib/server/job-queue'

jest.mock('@/lib/server/job-queue', () => ({
  enqueueJob: jest.fn(),
}))

function completionClient(content: unknown) {
  return {
    create: jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
  }
}

describe('inferVenueCapacity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('extracts conservative venue capacity from a structured model response', async () => {
    const client = completionClient({
      standing_capacity: 85,
      seated_capacity: 42,
      confidence: 0.78,
      source_quote: 'Accommodates up to 85 guests for receptions.',
    })

    const result = await inferVenueCapacity({
      name: 'Moongate Lounge',
      place_types: ['bar', 'event_venue'],
      website_url: 'https://moongate.example.com',
      formatted_address: '123 Broadway, Oakland, CA',
    }, 'Private room accommodates up to 85 guests for receptions.', client)

    expect(result).toEqual({
      standing: 85,
      seated: 42,
      confidence: 0.78,
      source_quote: 'Accommodates up to 85 guests for receptions.',
      model: VENUE_CAPACITY_INFERENCE_MODEL,
    })
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      model: VENUE_CAPACITY_INFERENCE_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
    }))
  })

  it('keeps unknown capacity as null while still producing an idempotent update payload', async () => {
    const client = completionClient({
      standing_capacity: null,
      seated_capacity: null,
      confidence: 0,
      source_quote: null,
    })
    const inferredAt = '2026-06-24T01:20:00.000Z'

    const result = await inferVenueCapacity({
      name: 'Unknown Cafe',
      place_types: ['cafe'],
      website_url: null,
      formatted_address: null,
    }, null, client)

    expect(result).toEqual({
      standing: null,
      seated: null,
      confidence: 0,
      source_quote: null,
      model: VENUE_CAPACITY_INFERENCE_MODEL,
    })
    expect(buildVenueCapacityInferenceUpdate(result, inferredAt)).toEqual({
      inferred_capacity_standing: null,
      inferred_capacity_seated: null,
      capacity_inference_confidence: 0,
      capacity_inference_source_quote: null,
      capacity_inference_model: VENUE_CAPACITY_INFERENCE_MODEL,
      capacity_inference_admin_status: 'pending',
      capacity_inference_extracted_at: inferredAt,
      updated_at: inferredAt,
    })
  })

  it('reads place types from all stored Google metadata fields', () => {
    expect(readVenuePlaceTypes({
      google_primary_type: 'bar',
      google_types: ['bar', 'restaurant'],
      places_all_types: ['event_venue', 'restaurant'],
    })).toEqual(['bar', 'restaurant', 'event_venue'])
  })

  it('skips venues that already have a capacity inference timestamp', () => {
    expect(shouldSkipVenueCapacityInference({ capacity_inference_extracted_at: '2026-06-24T00:00:00Z' })).toBe(true)
    expect(shouldSkipVenueCapacityInference({ capacity_inference_extracted_at: null })).toBe(false)
  })

  it('enqueues capacity inference as one unique job per discovery venue', async () => {
    ;(enqueueJob as jest.Mock).mockResolvedValue({ id: 'job-1' })
    const admin = {} as never

    await expect(enqueueVenueCapacityInferenceJob(admin, 'venue-1')).resolves.toEqual({ id: 'job-1' })

    expect(enqueueJob).toHaveBeenCalledWith(admin, {
      jobType: 'venue.capacity_infer',
      payload: { discovery_venue_id: 'venue-1' },
      uniqueKey: 'venue-capacity:venue-1',
      scheduledAt: undefined,
      maxAttempts: 3,
    })
  })
})
