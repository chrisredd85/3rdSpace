import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import type Stripe from 'stripe'

export const STRIPE_WEBHOOK_REPLAY_HEADER = 'x-3rdplace-stripe-webhook-replay'

export function isAuthorizedStripeWebhookReplay(request: Request): boolean {
  if (request.headers.get(STRIPE_WEBHOOK_REPLAY_HEADER) !== '1') return false

  const expected = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!expected || !authorization?.startsWith('Bearer ')) return false

  return safeEqual(authorization.slice('Bearer '.length), expected)
}

export function parsePersistedStripeEvent(rawBody: string): Stripe.Event {
  const candidate = JSON.parse(rawBody) as Partial<Stripe.Event>
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.type !== 'string'
    || !candidate.data
    || typeof candidate.data !== 'object'
    || !('object' in candidate.data)
  ) {
    throw new Error('Persisted Stripe event is malformed')
  }

  return candidate as Stripe.Event
}

export async function loadQueuedStripeWebhookReplay(
  db: { from: (table: string) => any },
  input: { eventId: string; endpointPath: string },
): Promise<Stripe.Event | null> {
  const { data, error } = await db
    .from('stripe_webhook_events')
    .select('payload')
    .eq('stripe_event_id', input.eventId)
    .eq('endpoint_path', input.endpointPath)
    .eq('processed', false)
    .not('maintenance_deferred_at', 'is', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to authorize persisted Stripe webhook replay')
  }
  if (!data?.payload) return null

  return parsePersistedStripeEvent(JSON.stringify(data.payload))
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}
