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
  state: 'open' | 'paused' | 'draining' = 'open'
  reservationError: string | null = null
  private tokenCounter = 0

  from() {
    throw new Error('Reservation tests should use the RPC path')
  }

  async rpc(fn: string, args: Record<string, any>) {
    if (fn === 'reserve_stripe_webhook_event') {
      if (this.reservationError) {
        return { data: null, error: { message: this.reservationError } }
      }
      if (args.p_replay_authorized && this.state !== 'draining') {
        return { data: null, error: { message: 'authorized webhook replay requires draining state' } }
      }
      const shouldDefer = this.state !== 'open' && !(this.state === 'draining' && args.p_replay_authorized)
      const existing = this.rows.find((row) => (
        row.stripe_event_id === args.p_stripe_event_id &&
        row.endpoint_path === args.p_endpoint_path
      ))

      if (!existing) {
        const now = new Date().toISOString()
        const reservationToken = shouldDefer ? null : `reservation-${++this.tokenCounter}`
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
          in_flight: !shouldDefer,
          reserved_at: shouldDefer ? null : now,
          reservation_token: reservationToken,
          maintenance_deferred_at: shouldDefer ? now : null,
          processing_outcome: shouldDefer ? 'deferred_maintenance' : 'received',
          duplicate_count: 0,
        })
        return {
          data: [{
            existed: false,
            in_flight: !shouldDefer,
            completed: false,
            reserved_now: !shouldDefer,
            processed_at: null,
            reservation_token: reservationToken,
            deferred: shouldDefer,
            control_state: this.state,
            queued_at: shouldDefer ? now : null,
          }],
          error: null,
        }
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
            reservation_token: null,
            deferred: false,
            control_state: this.state,
            queued_at: null,
          }],
          error: null,
        }
      }

      if (existing.in_flight) {
        return {
          data: [{
            existed: true,
            in_flight: true,
            completed: false,
            reserved_now: false,
            processed_at: null,
            reservation_token: null,
            deferred: false,
            control_state: this.state,
            queued_at: null,
          }],
          error: null,
        }
      }

      if (shouldDefer) {
        const now = new Date().toISOString()
        Object.assign(existing, {
          event_type: args.p_event_type,
          payload: args.p_payload,
          source: args.p_source,
          endpoint_path: args.p_endpoint_path,
          livemode: args.p_livemode,
          processed: false,
          processed_at: null,
          completed_at: null,
          processing_outcome: 'deferred_maintenance',
          in_flight: false,
          reservation_token: null,
          maintenance_deferred_at: now,
        })
        return {
          data: [{
            existed: true,
            in_flight: false,
            completed: false,
            reserved_now: false,
            processed_at: null,
            reservation_token: null,
            deferred: true,
            control_state: this.state,
            queued_at: now,
          }],
          error: null,
        }
      }

      const reservationToken = `reservation-${++this.tokenCounter}`
      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processing_outcome: 'received',
        in_flight: true,
        reserved_at: new Date().toISOString(),
        reservation_token: reservationToken,
        last_error: null,
        error: null,
      })
      return {
        data: [{
          existed: true,
          in_flight: true,
          completed: false,
          reserved_now: true,
          processed_at: null,
          reservation_token: reservationToken,
          deferred: false,
          control_state: this.state,
          queued_at: null,
        }],
        error: null,
      }
    }

    if (fn === 'record_stripe_webhook_event_result') {
      const existing = this.rows.find((row) => (
        row.stripe_event_id === args.p_stripe_event_id &&
        row.endpoint_path === args.p_endpoint_path
      ))
      if (
        !existing
        || !existing.in_flight
        || existing.reservation_token !== args.p_reservation_token
      ) {
        return { data: null, error: { message: 'Stripe webhook reservation ownership was lost' } }
      }
      const now = new Date().toISOString()
      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processed: args.p_processed,
        processed_at: args.p_processed ? now : null,
        completed_at: args.p_processed ? now : null,
        in_flight: false,
        reservation_token: null,
        processing_outcome: args.p_processing_outcome,
        maintenance_deferred_at: args.p_processed ? null : existing.maintenance_deferred_at,
        last_error: args.p_error ?? null,
        error: args.p_error ?? null,
      })
      return { data: existing, error: null }
    }

    if (fn === 'release_stale_stripe_webhook_reservations') {
      const cutoffMs = Date.now() - 5 * 60 * 1000
      let released = 0
      this.rows.forEach((row) => {
        if (row.in_flight && row.reserved_at && Date.parse(row.reserved_at) < cutoffMs) {
          row.in_flight = false
          row.reservation_token = null
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

async function reserveToken(db: ReservationDb, input = reservationInput()) {
  const reservation = await reserveStripeWebhookEvent(db as any, input)
  if (!('reservedNow' in reservation) || !reservation.reservedNow) {
    throw new Error('test expected a reservation token')
  }
  return reservation.reservationToken
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

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toMatchObject({
      reservedNow: true,
      existed: false,
      reservationToken: expect.any(String),
      controlState: 'open',
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

    const reservationToken = await reserveToken(db)
    await recordStripeWebhookProcessingResult(db as any, {
      ...reservationInput(),
      outcome: 'processed',
      reservationToken,
    })

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toMatchObject({
      completed: true,
      processedAt: expect.any(String),
    })
    expect(db.rows[0].duplicate_count).toBe(1)
  })

  it('releases a failed side-effect attempt so Stripe retries can reserve again', async () => {
    const db = new ReservationDb()

    const reservationToken = await reserveToken(db)
    await failStripeWebhookProcessing(db as any, {
      ...reservationInput(),
      reservationToken,
      error: new Error('handler failed'),
    })

    expect(db.rows[0]).toMatchObject({
      in_flight: false,
      processed: false,
      processing_outcome: 'failed',
      last_error: 'handler failed',
    })

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toMatchObject({
      reservedNow: true,
      existed: true,
      reservationToken: expect.any(String),
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

    await expect(reserveStripeWebhookEvent(db as any, reservationInput())).resolves.toMatchObject({
      reservedNow: true,
      existed: true,
      reservationToken: expect.any(String),
    })
    expect(db.rows[0]).toMatchObject({
      in_flight: true,
      metadata: { stale_reservation: true },
      processing_outcome: 'received',
    })
  })

  it('fails closed when the atomic reservation RPC is absent or errors', async () => {
    await expect(reserveStripeWebhookEvent({ from: jest.fn() } as any, reservationInput()))
      .rejects.toThrow('reservation RPC is unavailable')

    const db = new ReservationDb()
    db.reservationError = 'database RPC unavailable'
    await expect(reserveStripeWebhookEvent(db as any, reservationInput()))
      .rejects.toThrow('database RPC unavailable')
    expect(db.rows).toHaveLength(0)
  })

  it('queues external deliveries in paused and draining states but reserves authorized draining replay', async () => {
    const paused = new ReservationDb()
    paused.state = 'paused'
    await expect(reserveStripeWebhookEvent(paused as any, reservationInput())).resolves.toMatchObject({
      deferred: true,
      controlState: 'paused',
      queuedAt: expect.any(String),
    })
    expect(paused.rows[0]).toMatchObject({
      in_flight: false,
      reservation_token: null,
      processing_outcome: 'deferred_maintenance',
    })

    const draining = new ReservationDb()
    draining.state = 'draining'
    await expect(reserveStripeWebhookEvent(draining as any, reservationInput())).resolves.toMatchObject({
      deferred: true,
      controlState: 'draining',
    })
    await expect(reserveStripeWebhookEvent(draining as any, {
      ...reservationInput(),
      replayAuthorized: true,
    })).resolves.toMatchObject({
      reservedNow: true,
      existed: true,
      controlState: 'draining',
      reservationToken: expect.any(String),
    })
  })

  it('fences a stale owner after its five-minute lease is reclaimed', async () => {
    const db = new ReservationDb()
    const staleToken = await reserveToken(db)
    db.rows[0].reserved_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    await expect(releaseStaleStripeWebhookReservations(db as any)).resolves.toEqual({ releasedCount: 1 })
    const currentToken = await reserveToken(db)
    expect(currentToken).not.toBe(staleToken)

    await expect(recordStripeWebhookProcessingResult(db as any, {
      ...reservationInput(),
      outcome: 'processed',
      reservationToken: staleToken,
    })).rejects.toThrow('reservation ownership was lost')

    await expect(recordStripeWebhookProcessingResult(db as any, {
      ...reservationInput(),
      outcome: 'processed',
      reservationToken: currentToken,
    })).resolves.toBeUndefined()
    expect(db.rows[0]).toMatchObject({ processed: true, in_flight: false, reservation_token: null })
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
