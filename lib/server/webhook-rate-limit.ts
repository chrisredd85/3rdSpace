type RateLimitEntry = {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitEntry>()

/**
 * Applies a small in-memory rate limit to public webhook endpoints.
 *
 * This is a lightweight guard for accidental floods during testing. It is not a
 * distributed production rate limiter, so production deployments should pair it
 * with platform/edge-level rate limits.
 *
 * @param key - Unique requester/platform key, usually platform plus IP.
 * @param limit - Maximum accepted requests in the window.
 * @param windowMs - Rolling window duration in milliseconds.
 * @returns True when the request may continue.
 */
function allowInMemoryWebhookRequest(key: string, limit = 120, windowMs = 60_000) {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (existing.count >= limit) {
    return false
  }

  existing.count += 1
  buckets.set(key, existing)
  return true
}

/**
 * Applies a distributed webhook rate limit when the database function is
 * available, with an in-memory fallback for local development and unmigrated
 * environments.
 */
export async function allowWebhookRequest(
  supabase: any,
  key: string,
  limit = 120,
  windowMs = 60_000
) {
  const { data, error } = await supabase.rpc('consume_webhook_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: Math.ceil(windowMs / 1000),
  })

  if (error) {
    console.warn('[webhook-rate-limit] Falling back to in-memory rate limit', error)
    return allowInMemoryWebhookRequest(key, limit, windowMs)
  }

  return Boolean(data)
}

/**
 * Builds a stable rate-limit key from request metadata.
 *
 * @param platform - Webhook platform name.
 * @param headers - Incoming request headers.
 * @returns Platform/IP key for the in-memory bucket.
 */
export function getWebhookRateLimitKey(platform: string, headers: Headers) {
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'

  return `${platform}:${ip}`
}
