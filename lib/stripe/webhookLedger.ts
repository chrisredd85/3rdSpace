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

export async function beginStripeWebhookProcessing(
  db: WebhookLedgerDb,
  input: {
    event: StripeWebhookLedgerEvent
    source: StripeWebhookSource
    endpointPath: string
  }
): Promise<StripeWebhookLedgerReservation> {
  const existing = await loadLedgerRow(db, input.event.id)
  if (existing) {
    await incrementDuplicateCount(db, input.event.id)
    if (existing.processed) {
      return { duplicate: true, processedAt: existing.processed_at ?? null }
    }
    return { duplicate: false }
  }

  const { error } = await db
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: input.event.id,
      event_type: input.event.type,
      source: input.source,
      endpoint_path: input.endpointPath,
      livemode: Boolean(input.event.livemode),
      payload: input.event,
      processed: false,
      processing_outcome: 'received',
      received_at: new Date().toISOString(),
    })

  if (error) {
    if (isUniqueViolation(error)) {
      await incrementDuplicateCount(db, input.event.id)
      const raced = await loadLedgerRow(db, input.event.id)
      if (raced?.processed) {
        return { duplicate: true, processedAt: raced.processed_at ?? null }
      }
      return { duplicate: false }
    }
    throw new Error(error.message ?? 'Failed to reserve Stripe webhook event')
  }

  return { duplicate: false }
}

export async function completeStripeWebhookProcessing(
  db: WebhookLedgerDb,
  input: {
    eventId: string
    outcome: StripeWebhookProcessingOutcome
  }
) {
  const now = new Date().toISOString()
  const { error } = await db
    .from('stripe_webhook_events')
    .update({
      processed: true,
      processed_at: now,
      processing_outcome: input.outcome,
      last_error: null,
      error: null,
    })
    .eq('stripe_event_id', input.eventId)

  if (error) throw new Error(error.message ?? 'Failed to mark Stripe webhook event processed')
}

export async function failStripeWebhookProcessing(
  db: WebhookLedgerDb,
  input: {
    eventId: string
    error: unknown
  }
) {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const { error } = await db
    .from('stripe_webhook_events')
    .update({
      processed: false,
      processing_outcome: 'failed',
      last_error: message.slice(0, 1000),
      error: message.slice(0, 1000),
    })
    .eq('stripe_event_id', input.eventId)

  if (error) throw new Error(error.message ?? 'Failed to mark Stripe webhook event failed')
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
