import { NextResponse, type NextRequest } from 'next/server'

import { checkRateLimit, rateLimitHeaders, type RateLimitResult } from '@/lib/server/rate-limit'

export type SettlementTokenRateLimitKind = 'view' | 'action'

type SettlementTokenRateLimitOptions = {
  token: string
  kind: SettlementTokenRateLimitKind
}

type SettlementTokenRateLimitExceeded = {
  limited: true
  response: NextResponse
}

type SettlementTokenRateLimitAllowed = {
  limited: false
}

export type SettlementTokenRateLimitOutcome =
  | SettlementTokenRateLimitExceeded
  | SettlementTokenRateLimitAllowed

const VIEW_LIMIT_PER_MINUTE = 10
const ACTION_LIMIT_PER_MINUTE = 5
const TOTAL_LIMIT_PER_HOUR = 100

const MINUTE_WINDOW_MS = 60_000
const HOUR_WINDOW_MS = 60 * 60_000

export async function enforceSettlementTokenRateLimit(
  request: NextRequest | Request,
  options: SettlementTokenRateLimitOptions
): Promise<SettlementTokenRateLimitOutcome> {
  const ip = getRequesterIp(request.headers)
  const tokenPrefix = getTokenPrefix(options.token)
  const minuteLimit = options.kind === 'view' ? VIEW_LIMIT_PER_MINUTE : ACTION_LIMIT_PER_MINUTE
  const routeKey = `settlement-token:${options.kind}:${ip}`
  const totalKey = `settlement-token:total:${ip}`

  const minute = await checkRateLimit(routeKey, {
    limit: minuteLimit,
    windowMs: MINUTE_WINDOW_MS,
  })
  if (!minute.allowed) {
    return limitExceededResponse(minute, { ip, tokenPrefix, kind: options.kind, window: 'minute' })
  }

  const hourly = await checkRateLimit(totalKey, {
    limit: TOTAL_LIMIT_PER_HOUR,
    windowMs: HOUR_WINDOW_MS,
  })
  if (!hourly.allowed) {
    return limitExceededResponse(hourly, { ip, tokenPrefix, kind: options.kind, window: 'hour' })
  }

  return { limited: false }
}

function limitExceededResponse(
  result: RateLimitResult,
  context: {
    ip: string
    tokenPrefix: string
    kind: SettlementTokenRateLimitKind
    window: 'minute' | 'hour'
  }
): SettlementTokenRateLimitExceeded {
  const retryAfter = calculateRetryAfterSeconds(result)
  console.warn('[settlement-token-rate-limit] Rate limit exceeded', {
    ip: context.ip,
    token_prefix: context.tokenPrefix,
    kind: context.kind,
    window: context.window,
    retry_after_seconds: retryAfter,
  })

  return {
    limited: true,
    response: NextResponse.json(
      {
        error: 'Too many settlement link requests. Try again shortly.',
        code: 'settlement_token_rate_limited',
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(result),
          'Retry-After': String(retryAfter),
        },
      }
    ),
  }
}

function calculateRetryAfterSeconds(result: RateLimitResult): number {
  return Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
}

function getRequesterIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}

function getTokenPrefix(token: string): string {
  return token.slice(0, 8) || 'missing'
}
