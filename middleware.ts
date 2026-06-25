/**
 * Next.js Edge Middleware
 *
 * Responsibilities:
 *  1. Session refresh — keeps Supabase cookies alive on every request.
 *  2. Auth redirect — unauthenticated users hitting dashboard routes are sent to /login.
 *  3. Role guard — users are redirected to their own dashboard if they land on
 *     the wrong role prefix.
 *
 * Public routes bypass all auth checks; API routes and static assets are skipped entirely.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { protectRoute, getAuthUser } from '@/lib/supabase/middleware'
import { ensureRequestIdHeaders } from '@/lib/server/request-id'
import type { UserType } from '@/lib/types'

type EdgeRateLimitEntry = {
  count: number
  resetAt: number
}

const settlementViewBuckets = new Map<string, EdgeRateLimitEntry>()
const SETTLEMENT_VIEW_LIMIT_PER_MINUTE = 10
const SETTLEMENT_TOTAL_LIMIT_PER_HOUR = 100
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

function isAdminUser(user: { email?: string | null; app_metadata?: Record<string, unknown> | null }) {
  const configuredAdmins = new Set(
    (process.env.ADMIN_EMAILS || process.env.INTERNAL_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
  const email = user.email?.toLowerCase() ?? ''
  const appMetadata = user.app_metadata ?? null

  return configuredAdmins.has(email) || appMetadata?.role === 'admin' || appMetadata?.is_admin === true
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestId = ensureRequestIdHeaders(request.headers)

  const settlementToken = extractVenueSettlementToken(pathname)
  if (settlementToken && request.method === 'GET') {
    const rateLimit = enforceSettlementTokenViewRateLimit(request, settlementToken)
    if (rateLimit) return rateLimit

    const tokenStatus = await fetch(
      new URL(`/api/venue/settlement/${encodeURIComponent(settlementToken)}/status`, request.nextUrl.origin),
      { cache: 'no-store' }
    )
    if (tokenStatus.status === 429) {
      return new NextResponse(await tokenStatus.text(), {
        status: 429,
        headers: {
          'content-type': tokenStatus.headers.get('content-type') ?? 'application/json',
          'Retry-After': tokenStatus.headers.get('Retry-After') ?? '60',
          'X-RateLimit-Limit': tokenStatus.headers.get('X-RateLimit-Limit') ?? '',
          'X-RateLimit-Remaining': tokenStatus.headers.get('X-RateLimit-Remaining') ?? '',
          'X-RateLimit-Reset': tokenStatus.headers.get('X-RateLimit-Reset') ?? '',
        },
      })
    }
    if (tokenStatus.status === 410) {
      return new NextResponse('Settlement token revoked', {
        status: 410,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    if (tokenStatus.status === 404) {
      return new NextResponse('Settlement token invalid or expired', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    return NextResponse.next()
  }

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup', '/', '/api/auth/login', '/api/auth/signup', '/api/auth/callback']
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith('/api/auth/'))

  // Allow API routes and static files
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.startsWith('/favicon')) {
    const response = NextResponse.next({ request: { headers: requestId.headers } })
    response.headers.set('x-request-id', requestId.requestId)
    return response
  }

  // Auth routes - redirect to appropriate dashboard if already authenticated
  if (pathname === '/login' || pathname === '/signup') {
    const { user, response } = await getAuthUser(request)
    const forceSignup = pathname === '/signup' && (
      request.nextUrl.searchParams.get('force') === '1' ||
      request.nextUrl.searchParams.get('switch_account') === '1'
    )
    if (forceSignup) return response

    if (user) {
      // Get user type and redirect to appropriate dashboard
      const userType = (user.user_metadata?.user_type as UserType) || null
      let dashboardPath = '/planner' // Default

      if (userType === 'venue_owner') {
        dashboardPath = '/venue'
      } else if (userType === 'vendor') {
        dashboardPath = '/vendor'
      } else if (userType === 'community_builder') {
        dashboardPath = '/planner'
      }

      const url = request.nextUrl.clone()
      url.pathname = dashboardPath
      // Signal that user was redirected because already signed in (dashboard can show a toast)
      url.searchParams.set('from', 'auth')
      return NextResponse.redirect(url)
    }
    return response
  }

  // Onboarding route - requires authentication, but allow access
  if (pathname === '/onboarding') {
    const result = await protectRoute(request)
    if (result instanceof NextResponse) {
      return result // Redirect to login if not authenticated
    }
    // Allow access to onboarding page
    return result.response
  }

  if (pathname.startsWith('/admin')) {
    const result = await protectRoute(request)
    if (result instanceof NextResponse) {
      return result
    }

    if (!isAdminUser(result.user)) {
      const url = request.nextUrl.clone()
      url.pathname = '/planner'
      return NextResponse.redirect(url)
    }

    return result.response
  }

  // Public planner intake — creators can draft an event before account creation.
  if (pathname === '/planner' || pathname === '/planner/new-plan') {
    const { response } = await getAuthUser(request)
    return response
  }

  // Vendor invite claims must be reachable from emailed claim links before the
  // vendor has an account or authenticated session.
  if (pathname === '/vendor/claim') {
    const { response } = await getAuthUser(request)
    return response
  }

  // Protect dashboard routes (venue, vendor, planner). Legacy /builder paths
  // are handled by permanent redirects in next.config.js before route access.
  const dashboardRoutes = ['/venue', '/vendor', '/planner']
  if (dashboardRoutes.some((route) => pathname.startsWith(route))) {
    const result = await protectRoute(request)
    if (result instanceof NextResponse) {
      return result // Redirect to login
    }

    // Verify user has access to the requested dashboard
    const { user } = result
    const userType = (user.user_metadata?.user_type as UserType) || null

    if (pathname.startsWith('/venue') && userType !== 'venue_owner') {
      const url = request.nextUrl.clone()
      if (userType === 'community_builder') {
        url.pathname = '/planner'
      } else if (userType === 'vendor') {
        url.pathname = '/vendor'
      } else {
        url.pathname = '/venue'
      }
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/vendor') && userType !== 'vendor') {
      const url = request.nextUrl.clone()
      if (userType === 'community_builder') {
        url.pathname = '/planner'
      } else if (userType === 'venue_owner') {
        url.pathname = '/venue'
      } else {
        url.pathname = '/vendor'
      }
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/planner') && userType !== 'community_builder') {
      const url = request.nextUrl.clone()
      if (userType === 'venue_owner') {
        url.pathname = '/venue'
      } else if (userType === 'vendor') {
        url.pathname = '/vendor'
      } else {
        url.pathname = '/login'
      }
      return NextResponse.redirect(url)
    }

    return result.response
  }

  // For all other routes, just refresh the session
  const { response } = await getAuthUser(request)
  return response
}

function enforceSettlementTokenViewRateLimit(request: NextRequest, token: string): NextResponse | null {
  const ip = getRequesterIp(request.headers)
  const tokenPrefix = token.slice(0, 8) || 'missing'

  const minute = consumeEdgeRateLimit(`settlement-token:view:${ip}`, SETTLEMENT_VIEW_LIMIT_PER_MINUTE, MINUTE_MS)
  if (!minute.allowed) {
    return settlementTokenRateLimitResponse(minute, { ip, tokenPrefix, window: 'minute' })
  }

  const hourly = consumeEdgeRateLimit(`settlement-token:total:${ip}`, SETTLEMENT_TOTAL_LIMIT_PER_HOUR, HOUR_MS)
  if (!hourly.allowed) {
    return settlementTokenRateLimitResponse(hourly, { ip, tokenPrefix, window: 'hour' })
  }

  return null
}

function consumeEdgeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const current = settlementViewBuckets.get(key)

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs
    settlementViewBuckets.set(key, { count: 1, resetAt })
    return { allowed: true, limit, remaining: Math.max(limit - 1, 0), resetAt }
  }

  if (current.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: current.resetAt }
  }

  current.count += 1
  return { allowed: true, limit, remaining: Math.max(limit - current.count, 0), resetAt: current.resetAt }
}

function settlementTokenRateLimitResponse(
  result: { limit: number; remaining: number; resetAt: number },
  context: { ip: string; tokenPrefix: string; window: 'minute' | 'hour' }
) {
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  console.warn('[settlement-token-rate-limit] Rate limit exceeded', {
    ip: context.ip,
    token_prefix: context.tokenPrefix,
    kind: 'view',
    window: context.window,
    retry_after_seconds: retryAfter,
  })

  return NextResponse.json(
    {
      error: 'Too many settlement link requests. Try again shortly.',
      code: 'settlement_token_rate_limited',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    }
  )
}

function getRequesterIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}

function extractVenueSettlementToken(pathname: string): string | null {
  const match = pathname.match(/^\/venue\/settlement\/([^/]+)$/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
