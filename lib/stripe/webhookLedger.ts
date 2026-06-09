import 'server-only'

type WebhookLedgerDb = {
  from: (table: string) => any
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error?: { message?: string } | null }>
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
      processing_outcome: input.outcome,
      last_error: errorMessage ? errorMessage.slice(0, 1000) : null,
      error: errorMessage ? errorMessage.slice(0, 1000) : null,
    })
    .eq('stripe_event_id', input.event.id)

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

async function incrementDuplicateCount(db: WebhookLedgerDb, eventId: string) {
  if (typeof db.rpc === 'function') {
    const { error } = await db.rpc('increment_stripe_webhook_duplicate_count', {
      p_stripe_event_id: eventId,
    })

    if (!error) return
    console.warn('[stripe.webhook] Failed to increment duplicate delivery count', {
      eventId,
      error: error.message,
    })
  }

  await db
    .from('stripe_webhook_events')
    .update({ duplicate_count: 1 })
    .eq('stripe_event_id', eventId)
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null
  return candidate?.code === '23505' || /duplicate key|unique constraint/i.test(candidate?.message ?? '')
}
