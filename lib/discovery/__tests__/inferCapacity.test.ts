jest.mock('server-only', () => ({}))

import {
  VENUE_CAPACITY_INFERENCE_MODEL,
  inferVenueCapacity,
  shouldSkipVenueCapacityInference,
} from '@/lib/discovery/inferCapacity'

describe('inferVenueCapacity', () => {
  it('extracts conservative standing and seated capacities from model JSON', async () => {
    const client = {
      create: jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              standing: 120,
              seated: 72,
              confidence: 0.82,
              source_quote: 'Private events up to 120 guests.',
            }),
          },
        }],
      }),
    }

    const result = await inferVenueCapacity({
      name: 'Moongate Lounge',
      venue_type: 'bar',
      city: 'Oakland',
      state: 'CA',
      website_url: 'https://moongate.example',
      google_types: ['bar', 'lounge_bar'],
    }, 'Private events up to 120 guests.', client)

    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({
      model: VENUE_CAPACITY_INFERENCE_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
    }))
    expect(result).toEqual({
      standing: 120,
      seated: 72,
      confidence: 0.82,
      source_quote: 'Private events up to 120 guests.',
      model: VENUE_CAPACITY_INFERENCE_MODEL,
    })
  })

  it('keeps low-confidence unknown results as a negative inference record', async () => {
    const client = {
      create: jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              standing: null,
              seated: null,
              confidence: 0.2,
              source_quote: null,
            }),
          },
        }],
      }),
    }

    const result = await inferVenueCapacity({
      name: 'Unknown Venue',
      venue_type: 'venue',
    }, null, client)

    expect(result).toEqual({
      standing: null,
      seated: null,
      confidence: 0.2,
      source_quote: null,
      model: VENUE_CAPACITY_INFERENCE_MODEL,
    })
  })

  it('skips venues that already have a capacity inference timestamp', () => {
    expect(shouldSkipVenueCapacityInference({ capacity_inference_extracted_at: '2026-06-24T00:00:00.000Z' })).toBe(true)
    expect(shouldSkipVenueCapacityInference({ capacity_inference_extracted_at: null })).toBe(false)
  })
})
