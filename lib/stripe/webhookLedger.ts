import 'server-only'

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
  | 'failed'

export type StripeWebhookLedgerReservation =
  | { duplicate: true; processedAt: string | null }
  | { duplicate: false }

export type StripeWebhookEventReservation =
  | { completed: true; processedAt: string | null }
  | { inFlight: true }
  | { reservedNow: true; existed: boolean }
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
  }
): Promise<StripeWebhookEventReservation> {
  await releaseStaleReservationsBestEffort(db)

  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('reserve_stripe_webhook_event', {
      p_stripe_event_id: input.event.id,
      p_event_type: input.event.type,
      p_payload: input.event,
      p_source: input.source,
      p_endpoint_path: input.endpointPath,
      p_livemode: Boolean(input.event.livemode),
    })

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      return normalizeReservation(row)
    }
    console.warn('[stripe.webhook] Failed to reserve webhook event through RPC', {
      eventId: input.event.id,
      eventType: input.event.type,
      endpointPath: input.endpointPath,
      error: error.message,
    })
  }

  return reserveWebhookEventFallback(db, input)
}

async function releaseStaleReservationsBestEffort(db: WebhookLedgerDb) {
  try {
    const result = await releaseStaleStripeWebhookReservations(db)
    if (result.releasedCount > 0) {
      console.info('[stripe.webhook] Released stale webhook reservations before processing', {
        releasedCount: result.releasedCount,
      })
    }
  } catch (error) {
    console.warn('[stripe.webhook] Failed to release stale reservations before processing', {
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

  if (typeof db.rpc === 'function') {
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
    })

    if (!error) return
    console.warn('[stripe.webhook] Failed to record webhook result through RPC', {
      eventId: input.event.id,
      eventType: input.event.type,
      error: error.message,
    })
  }

  const now = new Date().toISOString()
  const { error } = await db
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: input.event.id,
      event_type: input.event.type,
      source: input.source,
      endpoint_path: input.endpointPath,
      livemode: Boolean(input.event.livemode),
      payload: input.event,
      processed,
      processed_at: processed ? now : null,
      completed_at: processed ? now : null,
      in_flight: false,
      processing_outcome: input.outcome,
      received_at: now,
      last_error: errorMessage ? errorMessage.slice(0, 1000) : null,
      error: errorMessage ? errorMessage.slice(0, 1000) : null,
    })

  if (!error) return

  if (!isUniqueViolation(error)) {
    throw new Error(error.message ?? 'Failed to record Stripe webhook result')
  }

  const { error: updateError } = await db
    .from('stripe_webhook_events')
    .update({
      processed,
      processed_at: processed ? now : null,
      completed_at: processed ? now : null,
      in_flight: false,
      processing_outcome: input.outcome,
      last_error: errorMessage ? errorMessage.slice(0, 1000) : null,
      error: errorMessage ? errorMessage.slice(0, 1000) : null,
    })
    .eq('stripe_event_id', input.event.id)
    .eq('endpoint_path', input.endpointPath)

  if (updateError) throw new Error(updateError.message ?? 'Failed to update Stripe webhook result')
}

export async function failStripeWebhookProcessing(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
    error: unknown
  }
) {
  await recordStripeWebhookProcessingResult(db, {
    event: input.event,
    source: input.source,
    endpointPath: input.endpointPath,
    outcome: 'failed',
    processed: false,
    error: input.error,
  })
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
    console.warn('[stripe.webhook] Failed to release stale reservations through RPC', {
      error: error.message,
    })
  }

  return { releasedCount: 0 }
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
    console.warn('[stripe.webhook] Failed to increment duplicate delivery count', {
      eventId,
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
  } | null

  if (!reservation) return { reservedNow: false, reason: 'reservation_failed' }
  if (reservation.completed) return { completed: true, processedAt: reservation.processed_at ?? null }
  if (reservation.in_flight && !reservation.reserved_now) return { inFlight: true }
  if (reservation.reserved_now) return { reservedNow: true, existed: Boolean(reservation.existed) }
  return { reservedNow: false, reason: 'reservation_failed' }
}

async function reserveWebhookEventFallback(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
  }
): Promise<StripeWebhookEventReservation> {
  const { data: existing, error: existingError } = await db
    .from('stripe_webhook_events')
    .select('processed, processed_at, completed_at, in_flight')
    .eq('stripe_event_id', input.event.id)
    .eq('endpoint_path', input.endpointPath)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message ?? 'Failed to reserve Stripe webhook event')

  if (existing?.completed_at || existing?.processed) {
    await incrementDuplicateCount(db, input.event.id, input.endpointPath)
    return { completed: true, processedAt: existing.completed_at ?? existing.processed_at ?? null }
  }
  if (existing?.in_flight) return { inFlight: true }

  const now = new Date().toISOString()
  if (existing) {
    const { error } = await db
      .from('stripe_webhook_events')
      .update({
        event_type: input.event.type,
        payload: input.event,
        source: input.source,
        endpoint_path: input.endpointPath,
        livemode: Boolean(input.event.livemode),
        processing_outcome: 'received',
        in_flight: true,
        reserved_at: now,
        last_error: null,
        error: null,
      })
      .eq('stripe_event_id', input.event.id)
      .eq('endpoint_path', input.endpointPath)
    if (error) throw new Error(error.message ?? 'Failed to reserve Stripe webhook event')
    return { reservedNow: true, existed: true }
  }

  const { error } = await db
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: input.event.id,
      event_type: input.event.type,
      payload: input.event,
      source: input.source,
      endpoint_path: input.endpointPath,
      livemode: Boolean(input.event.livemode),
      processed: false,
      processing_outcome: 'received',
      received_at: now,
      in_flight: true,
      reserved_at: now,
    })
  if (error) {
    if (isUniqueViolation(error)) return { inFlight: true }
    throw new Error(error.message ?? 'Failed to reserve Stripe webhook event')
  }
  return { reservedNow: true, existed: false }
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null
  return candidate?.code === '23505' || /duplicate key|unique constraint/i.test(candidate?.message ?? '')
}
