import type { Duration } from '@upstash/ratelimit'

type RatelimitClass = typeof import('@upstash/ratelimit').Ratelimit
type RedisClass = typeof import('@upstash/redis').Redis
type RedisClient = InstanceType<RedisClass>
type RedisLimiter = {
  limit(identifier: string): Promise<{
    success: boolean
    limit: number
    remaining: number
    reset: number
  }>
}

export interface RateLimitOptions {
  limit?: number
  windowMs?: number
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

interface RateLimitBucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitBucket>()
const redisLimiters = new Map<string, RedisLimiter>()

let redis: RedisClient | null = null
let upstashModulesPromise: Promise<{ Ratelimit: RatelimitClass; Redis: RedisClass }> | null = null
let warnedMissingUpstash = false
let warnedUpstashFailure = false

/**
 * Applies a Redis-backed sliding-window rate limit.
 *
 * Local development and Vercel preview builds fall back to the original
 * in-memory limiter when Upstash env vars are unset. Vercel production must
 * have Upstash configured so the limit binds across function instances.
 */
export async function checkRateLimit(key: string, options: RateLimitOptions = {}): Promise<RateLimitResult> {
  const limit = options.limit ?? 60
  const windowMs = options.windowMs ?? 60_000

  if (!hasUpstashConfig()) {
    assertUpstashConfiguredForProduction()
    warnOnceMissingUpstash()
    return checkInMemoryRateLimit(key, { limit, windowMs })
  }

  try {
    const result = await (await getRedisLimiter(limit, windowMs)).limit(key)
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: Math.max(result.remaining, 0),
      resetAt: result.reset,
    }
  } catch (error) {
    if (isVercelProduction()) {
      throw error
    }
    warnOnceUpstashFailure(error)
    return checkInMemoryRateLimit(key, { limit, windowMs })
  }
}

function checkInMemoryRateLimit(
  key: string,
  options: Required<RateLimitOptions>
): RateLimitResult {
  const { limit, windowMs } = options
  const now = Date.now()
  const current = buckets.get(key)

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { allowed: true, limit, remaining: Math.max(limit - 1, 0), resetAt }
  }

  if (current.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: current.resetAt }
  }

  current.count += 1
  return {
    allowed: true,
    limit,
    remaining: Math.max(limit - current.count, 0),
    resetAt: current.resetAt,
  }
}

async function getRedisLimiter(limit: number, windowMs: number): Promise<RedisLimiter> {
  const limiterKey = `${limit}:${windowMs}`
  const existing = redisLimiters.get(limiterKey)
  if (existing) return existing

  const { Ratelimit } = await loadUpstashModules()
  const limiter = new Ratelimit({
    redis: await getRedis(),
    limiter: Ratelimit.slidingWindow(limit, toUpstashDuration(windowMs)),
    prefix: `3rdplace:rate-limit:${limiterKey}`,
  })

  redisLimiters.set(limiterKey, limiter)
  return limiter
}

async function getRedis(): Promise<RedisClient> {
  if (redis) return redis

  const { Redis } = await loadUpstashModules()
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL ?? '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  })
  return redis
}

async function loadUpstashModules(): Promise<{ Ratelimit: RatelimitClass; Redis: RedisClass }> {
  if (!upstashModulesPromise) {
    upstashModulesPromise = Promise.all([import('@upstash/ratelimit'), import('@upstash/redis')]).then(
      ([ratelimitModule, redisModule]) => ({
        Ratelimit: ratelimitModule.Ratelimit,
        Redis: redisModule.Redis,
      })
    )
  }

  return upstashModulesPromise
}

function hasUpstashConfig(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

function assertUpstashConfiguredForProduction(): void {
  if (!isVercelProduction()) return

  throw new Error(
    'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in Vercel Production. Production rate limiting must use Redis.'
  )
}

function warnOnceMissingUpstash(): void {
  if (warnedMissingUpstash) return
  warnedMissingUpstash = true
  console.warn(
    '[rate-limit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is unset; using in-memory rate limiting for this non-production environment.'
  )
}

function warnOnceUpstashFailure(error: unknown): void {
  if (warnedUpstashFailure) return
  warnedUpstashFailure = true
  console.warn('[rate-limit] Upstash rate-limit check failed; using in-memory fallback.', error)
}

function toUpstashDuration(windowMs: number): Duration {
  if (windowMs % 86_400_000 === 0) return `${windowMs / 86_400_000} d`
  if (windowMs % 3_600_000 === 0) return `${windowMs / 3_600_000} h`
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} m`
  if (windowMs % 1_000 === 0) return `${windowMs / 1_000} s`
  return `${windowMs} ms`
}

/**
 * Converts a rate-limit result into stable HTTP headers.
 */
export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  }
}
