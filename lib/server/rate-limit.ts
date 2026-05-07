interface RateLimitOptions {
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

/**
 * Applies a simple in-memory fixed-window rate limit.
 *
 * This is suitable for MVP/local protection only. Production deployments with
 * multiple instances should swap this for Redis/Upstash-backed limits.
 */
export function checkRateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const limit = options.limit ?? 60
  const windowMs = options.windowMs ?? 60_000
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
