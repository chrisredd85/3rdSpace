export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { claimJobs, completeJob, failJob, type AppJob, type SupabaseJobClaimClient } from '@/lib/server/job-queue'
import { runOpportunityInviteJob } from '@/lib/server/opportunity-email-worker'
import { runEventbriteImport } from '@/lib/server/eventbrite-import'
import {
  runLiveEventRecompute,
  type SupabaseAdminClient as LiveEventRecomputeClient,
} from '@/lib/live-events/recommendations'
import { toJsonObject } from '@/lib/types/databaseRows'
import { processQueuedEventbriteWebhook, runQueuedEventbriteBackfillImport } from '@/lib/integrations/eventbrite/sync'
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
import {
  createSettlementRunForEvent,
  extractWebhookAttendanceCount,
  pullEventbriteAttendanceForSettlementRun,
  recordWebhookAttendanceForEvent,
} from '@/lib/finance/settlement-runs'
import { sendVenueSettlementAcknowledgementEmail } from '@/lib/finance/settlement-checkout'

export const runtime = 'nodejs'

function headersFromPayload(headers: unknown) {
  return new Headers(readStringRecord(headers))
}

function searchParamsFromPayload(searchParams: unknown) {
  return new URLSearchParams(readStringRecord(searchParams))
}

async function recordSettlementAttendanceBestEffort(
  admin: ReturnType<typeof createServiceRoleClient>,
  input: Parameters<typeof recordWebhookAttendanceForEvent>[1],
) {
  try {
    await recordWebhookAttendanceForEvent(admin, input)
  } catch (error) {
    console.warn('[jobs.run] Settlement attendance recording failed', {
      eventId: input.eventId,
      source: input.source,
      error: error instanceof Error ? error.message : error,
    })
  }
}

async function processPoshWebhookJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  const payload = toJsonObject(job.payload.payload)
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
  await recordSettlementAttendanceBestEffort(admin, {
    eventId: result.eventId,
    source: 'webhook_posh',
    payload,
    attendanceCount: extractWebhookAttendanceCount(payload),
  })
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
  const payload = toJsonObject(job.payload.payload)
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
  await recordSettlementAttendanceBestEffort(admin, {
    eventId: result.eventId,
    source: 'webhook_luma',
    payload,
    attendanceCount: extractWebhookAttendanceCount(payload),
  })
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
  const payload = toJsonObject(job.payload.payload)
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
  await recordSettlementAttendanceBestEffort(admin, {
    eventId: result.eventId,
    source: 'webhook_partiful',
    payload,
    attendanceCount: extractWebhookAttendanceCount(payload),
  })
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
    payload: toJsonObject(payload),
  })
}

async function processJob(admin: ReturnType<typeof createServiceRoleClient>, job: AppJob) {
  if (job.job_type === 'eventbrite.import') {
    const integrationId = job.payload.integrationId
    if (typeof integrationId !== 'string') throw new Error('Missing integrationId')
    return runEventbriteImport(admin, integrationId)
  }

  if (job.job_type === 'eventbrite.backfill.import') {
    const builderId = job.payload.builderId
    const userId = job.payload.userId
    const eventbriteEventIds = job.payload.eventbriteEventIds
    if (typeof builderId !== 'string') throw new Error('Missing builderId')
    if (typeof userId !== 'string') throw new Error('Missing userId')
    if (!Array.isArray(eventbriteEventIds) || !eventbriteEventIds.every((id) => typeof id === 'string')) {
      throw new Error('Missing Eventbrite event ids')
    }
    return runQueuedEventbriteBackfillImport({
      db: admin,
      builderId,
      userId,
      eventbriteEventIds,
    })
  }

  if (job.job_type === 'live_event.recompute') {
    const eventId = job.payload.eventId
    if (typeof eventId !== 'string') throw new Error('Missing eventId')
    return runLiveEventRecompute(admin as unknown as LiveEventRecomputeClient, eventId)
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

  if (job.job_type === 'settlement.run.create') {
    const eventId = job.payload.event_id ?? job.payload.eventId
    if (typeof eventId !== 'string') throw new Error('Missing event_id')
    return createSettlementRunForEvent(admin, eventId)
  }

  if (job.job_type === 'settlement.run.eventbrite_pull') {
    const runId = job.payload.settlement_run_id ?? job.payload.settlementRunId
    if (typeof runId !== 'string') throw new Error('Missing settlement_run_id')
    return pullEventbriteAttendanceForSettlementRun(admin, runId)
  }

  if (job.job_type === 'settlement.ack.email_send') {
    const runId = job.payload.settlement_run_id ?? job.payload.settlementRunId
    if (typeof runId !== 'string') throw new Error('Missing settlement_run_id')
    return sendVenueSettlementAcknowledgementEmail(admin, runId)
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
  const jobClient = admin as unknown as SupabaseJobClaimClient
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitParam || 5) || 5, 1), 25)
  const jobs = await claimJobs(jobClient, limit)
  const results = []

  for (const job of jobs) {
    try {
      const result = await processJob(admin, job)
      await completeJob(jobClient, job.id, toJsonObject(result))
      results.push({ id: job.id, jobType: job.job_type, status: 'succeeded', result })
    } catch (error) {
      await failJob(jobClient, job, error)
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

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}
