export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getCronOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { releaseStaleStripeWebhookReservations } from '@/lib/stripe/webhookLedger'
import { STRIPE_WEBHOOK_REPLAY_HEADER } from '@/lib/stripe/webhookReplayAuth'
import { readWritePauseStatus, STRIPE_WEBHOOK_PATHS } from '@/lib/write-pause'

const requestSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
})

type DeferredRow = {
  id: string
  payload: unknown
  endpoint_path: string
  stripe_event_id: string
}

export async function POST(request: NextRequest) {
  const context = await getCronOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is required to replay deferred Stripe webhooks' },
      { status: 503 },
    )
  }

  const pause = await readWritePauseStatus()
  if (!pause.available) {
    return NextResponse.json(
      { error: 'Write-pause status is unavailable; refusing webhook replay' },
      { status: 503 },
    )
  }
  if (pause.state !== 'draining') {
    return NextResponse.json(
      { error: 'Deferred Stripe webhooks may replay only while the write pause is draining' },
      { status: 409 },
    )
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid replay request' }, { status: 400 })
  }

  const admin = createServiceRoleClient() as any
  let releasedStaleReservations = 0
  try {
    const released = await releaseStaleStripeWebhookReservations(admin)
    releasedStaleReservations = released.releasedCount
  } catch (error) {
    console.error('[stripe.webhook.replay] stale_reservation_release_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to reclaim interrupted Stripe webhook replays' },
      { status: 500 },
    )
  }

  const { data, error } = await admin
    .from('stripe_webhook_events')
    .select('id,payload,endpoint_path,stripe_event_id')
    .eq('processed', false)
    .eq('in_flight', false)
    .not('maintenance_deferred_at', 'is', null)
    .order('maintenance_deferred_at', { ascending: true })
    .limit(parsed.data.limit)

  if (error) {
    console.error('[stripe.webhook.replay] load_failed', { error: error.message })
    return NextResponse.json({ error: 'Failed to load deferred Stripe webhooks' }, { status: 500 })
  }

  const rows = (data ?? []) as DeferredRow[]
  const allowedPaths = new Set<string>(STRIPE_WEBHOOK_PATHS)
  const replayed: string[] = []
  const inFlight: string[] = []
  const failed: Array<{ stripe_event_id: string; status: number | null; error: string }> = []
  const origin = new URL(request.url).origin

  for (const row of rows) {
    if (!allowedPaths.has(row.endpoint_path)) {
      failed.push({
        stripe_event_id: row.stripe_event_id,
        status: null,
        error: `Unsupported persisted endpoint: ${row.endpoint_path}`,
      })
      continue
    }

    try {
      const response = await fetch(new URL(row.endpoint_path, origin), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cronSecret}`,
          'content-type': 'application/json',
          [STRIPE_WEBHOOK_REPLAY_HEADER]: '1',
        },
        body: JSON.stringify(row.payload),
        cache: 'no-store',
      })

      if (response.ok) {
        replayed.push(row.stripe_event_id)
      } else if (response.status === 409) {
        inFlight.push(row.stripe_event_id)
      } else {
        const body = await response.text()
        failed.push({
          stripe_event_id: row.stripe_event_id,
          status: response.status,
          error: body.slice(0, 500) || 'Replay request failed',
        })
      }
    } catch (error) {
      failed.push({
        stripe_event_id: row.stripe_event_id,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const { count, error: countError } = await admin
    .from('stripe_webhook_events')
    .select('id', { count: 'exact', head: true })
    .eq('processed', false)
    .not('maintenance_deferred_at', 'is', null)

  if (countError) {
    console.error('[stripe.webhook.replay] remaining_count_failed', { error: countError.message })
  }

  const result = {
    ok: failed.length === 0 && !countError,
    attempted: rows.length,
    replayed: replayed.length,
    in_flight: inFlight.length,
    released_stale_reservations: releasedStaleReservations,
    failed,
    remaining: count ?? null,
  }
  console.info('[stripe.webhook.replay] batch_complete', result)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
