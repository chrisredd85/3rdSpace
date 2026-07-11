/**
 * @jest-environment node
 */

describe('durable write-pause store reads', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    jest.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
  })

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey
  })

  it('survives a simulated process restart because every decision reloads the DB row', async () => {
    const durableRow = {
      state: 'paused',
      enabled: true,
      reason: 'Release window',
      enabled_at: '2026-07-10T20:00:00.000Z',
      updated_at: '2026-07-10T20:00:00.000Z',
      revision: 3,
    }
    const fetchFromDurableStore = jest.fn(async () => new Response(JSON.stringify([durableRow]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

    const firstModule = await import('@/lib/write-pause')
    const first = await firstModule.readWritePauseStatus(fetchFromDurableStore)

    jest.resetModules()
    const restartedModule = await import('@/lib/write-pause')
    const afterRestart = await restartedModule.readWritePauseStatus(fetchFromDurableStore)

    expect(first).toMatchObject({ available: true, state: 'paused', enabled: true, revision: 3 })
    expect(afterRestart).toMatchObject({ available: true, state: 'paused', enabled: true, revision: 3 })
    expect(fetchFromDurableStore).toHaveBeenCalledTimes(2)
    expect(fetchFromDurableStore).toHaveBeenLastCalledWith(
      expect.any(URL),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
