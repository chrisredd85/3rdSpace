/** @jest-environment node */
import { createClient } from '@supabase/supabase-js'
import { venueBoundaryFetch } from '../venueBoundaryFetch'
import { RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { isUnavailableRecommendation, readRecommendationAvailability } from '@/lib/planner/recommendationAvailability'
import { assertDurableVenueContent } from '@/lib/discovery/venuePersistence'

const marker = { venue_content_unavailable: true, unavailable_code: 'legacy_discovery_evidence_missing' }
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  plan_id: '22222222-2222-4222-8222-222222222222',
  reference_id: '33333333-3333-4333-8333-333333333333',
  type: 'venue', status: 'superseded', rank: 1, is_best_fit: true,
  external_name: 'Old proposal', notes: 'Old ranked explanation', price_cents: 42000,
  metadata: { ...marker, fit_score: 97 },
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
})

it.each([undefined, null, {}, { venue_content_unavailable: true },
  { unavailable_code: marker.unavailable_code },
  { ...marker, venue_content_unavailable: 'true' },
  { ...marker, unavailable_code: 'another_reason' },
])('preserves an unmarked/partial-marker row exactly: %j', metadata => {
  const input = { ...row, metadata }
  expect(isUnavailableRecommendation(input)).toBe(false)
  expect(readRecommendationAvailability(input)).toBe(input)
})

it('accepts both pre-162 and retired read shapes without manufacturing evidence', () => {
  const before = JSON.stringify(row)
  const unavailable = readRecommendationAvailability(row)
  expect(unavailable).toEqual({
    id: row.id, plan_id: row.plan_id, reference_id: row.reference_id, type: 'venue',
    status: 'unavailable', metadata: marker,
  })
  expect(() => assertDurableVenueContent({ ...row, metadata: {} })).not.toThrow()
  expect(() => assertDurableVenueContent(unavailable)).not.toThrow()
  expect(JSON.stringify(row)).toBe(before)
})

it.each(['single', 'array'] as const)('returns UNAVAILABLE through a real Supabase targeted %s GET', async shape => {
  const transport = jest.fn().mockResolvedValue(json(shape === 'single' ? row : [row]))
  const db = createClient('https://db.example', 'test-key', {
    global: { fetch: venueBoundaryFetch(transport) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const query = db.from('recommendations').select(RECOMMENDATION_SELECT_COLUMNS).eq('id', row.id)
  const result = await (shape === 'single' ? query.single() : query)
  expect(result.error).toBeNull()
  const expected = readRecommendationAvailability(row)
  expect(result.data).toEqual(shape === 'single' ? expected : [expected])
  expect(JSON.stringify(result.data)).not.toMatch(/Old proposal|Old ranked explanation|fit_score|is_best_fit/)
  const url = new URL(String(transport.mock.calls[0][0]))
  expect(url.searchParams.get('select')).toContain('metadata')
})

it('keeps an unmarked targeted UUID recommendation unchanged', async () => {
  const input = { ...row, metadata: {} }
  const response = await venueBoundaryFetch(jest.fn().mockResolvedValue(json(input)))(
    `https://db.example/rest/v1/recommendations?id=eq.${row.id}`,
  )
  expect(await response.json()).toEqual(input)
})

it.each([true, false])('fetches a targeted marker even when SELECT omits metadata; unavailable=%s', async marked => {
  const transport = jest.fn().mockImplementation(async (input: string) => {
    const url = new URL(input)
    const selected = url.searchParams.get('select')!.split(',')
    const dbRow = { ...row, metadata: marked ? marker : {} } as Record<string, unknown>
    // Model PostgREST's projection, including alias:column, rather than handing
    // the reader a full row that conceals a missing SELECT field.
    const projected = Object.fromEntries(selected.map(field => {
      const [name, column = name] = field.split(':')
      return [name, dbRow[column]]
    }))
    return json([projected])
  })
  const response = await venueBoundaryFetch(transport)(
    `https://db.example/rest/v1/recommendations?id=eq.${row.id}&select=id,rank,notes,status`,
  )
  expect(await response.json()).toEqual(marked
    ? [{ id: row.id, status: 'unavailable', metadata: marker }]
    : [{ id: row.id, rank: 1, notes: row.notes, status: 'superseded' }])
  expect(transport).toHaveBeenCalledTimes(1)
})

it('adds the internal marker for singular Request inputs without losing headers or filters', async () => {
  const request = new Request(`https://db.example/rest/v1/recommendations?plan_id=eq.${row.plan_id}&select=id,rank`, {
    headers: { accept: 'application/vnd.pgrst.object+json', 'x-test-header': 'preserve' },
  })
  const transport = jest.fn().mockImplementation(async (input: Request) => {
    expect(input).toBeInstanceOf(Request)
    const url = new URL(input.url)
    expect(url.searchParams.get('plan_id')).toBe(`eq.${row.plan_id}`)
    expect(url.searchParams.get('select')).toContain(':metadata')
    expect(input.headers.get('x-test-header')).toBe('preserve')
    return json({ id: row.id, rank: 1, __recommendation_availability_metadata: marker })
  })
  const response = await venueBoundaryFetch(transport)(request)
  expect(await response.json()).toEqual({ id: row.id, status: 'unavailable', metadata: marker })
})

it('retains marked admin/history lists and identity-only history reads for their consumers', async () => {
  for (const input of [[row], [{ id: row.id }]]) {
    const response = await venueBoundaryFetch(jest.fn().mockResolvedValue(json(input)))(
      `https://db.example/rest/v1/recommendations?plan_id=eq.${row.plan_id}`,
    )
    expect(await response.json()).toEqual(input)
  }
})

it.each([
  ['POST', 'recommendations', 201],
  ['PATCH', `recommendations?id=eq.${row.id}`, 200],
  ['POST', 'rpc/apply_plan_revision_atomic', 200],
] as const)('leaves a committed %s %s receipt intact (HTTP %s)', async (method, path, status) => {
  const receipt = path.startsWith('rpc/') ? { success: true, recommendation: row } : [row]
  const transport = jest.fn().mockResolvedValue(json(receipt, status))
  const response = await venueBoundaryFetch(transport)(`https://db.example/rest/v1/${path}`, {
    method, body: JSON.stringify({}),
  })
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual(receipt)
  expect(transport).toHaveBeenCalledTimes(1)
})
