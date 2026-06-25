import 'server-only'

import { createHash } from 'crypto'

import { sendResendEmail } from '@/lib/email'
import { getStripeClient } from '@/lib/stripe/connect'

export type DataDeletionResult = {
  deleted: string[]
  anonymized: string[]
  retained: string[]
  failed: Array<{ step: string; error: string }>
}

type SupabaseAdminClient = {
  from: (table: string) => any
  auth?: {
    admin?: {
      deleteUser?: (userId: string, shouldSoftDelete?: boolean) => Promise<{ data?: unknown; error?: { message?: string } | null }>
    }
  }
}

type ExecuteDataDeletionOptions = {
  supabase: SupabaseAdminClient
  userId: string
  adminUserId: string
}

const RETENTION_REDACTION_TEXT = '[redacted by 3rdPlace data retention policy]'

function anonymizedEmail(userId: string) {
  return `deleted-${createHash('sha256').update(userId).digest('hex').slice(0, 16)}@deleted.3rdplace.local`
}

async function runStep(
  result: DataDeletionResult,
  bucket: 'deleted' | 'anonymized' | 'retained',
  label: string,
  fn: () => Promise<unknown>
) {
  try {
    await fn()
    result[bucket].push(label)
  } catch (error) {
    result.failed.push({
      step: label,
      error: error instanceof Error ? error.message : 'Unknown deletion error',
    })
  }
}

async function deleteWhere(admin: SupabaseAdminClient, table: string, column: string, value: string) {
  const { error } = await admin.from(table).delete().eq(column, value)
  if (error) throw new Error(error.message ?? `Failed deleting ${table}`)
}

async function updateWhere(
  admin: SupabaseAdminClient,
  table: string,
  payload: Record<string, unknown>,
  column: string,
  value: string
) {
  const { error } = await admin.from(table).update(payload).eq(column, value)
  if (error) throw new Error(error.message ?? `Failed updating ${table}`)
}

async function updateIn(
  admin: SupabaseAdminClient,
  table: string,
  payload: Record<string, unknown>,
  column: string,
  values: string[]
) {
  if (values.length === 0) return
  const { error } = await admin.from(table).update(payload).in(column, values)
  if (error) throw new Error(error.message ?? `Failed updating ${table}`)
}

async function loadBuilderProfile(admin: SupabaseAdminClient, userId: string) {
  const { data, error } = await admin
    .from('builder_profiles')
    .select('id, stripe_customer_id, name, organization_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed loading builder profile')
  return data as { id: string; stripe_customer_id?: string | null } | null
}

async function loadOutreachThreadIds(admin: SupabaseAdminClient, userId: string) {
  const { data, error } = await admin.from('outreach_threads').select('id').eq('user_id', userId)
  if (error) throw new Error(error.message ?? 'Failed loading outreach thread ids')
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
}

/**
 * Executes a user privacy deletion request.
 *
 * Financial/tax records are retained. The auth user is soft-deleted so existing
 * settlement ledgers with restrictive FKs stay valid while personal profile and
 * token data is stripped from application tables.
 */
export async function executeDataDeletion(opts: ExecuteDataDeletionOptions): Promise<DataDeletionResult> {
  const result: DataDeletionResult = {
    deleted: [],
    anonymized: [],
    retained: [],
    failed: [],
  }
  const admin = opts.supabase
  const builder = await loadBuilderProfile(admin, opts.userId)
  const deletedEmail = anonymizedEmail(opts.userId)

  await runStep(result, 'deleted', 'creator_email_accounts', () =>
    deleteWhere(admin, 'creator_email_accounts', 'user_id', opts.userId)
  )
  await runStep(result, 'deleted', 'oauth_pending_connections', () =>
    deleteWhere(admin, 'oauth_pending_connections', 'user_id', opts.userId)
  )

  if (builder?.id) {
    await runStep(result, 'deleted', 'builder_ticketing_connections', () =>
      deleteWhere(admin, 'builder_ticketing_connections', 'builder_id', builder.id)
    )
    await runStep(result, 'anonymized', 'builder_profiles', () =>
      updateWhere(
        admin,
        'builder_profiles',
        {
          name: 'Deleted 3rdPlace user',
          organization_name: null,
          bio: null,
          phone: null,
          photo_url: null,
          social_handle: null,
          website: null,
          invite_collaborators: [],
          signup_metadata: {
            deleted_at: new Date().toISOString(),
            deletion_request: 'user_requested',
          },
          stripe_customer_id: null,
          stripe_subscription_id: null,
          updated_at: new Date().toISOString(),
        },
        'id',
        builder.id
      )
    )
  }

  const outreachThreadIds = await loadOutreachThreadIds(admin, opts.userId)

  await runStep(result, 'anonymized', 'outreach_threads', () =>
    updateWhere(
      admin,
      'outreach_threads',
      {
        target_email: null,
        target_phone: null,
        target_instagram_handle: null,
        channel_strategy: {},
        updated_at: new Date().toISOString(),
      },
      'user_id',
      opts.userId
    )
  )

  await runStep(result, 'anonymized', 'public.users', () =>
    updateWhere(
      admin,
      'users',
      {
        email: deletedEmail,
        company_name: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        subscription_id: null,
        subscription_status: 'deleted',
        subscription_tier: null,
        is_active: false,
        updated_at: new Date().toISOString(),
      },
      'id',
      opts.userId
    )
  )

  await runStep(result, 'anonymized', 'outreach_messages', () =>
    updateIn(
      admin,
      'outreach_messages',
      {
        subject: RETENTION_REDACTION_TEXT,
        body_text: RETENTION_REDACTION_TEXT,
        body_html: null,
        transcript_text: null,
        headers_json: {},
        provider_metadata_json: {},
        attachments_json: [],
      },
      'thread_id',
      outreachThreadIds
    )
  )

  if (builder?.stripe_customer_id) {
    await runStep(result, 'deleted', 'stripe_customer', async () => {
      const stripe = getStripeClient()
      await stripe.customers.del(builder.stripe_customer_id as string)
    })
  }

  await runStep(result, 'deleted', 'auth.users_soft_delete', async () => {
    const response = await admin.auth?.admin?.deleteUser?.(opts.userId, true)
    if (response?.error) throw new Error(response.error.message ?? 'Failed to soft-delete auth user')
  })

  result.retained.push(
    'settlement_runs',
    'settlement_charges',
    'platform_fee_transactions',
    'audit_logs',
    'Stripe accounting records',
    'anonymous aggregate analytics'
  )

  await runStep(result, 'retained', 'admin_audit_log', async () => {
    const { error } = await admin.from('admin_audit_log').insert({
      admin_user_id: opts.adminUserId,
      action: 'data_deletion_executed',
      entity_type: 'user',
      entity_id: opts.userId,
      before_state: null,
      after_state: result,
      metadata: {
        soft_deleted_auth_user: true,
        retained_financial_records: true,
      },
    })
    if (error) throw new Error(error.message ?? 'Failed writing admin audit log')
  })

  return result
}

export async function sendDataDeletionRequestedEmail(params: {
  to: string
  coolingOffEndsAt: string
}) {
  const from = process.env.PRIVACY_FROM_EMAIL || process.env.RESEND_FROM_EMAIL
  if (!from || !process.env.RESEND_API_KEY) return { sent: false, reason: 'Email provider not configured' }

  return sendResendEmail({
    from,
    to: params.to,
    subject: '3rdPlace data deletion request received',
    html: `
      <p>We received your request to delete your 3rdPlace account data.</p>
      <p>Your 7-day cooling-off period ends on ${new Date(params.coolingOffEndsAt).toLocaleString()}.</p>
      <p>You can cancel the request from Planner settings before that time.</p>
      <p>Financial and tax records may be retained or anonymized as described in the 3rdPlace data retention policy.</p>
    `,
    text: `We received your 3rdPlace data deletion request. Your cooling-off period ends on ${params.coolingOffEndsAt}.`,
  })
}
