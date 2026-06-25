/**
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

import { GET as releaseStaleReservations } from '@/app/api/cron/stripe-webhooks/release-stale/route'
import {
  failStripeWebhookProcessing,
  recordStripeWebhookProcessingResult,
  releaseStaleStripeWebhookReservations,
  reserveStripeWebhookEvent,
} from '@/lib/stripe/webhookLedger'
import { createServiceRoleClient } from '@/lib/supabase/server'

type Row = Record<string, any>

const EVENT = {
  id: 'evt_reservation_test',
  type: 'checkout.session.completed',
  livemode: false,
}

class ReservationDb {
  rows: Row[] = []

  from() {
    throw new Error('Reservation tests should use the RPC path')
  }

  async rpc(fn: string, args: Record<string, any>) {
    if (fn === 'reserve_stripe_webhook_event') {
      const existing = this.rows.find((row) => (
        row.stripe_event_id === args.p_stripe_event_id &&
        row.endpoint_path === args.p_endpoint_path
      ))

      if (!existing) {
        this.rows.push({
          id: `stripe_webhook_events-${this.rows.length + 1}`,
          stripe_event_id: args.p_stripe_event_id,
          event_type: args.p_event_type,
          payload: args.p_payload,
          source: args.p_source,
          endpoint_path: args.p_endpoint_path,
          livemode: args.p_livemode,
          processed: false,
          processed_at: null,
          completed_at: null,
          in_flight: true,
          reserved_at: new Date().toISOString(),
          processing_outcome: 'received',
          duplicate_count: 0,
        })
        return { data: [{ existed: false, in_flight: true, completed: false, reserved_now: true, processed_at: null }], error: null }
      }

      if (existing.completed_at || existing.processed) {
        existing.duplicate_count = Number(existing.duplicate_count ?? 0) + 1
        return {
          data: [{
            existed: true,
            in_flight: false,
            completed: true,
            reserved_now: false,
            processed_at: existing.completed_at ?? existing.processed_at ?? null,
          }],
          error: null,
        }
      }

      if (existing.in_flight) {
        return { data: [{ existed: true, in_flight: true, completed: false, reserved_now: false, processed_at: null }], error: null }
      }

      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processing_outcome: 'received',
        in_flight: true,
        reserved_at: new Date().toISOString(),
        last_error: null,
        error: null,
      })
      return { data: [{ existed: true, in_flight: true, completed: false, reserved_now: true, processed_at: null }], error: null }
    }

    if (fn === 'record_stripe_webhook_event_result') {
      const existing = this.rows.find((row) => (
        row.stripe_event_id === args.p_stripe_event_id &&
        row.endpoint_path === args.p_endpoint_path
      ))
      const now = new Date().toISOString()
      const row = existing ?? {
        id: `stripe_webhook_events-${this.rows.length + 1}`,
        stripe_event_id: args.p_stripe_event_id,
        endpoint_path: args.p_endpoint_path,
        duplicate_count: 0,
      }
      Object.assign(row, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processed: args.p_processed,
        processed_at: args.p_processed ? now : null,
        completed_at: args.p_processed ? now : null,
        in_flight: false,
        processing_outcome: args.p_processing_outcome,
        last_error: args.p_error ?? null,
        error: args.p_error ?? null,
      })
      if (!existing) this.rows.push(row)
      return { data: row, error: null }
    }

    if (fn === 'release_stale_stripe_webhook_reservations') {
      const cutoffMs = Date.now() - 5 * 60 * 1000
      let released = 0
      this.rows.forEach((row) => {
        if (row.in_flight && row.reserved_at && Date.parse(row.reserved_at) < cutoffMs) {
          row.in_flight = false
          row.metadata = { ...(row.metadata ?? {}), stale_reservation: true }
          row.last_error = row.last_error ?? 'stale reservation released'
          released += 1
        }
      })
      return { data: [{ released_count: released }], error: null }
    }

    return { data: null, error: null }
  }
}

function reservationInput(event = EVENT) {
  return {
    event,
    source: 'platform' as const,
    endpointPath: '/api/webhooks/stripe',
  }
}

describe('Stripe webhook event reservations', () => {
  const originalCronSecret = process.env.CRON_SECRET

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret
    jest.clearAllMocks()
  })

  it('reserves first delivery before side effects', async () => {
    const db = new ReservationDb()

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toEqual({
      reservedNow: true,
      existed: false,
    })

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({
      stripe_event_id: EVENT.id,
      endpoint_path: '/api/webhooks/stripe',
      in_flight: true,
      processing_outcome: 'received',
    })
  })

  it('returns an in-flight response for concurrent duplicate delivery', async () => {
    const db = new ReservationDb()

    await reserveStripeWebhookEvent(db as any, reservationInput())

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toEqual({
      inFlight: true,
    })
  })

  it('skips completed duplicate delivery and increments duplicate count', async () => {
    const db = new ReservationDb()

    await reserveStripeWebhookEvent(db as any, reservationInput())
    await recordStripeWebhookProcessingResult(db as any, {
      ...reservationInput(),
      outcome: 'processed',
    })

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toMatchObject({
      completed: true,
      processedAt: expect.any(String),
    })
    expect(db.rows[0].duplicate_count).toBe(1)
  })

  it('releases a failed side-effect attempt so Stripe retries can reserve again', async () => {
    const db = new ReservationDb()

    await reserveStripeWebhookEvent(db as any, reservationInput())
    await failStripeWebhookProcessing(db as any, {
      ...reservationInput(),
      error: new Error('handler failed'),
    })

    expect(db.rows[0]).toMatchObject({
      in_flight: false,
      processed: false,
      processing_outcome: 'failed',
      last_error: 'handler failed',
    })

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toEqual({
      reservedNow: true,
      existed: true,
    })
  })

  it('releases stale in-flight reservations through the cron helper', async () => {
    const db = new ReservationDb()
    db.rows.push({
      stripe_event_id: 'evt_stale',
      endpoint_path: '/api/webhooks/stripe',
      in_flight: true,
      reserved_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      metadata: {},
    })

    await expect(releaseStaleStripeWebhookReservations(db as any)).resolves.toEqual({ releasedCount: 1 })
    expect(db.rows[0]).toMatchObject({
      in_flight: false,
      metadata: { stale_reservation: true },
    })
  })

  it('releases stale in-flight reservations before reserving a retry', async () => {
    const db = new ReservationDb()
    db.rows.push({
      stripe_event_id: EVENT.id,
      endpoint_path: '/api/webhooks/stripe',
      in_flight: true,
      reserved_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      metadata: {},
    })

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toEqual({
      reservedNow: true,
      existed: true,
    })
    expect(db.rows[0]).toMatchObject({
      in_flight: true,
      metadata: { stale_reservation: true },
      processing_outcome: 'received',
    })
  })

  it('requires cron authorization before releasing stale reservations', async () => {
    const db = new ReservationDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    process.env.CRON_SECRET = 'cron_secret'

    const unauthorized = await releaseStaleReservations(new Request('http://localhost/api/cron/stripe-webhooks/release-stale') as any)
    expect(unauthorized.status).toBe(401)

    const authorized = await releaseStaleReservations(new Request('http://localhost/api/cron/stripe-webhooks/release-stale', {
      headers: { authorization: 'Bearer cron_secret' },
    }) as any)

    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toEqual({ ok: true, released_count: 0 })
  })
})
