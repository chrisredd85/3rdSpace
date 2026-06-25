export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { verifyEventbriteWebhookSignature } from '@/lib/integrations/eventbrite/client'
import {
  getEventbriteWebhookDeliveryId,
  getEventbriteWebhookSecret,
  recordEventbriteWebhookReceipt,
  resolveEventbriteWebhookConnection,
} from '@/lib/integrations/eventbrite/sync'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { parseWebhookJson } from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { toJsonObject } from '@/lib/types/databaseRows'

const STALE_SECRET_ERROR = 'stale_encryption'

export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  let payload: Record<string, unknown>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Eventbrite Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const connection = await resolveEventbriteWebhookConnection(admin, request.nextUrl.searchParams)
  if (!connection) {
    return NextResponse.json({ error: 'Eventbrite connection not found' }, { status: 400 })
  }

  if (connection.status === 'setup_required' && connection.last_error === STALE_SECRET_ERROR) {
    return NextResponse.json(staleEventbriteSecretResponse(), { status: 200 })
  }

  let secret: string | null
  try {
    secret = getEventbriteWebhookSecret(connection)
  } catch (error) {
    await markEventbriteWebhookSecretStale(admin, connection, error)
    return NextResponse.json(staleEventbriteSecretResponse(), { status: 200 })
  }

  const signature =
    request.headers.get('x-eventbrite-signature') ??
    request.headers.get('eventbrite-signature') ??
    request.headers.get('x-eventbrite-signature-sha256')

  if (!secret || !verifyEventbriteWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid Eventbrite webhook signature' }, { status: 401 })
  }

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('eventbrite', request.headers)))) {
    console.warn('[Eventbrite Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  const deliveryId = getEventbriteWebhookDeliveryId(payload, request.headers)
  if (!deliveryId) {
    return NextResponse.json({ error: 'Missing Eventbrite webhook id' }, { status: 400 })
  }

  try {
    const receipt = await recordEventbriteWebhookReceipt({
      db: admin,
      connection,
      payload,
      headers: request.headers,
      deliveryId,
    })

    if (receipt.duplicate) {
      return NextResponse.json({ received: true, queued: false, duplicate: true }, { status: 200 })
    }

    const headers = normalizeHeaders(request.headers)
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const job = await enqueueJob(admin as unknown as SupabaseJobClient, {
      jobType: 'webhook.eventbrite',
      payload: {
        connectionId: connection.id,
        deliveryId,
        payload: toJsonObject(payload),
        rawBody,
        headers,
        searchParams,
      },
      uniqueKey: `webhook:eventbrite:${deliveryId}`,
      maxAttempts: 3,
    })

    return NextResponse.json({ received: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('[Eventbrite Webhook] Failed to enqueue webhook', error)
    return NextResponse.json(
      {
        received: true,
        queued: false,
        error: error instanceof Error ? error.message : 'Eventbrite webhook processing failed',
      },
      { status: 200 }
    )
  }
}

function normalizeHeaders(headers: Headers) {
  const normalized: Record<string, string> = {}
  headers.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}

function staleEventbriteSecretResponse() {
  return {
    received: true,
    ignored: true,
    reason: 'stale_secret',
  }
}

async function markEventbriteWebhookSecretStale(
  admin: ReturnType<typeof createServiceRoleClient>,
  connection: {
    id: string
    builder_id: string
  },
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[Eventbrite Webhook] Webhook secret decryption failed - likely stale ciphertext', {
    action: 'webhook_decryption_stale',
    provider: 'eventbrite',
    table: 'builder_ticketing_connections',
    row_id: connection.id,
    builder_id: connection.builder_id,
    error: message,
  })
  Sentry.captureException(error, {
    tags: {
      action: 'webhook_decryption_stale',
      provider: 'eventbrite',
    },
    extra: {
      table: 'builder_ticketing_connections',
      row_id: connection.id,
      builder_id: connection.builder_id,
    },
  })

  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('builder_ticketing_connections')
    .update({
      status: 'setup_required',
      last_error: STALE_SECRET_ERROR,
      updated_at: now,
    } as never)
    .eq('id', connection.id)

  if (updateError) {
    console.error('[Eventbrite Webhook] Failed to mark Eventbrite connection setup_required after stale secret', {
      row_id: connection.id,
      error: updateError.message,
    })
  }

  const { error: providerError } = await admin
    .from('provider_connections')
    .update({
      status: 'setup_required',
      last_error: STALE_SECRET_ERROR,
      updated_at: now,
    } as never)
    .eq('builder_id', connection.builder_id)
    .eq('provider', 'eventbrite')
    .is('plan_id', null)

  if (providerError) {
    console.warn('[Eventbrite Webhook] Failed to sync provider connection stale-secret state', {
      builder_id: connection.builder_id,
      error: providerError.message,
    })
  }

  await notifyEventbriteReconnectRequired(admin, connection)
}

async function notifyEventbriteReconnectRequired(
  admin: ReturnType<typeof createServiceRoleClient>,
  connection: {
    id: string
    builder_id: string
  }
) {
  const { data: builder, error: builderError } = await admin
    .from('builder_profiles')
    .select('user_id')
    .eq('id', connection.builder_id)
    .maybeSingle()

  if (builderError || !builder?.user_id) {
    if (builderError) {
      console.warn('[Eventbrite Webhook] Failed to load builder for stale-secret notification', {
        builder_id: connection.builder_id,
        error: builderError.message,
      })
    }
    return
  }

  const userId = String(builder.user_id)
  const groupKey = `ticketing-stale-secret:eventbrite:${connection.id}`
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existing, error: existingError } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('group_key', groupKey)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle()

  if (existingError) {
    console.warn('[Eventbrite Webhook] Failed to check stale-secret notification rate limit', {
      user_id: userId,
      error: existingError.message,
    })
    return
  }

  if (existing) return

  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type: 'ticketing_reconnect_required',
    notification_type: 'ticketing_reconnect_required',
    title: 'Eventbrite needs reconnecting',
    message: 'We upgraded token security and need you to reconnect Eventbrite before ticketing data can sync again.',
    action_url: '/planner/tickets',
    link_url: '/planner/tickets',
    group_key: groupKey,
    related_id: connection.id,
    metadata: {
      provider: 'eventbrite',
      builder_id: connection.builder_id,
      connection_id: connection.id,
      reason: STALE_SECRET_ERROR,
    },
    created_at: new Date().toISOString(),
  } as never)

  if (error) {
    console.warn('[Eventbrite Webhook] Failed to insert stale-secret notification', {
      user_id: userId,
      error: error.message,
    })
  }
}
