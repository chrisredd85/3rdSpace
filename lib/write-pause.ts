export const WRITE_PAUSE_CONTROL_KEY = 'write_pause'
export const WRITE_PAUSE_CONTROL_PATH = '/api/internal/write-pause'
export const STRIPE_WEBHOOK_REPLAY_PATH = '/api/internal/stripe-webhooks/replay-deferred'

export const STRIPE_WEBHOOK_PATHS = [
  '/api/webhooks/stripe',
  '/api/webhooks/stripe/connect',
] as const

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MUTATING_JOB_PREFIXES = [
  '/api/cron/',
  '/api/internal/cron/',
  '/api/internal/jobs/',
  '/api/jobs/',
]
const MUTATING_GET_PATTERNS = [
  /^\/api\/admin\/reconcile\/captured-deposits$/,
  /^\/api\/messages\/(?!threads(?:\/|$))[^/]+$/,
  /^\/api\/messages\/threads\/[^/]+$/,
  /^\/api\/opportunities\/respond\/[^/]+$/,
  /^\/api\/planner\/plans\/[^/]+\/partnerships$/,
  /^\/api\/venue\/opportunity\/[^/]+\/stripe-resume$/,
  /^\/api\/(?:builder|vendor|venue)\/stripe\/(?:dashboard|status)$/,
]
const EVENT_FINANCIALS_PATH = /^\/api\/events\/[^/]+\/financials$/

export type WritePauseState = 'open' | 'paused' | 'draining'

export type WritePauseStatus = {
  available: true
  state: WritePauseState
  enabled: boolean
  reason: string | null
  enabledAt: string | null
  updatedAt: string
  revision: number
}

export type UnavailableWritePauseStatus = {
  available: false
  state: 'open'
  enabled: false
  error: string
}

export type WritePauseReadResult = WritePauseStatus | UnavailableWritePauseStatus

export function isStripeWebhookPath(pathname: string): boolean {
  return STRIPE_WEBHOOK_PATHS.some((path) => pathname === path)
}

/**
 * Every application API mutation enters through middleware. Webhook receipt
 * and the authenticated pause-control endpoint are the only write-method
 * exemptions. Cron/job GET handlers are treated as writes because several
 * legacy jobs mutate state despite using GET.
 */
export function shouldEnforceWritePause(
  method: string,
  pathname: string,
  options: {
    isServerAction?: boolean
    searchParams?: Pick<URLSearchParams, 'get'>
  } = {},
): boolean {
  const normalizedMethod = method.toUpperCase()
  if (options.isServerAction && normalizedMethod === 'POST') return true
  if (!pathname.startsWith('/api/')) return false
  if (pathname === WRITE_PAUSE_CONTROL_PATH) return false
  if (pathname === STRIPE_WEBHOOK_REPLAY_PATH) return false
  if (isStripeWebhookPath(pathname)) return false

  if (UNSAFE_METHODS.has(normalizedMethod)) return true
  if (MUTATING_JOB_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  // Next.js automatically implements HEAD by invoking a route's GET handler.
  // Treat both methods identically for read-on-write routes so HEAD cannot
  // bypass the pause while still leaving genuinely read-only HEAD requests up.
  const invokesGetHandler = normalizedMethod === 'GET' || normalizedMethod === 'HEAD'
  if (invokesGetHandler && pathname.endsWith('/callback')) return true
  if (invokesGetHandler && MUTATING_GET_PATTERNS.some((pattern) => pattern.test(pathname))) return true
  if (
    invokesGetHandler
    && EVENT_FINANCIALS_PATH.test(pathname)
    && options.searchParams?.get('recalculate') === 'true'
  ) return true

  return false
}

export async function readWritePauseStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<WritePauseReadResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    const error = 'Supabase environment is unavailable for the write-pause check'
    console.error('[write-pause] fail-open: flag store configuration missing')
    return { available: false, state: 'open', enabled: false, error }
  }

  try {
    const url = new URL('/rest/v1/release_runtime_controls', supabaseUrl)
    url.searchParams.set('control_key', `eq.${WRITE_PAUSE_CONTROL_KEY}`)
    url.searchParams.set('select', 'state,enabled,reason,enabled_at,updated_at,revision')

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: 'application/json',
        'cache-control': 'no-cache',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`flag store returned ${response.status}`)
    }

    const rows = await response.json() as Array<Record<string, unknown>>
    const row = rows[0]
    if (!row || typeof row.enabled !== 'boolean' || typeof row.updated_at !== 'string') {
      throw new Error('write_pause row is missing or malformed')
    }

    const state = row.state
    if (state !== 'open' && state !== 'paused' && state !== 'draining') {
      throw new Error('write_pause state is invalid')
    }
    if (row.enabled !== (state !== 'open')) {
      throw new Error('write_pause state and compatibility flag disagree')
    }

    const revision = Number(row.revision)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('write_pause revision is invalid')
    }

    return {
      available: true,
      state,
      enabled: row.enabled,
      reason: typeof row.reason === 'string' ? row.reason : null,
      enabledAt: typeof row.enabled_at === 'string' ? row.enabled_at : null,
      updatedAt: row.updated_at,
      revision,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[write-pause] fail-open: durable flag read failed', { error: message })
    return { available: false, state: 'open', enabled: false, error: message }
  }
}
