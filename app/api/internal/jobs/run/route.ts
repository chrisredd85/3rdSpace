export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { claimJobs, completeJob, failJob, type AppJob } from '@/lib/server/job-queue'
import { runOpportunityInviteJob } from '@/lib/server/opportunity-email-worker'
import { runEventbriteImport } from '@/lib/server/eventbrite-import'
import { runLiveEventRecompute } from '@/lib/finance/liveRecommendations'
import { processQueuedEventbriteWebhook } from '@/lib/integrations/eventbrite/sync'
import {
  processLumaWebhook,
  processPartifulWebhook,
  processPoshWebhook,
  recordPoshWebhookHeartbeat,
  recordWebhookDelivery,
  resolveIntegrationContext,
  verifyLumaSignature,
  verifyPoshSecret,
} from '@/lib/server/ticket-webhooks'

export const runtime = 'nodejs'

function headersFromPayload(headers: Record<string, string> | undefined) {
  return new Headers(headers ?? {})
}

function searchParamsFromPayload(searchParams: Record<string, string> | undefined) {
  return new URLSearchParams(searchParams ?? {})
}

async function processPoshWebhookJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  const payload = job.payload.payload as Record<string, any>
  const headers = headersFromPayload(job.payload.headers)
  const searchParams = searchParamsFromPayload(job.payload.searchParams)
  const context = await resolveIntegrationContext(admin, 'posh', payload, searchParams)
  const configuredSecret =
    typeof context.config?.webhook_secret === 'string'
      ? context.config.webhook_secret
      : process.env.POSH_WEBHOOK_SECRET

  if (configuredSecret && !verifyPoshSecret(configuredSecret, headers.get('posh-secret'))) {
    await recordWebhookDelivery(admin, 'posh', payload, headers, context, 'Invalid Posh webhook secret')
    return {
      processed: false,
      ignored: true,
      reason: 'invalid_secret',
      integrationId: context.integrationId,
      eventId: context.eventId,
    }
  }

  await recordPoshWebhookHeartbeat(admin, context, payload)
  const result = await processPoshWebhook(admin, payload, context)
  await recordWebhookDelivery(
    admin,
    'posh',
    payload,
    headers,
    context,
    result.processed ? null : result.skippedReason
  )
  return result
}

async function processLumaWebhookJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  const payload = job.payload.payload as Record<string, any>
  const rawBody = typeof job.payload.rawBody === 'string' ? job.payload.rawBody : JSON.stringify(payload)
  const headers = headersFromPayload(job.payload.headers)
  const searchParams = searchParamsFromPayload(job.payload.searchParams)
  const context = await resolveIntegrationContext(admin, 'luma', payload, searchParams)
  const configuredSecret =
    typeof context.config?.webhook_secret === 'string'
      ? context.config.webhook_secret
      : process.env.LUMA_WEBHOOK_SECRET

  if (configuredSecret && !verifyLumaSignature(configuredSecret, headers.get('webhook-signature'), rawBody)) {
    await recordWebhookDelivery(admin, 'luma', payload, headers, context, 'Invalid Luma webhook signature')
    return {
      processed: false,
      ignored: true,
      reason: 'invalid_signature',
      integrationId: context.integrationId,
      eventId: context.eventId,
    }
  }

  const result = await processLumaWebhook(admin, payload, context, headers.get('webhook-id'))
  await recordWebhookDelivery(
    admin,
    'luma',
    payload,
    headers,
    context,
    result.processed ? null : result.skippedReason
  )
  return result
}

async function processPartifulWebhookJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  const payload = job.payload.payload as Record<string, any>
  const headers = headersFromPayload(job.payload.headers)
  const searchParams = searchParamsFromPayload(job.payload.searchParams)
  const context = await resolveIntegrationContext(admin, 'partiful', payload, searchParams)
  const configuredSecret =
    typeof context.config?.webhook_secret === 'string'
      ? context.config.webhook_secret
      : process.env.PARTIFUL_WEBHOOK_SECRET

  if (
    configuredSecret &&
    !verifyPoshSecret(
      configuredSecret,
      headers.get('partiful-secret') ?? headers.get('x-partiful-secret')
    )
  ) {
    await recordWebhookDelivery(admin, 'partiful', payload, headers, context, 'Invalid Partiful webhook secret')
    return {
      processed: false,
      ignored: true,
      reason: 'invalid_secret',
      integrationId: context.integrationId,
      eventId: context.eventId,
    }
  }

  const result = await processPartifulWebhook(admin, payload, context, headers.get('webhook-id'))
  await recordWebhookDelivery(
    admin,
    'partiful',
    payload,
    headers,
    context,
    result.processed ? null : result.skippedReason
  )
  return result
}

async function processEventbriteWebhookJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  const connectionId = job.payload.connectionId
  const deliveryId = job.payload.deliveryId
  const payload = job.payload.payload

  if (typeof connectionId !== 'string') throw new Error('Missing Eventbrite connectionId')
  if (typeof deliveryId !== 'string') throw new Error('Missing Eventbrite deliveryId')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Missing Eventbrite webhook payload')
  }

  return processQueuedEventbriteWebhook({
    db: admin,
    connectionId,
    deliveryId,
    payload: payload as Record<string, unknown>,
  })
}

async function processJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  if (job.job_type === 'eventbrite.import') {
    const integrationId = job.payload.integrationId
    if (typeof integrationId !== 'string') throw new Error('Missing integrationId')
    return runEventbriteImport(admin, integrationId)
  }

  if (job.job_type === 'live_event.recompute') {
    const eventId = job.payload.eventId
    if (typeof eventId !== 'string') throw new Error('Missing eventId')
    return runLiveEventRecompute(admin, eventId)
  }

  if (job.job_type === 'webhook.eventbrite') {
    return processEventbriteWebhookJob(admin, job)
  }

  if (job.job_type === 'webhook.posh') {
    return processPoshWebhookJob(admin, job)
  }

  if (job.job_type === 'webhook.luma') {
    return processLumaWebhookJob(admin, job)
  }

  if (job.job_type === 'webhook.partiful') {
    return processPartifulWebhookJob(admin, job)
  }

  if (
    job.job_type === 'opportunity_send_venue_invite' ||
    job.job_type === 'opportunity_remind_venue_invite' ||
    job.job_type === 'opportunity_expire_venue_invite' ||
    job.job_type === 'opportunity_send_vendor_invite' ||
    job.job_type === 'opportunity_remind_vendor_invite' ||
    job.job_type === 'opportunity_expire_vendor_invite'
  ) {
    return runOpportunityInviteJob(admin, job)
  }

  throw new Error(`Unsupported job type: ${job.job_type}`)
}

/**
 * Claims and processes queued background jobs.
 *
 * Call this from a cron, a separate worker, or the admin console.
 */
export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient()
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitParam || 5) || 5, 1), 25)
  const jobs = await claimJobs(admin, limit)
  const results = []

  for (const job of jobs) {
    try {
      const result = await processJob(admin, job)
      await completeJob(admin, job.id, result)
      results.push({ id: job.id, jobType: job.job_type, status: 'succeeded', result })
    } catch (error) {
      await failJob(admin, job, error)
      results.push({
        id: job.id,
        jobType: job.job_type,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Job failed',
      })
    }
  }

  return NextResponse.json({
    claimed: jobs.length,
    results,
  })
}
