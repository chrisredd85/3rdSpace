/**
 * @jest-environment node
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  isStripeWebhookPath,
  shouldEnforceWritePause,
  STRIPE_WEBHOOK_REPLAY_PATH,
  WRITE_PAUSE_CONTROL_PATH,
} from '@/lib/write-pause'

const apiRoot = path.join(process.cwd(), 'app/api')
const unsafeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(absolute)
    return entry.isFile() && entry.name === 'route.ts' ? [absolute] : []
  })
}

function apiPath(file: string): string {
  const relative = path.relative(apiRoot, path.dirname(file)).split(path.sep).join('/')
  return `/api/${relative}`.replace(/\/$/, '')
}

describe('write-pause route coverage', () => {
  it('protects every declared unsafe API method except the reviewed control and webhook bypasses', () => {
    const uncovered: string[] = []

    for (const file of routeFiles(apiRoot)) {
      const source = fs.readFileSync(file, 'utf8')
      const pathname = apiPath(file)
      for (const method of unsafeMethods) {
        const declaresMethod = new RegExp(
          `export\\s+(?:async\\s+function\\s+${method}\\b|const\\s+${method}\\b)`,
        ).test(source)
        if (!declaresMethod) continue
        const reviewedBypass = pathname === WRITE_PAUSE_CONTROL_PATH
          || pathname === STRIPE_WEBHOOK_REPLAY_PATH
          || isStripeWebhookPath(pathname)
        if (!reviewedBypass && !shouldEnforceWritePause(method, pathname)) {
          uncovered.push(`${method} ${pathname}`)
        }
      }
    }

    expect(uncovered).toEqual([])
  })

  it('keeps only the authenticated control and replay paths open during draining', () => {
    expect(shouldEnforceWritePause('POST', WRITE_PAUSE_CONTROL_PATH)).toBe(false)
    expect(shouldEnforceWritePause('POST', STRIPE_WEBHOOK_REPLAY_PATH)).toBe(false)
    expect(shouldEnforceWritePause('POST', '/api/internal/stripe-webhooks/other')).toBe(true)
  })

  it('treats legacy GET cron/job handlers as writes while ordinary reads stay open', () => {
    expect(shouldEnforceWritePause('GET', '/api/cron/discovery/refresh-stale')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/internal/jobs/run')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/admin/reconcile/captured-deposits')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/messages/thread-1')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/messages/threads/thread-1')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/opportunities/respond/token-1')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/planner/plans/plan-1/partnerships')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/venue/opportunity/token-1/stripe-resume')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/vendor/stripe/status')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/venue/stripe/dashboard')).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/planner/plans/plan-1')).toBe(false)
    expect(shouldEnforceWritePause('GET', '/api/health')).toBe(false)
  })

  it('treats auto-implemented HEAD requests like GET on read-on-write routes', () => {
    expect(shouldEnforceWritePause('HEAD', '/api/integrations/gmail/callback')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/messages/thread-1')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/messages/threads/thread-1')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/opportunities/respond/token-1')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/planner/plans/plan-1/partnerships')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/venue/opportunity/token-1/stripe-resume')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/vendor/stripe/status')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/venue/stripe/dashboard')).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/planner/plans/plan-1')).toBe(false)
    expect(shouldEnforceWritePause('HEAD', '/api/health')).toBe(false)
  })

  it('blocks only the recalculating financials read while keeping cached financial reads available', () => {
    const recalculate = new URLSearchParams({ recalculate: 'true' })
    const cached = new URLSearchParams()

    expect(shouldEnforceWritePause('GET', '/api/events/event-1/financials', {
      searchParams: recalculate,
    })).toBe(true)
    expect(shouldEnforceWritePause('HEAD', '/api/events/event-1/financials', {
      searchParams: recalculate,
    })).toBe(true)
    expect(shouldEnforceWritePause('GET', '/api/events/event-1/financials', {
      searchParams: cached,
    })).toBe(false)
    expect(shouldEnforceWritePause('HEAD', '/api/events/event-1/financials', {
      searchParams: cached,
    })).toBe(false)
  })

  it('protects Next.js Server Actions outside the API route tree', () => {
    expect(shouldEnforceWritePause('POST', '/planner/experiences', { isServerAction: true })).toBe(true)
    expect(shouldEnforceWritePause('POST', '/admin/supply-scout', { isServerAction: true })).toBe(true)
    expect(shouldEnforceWritePause('GET', '/planner/experiences', { isServerAction: false })).toBe(false)
  })
})
