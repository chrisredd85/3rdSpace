jest.mock('server-only', () => ({}))

import { containsGooglePhotoData, isGooglePhotoField, stripGooglePhotoData } from '../googlePhotoPersistence'
import { logAgentRun } from '@/lib/server/agent-runs'
import { completeJob, enqueueJob } from '@/lib/server/job-queue'
import { buildTemplateInsert } from '@/lib/planner/templateIdentity'

const token = 'places/fixture/photos/secret-photo-token'
const ownImage = 'https://example.com/independent.jpg'
const mixed = {
  partner_id: 'partner-1', amount_cents: 2500,
  nested: { google_photo_names: ['opaque-token'], photos: [{ name: token, authorAttributions: [{ displayName: 'Google credit' }] }, { url: ownImage }] },
}

describe('Google photo persistence boundaries', () => {
  it('removes nested Google photo objects while preserving independent images, IDs and money', () => {
    const result = stripGooglePhotoData(mixed)
    expect(result).toEqual({ partner_id: 'partner-1', amount_cents: 2500, nested: { photos: [{ url: ownImage }] } })
    expect(containsGooglePhotoData(mixed)).toBe(true)
    expect(containsGooglePhotoData(result)).toBe(false)
    expect(mixed.nested.photos[0]).toHaveProperty('name', token)
  })

  it.each([
    token,
    'places%2Ffixture%2Fphotos%2Fsecret-photo-token',
    `https://places.googleapis.com/v1/${token}/media?maxWidthPx=400`,
    'https://maps.googleapis.com/maps/api/place/photo?photoreference=secret-photo-token',
    'https://lh3.googleusercontent.com/places/secret-photo-token',
  ])('redacts a known resource/media form in error prose: %s', (reference) => {
    const result = stripGooglePhotoData(`Failed to fetch ${reference}`)
    expect(result).toBe('Failed to fetch [Google photo omitted]')
    expect(containsGooglePhotoData(reference)).toBe(true)
  })

  it('handles opaque photo keys inside raw JSON logs and does not blanket-delete photos', () => {
    const result = JSON.parse(stripGooglePhotoData(JSON.stringify(mixed)))
    expect(result.nested).toEqual({ photos: [{ url: ownImage }] })
    expect(stripGooglePhotoData({ photos: [ownImage], caption: 'Partner portfolio' })).toEqual({ photos: [ownImage], caption: 'Partner portfolio' })
    expect(isGooglePhotoField('google_photo_names')).toBe(true)
    expect(isGooglePhotoField('photos')).toBe(true)
    expect(isGooglePhotoField('capacity_seated')).toBe(false)
  })

  it('does not allow a fresh paired Google photo envelope into a later snapshot', () => {
    const result = stripGooglePhotoData({ image: { dataUrl: 'data:image/jpeg;base64,abcd', attribution: { googleMapsUri: 'https://www.google.com/maps/photo/fixture', authorAttributions: [] } } })
    expect(result).toEqual({ image: null })
  })

  it('removes opaque photo arrays only when their enclosing row identifies Google origin', () => {
    expect(stripGooglePhotoData({ source: 'google_places', id: 'id-1', photos: ['opaque-token', ownImage] })).toEqual({ source: 'google_places', id: 'id-1', photos: [ownImage] })
    expect(stripGooglePhotoData({ source: 'host_input', photos: [ownImage] })).toEqual({ source: 'host_input', photos: [ownImage] })
    expect(stripGooglePhotoData({ credit: { googleMapsUri: 'https://www.google.com/maps/photo/fixture', authorAttributions: [] } })).toEqual({ credit: null })
  })

  it('preserves independent dates, known zero and false through generic copy boundaries', () => {
    const value = { captured_at: new Date('2026-09-22T00:00:00Z'), amount_cents: 0, confirmed: false }
    expect(stripGooglePhotoData(value)).toEqual(value)
    expect(containsGooglePhotoData(value)).toBe(false)
  })

  it('preserves business identity and money when a record also carries a Google image URL', () => {
    const result = stripGooglePhotoData({ partner_id: 'partner-1', amount_cents: 2500, url: `https://places.googleapis.com/v1/${token}/media` })
    expect(result).toEqual({ partner_id: 'partner-1', amount_cents: 2500, url: '[Google photo omitted]' })
  })

  it('preserves the same $25 business record when paired photo bytes or credit are attached', () => {
    const commercial = { partner_id: 'partner-1', amount_cents: 2500 }
    const credit = { googleMapsUri: 'https://www.google.com/maps/photo/fixture', authorAttributions: [] }
    expect(stripGooglePhotoData({ ...commercial, dataUrl: 'data:image/jpeg;base64,abcd', attribution: credit }))
      .toEqual({ ...commercial, attribution: null })
    expect(stripGooglePhotoData({ ...commercial, ...credit })).toEqual(commercial)
  })

  it('fences real agent logging inputs, outputs, messages and raw output before insertion', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    await logAgentRun({ from: () => ({ insert }) }, {
      userId: 'user-1', agentName: 'venue' as never, status: 'success' as never,
      durationMs: 100, model: 'fixture', inputPayload: mixed, outputPayload: mixed,
      messagesPayload: [{ content: token }], rawModelOutput: JSON.stringify(mixed), error: token,
    })
    const written = insert.mock.calls[0][0]
    expect(JSON.stringify(written)).not.toMatch(/secret-photo-token|opaque-token|Google credit/)
    expect(written.input_payload.amount_cents).toBe(2500)
    expect(written.output_payload.nested.photos).toEqual([{ url: ownImage }])
  })

  it('fences real queued job payloads and completion results', async () => {
    const insert = jest.fn(payload => ({ select: () => ({ single: async () => ({ data: { id: 'job-1', ...payload, result: null }, error: null }) }) }))
    const update = jest.fn(() => ({ eq: async () => ({ error: null }) }))
    const db = { from: () => ({ insert, update }) }
    await enqueueJob(db as never, { jobType: 'infer_venue_capacity', payload: mixed })
    await completeJob(db as never, 'job-1', mixed)
    expect(insert.mock.calls[0][0].payload).toEqual(stripGooglePhotoData(mixed))
    expect(update.mock.calls[0][0].result).toEqual(stripGooglePhotoData(mixed))
    expect(JSON.stringify([insert.mock.calls, update.mock.calls])).not.toContain('secret-photo-token')
  })

  it('fences real template copies without changing selected partner identity or price', () => {
    const input = {
      userId: 'user-1', requestedName: 'Repeat event', attendanceSummary: null,
      plan: { id: 'plan-1', materialized_event_id: 'event-1', guest_count: 50, metadata: { run_of_show: mixed } },
      sourceEvent: { id: 'event-1', outcome_summary: {}, outcome_recorded_at: null },
      recommendations: [{ id: 'rec-1', type: 'venue', reference_id: 'partner-1', price_cents: 2500, is_best_fit: true, metadata: mixed }],
    }
    const result = buildTemplateInsert(input as never)
    expect(JSON.stringify(result)).not.toMatch(/secret-photo-token|opaque-token|Google credit/)
    expect(result.shopping_list).toMatchObject({ selected_venue: { reference_id: 'partner-1', price_cents: 2500 } })
    expect(JSON.stringify(input)).toContain('secret-photo-token')
  })
})
