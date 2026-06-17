const mockLimit = jest.fn()
const mockSlidingWindow = jest.fn((tokens: number, window: string) => ({ tokens, window }))
const mockRatelimitConstructor = jest.fn().mockImplementation(() => ({ limit: mockLimit }))
const mockRedisConstructor = jest.fn()

jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(mockRatelimitConstructor, {
    slidingWindow: mockSlidingWindow,
  }),
}))

jest.mock('@upstash/redis', () => ({
  Redis: mockRedisConstructor,
}))

const ORIGINAL_ENV = process.env

async function loadRateLimitModule() {
  jest.resetModules()
  return import('@/lib/server/rate-limit')
}

describe('Redis-backed rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.VERCEL_ENV
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('falls back to in-memory limiting when Upstash env vars are missing outside production', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkRateLimit, rateLimitHeaders } = await loadRateLimitModule()

    const first = await checkRateLimit('local-user', { limit: 2, windowMs: 60_000 })
    const second = await checkRateLimit('local-user', { limit: 2, windowMs: 60_000 })
    const third = await checkRateLimit('local-user', { limit: 2, windowMs: 60_000 })

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third).toMatchObject({ allowed: false, limit: 2, remaining: 0 })
    expect(rateLimitHeaders(third)).toEqual({
      'X-RateLimit-Limit': '2',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(third.resetAt / 1000)),
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(mockRatelimitConstructor).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  it('resets the local fallback bucket after the configured window', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-17T00:00:00.000Z'))
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkRateLimit } = await loadRateLimitModule()

    await expect(checkRateLimit('window-user', { limit: 1, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    })
    await expect(checkRateLimit('window-user', { limit: 1, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    })

    jest.advanceTimersByTime(1_001)

    await expect(checkRateLimit('window-user', { limit: 1, windowMs: 1_000 })).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    })
  })

  it('requires Upstash env vars on Vercel production', async () => {
    process.env.VERCEL_ENV = 'production'
    const { checkRateLimit } = await loadRateLimitModule()

    await expect(checkRateLimit('prod-user')).rejects.toThrow(/Missing UPSTASH_REDIS_REST_URL/)
  })

  it('uses an Upstash sliding-window limiter when Redis env vars are configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    mockLimit.mockResolvedValueOnce({
      success: true,
      limit: 10,
      remaining: 9,
      reset: 1_234_000,
    })

    const { checkRateLimit } = await loadRateLimitModule()
    const result = await checkRateLimit('redis-user', { limit: 10, windowMs: 60_000 })

    expect(mockRedisConstructor).toHaveBeenCalledWith({
      url: 'https://redis.example.com',
      token: 'test-token',
    })
    expect(mockSlidingWindow).toHaveBeenCalledWith(10, '1 m')
    expect(mockRatelimitConstructor).toHaveBeenCalledWith({
      redis: expect.any(Object),
      limiter: { tokens: 10, window: '1 m' },
      prefix: '3rdplace:rate-limit:10:60000',
    })
    expect(mockLimit).toHaveBeenCalledWith('redis-user')
    expect(result).toEqual({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: 1_234_000,
    })
  })

  it('builds separate Redis sliding-window limiters for distinct windows', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    mockLimit
      .mockResolvedValueOnce({ success: true, limit: 60, remaining: 59, reset: 1_000 })
      .mockResolvedValueOnce({ success: true, limit: 60, remaining: 58, reset: 2_000 })

    const { checkRateLimit } = await loadRateLimitModule()

    await checkRateLimit('minute-user', { limit: 60, windowMs: 60_000 })
    await checkRateLimit('two-minute-user', { limit: 60, windowMs: 120_000 })

    expect(mockSlidingWindow).toHaveBeenCalledWith(60, '1 m')
    expect(mockSlidingWindow).toHaveBeenCalledWith(60, '2 m')
    expect(mockRatelimitConstructor).toHaveBeenCalledTimes(2)
  })
})
