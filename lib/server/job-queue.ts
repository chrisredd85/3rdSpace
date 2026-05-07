import 'server-only'

import { randomUUID } from 'crypto'

type SupabaseAdminClient = any

export type AppJobType =
  | 'eventbrite.import'
  | 'webhook.posh'
  | 'webhook.luma'
  | 'webhook.partiful'
  | 'opportunity_send_venue_invite'
  | 'opportunity_remind_venue_invite'
  | 'opportunity_expire_venue_invite'
  | 'opportunity_send_vendor_invite'
  | 'opportunity_remind_vendor_invite'
  | 'opportunity_expire_vendor_invite'

export type AppJob = {
  id: string
  job_type: AppJobType
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'
  payload: Record<string, any>
  result: Record<string, any> | null
  error: string | null
  attempts: number
  max_attempts: number
  unique_key: string | null
}

export async function enqueueJob(
  admin: SupabaseAdminClient,
  params: {
    jobType: AppJobType
    payload: Record<string, any>
    uniqueKey?: string
    scheduledAt?: string
    maxAttempts?: number
  }
) {
  const { data, error } = await admin
    .from('app_jobs')
    .insert({
      job_type: params.jobType,
      payload: params.payload,
      unique_key: params.uniqueKey ?? null,
      scheduled_at: params.scheduledAt ?? new Date().toISOString(),
      max_attempts: params.maxAttempts ?? 5,
    })
    .select('*')
    .single()

  if (!error) return data as AppJob

  const isConflict =
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message)

  if (!isConflict || !params.uniqueKey) {
    throw new Error(`Failed to enqueue job: ${error.message}`)
  }

  const { data: existing, error: existingError } = await admin
    .from('app_jobs')
    .select('*')
    .eq('unique_key', params.uniqueKey)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError || !existing) {
    throw new Error(existingError?.message || 'Job is already queued')
  }

  return existing as AppJob
}

export async function claimJobs(admin: SupabaseAdminClient, limit = 5) {
  const workerId = `${process.env.VERCEL_REGION || 'local'}-${randomUUID()}`
  const { data, error } = await admin.rpc('claim_app_jobs', {
    p_limit: limit,
    p_worker_id: workerId,
  })

  if (error) {
    throw new Error(`Failed to claim jobs: ${error.message}`)
  }

  return ((data as AppJob[] | null) ?? []).filter(Boolean)
}

export async function completeJob(
  admin: SupabaseAdminClient,
  jobId: string,
  result: Record<string, any>
) {
  const { error } = await admin
    .from('app_jobs')
    .update({
      status: 'succeeded',
      result,
      error: null,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq('id', jobId)

  if (error) throw new Error(`Failed to complete job: ${error.message}`)
}

export async function failJob(
  admin: SupabaseAdminClient,
  job: AppJob,
  error: unknown
) {
  const message = error instanceof Error ? error.message : 'Job failed'
  const shouldRetry = job.attempts < job.max_attempts
  const nextStatus = shouldRetry ? 'pending' : 'dead'
  const retryDelayMs = Math.min(60_000 * Math.max(job.attempts, 1), 10 * 60_000)

  const { error: updateError } = await admin
    .from('app_jobs')
    .update({
      status: nextStatus,
      error: message,
      scheduled_at: shouldRetry
        ? new Date(Date.now() + retryDelayMs).toISOString()
        : new Date().toISOString(),
      completed_at: shouldRetry ? null : new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq('id', job.id)

  if (updateError) {
    throw new Error(`Failed to mark job failed: ${updateError.message}`)
  }
}
