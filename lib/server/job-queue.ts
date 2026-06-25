import 'server-only'

import { randomUUID } from 'crypto'
import { toJsonObject } from '@/lib/types/databaseRows'
import type {
  FunctionArgs,
  FunctionReturns,
  JsonObject,
  TableInsert,
  TableRow,
  TableUpdate,
} from '@/lib/types/databaseRows'

type AppJobRow = TableRow<'app_jobs'>
type AppJobInsert = TableInsert<'app_jobs'>
type AppJobUpdate = TableUpdate<'app_jobs'>
type DbError = { code?: string; message: string }
type DbResult<T> = { data: T | null; error: DbError | null }
type DbMutationResult = { error: DbError | null }
type SingleBuilder<T> = { single(): PromiseLike<DbResult<T>> }
type AppJobInsertBuilder = { select(columns: string): SingleBuilder<AppJobRow> }
type AppJobSelectBuilder = {
  eq(column: string, value: unknown): AppJobSelectBuilder
  in(column: string, values: readonly unknown[]): AppJobSelectBuilder
  order(column: string, options?: { ascending?: boolean }): AppJobSelectBuilder
  limit(count: number): AppJobSelectBuilder
  maybeSingle(): PromiseLike<DbResult<AppJobRow>>
}
type AppJobUpdateBuilder = { eq(column: string, value: unknown): PromiseLike<DbMutationResult> }
type AppJobTable = {
  insert(values: AppJobInsert): AppJobInsertBuilder
  select(columns: string): AppJobSelectBuilder
  update(values: AppJobUpdate): AppJobUpdateBuilder
}
type AppJobRpcClient = {
  rpc(
    fn: 'claim_app_jobs',
    args: FunctionArgs<'claim_app_jobs'>
  ): PromiseLike<{ data: FunctionReturns<'claim_app_jobs'> | null; error: DbError | null }>
}
export type SupabaseJobClient = { from(table: 'app_jobs'): AppJobTable }
export type SupabaseJobClaimClient = SupabaseJobClient & AppJobRpcClient

export type AppJobType =
  | 'eventbrite.import'
  | 'eventbrite.backfill.import'
  | 'live_event.recompute'
  | 'webhook.eventbrite'
  | 'webhook.posh'
  | 'webhook.luma'
  | 'webhook.partiful'
  | 'settlement.run.create'
  | 'settlement.run.eventbrite_pull'
  | 'settlement.ack.email_send'
  | 'opportunity_send_venue_invite'
  | 'opportunity_remind_venue_invite'
  | 'opportunity_expire_venue_invite'
  | 'opportunity_send_vendor_invite'
  | 'opportunity_remind_vendor_invite'
  | 'opportunity_expire_vendor_invite'
  | 'venue.stripe_setup_reminder'
  | 'venue.capacity_infer'

export type AppJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'

export type AppJob = Omit<AppJobRow, 'job_type' | 'payload' | 'result' | 'status'> & {
  job_type: AppJobType
  status: AppJobStatus
  payload: JsonObject
  result: JsonObject | null
}

export async function enqueueJob(
  admin: SupabaseJobClient,
  params: {
    jobType: AppJobType
    payload: JsonObject
    uniqueKey?: string
    scheduledAt?: string
    maxAttempts?: number
  }
) {
  const insert: AppJobInsert = {
    job_type: params.jobType,
    payload: params.payload,
    unique_key: params.uniqueKey ?? null,
    scheduled_at: params.scheduledAt ?? new Date().toISOString(),
    max_attempts: params.maxAttempts ?? 5,
  }

  const { data, error } = await admin
    .from('app_jobs')
    .insert(insert)
    .select('*')
    .single()

  if (!error && data) return normalizeAppJobRow(data)
  if (!error) throw new Error('Failed to enqueue job: no job returned')

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

  return normalizeAppJobRow(existing)
}

export async function claimJobs(admin: SupabaseJobClaimClient, limit = 5) {
  const workerId = `${process.env.VERCEL_REGION || 'local'}-${randomUUID()}`
  const { data, error } = await admin.rpc('claim_app_jobs', {
    p_limit: limit,
    p_worker_id: workerId,
  })

  if (error) {
    throw new Error(`Failed to claim jobs: ${error.message}`)
  }

  return ((data as AppJobRow[] | null) ?? []).filter(Boolean).map(normalizeAppJobRow)
}

export async function completeJob(
  admin: SupabaseJobClient,
  jobId: string,
  result: JsonObject
) {
  const update: AppJobUpdate = {
    status: 'succeeded',
    result,
    error: null,
    completed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
  }

  const { error } = await admin
    .from('app_jobs')
    .update(update)
    .eq('id', jobId)

  if (error) throw new Error(`Failed to complete job: ${error.message}`)
}

export async function failJob(
  admin: SupabaseJobClient,
  job: AppJob,
  error: unknown
) {
  const message = error instanceof Error ? error.message : 'Job failed'
  const shouldRetry = job.attempts < job.max_attempts
  const nextStatus = shouldRetry ? 'pending' : 'dead'
  const retryDelayMs = Math.min(60_000 * Math.max(job.attempts, 1), 10 * 60_000)
  const update: AppJobUpdate = {
    status: nextStatus,
    error: message,
    scheduled_at: shouldRetry
      ? new Date(Date.now() + retryDelayMs).toISOString()
      : new Date().toISOString(),
    completed_at: shouldRetry ? null : new Date().toISOString(),
    locked_at: null,
    locked_by: null,
  }

  const { error: updateError } = await admin
    .from('app_jobs')
    .update(update)
    .eq('id', job.id)

  if (updateError) {
    throw new Error(`Failed to mark job failed: ${updateError.message}`)
  }
}

export function normalizeAppJobRow(row: AppJobRow): AppJob {
  return {
    ...row,
    job_type: row.job_type as AppJobType,
    status: row.status as AppJobStatus,
    payload: toJsonObject(row.payload),
    result: row.result === null ? null : toJsonObject(row.result),
  }
}
