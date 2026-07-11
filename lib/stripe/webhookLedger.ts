import 'server-only'
import { rootLogger } from '@/lib/server/logger'

type WebhookLedgerDb = {
  from: (table: string) => any
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>
}

export type StripeWebhookSource = 'platform' | 'connect'
export type StripeWebhookProcessingOutcome =
  | 'received'
  | 'processed'
  | 'ignored'
  | 'observed'
  | 'rate_limited'
  | 'deferred_maintenance'
  | 'failed'

export type StripeWebhookLedgerReservation =
  | { duplicate: true; processedAt: string | null }
  | { duplicate: false }

export type StripeWebhookEventReservation =
  | { completed: true; processedAt: string | null }
  | { inFlight: true }
  | {
      deferred: true
      queuedAt: string
      controlState: 'paused' | 'draining'
    }
  | {
      reservedNow: true
      existed: boolean
      reservationToken: string
      controlState: 'open' | 'draining'
    }
  | { reservedNow: false; reason: string }

export interface StripeWebhookLedgerEvent {
  id: string
  type: string
  livemode?: boolean
}

export async function checkStripeWebhookLedger(
  db: WebhookLedgerDb,
  input: {
    eventId: string
  }
): Promise<StripeWebhookLedgerReservation> {
  const existing = await loadLedgerRow(db, input.eventId)
  if (existing) {
    if (existing.processed) {
      await incrementDuplicateCount(db, input.eventId)
      return { duplicate: true, processedAt: existing.processed_at ?? null }
    }

    return { duplicate: false }
  }

  return { duplicate: false }
}

export async function reserveStripeWebhookEvent(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
    replayAuthorized?: boolean
  }
): Promise<StripeWebhookEventReservation> {
  await releaseStaleReservationsBestEffort(db)

  if (typeof db.rpc !== 'function') {
    throw new Error('Stripe webhook reservation RPC is unavailable')
  }

  const { data, error } = await db.rpc('reserve_stripe_webhook_event', {
    p_stripe_event_id: input.event.id,
    p_event_type: input.event.type,
    p_payload: input.event,
    p_source: input.source,
    p_endpoint_path: input.endpointPath,
    p_livemode: Boolean(input.event.livemode),
    p_replay_authorized: Boolean(input.replayAuthorized),
  })

  if (error) {
    rootLogger.warn('Stripe webhook reservation RPC failed', {
      stripe_event_id: input.event.id,
      stripe_event_type: input.event.type,
      endpointPath: input.endpointPath,
      error: error.message,
    })
    throw new Error(error.message ?? 'Stripe webhook reservation RPC failed')
  }

  const row = Array.isArray(data) ? data[0] : data
  const reservation = normalizeReservation(row)
  if ('reservedNow' in reservation && !reservation.reservedNow) {
    throw new Error(reservation.reason)
  }
  return reservation
}

async function releaseStaleReservationsBestEffort(db: WebhookLedgerDb) {
  try {
    const result = await releaseStaleStripeWebhookReservations(db)
    if (result.releasedCount > 0) {
      rootLogger.info('Stripe webhook stale reservations released before processing', {
        releasedCount: result.releasedCount,
      })
    }
  } catch (error) {
    rootLogger.warn('Stripe webhook stale reservation release failed before processing', {
      error: error instanceof Error ? error.message : error,
    })
  }
}

export async function recordStripeWebhookProcessingResult(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
    outcome: StripeWebhookProcessingOutcome
    reservationToken: string
    processed?: boolean
    error?: unknown
  }
) {
  const processed = input.processed ?? input.outcome !== 'failed'
  const errorMessage = input.error instanceof Error
    ? input.error.message
    : input.error == null
      ? null
      : String(input.error)

  if (typeof db.rpc !== 'function') {
    throw new Error('Stripe webhook result RPC is unavailable')
  }

  const { error } = await db.rpc('record_stripe_webhook_event_result', {
    p_stripe_event_id: input.event.id,
    p_event_type: input.event.type,
    p_payload: input.event,
    p_source: input.source,
    p_endpoint_path: input.endpointPath,
    p_livemode: Boolean(input.event.livemode),
    p_processing_outcome: input.outcome,
    p_processed: processed,
    p_error: errorMessage,
    p_reservation_token: input.reservationToken,
  })

  if (!error) return
  rootLogger.warn('Stripe webhook result RPC failed', {
    stripe_event_id: input.event.id,
    stripe_event_type: input.event.type,
    error: error.message,
  })
  throw new Error(error.message ?? 'Stripe webhook result RPC failed')
}

export async function failStripeWebhookProcessing(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
    reservationToken: string
    error: unknown
  }
) {
  await recordStripeWebhookProcessingResult(db, {
    event: input.event,
    source: input.source,
    endpointPath: input.endpointPath,
    outcome: 'failed',
    reservationToken: input.reservationToken,
    processed: false,
    error: input.error,
  })
}

export async function deferStripeWebhookForMaintenance(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    endpointPath: string
    reservationToken: string
  },
) {
  if (typeof db.rpc !== 'function') {
    throw new Error('Stripe webhook maintenance deferral RPC is unavailable')
  }

  const { data, error } = await db.rpc('defer_stripe_webhook_for_maintenance', {
    p_stripe_event_id: input.event.id,
    p_endpoint_path: input.endpointPath,
    p_reservation_token: input.reservationToken,
  })

  if (error) {
    throw new Error(error.message ?? 'Failed to defer Stripe webhook during maintenance')
  }

  const result = (Array.isArray(data) ? data[0] : data) as { queued_at?: unknown } | null
  if (!result || typeof result.queued_at !== 'string') {
    throw new Error('Stripe webhook maintenance deferral result is invalid')
  }

  return { queuedAt: result.queued_at }
}

export async function releaseStaleStripeWebhookReservations(
  db: WebhookLedgerDb,
  olderThan: string = '5 minutes'
): Promise<{ releasedCount: number }> {
  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('release_stale_stripe_webhook_reservations', {
      p_older_than: olderThan,
    })
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      return { releasedCount: Number((row as any)?.released_count ?? 0) }
    }
    rootLogger.warn('Stripe webhook stale reservation release RPC failed', {
      error: error.message,
    })
    throw new Error(error.message ?? 'Failed to release stale Stripe webhook reservations')
  }

  throw new Error('Stripe webhook ledger does not support stale reservation release')
}

async function loadLedgerRow(db: WebhookLedgerDb, eventId: string): Promise<{
  processed: boolean | null
  processed_at: string | null
} | null> {
  const { data, error } = await db
    .from('stripe_webhook_events')
    .select('processed, processed_at')
    .eq('stripe_event_id', eventId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to read Stripe webhook ledger')
  return data as { processed: boolean | null; processed_at: string | null } | null
}

async function incrementDuplicateCount(db: WebhookLedgerDb, eventId: string, endpointPath?: string) {
  if (typeof db.rpc === 'function') {
    const { error } = await db.rpc('increment_stripe_webhook_duplicate_count', {
      p_stripe_event_id: eventId,
      p_endpoint_path: endpointPath ?? null,
    })

    if (!error) return
    rootLogger.warn('Stripe webhook duplicate count increment failed', {
      stripe_event_id: eventId,
      error: error.message,
    })
  }

  let query = db
    .from('stripe_webhook_events')
    .update({ duplicate_count: 1 })
    .eq('stripe_event_id', eventId)
  if (endpointPath) query = query.eq('endpoint_path', endpointPath)
  await query
}

function normalizeReservation(row: unknown): StripeWebhookEventReservation {
  const reservation = row as {
    existed?: boolean
    in_flight?: boolean
    completed?: boolean
    reserved_now?: boolean
    processed_at?: string | null
    reservation_token?: string | null
    deferred?: boolean
    control_state?: 'open' | 'paused' | 'draining'
    queued_at?: string | null
  } | null

  if (!reservation) return { reservedNow: false, reason: 'reservation_failed' }
  if (reservation.completed) return { completed: true, processedAt: reservation.processed_at ?? null }
  if (reservation.in_flight && !reservation.reserved_now) return { inFlight: true }
  if (reservation.deferred) {
    if (
      (reservation.control_state !== 'paused' && reservation.control_state !== 'draining')
      || typeof reservation.queued_at !== 'string'
    ) {
      return { reservedNow: false, reason: 'invalid_deferred_reservation' }
    }
    return {
      deferred: true,
      queuedAt: reservation.queued_at,
      controlState: reservation.control_state,
    }
  }
  if (reservation.reserved_now) {
    if (
      typeof reservation.reservation_token !== 'string'
      || !reservation.reservation_token
      || (reservation.control_state !== 'open' && reservation.control_state !== 'draining')
    ) {
      return { reservedNow: false, reason: 'invalid_reservation_token' }
    }
    return {
      reservedNow: true,
      existed: Boolean(reservation.existed),
      reservationToken: reservation.reservation_token,
      controlState: reservation.control_state,
    }
  }
  return { reservedNow: false, reason: 'reservation_failed' }
}
