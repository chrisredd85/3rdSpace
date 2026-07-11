export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { getRequestLogger } from '@/lib/server/logger'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { processStripeConnectWebhookEvent } from '@/lib/stripe/connect-webhook'
import {
  deferStripeWebhookForMaintenance,
  failStripeWebhookProcessing,
  recordStripeWebhookProcessingResult,
  reserveStripeWebhookEvent,
} from '@/lib/stripe/webhookLedger'
import {
  isAuthorizedStripeWebhookReplay,
  loadQueuedStripeWebhookReplay,
  parsePersistedStripeEvent,
} from '@/lib/stripe/webhookReplayAuth'
import { readWritePauseStatus } from '@/lib/write-pause'

export const runtime = 'nodejs'

/**
 * Receives Stripe Connect account events. This route intentionally uses the
 * Connect endpoint signing secret so platform and Connect secrets cannot shadow
 * each other.
 */
export async function POST(request: NextRequest) {
  const logger = getRequestLogger(request).child({ stripe_source: 'connect' })
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const authorizedReplay = isAuthorizedStripeWebhookReplay(request)

  if (!webhookSecret && !authorizedReplay) {
    logger.error('Stripe Connect webhook missing secret')
    return NextResponse.json({ error: 'Stripe Connect webhook secret is not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')

  if (!signature && !authorizedReplay) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = authorizedReplay
      ? parsePersistedStripeEvent(rawBody)
      : getStripeClient().webhooks.constructEvent(rawBody, signature!, webhookSecret!)
  } catch (error) {
    logger.error(authorizedReplay ? 'Stripe Connect webhook replay payload invalid' : 'Stripe Connect webhook invalid signature', error)
    return NextResponse.json(
      { error: authorizedReplay ? 'Invalid persisted Stripe event' : 'Invalid Stripe signature' },
      { status: 400 },
    )
  }

  if (authorizedReplay) {
    try {
      const queuedEvent = await loadQueuedStripeWebhookReplay(admin as any, {
        eventId: event.id,
        endpointPath: '/api/webhooks/stripe/connect',
      })
      if (!queuedEvent) {
        logger.error('Stripe Connect webhook replay rejected because no deferred ledger event exists', undefined, {
          stripe_event_id: event.id,
        })
        return NextResponse.json({ error: 'Deferred Stripe event not found' }, { status: 403 })
      }
      event = queuedEvent
    } catch (error) {
      logger.error('Stripe Connect webhook replay ledger lookup failed', error, { stripe_event_id: event.id })
      return NextResponse.json({ error: 'Deferred Stripe event lookup failed' }, { status: 500 })
    }
  }

  const eventLogger = logger.child({ stripe_event_id: event.id, stripe_event_type: event.type })

  let reservation: Awaited<ReturnType<typeof reserveStripeWebhookEvent>>
  try {
    reservation = await reserveStripeWebhookEvent(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      replayAuthorized: authorizedReplay,
    })
  } catch (error) {
    eventLogger.error('Stripe Connect webhook reservation failed closed', error)
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }
  if ('deferred' in reservation && reservation.deferred) {
    eventLogger.info('Stripe Connect webhook queued by durable write-pause reservation', {
      queuedAt: reservation.queuedAt,
      controlState: reservation.controlState,
    })
    return NextResponse.json(
      { received: true, queued: true, reason: 'maintenance_in_progress' },
      { status: 202 },
    )
  }
  if ('completed' in reservation && reservation.completed) {
    eventLogger.info('Stripe Connect webhook duplicate delivery skipped', {
      processedAt: reservation.processedAt,
    })
    return NextResponse.json({ received: true, duplicate: true })
  }
  if ('inFlight' in reservation && reservation.inFlight) {
    eventLogger.info('Stripe Connect webhook concurrent duplicate delivery skipped')
    return NextResponse.json({ received: true, in_flight: true }, { status: 409 })
  }
  if (!('reservedNow' in reservation) || !reservation.reservedNow) {
    eventLogger.error('Stripe Connect webhook reservation failed', undefined, {
      reservation,
    })
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }
  const reservationToken = reservation.reservationToken

  const pause = await readWritePauseStatus()
  if (!authorizedReplay && pause.available && pause.state !== 'open') {
    try {
      const deferred = await deferStripeWebhookForMaintenance(admin as any, {
        event,
        endpointPath: '/api/webhooks/stripe/connect',
        reservationToken,
      })
      eventLogger.info('Stripe Connect webhook queued during write pause', {
        queuedAt: deferred.queuedAt,
        pauseRevision: pause.revision,
      })
      return NextResponse.json(
        {
          received: true,
          queued: true,
          reason: 'maintenance_in_progress',
        },
        { status: 202 },
      )
    } catch (error) {
      eventLogger.error('Stripe Connect webhook maintenance queue failed', error)
      await failStripeWebhookProcessing(admin as any, {
        event,
        source: 'connect',
        endpointPath: '/api/webhooks/stripe/connect',
        reservationToken,
        error,
      }).catch((ledgerError) => {
        eventLogger.error('Stripe Connect webhook failed to save queue failure', ledgerError)
      })
      return NextResponse.json({ received: true, queued: false }, { status: 500 })
    }
  }

  if (!pause.available) {
    eventLogger.error('Write-pause store unavailable; processing Stripe Connect webhook fail-open', undefined, {
      error: pause.error,
    })
  }

  // Replays are CRON-authenticated and reload the authoritative payload from
  // the deferred ledger. Applying the public delivery rate limit here would
  // acknowledge the replay as processed without running its side effects.
  if (!authorizedReplay && !(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe-connect', request.headers)))) {
    eventLogger.warn('Stripe Connect webhook rate limit exceeded')
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: 'rate_limited',
      reservationToken,
      processed: false,
    })
    return NextResponse.json(
      { received: false, retry: true, reason: 'rate_limited' },
      { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
    )
  }

  try {
    const result = await processStripeConnectWebhookEvent(admin as any, event, getStripeClient())
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: result.observed ? 'observed' : result.ignored ? 'ignored' : 'processed',
      reservationToken,
    })
    return NextResponse.json(result)
  } catch (error) {
    eventLogger.error('Stripe Connect webhook processing failed', error)
    await failStripeWebhookProcessing(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      reservationToken,
      error,
    }).catch((ledgerError) => {
      eventLogger.error('Stripe Connect webhook failed to save failure state', ledgerError)
    })
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
