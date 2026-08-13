jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as createAgentAction } from '@/app/api/planner/plans/[planId]/agent-actions/route'
import { POST as confirmExternalCheckout } from '@/app/api/planner/plans/[planId]/agent-actions/[actionId]/confirm/route'
import { PATCH as updateApproval } from '@/app/api/planner/plans/[planId]/approvals/route'
import { POST as createVenueOpportunity } from '@/app/api/planner/plans/[planId]/opportunities/venues/route'
import { GET as listPublicVendors } from '@/app/api/vendors/route'
import { GET as listAdminVendors } from '@/app/api/admin/catalog/vendors/route'
import {
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import {
  completeExternalCheckoutHandoff,
  prepareExternalCheckoutHandoff,
} from '@/lib/planner/execution/externalCheckout'
import { buildTicketTierRollups, classifyTicketTier } from '@/lib/server/ticket-normalization'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueOpportunityInviteSendJobs } from '@/lib/server/opportunity-email-worker'
import { executeApprovedGmailOutreach } from '@/lib/outreach/gmailApprovalFlow'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn().mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1', email: 'ops@3rdspace.com' },
  }),
}))

jest.mock('@/lib/server/opportunity-email-worker', () => ({
  enqueueOpportunityInviteSendJobs: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/outreach/gmailApprovalFlow', () => ({
  ...jest.requireActual('@/lib/outreach/gmailApprovalFlow'),
  executeApprovedGmailOutreach: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')

      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockEnqueueOpportunityInviteSendJobs = enqueueOpportunityInviteSendJobs as jest.Mock
const mockExecuteApprovedGmailOutreach = executeApprovedGmailOutreach as jest.Mock

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const VENUE_ID_1 = '550e8400-e29b-41d4-a716-446655440004'
const VENUE_ID_2 = '550e8400-e29b-41d4-a716-446655440005'
const VENDOR_ID = '550e8400-e29b-41d4-a716-446655440006'

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    agent_actions: [],
    agent_action_audit_log: [],
    approvals: [],
    plan_messages: [],
    venue_opportunity_briefs: [],
    venue_opportunity_invites: [],
    vendor_opportunity_briefs: [],
    vendor_opportunity_invites: [],
    venues: [],
    venue_stripe_accounts: [],
    vendor_profiles: [],
    vendor_stripe_accounts: [],
    admin_tasks: [],
    outreach_threads: [],
    outreach_messages: [],
    builder_profiles: [],
    builder_event_usage: [],
    builder_event_access_consumptions: [],
  }

  selects: Array<{ table: string; columns: string }> = []
  mutations: Array<{ table: string; operation: 'insert' | 'update' }> = []
  nextMutationError: { table: string; operation: 'insert' | 'update'; code: string; message: string } | null = null
  private sequence = 0
  private rpcQueue = Promise.resolve()

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  rpc(name: string, params: Record<string, unknown>) {
    const result = name === 'consume_builder_event_access'
      ? this.rpcQueue.then(() => this.consumeBuilderEventAccess(params))
      : name === 'supersede_approval_version'
        ? Promise.resolve(this.supersedeApprovalVersion(params))
      : name === 'enqueue_approved_admin_task'
          ? Promise.resolve(this.enqueueApprovedAdminTask(params))
      : name === 'prepare_approved_vendor_contact_draft'
            ? Promise.resolve(this.prepareVendorContactDraft(params))
            : name === 'create_canonical_booking_from_approval'
              ? Promise.resolve(this.createCanonicalBookingFromApproval(params))
            : name === 'confirm_external_checkout_handoff'
              ? Promise.resolve(this.confirmExternalCheckoutHandoff(params))
        : Promise.resolve({ data: null, error: { message: `Unknown RPC ${name}` } })
    if (name === 'consume_builder_event_access') {
      this.rpcQueue = result.then(() => undefined, () => undefined)
    }
    return Object.assign(result, { maybeSingle: () => result })
  }

  private enqueueApprovedAdminTask(params: Record<string, unknown>) {
    const actionId = String(params.p_action_id)
    const existing = this.rows.admin_tasks.find((row) => row.agent_action_id === actionId)
    if (existing) return { data: existing, error: null }
    const action = this.rows.agent_actions.find((row) => row.id === actionId)
    const plan = this.rows.plans.find((row) => row.id === params.p_plan_id)
    if (!action || !plan) return { data: null, error: { message: 'concierge identity missing' } }
    const task = {
      id: this.nextId('admin_tasks'),
      plan_id: params.p_plan_id,
      agent_action_id: actionId,
      approval_id: params.p_approval_id,
      event_id: plan.materialized_event_id ?? null,
      task_type: params.p_task_type,
      description: params.p_description,
      status: 'open',
      priority: params.p_priority,
      metadata: params.p_metadata,
      outcome_payload: {},
    }
    this.rows.admin_tasks.push(task)
    action.result_metadata = {
      ...(action.result_metadata as Row ?? {}),
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'queued',
      admin_task_id: task.id,
      outbound_message_sent: false,
    }
    this.rows.plan_messages.push({
      id: this.nextId('plan_messages'),
      plan_id: params.p_plan_id,
      role: 'agent',
      content: params.p_host_message,
      message_type: 'status_update',
      metadata: {
        state: 'concierge_task_queued',
        agent_action_id: actionId,
        approval_id: params.p_approval_id,
      },
    })
    return { data: task, error: null }
  }

  private prepareVendorContactDraft(params: Record<string, unknown>) {
    const actionId = String(params.p_action_id)
    const existing = this.rows.outreach_messages.find((row) => row.agent_action_id === actionId)
    if (existing) {
      return {
        data: {
          disposition: 'complete',
          outreach_thread_id: existing.thread_id,
          outreach_message_id: existing.id,
          outbound_message_sent: false,
        },
        error: null,
      }
    }
    const action = this.rows.agent_actions.find((row) => row.id === actionId)
    const vendor = this.rows.vendor_profiles.find((row) => row.id === action?.target_id)
    if (!action || !vendor?.contact_email) {
      return { data: null, error: { message: 'vendor_contact_email_missing' } }
    }
    const thread = {
      id: this.nextId('outreach_threads'),
      plan_id: params.p_plan_id,
      target_type: 'vendor',
      target_id: vendor.id,
      state: 'draft',
    }
    const message = {
      id: this.nextId('outreach_messages'),
      thread_id: thread.id,
      agent_action_id: actionId,
      approval_id: params.p_approval_id,
      direction: 'outbound',
      body_text: 'Draft only',
      delivery_status: null,
      provider_metadata_json: {
        approval_required_for_send: true,
        outbound_message_sent: false,
      },
    }
    this.rows.outreach_threads.push(thread)
    this.rows.outreach_messages.push(message)
    action.result_metadata = {
      ...(action.result_metadata as Row ?? {}),
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'draft_ready',
      outreach_thread_id: thread.id,
      outreach_message_id: message.id,
      outbound_message_sent: false,
      send_requires_separate_approval: true,
    }
    return {
      data: {
        disposition: 'complete',
        outreach_thread_id: thread.id,
        outreach_message_id: message.id,
        outbound_message_sent: false,
      },
      error: null,
    }
  }

  private createCanonicalBookingFromApproval(params: Record<string, unknown>) {
    const action = this.rows.agent_actions.find((row) => row.id === params.p_agent_action_id)
    const approval = this.rows.approvals.find((row) => row.id === params.p_approval_id)
    const plan = this.rows.plans.find((row) => row.id === params.p_plan_id)
    if (!action || !approval || !plan?.materialized_event_id) {
      return { data: null, error: { message: 'canonical_quote_booking_identity_missing' } }
    }

    const bookingId = this.nextId('venue_bookings')
    action.status = 'complete'
    action.executed_at = new Date().toISOString()
    action.result_metadata = {
      ...(action.result_metadata as Row ?? {}),
      canonical_booking_status: 'confirmed',
      canonical_booking_kind: 'venue',
      canonical_booking_id: bookingId,
      canonical_event_id: plan.materialized_event_id,
      outbound_message_sent: false,
    }

    return {
      data: {
        existing: false,
        disposition: 'executing',
        booking_kind: 'venue',
        booking_id: bookingId,
        booking_status: 'confirmed',
        action_status: 'complete',
        event_id: plan.materialized_event_id,
      },
      error: null,
    }
  }

  private confirmExternalCheckoutHandoff(params: Record<string, unknown>) {
    const plan = this.rows.plans.find((row) => row.id === params.p_plan_id)
    const action = this.rows.agent_actions.find((row) => row.id === params.p_action_id)
    const approval = this.rows.approvals.find((row) => row.id === params.p_approval_id)
    if (!plan || !action || !approval) {
      return { data: null, error: { code: 'P0002', message: 'confirm_external_checkout_action_not_found' } }
    }
    if (
      plan.user_id !== params.p_actor_id ||
      action.plan_id !== plan.id ||
      action.approval_id !== approval.id ||
      approval.agent_action_id !== action.id ||
      approval.snapshot_hash !== params.p_expected_snapshot_hash
    ) {
      return { data: null, error: { code: '23514', message: 'confirm_external_checkout_approval_mismatch' } }
    }

    const currentEvidence = (action.result_metadata as Row | undefined)?.external_checkout as Row | undefined
    const existing = action.status === 'complete' && currentEvidence?.status === 'completed'
    if (!existing) {
      if (action.status !== 'executing' || currentEvidence?.status !== 'ready') {
        return { data: null, error: { code: '23514', message: 'confirm_external_checkout_not_confirmable' } }
      }
      const completed = completeExternalCheckoutHandoff({
        resultMetadata: action.result_metadata,
        confirmedBy: String(params.p_actor_id),
      })
      action.status = 'complete'
      action.executed_at = completed.evidence.completed_at
      action.result_metadata = completed.resultMetadata
    }

    const hasAudit = this.rows.agent_action_audit_log.some((row) =>
      row.action_id === action.id &&
      row.reason === 'external_checkout.host_confirmed' &&
      row.metadata?.approval_id === approval.id
    )
    if (!hasAudit) {
      this.rows.agent_action_audit_log.push({
        id: this.nextId('agent_action_audit_log'),
        action_id: action.id,
        plan_id: plan.id,
        from_status: 'executing',
        to_status: 'complete',
        actor_id: params.p_actor_id,
        actor_role: 'user',
        reason: 'external_checkout.host_confirmed',
        metadata: {
          approval_id: approval.id,
          snapshot_hash: params.p_expected_snapshot_hash,
          confirmation_source: 'host',
        },
      })
    }

    let message = this.rows.plan_messages.find((row) =>
      row.plan_id === plan.id &&
      row.metadata?.state === 'external_checkout_completed' &&
      row.metadata?.agent_action_id === action.id
    )
    if (!message) {
      message = {
        id: this.nextId('plan_messages'),
        plan_id: plan.id,
        role: 'agent',
        content: `You confirmed the external checkout with ${action.provider || 'the external provider'} was completed.`,
        message_type: 'status_update',
        metadata: {
          state: 'external_checkout_completed',
          action_status: 'complete',
          agent_action_id: action.id,
          approval_id: approval.id,
          action_result: action.result_metadata,
        },
      }
      this.rows.plan_messages.push(message)
    }

    return {
      data: {
        existing,
        action_status: action.status,
        approval_status: approval.status,
        result_metadata: action.result_metadata,
        agent_action: action,
        plan_message: message,
      },
      error: null,
    }
  }

  nextId(table: string) {
    this.sequence += 1
    return `${table}-${this.sequence}`
  }

  private async consumeBuilderEventAccess(params: Record<string, unknown>) {
    const builderId = params.p_builder_id as string
    const eventId = params.p_event_id as string
    const defaultFreeEventsGranted = params.p_default_free_events_granted as number
    const payPerEventAmountCents = params.p_pay_per_event_amount_cents as number
    const proMonthlyAmountCents = params.p_pro_monthly_amount_cents as number
    const builderRow = this.rows.builder_profiles.find((row) => row.id === builderId)

    if (!builderRow) {
      return { data: null, error: { code: 'P0002', message: 'builder_profile_not_found' } }
    }

    const existing = this.rows.builder_event_access_consumptions.find((row) => (
      row.builder_id === builderId && row.event_id === eventId
    ))
    if (existing) return { data: existing, error: null }

    const freeEventsGranted = Math.max(
      (builderRow.free_events_granted as number | null | undefined) ?? defaultFreeEventsGranted,
      defaultFreeEventsGranted
    )
    const freeEventsUsed = (builderRow.free_events_used as number | null | undefined) ?? 0
    const paidEventCredits = (builderRow.paid_event_credits as number | null | undefined) ?? 0
    const isPro = (
      (builderRow.billing_tier === 'pro_monthly' || builderRow.billing_tier === 'pro_annual') &&
      builderRow.subscription_status === 'active'
    )

    let source: string
    let amountCents = 0

    if (isPro) {
      source = builderRow.billing_tier
    } else if (freeEventsGranted - freeEventsUsed > 0) {
      source = 'free_trial'
      builderRow.free_events_used = freeEventsUsed + 1
    } else if (paidEventCredits > 0) {
      source = 'pay_per_event'
      amountCents = payPerEventAmountCents
      builderRow.billing_tier = 'pay_per_event'
      builderRow.paid_event_credits = paidEventCredits - 1
    } else {
      return { data: null, error: { code: 'P0001', message: 'builder_billing_required' } }
    }

    const now = new Date().toISOString()
    const row = {
      id: this.nextId('builder_event_access_consumptions'),
      builder_id: builderId,
      event_id: eventId,
      source,
      amount: Math.floor(amountCents / 100),
      amount_cents: amountCents,
      source_metadata: {},
      created_at: now,
      updated_at: now,
    }
    this.rows.builder_event_access_consumptions.push(row)

    const usage = this.rows.builder_event_usage[0]
    if (usage) {
      usage.events_booked = ((usage.events_booked as number | undefined) ?? 0) + 1
      usage.total_fees_paid = ((usage.total_fees_paid as number | undefined) ?? 0) + amountCents / 100
      usage.could_have_saved = Math.max(
        (((usage.events_booked as number | undefined) ?? 0) * (payPerEventAmountCents / 100)) -
          (proMonthlyAmountCents / 100),
        0
      )
      usage.updated_at = now
    } else {
      this.rows.builder_event_usage.push({
        id: this.nextId('builder_event_usage'),
        builder_id: builderId,
        month: '2026-06-01',
        events_booked: 1,
        total_fees_paid: amountCents / 100,
        could_have_saved: Math.max((payPerEventAmountCents - proMonthlyAmountCents) / 100, 0),
        created_at: now,
        updated_at: now,
      })
    }

    return { data: row, error: null }
  }

  private supersedeApprovalVersion(params: Record<string, unknown>) {
    const previous = this.rows.approvals.find((row) => (
      row.id === params.p_approval_id && row.plan_id === params.p_plan_id
    ))
    if (!previous || (previous.snapshot_hash ?? 'legacy-missing') !== params.p_expected_snapshot_hash) {
      return { data: null, error: { code: '40001', message: 'approval_snapshot_mismatch' } }
    }
    if (!['pending', 'expired', 're_approval_required'].includes(String(previous.status))) {
      return { data: null, error: { code: '23514', message: 'approval_version_source_not_editable' } }
    }
    const action = this.rows.agent_actions.find((row) => row.id === previous.agent_action_id)
    if (!action) return { data: null, error: { code: 'P0002', message: 'approval_version_action_not_found' } }
    const canResetWaitingCanonicalQuote = action.status === 'executing' &&
      previous.status === 're_approval_required' &&
      action.approval_id === previous.id &&
      action.payload_json?.kind === 'canonical_quote_booking' &&
      action.payload_json?.requires_event_materialization === true &&
      ['waiting_for_event_materialization', 'resuming_after_event_materialization', 'reapproval_required']
        .includes(String(action.result_metadata?.canonical_booking_status)) &&
      action.result_metadata?.outbound_message_sent !== true &&
      !(this.rows.venue_bookings ?? []).some((row) => row.agent_action_id === action.id || row.approval_id === previous.id) &&
      !(this.rows.vendor_bookings ?? []).some((row) => row.agent_action_id === action.id || row.approval_id === previous.id) &&
      !this.rows.admin_tasks.some((row) => row.agent_action_id === action.id || row.approval_id === previous.id) &&
      !this.rows.outreach_messages.some((row) => row.agent_action_id === action.id || row.approval_id === previous.id)
    if (['executing', 'complete', 'failed', 'cancelled'].includes(String(action.status)) && !canResetWaitingCanonicalQuote) {
      return { data: null, error: { code: '23514', message: 'approval_version_action_not_editable' } }
    }

    const now = new Date().toISOString()
    const replacement = {
      ...previous,
      id: '650e8400-e29b-41d4-a716-446655440099',
      status: 'pending',
      price_cents: params.p_requested_amount_cents,
      requested_amount_cents: params.p_requested_amount_cents,
      event_date: params.p_event_date,
      notes: params.p_notes,
      expires_at: params.p_expires_at,
      snapshot_json: params.p_snapshot_json,
      snapshot_hash: params.p_snapshot_hash,
      snapshot_schema_version: 2,
      root_approval_id: previous.root_approval_id ?? previous.id,
      version_number: (previous.version_number ?? 1) + 1,
      supersedes_approval_id: previous.id,
      superseded_by_approval_id: null,
      version_created_by: params.p_actor_id,
      version_reason: params.p_reason,
      authorized_amount_cents: null,
      authorized_by: null,
      authorized_at: null,
      approved_by: null,
      approved_at: null,
      created_at: now,
      updated_at: now,
    }
    previous.status = 'superseded'
    previous.superseded_at = now
    previous.superseded_by_approval_id = replacement.id
    action.approval_id = replacement.id
    action.amount_cents = params.p_requested_amount_cents
    action.payload_json = params.p_action_payload_json
    action.status = 'pending'
    this.rows.approvals.push(replacement)
    return { data: replacement, error: null }
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private selectedColumns = '*'
  private orderBy: { field: string; ascending: boolean } | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
    this.db.selects.push({ table: this.table, columns })
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: unknown) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values])
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  async single() {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (
      this.operation !== 'select'
      && this.db.nextMutationError?.table === this.table
      && this.db.nextMutationError.operation === this.operation
    ) {
      const error = this.db.nextMutationError
      this.db.nextMutationError = null
      return { data: null, error }
    }
    if (this.operation === 'insert') {
      this.db.mutations.push({ table: this.table, operation: 'insert' })
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = values.map((value) => this.withDefaults(value as Row))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
    }

    if (this.operation === 'update') {
      this.db.mutations.push({ table: this.table, operation: 'update' })
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...(this.payload as Row), updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.orderBy) {
      selected = [...selected].sort((a, b) => {
        const compare = String(a[this.orderBy!.field] ?? '').localeCompare(String(b[this.orderBy!.field] ?? ''))
        return this.orderBy!.ascending ? compare : -compare
      })
    }
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)

    return { data: selected.map((row) => this.project(row)), error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.inFilters.every(([field, values]) => values.includes(row[field]))
    )
  }

  private project(row: Row) {
    if (this.selectedColumns === '*' || !this.selectedColumns.trim()) return row
    const columns = this.selectedColumns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => column.split(/\s+/)[0])
    if (columns.length === 0) return row
    return Object.fromEntries(columns.map((column) => [column, row[column]]))
  }

  private withDefaults(row: Row) {
    const now = new Date().toISOString()
    return {
      created_at: now,
      updated_at: now,
      ...row,
      id: row.id ?? this.db.nextId(this.table),
    }
  }
}

function makeRequest(path: string, body?: Row, method = body ? 'POST' : 'GET') {
  const url = `http://localhost${path}`
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest

  Object.defineProperty(request, 'nextUrl', { value: new URL(url) })
  return request
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Row
}

function setV2ApprovalSnapshot(
  db: MemoryDb,
  approvalId: string,
  planOverride?: Row,
) {
  const approval = db.rows.approvals.find((row) => row.id === approvalId)!
  const action = db.rows.agent_actions.find((row) => row.id === approval.agent_action_id)!
  const plan = planOverride ?? db.rows.plans.find((row) => row.id === approval.plan_id)!
  const snapshotInput = {
    plan: plan as any,
    approval: approval as any,
    action: action as any,
    payload: action.payload_json as Record<string, unknown>,
  }
  approval.snapshot_hash = buildApprovalSnapshotHashV2(snapshotInput)
  approval.snapshot_json = buildApprovalSnapshotV2(snapshotInput)
  approval.snapshot_schema_version = 2
  return approval.snapshot_hash as string
}

function remapCreatedActionApproval(db: MemoryDb, created: Row) {
  const actionRow = db.rows.agent_actions.find((row) => row.id === created.agentAction.id)!
  const approvalRow = db.rows.approvals.find((row) => row.id === created.approval.id)!
  actionRow.id = ACTION_ID
  actionRow.approval_id = APPROVAL_ID
  approvalRow.id = APPROVAL_ID
  approvalRow.agent_action_id = ACTION_ID
  created.agentAction.id = ACTION_ID
  created.agentAction.approval_id = APPROVAL_ID
  created.approval.id = APPROVAL_ID
  created.approval.agent_action_id = ACTION_ID
}

function markAuthorizedCrashWindow(
  db: MemoryDb,
  resultMetadata: Row = { execution_kind: 'crash_window', outbound_message_sent: false },
) {
  const approval = db.rows.approvals.find((row) => row.id === APPROVAL_ID)!
  const action = db.rows.agent_actions.find((row) => row.id === ACTION_ID)!
  approval.status = 'authorized'
  approval.authorized_amount_cents = approval.requested_amount_cents
  approval.authorized_by = USER_ID
  approval.authorized_at = new Date().toISOString()
  approval.approved_by = USER_ID
  approval.approved_at = approval.authorized_at
  action.status = 'executing'
  action.result_metadata = resultMetadata
  return { approval, action }
}

function mockPlannerClient(db: MemoryDb, writeDb: MemoryDb = db) {
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            user_metadata: { user_type: 'community_builder' },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => db.from(table),
  })
  mockCreateServiceRoleClient.mockReturnValue({
    from: (table: string) => writeDb.from(table),
    rpc: (name: string, params: Record<string, unknown>) => writeDb.rpc(name, params),
  })
}

describe('MVP launch API contracts', () => {
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    mockExecuteApprovedGmailOutreach.mockReset()
    db = new MemoryDb()
    db.rows.plans.push({
      id: PLAN_ID,
      user_id: USER_ID,
      title: 'MVP launch plan',
      event_type: 'mixer',
      status: 'ready',
      guest_count: 80,
      budget_cap_cents: 800_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-01',
      date_window_end: '2026-08-02',
      ticketed: true,
      metadata: {},
    })
    db.rows.builder_profiles.push({
      id: 'builder-profile-1',
      user_id: USER_ID,
      name: 'MVP Builder',
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 0,
      paid_event_credits: 0,
    })
    mockPlannerClient(db)
  })

  it('POST planner agent-actions creates the agent_action, approval row, and visible approval_request message', async () => {
    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour soft hold',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      amount_cents: 500_000,
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      price_cents: 500_000,
      status: 'pending',
    }))
    expect(json.approvalMessage).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      message_type: 'approval_request',
      metadata: expect.objectContaining({
        state: 'recommendation_action_approval_requested',
        status: 'pending',
        source: 'planner_recommendation_action',
        approval: expect.objectContaining({
          id: json.approval.id,
          status: 'pending',
        }),
      }),
    }))
    expect(db.rows.agent_actions).toHaveLength(1)
    expect(db.rows.approvals).toHaveLength(1)
    const snapshotInput = {
      plan: db.rows.plans[0] as any,
      approval: db.rows.approvals[0] as any,
      action: db.rows.agent_actions[0] as any,
      payload: db.rows.agent_actions[0].payload_json as Record<string, unknown>,
    }
    expect(db.rows.approvals[0]).toEqual(expect.objectContaining({
      snapshot_schema_version: 2,
      snapshot_hash: buildApprovalSnapshotHashV2(snapshotInput),
      snapshot_json: buildApprovalSnapshotV2(snapshotInput),
    }))
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: PLAN_ID,
        message_type: 'approval_request',
        metadata: expect.objectContaining({
          approval: expect.objectContaining({
            id: json.approval.id,
          }),
        }),
      }),
    ]))
  })

  it.each(['completed', 'archived'] as const)(
    'rejects new actions and authorization on a %s plan while retaining negative cancellation',
    async (terminalStatus) => {
      db.rows.plans[0].status = terminalStatus
      const rejectedCreate = await createAgentAction(
        makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
          actionType: 'hold_request',
          targetType: 'venue',
          targetId: VENUE_ID_1,
          requestedAmountCents: 50_000,
          payloadJson: {
            action_label: 'Request hold',
            provider: 'Foundry Rooftop',
            package_details: '48-hour soft hold',
          },
        }),
        { params: { planId: PLAN_ID } },
      )

      expect(rejectedCreate.status).toBe(409)
      expect(await readJson(rejectedCreate)).toEqual({
        error: 'Completed or archived plans cannot start new execution work.',
        code: 'plan_terminal',
      })
      expect(db.rows.agent_actions).toHaveLength(0)
      expect(db.rows.approvals).toHaveLength(0)
      expect(db.rows.plan_messages).toHaveLength(0)
      expect(db.rows.agent_action_audit_log).toHaveLength(0)

      db.rows.plans[0].status = 'ready'
      const createdResponse = await createAgentAction(
        makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
          actionType: 'vendor_contact',
          targetType: 'vendor',
          targetId: VENDOR_ID,
          requestedAmountCents: 0,
          payloadJson: {
            action_label: 'Contact vendor',
            provider: 'Mission Photo Co.',
          },
        }),
        { params: { planId: PLAN_ID } },
      )
      const created = await readJson(createdResponse)
      expect(createdResponse.status).toBe(200)
      remapCreatedActionApproval(db, created)
      db.rows.plans[0].status = terminalStatus
      const mutationCountBeforeAuthorization = db.mutations.length

      const rejectedAuthorization = await updateApproval(
        makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: created.approval.id,
          command: 'authorize',
          expectedSnapshotHash: created.approval.snapshot_hash,
        }, 'PATCH'),
        { params: { planId: PLAN_ID } },
      )

      expect(rejectedAuthorization.status).toBe(409)
      expect(await readJson(rejectedAuthorization)).toEqual({
        error: 'Completed or archived plans cannot start new execution work.',
        code: 'plan_terminal',
      })
      expect(db.mutations).toHaveLength(mutationCountBeforeAuthorization)
      expect(db.rows.approvals[0].status).toBe('pending')
      expect(db.rows.agent_actions[0].status).toBe('pending')
      expect(db.rows.admin_tasks).toHaveLength(0)
      expect(db.rows.outreach_messages).toHaveLength(0)

      const cancelled = await updateApproval(
        makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: created.approval.id,
          command: 'cancel',
        }, 'PATCH'),
        { params: { planId: PLAN_ID } },
      )
      expect(cancelled.status).toBe(200)
      expect(db.rows.approvals[0].status).toBe('cancelled')
      expect(db.rows.agent_actions[0].status).toBe('cancelled')
    },
  )

  it('recovers an exact external-checkout authorization replay only when handoff evidence is missing', async () => {
    const createdResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'Open checkout',
          provider: 'Ticketing partner',
          external_url: 'https://tickets.example/recovery',
          package_details: 'Two tickets',
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createdResponse)
    remapCreatedActionApproval(db, created)
    markAuthorizedCrashWindow(db)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )

    expect(response.status).toBe(200)
    expect(db.rows.agent_actions[0].status).toBe('executing')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      execution_mode: 'external_checkout',
      external_checkout: expect.objectContaining({
        status: 'ready',
        approval_id: APPROVAL_ID,
        snapshot_hash: created.approval.snapshot_hash,
      }),
    }))

    const mutationsAfterRecovery = db.mutations.length
    const exactReplay = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    expect(exactReplay.status).toBe(200)
    expect(db.mutations).toHaveLength(mutationsAfterRecovery)
  })

  it('maps plan-lock contention during action creation and authorization to retryable conflicts', async () => {
    db.nextMutationError = {
      table: 'agent_actions',
      operation: 'insert',
      code: '55P03',
      message: 'could not obtain lock on row in relation plans',
    }
    const createConflict = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        requestedAmountCents: 0,
        payloadJson: { action_label: 'Request hold', provider: 'Venue' },
      }),
      { params: { planId: PLAN_ID } },
    )
    expect(createConflict.status).toBe(409)
    expect(await readJson(createConflict)).toEqual(expect.objectContaining({
      code: 'plan_execution_conflict',
      retryable: true,
    }))

    const createdResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        requestedAmountCents: 0,
        payloadJson: { action_label: 'Request hold', provider: 'Venue' },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createdResponse)
    remapCreatedActionApproval(db, created)
    db.nextMutationError = {
      table: 'approvals',
      operation: 'update',
      code: '55P03',
      message: 'lock not available',
    }
    const approvalConflict = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    expect(approvalConflict.status).toBe(409)
    expect(await readJson(approvalConflict)).toEqual(expect.objectContaining({
      code: 'plan_execution_conflict',
      retryable: true,
    }))
    expect(db.rows.approvals[0].status).toBe('pending')

    const crash = markAuthorizedCrashWindow(db)
    crash.action.status = 'pending'
    db.nextMutationError = {
      table: 'agent_actions',
      operation: 'update',
      code: '55P03',
      message: 'could not obtain lock on row in relation plans',
    }
    const recoveryConflict = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    expect(recoveryConflict.status).toBe(409)
    expect(await readJson(recoveryConflict)).toEqual(expect.objectContaining({
      code: 'plan_execution_conflict',
      retryable: true,
    }))
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it.each(['pending', 'proposed', 'executing'] as const)(
    'converges concurrent exact concierge recovery from %s on one durable task',
    async (crashStatus) => {
    const createdResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 50_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour hold',
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createdResponse)
    remapCreatedActionApproval(db, created)
    const { action } = markAuthorizedCrashWindow(db)
    action.status = crashStatus
    const replayRequest = () => updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )

    const responses = await Promise.all([replayRequest(), replayRequest()])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(db.rows.admin_tasks).toHaveLength(1)
    expect(db.rows.plan_messages.filter((message) =>
      message.metadata?.state === 'concierge_task_queued'
    )).toHaveLength(1)
    expect(db.rows.agent_actions[0].status).toBe('executing')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      handoff_status: 'queued',
      admin_task_id: db.rows.admin_tasks[0].id,
      outbound_message_sent: false,
    }))
    },
  )

  it('resumes a completing Gmail action from executing and converges on complete', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      description: 'Send approved Gmail outreach',
      provider: 'Gmail',
      target_type: 'outreach',
      target_id: null,
      payload_json: { kind: 'gmail_approved_outreach', targets: [] },
      amount_cents: 0,
      currency: 'usd',
      status: 'executing',
      approval_id: APPROVAL_ID,
      executed_at: null,
      result_metadata: { execution_kind: 'send_gmail_outreach', outbound_message_sent: false },
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send approved Gmail outreach',
      provider: 'Gmail',
      event_date: null,
      price_cents: 0,
      fees_cents: 0,
      status: 'authorized',
      requested_amount_cents: 0,
      authorized_amount_cents: 0,
      authorized_by: USER_ID,
      authorized_at: new Date().toISOString(),
      approved_by: USER_ID,
      approved_at: new Date().toISOString(),
      expires_at: '2099-01-01T00:00:00.000Z',
    })
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)
    mockExecuteApprovedGmailOutreach.mockResolvedValue({
      prepared: true,
      sent_count: 1,
      thread_ids: ['gmail-thread-1'],
      outbound_message_sent: true,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    expect(response.status).toBe(200)
    expect(mockExecuteApprovedGmailOutreach).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.any(Function),
    }), expect.objectContaining({
      action: expect.objectContaining({ status: 'executing' }),
    }))
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'complete',
      result_metadata: expect.objectContaining({ outbound_message_sent: true }),
    }))
  })

  it.each([
    ['outreach preparation', 'opportunity_send_venues', { kind: 'venue_outreach' }, 'ready', 'executing'],
    ['payment', 'payment', { kind: 'venue_deposit' }, 'ready', 'executing'],
    ['terminal plan', 'external_checkout', { kind: 'external_checkout', external_url: 'https://tickets.example/no-recovery' }, 'completed', 'executing'],
    ['complete truth', 'external_checkout', { kind: 'external_checkout', external_url: 'https://tickets.example/complete' }, 'ready', 'complete'],
    ['cancelled truth', 'external_checkout', { kind: 'external_checkout', external_url: 'https://tickets.example/cancelled' }, 'ready', 'cancelled'],
    ['failed truth', 'external_checkout', { kind: 'external_checkout', external_url: 'https://tickets.example/failed' }, 'ready', 'failed'],
  ] as const)(
    'does not recover %s from an exact authorize replay',
    async (_label, actionType, payload, planStatus, actionStatus) => {
    db.rows.plans[0].status = planStatus
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: actionType,
      description: 'Must not recover',
      provider: 'Provider',
      target_type: null,
      target_id: null,
      payload_json: payload,
      amount_cents: 0,
      currency: 'usd',
      status: actionStatus,
      approval_id: APPROVAL_ID,
      executed_at: null,
      result_metadata: {},
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Must not recover',
      provider: 'Provider',
      status: 'authorized',
      requested_amount_cents: 0,
      authorized_amount_cents: 0,
      authorized_by: USER_ID,
      authorized_at: new Date().toISOString(),
      approved_by: USER_ID,
      approved_at: new Date().toISOString(),
      expires_at: '2099-01-01T00:00:00.000Z',
    })
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)
    const mutationCount = db.mutations.length

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    expect(response.status).toBe(200)
    expect(db.mutations).toHaveLength(mutationCount)
    expect(db.rows.agent_actions[0].status).toBe(actionStatus)
    expect(db.rows.admin_tasks).toHaveLength(0)
    expect(mockExecuteApprovedGmailOutreach).not.toHaveBeenCalled()
    },
  )

  it('authorizes a venue hold into one cancellable concierge task with host-visible evidence', async () => {
    const createdResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 50_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour soft hold',
          execution_mode: 'concierge_admin_queue',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const created = await readJson(createdResponse)
    expect(createdResponse.status).toBe(200)
    expect(created.approval.snapshot_hash).toMatch(/^[a-f0-9]{64}$/)
    remapCreatedActionApproval(db, created)

    const authorizedResponse = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: created.approval.id,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const authorized = await readJson(authorizedResponse)

    expect(authorizedResponse.status).toBe(200)
    expect(authorized).toEqual(expect.objectContaining({
      actionStatus: 'executing',
      uiStatus: 'executing',
      availableActions: ['cancel_execution'],
      actionResult: expect.objectContaining({
        execution_mode: 'concierge_admin_queue',
        handoff_status: 'queued',
        admin_task_id: expect.any(String),
        outbound_message_sent: false,
      }),
    }))
    expect(db.rows.admin_tasks).toEqual([
      expect.objectContaining({
        plan_id: PLAN_ID,
        agent_action_id: created.agentAction.id,
        approval_id: created.approval.id,
        status: 'open',
      }),
    ])
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message_type: 'status_update',
        metadata: expect.objectContaining({ state: 'concierge_task_queued' }),
      }),
    ]))

    const replay = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: created.approval.id,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    expect(replay.status).toBe(200)
    expect(db.rows.admin_tasks).toHaveLength(1)
  })

  it('authorizes vendor contact into one unsent draft instead of fake sent state', async () => {
    db.rows.vendor_profiles.push({
      id: VENDOR_ID,
      name: 'Mission Photo Co.',
      contact_email: 'bookings@example.com',
      portfolio_url: 'https://example.com/mission-photo',
      discovery_vendor_id: null,
    })
    const createdResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'vendor_contact',
        targetType: 'vendor',
        targetId: VENDOR_ID,
        requestedAmountCents: 0,
        payloadJson: {
          action_label: 'Contact vendor',
          provider: 'Mission Photo Co.',
          execution_mode: 'concierge_admin_queue',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const created = await readJson(createdResponse)
    expect(createdResponse.status).toBe(200)
    expect(created.approval.snapshot_hash).toMatch(/^[a-f0-9]{64}$/)
    remapCreatedActionApproval(db, created)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: created.approval.id,
        command: 'authorize',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const authorized = await readJson(response)

    expect(response.status).toBe(200)
    expect(authorized).toEqual(expect.objectContaining({
      actionStatus: 'complete',
      uiStatus: 'succeeded',
      actionResult: expect.objectContaining({
        handoff_status: 'draft_ready',
        outbound_message_sent: false,
        send_requires_separate_approval: true,
      }),
    }))
    expect(db.rows.outreach_messages).toEqual([
      expect.objectContaining({
        agent_action_id: created.agentAction.id,
        approval_id: created.approval.id,
        direction: 'outbound',
        delivery_status: null,
      }),
    ])
    expect(db.rows.admin_tasks).toHaveLength(0)
  })

  it('loads canonical event identity and accepts an executor-side atomic completion', async () => {
    const eventId = '550e8400-e29b-41d4-a716-446655440007'
    db.rows.plans[0].status = 'executing'
    db.rows.plans[0].materialized_event_id = eventId
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'concierge_queue',
      description: 'Book the approved venue quote',
      provider: 'Foundry Rooftop',
      target_type: 'discovery_venue',
      target_id: VENUE_ID_1,
      payload_json: {
        kind: 'canonical_quote_booking',
        quote_kind: 'venue',
        requested_amount_cents: 125_000,
        execution_mode: 'concierge_admin_queue',
        outbound_message_sent: false,
      },
      amount_cents: 125_000,
      currency: 'usd',
      status: 'pending',
      approval_id: APPROVAL_ID,
      executed_at: null,
      result_metadata: {},
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Approve booking request with Foundry Rooftop',
      provider: 'Foundry Rooftop',
      event_date: '2026-08-01',
      price_cents: 125_000,
      fees_cents: 0,
      requested_amount_cents: 125_000,
      status: 'pending',
      expires_at: '2026-08-02T00:00:00.000Z',
    })
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const result = await readJson(response)

    expect(response.status).toBe(200)
    expect(result).toEqual(expect.objectContaining({
      actionStatus: 'complete',
      uiStatus: 'succeeded',
      actionResult: expect.objectContaining({
        canonical_booking_status: 'confirmed',
        canonical_event_id: eventId,
        outbound_message_sent: false,
      }),
    }))
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'complete',
      executed_at: expect.any(String),
    }))
    expect(db.selects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'plans',
        columns: expect.stringContaining('materialized_event_id'),
      }),
    ]))
  })

  it('POST planner agent-actions creates an approval before exposing external checkout', async () => {
    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          external_url: 'https://tickets.example/event/123',
          package_details: 'External ticketing checkout requires approval before the link is used.',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      action_type: 'external_checkout',
      approval_id: expect.any(String),
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      status: 'pending',
      price_cents: 9_500,
    }))
    expect(db.rows.agent_actions[0].payload_json).toEqual(expect.objectContaining({
      kind: 'external_checkout',
      external_url: 'https://tickets.example/event/123',
    }))
    expect(db.rows.agent_actions[0].payload_json).not.toHaveProperty('url')
    expect(db.rows.agent_actions[0].payload_json).not.toHaveProperty('checkout_url')
    expect(db.rows.agent_actions).toHaveLength(1)
    expect(db.rows.approvals).toHaveLength(1)
  })

  it('POST planner agent-actions creates a first-class controlled payment with no seeded card', async () => {
    db.rows.venues.push({
      id: VENUE_ID_1,
      owner_id: '550e8400-e29b-41d4-a716-446655440099',
      venue_name: 'Foundry Rooftop',
    })
    db.rows.venue_stripe_accounts.push({
      owner_id: '550e8400-e29b-41d4-a716-446655440099',
      stripe_account_id: 'acct_venue_ready',
      account_status: 'active',
      charges_enabled: true,
      payouts_enabled: true,
      disabled_reason: null,
    })

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'payment',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 50_000,
        payloadJson: {
          action_label: 'Authorize Foundry Rooftop deposit',
          provider: 'Foundry Rooftop',
          fees_cents: 0,
          package_details: 'Confirmed venue deposit',
          refund_terms: 'Refundable until 14 days before the event',
          cancellation_terms: 'New approval required if terms change',
          execution_mode: 'controlled_payment',
          has_controlled_payment_account: true,
          payment_required: true,
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      action_type: 'payment',
      target_type: 'venue',
      target_id: VENUE_ID_1,
      amount_cents: 50_000,
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      status: 'pending',
      price_cents: 50_000,
      payment_method_id: null,
    }))
    expect(json.approvalMessage).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        action_type: 'payment',
        execution_mode: 'controlled_payment',
        approval: expect.objectContaining({ payment_method_id: null }),
      }),
    }))
  })

  it('POST planner agent-actions rejects legacy or unsafe external checkout URL writes', async () => {
    const legacyResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          url: 'https://tickets.example/event/123',
          package_details: 'Legacy URL key must not be accepted for new writes.',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const unsafeResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          external_url: 'https://user:secret@tickets.example/event/123',
          package_details: 'Credential-bearing links must fail closed.',
        },
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(legacyResponse.status).toBe(400)
    expect(unsafeResponse.status).toBe(400)
    expect(db.rows.agent_actions).toHaveLength(0)
    expect(db.rows.approvals).toHaveLength(0)
  })

  it('POST planner agent-actions creates a strict controlled-payment proposal without moving money', async () => {
    const venueOwnerId = '550e8400-e29b-41d4-a716-446655440007'
    db.rows.venues.push({
      id: VENUE_ID_1,
      owner_id: venueOwnerId,
      venue_name: 'Ready Venue',
    })
    db.rows.venue_stripe_accounts = [{
      owner_id: venueOwnerId,
      stripe_account_id: 'acct_ready',
      account_status: 'active',
      charges_enabled: true,
      payouts_enabled: true,
      disabled_reason: null,
    }]

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'payment',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 25_000,
        payloadJson: {
          kind: 'venue_deposit',
          action_label: 'Authorize venue deposit',
          provider: 'Ready Venue',
          package_details: 'Deposit for the approved venue reservation.',
          refund_terms: 'Refundable until 14 days before the event.',
          cancellation_terms: 'Deposit is forfeited inside 14 days.',
          fees_cents: 750,
          event_date: '2026-08-01',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      action_type: 'payment',
      target_type: 'venue',
      target_id: VENUE_ID_1,
      amount_cents: 25_000,
      status: 'pending',
      approval_id: expect.any(String),
      result_metadata: expect.objectContaining({ execution_mode: 'controlled_payment' }),
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      status: 'pending',
      price_cents: 25_000,
      fees_cents: 750,
      refund_terms: 'Refundable until 14 days before the event.',
      cancellation_terms: 'Deposit is forfeited inside 14 days.',
      snapshot_schema_version: 2,
    }))
    expect(db.rows.agent_actions[0].payload_json).toEqual(expect.objectContaining({
      kind: 'venue_deposit',
      price_cents: 25_000,
      requestedAmountCents: 25_000,
      fees_cents: 750,
      requires_stripe_recipient: true,
    }))
    expect(db.rows.payment_intents ?? []).toHaveLength(0)
    expect(db.rows.venue_payment_transactions ?? []).toHaveLength(0)
  })

  it('POST planner agent-actions rejects incomplete controlled-payment proposals before writes', async () => {
    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'payment',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 0,
        payloadJson: {
          kind: 'venue_deposit',
          action_label: 'Authorize venue deposit',
          provider: 'Venue',
          package_details: 'Missing required terms must fail closed.',
        },
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(400)
    expect(db.rows.agent_actions).toHaveLength(0)
    expect(db.rows.approvals).toHaveLength(0)
    expect(db.rows.payment_intents ?? []).toHaveLength(0)
    expect(db.rows.venue_payment_transactions ?? []).toHaveLength(0)
  })

  it('host confirmation completes one ready external checkout and is idempotent', async () => {
    const snapshotHash = 'a'.repeat(64)
    const action = {
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'external_checkout',
      description: 'External checkout',
      provider: 'Ticketing partner',
      target_type: 'external',
      target_id: null,
      payload_json: { external_url: 'https://tickets.example/event/123' },
      amount_cents: 9_500,
      currency: 'usd',
      status: 'executing',
      approval_id: APPROVAL_ID,
      executed_at: null,
      result_metadata: {},
      created_at: '2026-07-09T20:00:00.000Z',
      updated_at: '2026-07-09T20:00:00.000Z',
    }
    const approval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      status: 'authorized',
      snapshot_hash: snapshotHash,
      snapshot_schema_version: 2,
      expires_at: '2026-07-10T20:00:00.000Z',
    }
    action.result_metadata = prepareExternalCheckoutHandoff({
      action: action as any,
      approval: approval as any,
      now: new Date('2026-07-09T20:00:00.000Z'),
    }).resultMetadata as Row
    db.rows.agent_actions.push(action)
    db.rows.approvals.push(approval)

    const first = await confirmExternalCheckout(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions/${ACTION_ID}/confirm`, {
        approvalId: APPROVAL_ID,
        expectedSnapshotHash: snapshotHash,
        outcome: 'completed',
      }),
      { params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }) }
    )
    const second = await confirmExternalCheckout(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions/${ACTION_ID}/confirm`, {
        approvalId: APPROVAL_ID,
        expectedSnapshotHash: snapshotHash,
        outcome: 'completed',
      }),
      { params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }) }
    )
    const stale = await confirmExternalCheckout(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions/${ACTION_ID}/confirm`, {
        approvalId: APPROVAL_ID,
        expectedSnapshotHash: 'b'.repeat(64),
        outcome: 'completed',
      }),
      { params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }) }
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(stale.status).toBe(409)
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'complete',
      executed_at: expect.any(String),
      result_metadata: expect.objectContaining({
        external_checkout: expect.objectContaining({
          status: 'completed',
          approval_id: APPROVAL_ID,
          snapshot_hash: snapshotHash,
          confirmed_by: USER_ID,
        }),
      }),
    }))
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
    expect(db.rows.plan_messages.filter((row) => row.metadata?.state === 'external_checkout_completed')).toHaveLength(1)
  })

  it('maps an approval-version deadlock to a refreshable HTTP conflict', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          external_url: 'https://tickets.example/event/123',
          package_details: 'External checkout handoff',
          event_date: '2026-08-01',
          notes: 'Initial terms',
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createResponse)
    remapCreatedActionApproval(db, created)
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '40P01', message: 'deadlock detected' },
    })
    mockCreateServiceRoleClient.mockReturnValue({
      from: (table: string) => db.from(table),
      rpc,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'request_reapproval',
        expectedSnapshotHash: created.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )

    expect(response.status).toBe(409)
    expect(await readJson(response)).toEqual(expect.objectContaining({
      code: 'approval_version_conflict',
      error: expect.stringContaining('Refresh'),
    }))
    expect(rpc).toHaveBeenCalledWith('supersede_approval_version', expect.any(Object))
    expect(db.rows.approvals).toHaveLength(1)
    expect(db.rows.approvals[0].status).toBe('pending')
  })

  it('edits $95.50 as a superseding pending version before separate authorization', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          kind: 'external_checkout',
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          external_url: 'https://tickets.example/event/123',
          package_details: 'External checkout handoff',
          event_date: '2026-08-01',
          notes: 'Initial terms',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const created = await readJson(createResponse)
    const generatedActionId = created.agentAction.id as string
    const generatedApprovalId = created.approval.id as string
    const actionRow = db.rows.agent_actions.find((row) => row.id === generatedActionId)!
    const approvalRow = db.rows.approvals.find((row) => row.id === generatedApprovalId)!
    actionRow.id = ACTION_ID
    actionRow.approval_id = APPROVAL_ID
    approvalRow.id = APPROVAL_ID
    approvalRow.agent_action_id = ACTION_ID
    created.agentAction.id = ACTION_ID
    created.agentAction.approval_id = APPROVAL_ID
    created.approval.id = APPROVAL_ID
    created.approval.agent_action_id = ACTION_ID
    const originalApprovalId = APPROVAL_ID

    const editResponse = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: originalApprovalId,
        command: 'edit',
        expectedSnapshotHash: created.approval.snapshot_hash,
        changes: {
          requestedAmountCents: 9_550,
          eventDate: '2026-08-02',
          notes: 'Exact host-edited terms',
        },
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const edited = await readJson(editResponse)

    expect(editResponse.status).toBe(200)
    expect(edited.approval).toEqual(expect.objectContaining({
      id: '650e8400-e29b-41d4-a716-446655440099',
      status: 'pending',
      price_cents: 9_550,
      requested_amount_cents: 9_550,
      authorized_amount_cents: null,
      event_date: '2026-08-02',
      notes: 'Exact host-edited terms',
      supersedes_approval_id: originalApprovalId,
      snapshot_schema_version: 2,
    }))
    expect(new Date(edited.approval.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(db.rows.approvals.find((row) => row.id === originalApprovalId)?.status).toBe('superseded')
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      approval_id: edited.approval.id,
      amount_cents: 9_550,
      status: 'pending',
      payload_json: expect.objectContaining({
        amount_cents: 9_550,
        price_cents: 9_550,
        requested_amount_cents: 9_550,
        requestedAmountCents: 9_550,
      }),
    }))
    const editedSnapshotInput = {
      plan: db.rows.plans[0] as any,
      approval: edited.approval as any,
      action: db.rows.agent_actions[0] as any,
      payload: db.rows.agent_actions[0].payload_json as Record<string, unknown>,
    }
    expect(edited.approval.snapshot_hash).toBe(buildApprovalSnapshotHashV2(editedSnapshotInput))
    expect(edited.approval.snapshot_json).toEqual(buildApprovalSnapshotV2(editedSnapshotInput))

    const authorizeResponse = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: edited.approval.id,
        command: 'authorize',
        expectedSnapshotHash: edited.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const authorized = await readJson(authorizeResponse)

    expect(authorizeResponse.status).toBe(200)
    expect(authorized.approval).toEqual(expect.objectContaining({
      status: 'authorized',
      requested_amount_cents: 9_550,
      authorized_amount_cents: 9_550,
    }))
    expect(authorized.confirmationSnapshot).toEqual(expect.objectContaining({
      approval: expect.objectContaining({
        requested_amount_cents: 9_550,
        price_cents: 9_550,
        event_date: '2026-08-02',
        notes: 'Exact host-edited terms',
      }),
      action: expect.objectContaining({
        amount_cents: 9_550,
        payload_json: expect.objectContaining({
          amount_cents: 9_550,
          price_cents: 9_550,
          requested_amount_cents: 9_550,
          requestedAmountCents: 9_550,
        }),
      }),
    }))
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'executing',
      result_metadata: expect.objectContaining({
        execution_mode: 'external_checkout',
        external_checkout: expect.objectContaining({
          status: 'ready',
          external_url: 'https://tickets.example/event/123',
          approval_id: edited.approval.id,
          snapshot_hash: edited.approval.snapshot_hash,
          completion_confirmation_required: true,
        }),
      }),
    }))
  })

  it('supersedes an authorized quote after materialization marks its clock expiry for re-approval', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 175_000,
        payloadJson: {
          action_label: 'Approve booking request',
          provider: 'Moongate Lounge',
          package_details: 'Venue quote',
          event_date: '2026-08-01',
          requested_amount_cents: 175_000,
          requires_event_materialization: true,
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createResponse)
    remapCreatedActionApproval(db, created)
    const action = db.rows.agent_actions.find((row) => row.id === ACTION_ID)!
    const approval = db.rows.approvals.find((row) => row.id === APPROVAL_ID)!
    action.action_type = 'concierge_queue'
    action.payload_json = {
      ...action.payload_json,
      kind: 'canonical_quote_booking',
      quote_kind: 'venue',
      price_cents: 175_000,
      requires_event_materialization: true,
    }
    action.status = 'executing'
    action.result_metadata = {
      canonical_booking_status: 'waiting_for_event_materialization',
      outbound_message_sent: false,
    }
    approval.status = 're_approval_required'
    approval.expires_at = '2000-01-01T00:00:00.000Z'
    approval.authorized_amount_cents = 175_000
    approval.authorized_by = USER_ID
    approval.authorized_at = '2026-07-09T20:00:00.000Z'

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: approval.id,
        command: 'request_reapproval',
        expectedSnapshotHash: approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )
    const payload = await readJson(response)

    expect(response.status).toBe(200)
    expect(payload.approval).toEqual(expect.objectContaining({
      status: 'pending',
      supersedes_approval_id: approval.id,
      authorized_by: null,
      authorized_at: null,
    }))
    expect(approval).toEqual(expect.objectContaining({
      status: 'superseded',
      authorized_by: USER_ID,
      authorized_at: '2026-07-09T20:00:00.000Z',
    }))
    expect(action).toEqual(expect.objectContaining({
      status: 'pending',
      approval_id: payload.approval.id,
    }))
  })

  it('rejects canonical quote repricing until a fresh trusted quote is staged', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 175_000,
        payloadJson: {
          action_label: 'Approve booking request',
          provider: 'Moongate Lounge',
          package_details: 'Trusted venue quote',
          event_date: '2026-08-01',
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createResponse)
    remapCreatedActionApproval(db, created)
    const action = db.rows.agent_actions.find((row) => row.id === ACTION_ID)!
    const approval = db.rows.approvals.find((row) => row.id === APPROVAL_ID)!
    action.action_type = 'concierge_queue'
    action.payload_json = {
      ...action.payload_json,
      kind: 'canonical_quote_booking',
      quote_kind: 'venue',
      requested_amount_cents: 175_000,
      price_cents: 175_000,
      quote_terms: { quoted_price_cents: 175_000 },
      requires_event_materialization: true,
    }
    const canonicalSnapshotHash = setV2ApprovalSnapshot(db, approval.id)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: approval.id,
        command: 'edit',
        expectedSnapshotHash: canonicalSnapshotHash,
        changes: {
          requestedAmountCents: 180_000,
          eventDate: approval.event_date,
          notes: approval.notes ?? null,
        },
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )

    expect(response.status).toBe(409)
    expect(await readJson(response)).toEqual(expect.objectContaining({
      code: 'canonical_quote_fresh_quote_required',
    }))
    expect(db.rows.approvals).toHaveLength(1)
    expect(approval).toEqual(expect.objectContaining({
      status: 'pending',
      price_cents: 175_000,
      requested_amount_cents: 175_000,
    }))
    expect(action).toEqual(expect.objectContaining({
      amount_cents: 175_000,
      approval_id: approval.id,
    }))
  })

  it('rejects a canonical quote event-date change until a fresh trusted quote is staged', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 175_000,
        payloadJson: {
          action_label: 'Approve booking request',
          provider: 'Moongate Lounge',
          package_details: 'Trusted venue quote',
          event_date: '2026-08-01',
        },
      }),
      { params: { planId: PLAN_ID } },
    )
    const created = await readJson(createResponse)
    remapCreatedActionApproval(db, created)
    const action = db.rows.agent_actions.find((row) => row.id === ACTION_ID)!
    const approval = db.rows.approvals.find((row) => row.id === APPROVAL_ID)!
    action.action_type = 'concierge_queue'
    action.payload_json = {
      ...action.payload_json,
      kind: 'canonical_quote_booking',
      quote_kind: 'venue',
      requested_amount_cents: 175_000,
      price_cents: 175_000,
      quote_terms: { quoted_price_cents: 175_000 },
      requires_event_materialization: true,
    }
    const canonicalSnapshotHash = setV2ApprovalSnapshot(db, approval.id)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: approval.id,
        command: 'edit',
        expectedSnapshotHash: canonicalSnapshotHash,
        changes: {
          requestedAmountCents: 175_000,
          eventDate: '2026-08-02',
          notes: approval.notes ?? null,
        },
      }, 'PATCH'),
      { params: { planId: PLAN_ID } },
    )

    expect(response.status).toBe(409)
    expect(await readJson(response)).toEqual(expect.objectContaining({
      code: 'canonical_quote_fresh_quote_required',
      error: expect.stringContaining('event date'),
    }))
    expect(db.rows.approvals).toHaveLength(1)
    expect(approval).toEqual(expect.objectContaining({
      status: 'pending',
      event_date: '2026-08-01',
    }))
    expect(action).toEqual(expect.objectContaining({
      amount_cents: 175_000,
      approval_id: approval.id,
      payload_json: expect.objectContaining({ event_date: '2026-08-01' }),
    }))
  })

  it('POST planner agent-actions keeps trusted mutations on the service writer', async () => {
    const writeDb = new MemoryDb()
    writeDb.rows = db.rows
    mockPlannerClient(db, writeDb)

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour soft hold',
        },
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.mutations.filter(({ table }) => [
      'agent_actions',
      'approvals',
      'agent_action_audit_log',
      'plan_messages',
    ].includes(table))).toEqual([])
    expect(writeDb.mutations).toEqual(expect.arrayContaining([
      { table: 'agent_actions', operation: 'insert' },
      { table: 'approvals', operation: 'insert' },
      { table: 'agent_action_audit_log', operation: 'insert' },
      { table: 'plan_messages', operation: 'insert' },
    ]))
  })

  it('POST planner agent-actions never creates a service writer for a non-owned plan', async () => {
    db.rows.plans[0].user_id = 'another-user'

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(404)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals prepares outreach drafts without sending outbound jobs', async () => {
    db.rows.venues.push(
      { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
      { id: VENUE_ID_2, venue_name: 'Mission Social Hall', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: false }
    )
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1, VENUE_ID_2],
        summary: 'MVP launch mixer with clear capacity and budget requirements.',
        requirements: { must_haves: ['AV', 'bar'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    const outreachApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(outreachApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      outbound_message_sent: false,
      send_requires_explicit_flow: true,
      venue_invite_count: 2,
    }))
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.plans[0].metadata.product_gate.event_access_source).toBe('free_trial')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
    expect(db.rows.venue_opportunity_invites).toHaveLength(2)
    expect(db.rows.venue_opportunity_invites.map((invite) => invite.status)).toEqual(['queued', 'queued'])
    expect(new Set(db.rows.venue_opportunity_invites.map((invite) => invite.magic_link_token)).size).toBe(2)
    db.rows.venue_opportunity_invites.forEach((invite) => {
      expect(invite.magic_link_token).toMatch(/^[a-f0-9]{64}$/)
      expect(new Date(invite.magic_link_expires_at).getTime()).toBeGreaterThan(Date.now())
    })
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message_type: 'status_update',
        metadata: expect.objectContaining({
          status: 'drafts_prepared',
          approval_id: APPROVAL_ID,
        }),
      }),
    ]))
  })

  it('PATCH planner approvals prepares one mixed venue and vendor outreach batch', async () => {
    db.rows.venues.push(
      { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
      { id: VENUE_ID_2, venue_name: 'Mission Social Hall', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: true }
    )
    db.rows.vendor_profiles.push({
      id: VENDOR_ID,
      name: 'Mission Photo Co.',
      vendor_type: 'photography',
      service_type: 'photo',
      is_claimed: true,
      is_admin_seeded: false,
    })
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1, VENUE_ID_2],
        vendor_ids: [VENDOR_ID],
        partner_targets: [
          { kind: 'venue', id: VENUE_ID_1, name: 'Foundry Rooftop' },
          { kind: 'venue', id: VENUE_ID_2, name: 'Mission Social Hall' },
          { kind: 'vendor', id: VENDOR_ID, name: 'Mission Photo Co.' },
        ],
        comparison_goal: 'Collect availability, fit, pricing, and next steps.',
        summary: 'MVP launch mixer with venue and vendor comparison requirements.',
        requirements: { must_haves: ['AV', 'photo'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    const mixedOutreachApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Approve outreach to 2 venues, 1 vendor',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(mixedOutreachApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      outbound_message_sent: false,
      send_requires_explicit_flow: true,
      venue_invite_count: 2,
      vendor_invite_count: 1,
    }))
    expect(db.rows.agent_actions[0].payload_json).toEqual(expect.objectContaining({
      opportunity_brief_id: expect.any(String),
      vendor_opportunity_brief_id: expect.any(String),
      invite_ids: expect.arrayContaining([expect.any(String)]),
      vendor_invite_ids: expect.arrayContaining([expect.any(String)]),
      queued_invite_count: 2,
      queued_vendor_invite_count: 1,
      partner_targets: expect.arrayContaining([
        expect.objectContaining({ kind: 'venue', name: 'Foundry Rooftop' }),
        expect.objectContaining({ kind: 'vendor', name: 'Mission Photo Co.' }),
      ]),
    }))
    expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
    expect(db.rows.venue_opportunity_invites).toHaveLength(2)
    expect(db.rows.vendor_opportunity_briefs).toHaveLength(1)
    expect(db.rows.vendor_opportunity_invites).toHaveLength(1)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals requires re-approval when approval-sensitive fields changed', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      payload_json: {
        venue_ids: [VENUE_ID_1],
        seats: 80,
      },
      result_metadata: {},
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Request hold',
      status: 'pending',
      price_cents: 50_000,
      fees_cents: 0,
      requested_amount_cents: 50_000,
      provider: 'Foundry Rooftop',
      event_date: '2026-08-01',
    })
    const staleSnapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID, {
      ...db.rows.plans[0],
      guest_count: 70,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: staleSnapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.approvals[0].status).toBe('re_approval_required')
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('PATCH planner approvals cannot make a snapshot-less approval executable', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      payload_json: {
        venue_ids: [VENUE_ID_1],
        seats: 80,
      },
      result_metadata: {},
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Request hold',
      status: 'pending',
      price_cents: 50_000,
      fees_cents: 0,
      requested_amount_cents: 50_000,
      provider: 'Foundry Rooftop',
      event_date: '2026-08-01',
      snapshot_hash: null,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: 'a'.repeat(64),
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(409)
    expect(json).toEqual(expect.objectContaining({ code: 'approval_snapshot_mismatch' }))
    expect(db.rows.approvals[0].status).toBe('pending')
    expect(db.rows.approvals[0].authorized_by).toBeUndefined()
    expect(db.rows.approvals[0].authorized_at).toBeUndefined()
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('PATCH planner approvals cancels rejected actions without preparing outreach', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Prepare venue outreach',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    })
    setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'reject',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('rejected')
    expect(db.rows.agent_actions[0].status).toBe('cancelled')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals cancels stale pending approvals even when linked action is terminal', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'complete',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Prepare venue outreach',
      status: 'pending',
      price_cents: 0,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'cancel',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('cancelled')
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals blocks execution when builder has no product access', async () => {
    db.rows.builder_profiles[0] = {
      ...db.rows.builder_profiles[0],
      free_events_granted: 2,
      free_events_used: 2,
      paid_event_credits: 0,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
    }
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      status: 'pending',
    })
    const accessApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(accessApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(402)
    expect(json).toEqual(expect.objectContaining({
      billingRequired: true,
      error: 'Choose pay-per-event or Pro to continue planning this event.',
    }))
    expect(db.rows.approvals[0].status).toBe('pending')
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('POST venue opportunities blocks outreach draft generation before approval', async () => {
    db.rows.venues.push({ id: VENUE_ID_1, venue_name: 'Foundry Rooftop', standing_capacity: 160, is_claimed: true })

    const response = await createVenueOpportunity(
      makeRequest(`/api/planner/plans/${PLAN_ID}/opportunities/venues`, {
        venue_ids: [VENUE_ID_1],
        summary: 'Venue fit request for MVP launch mixer.',
        requirements: { must_haves: ['AV'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(403)
    expect(json.error).toMatch(/Approved outreach approval is required/)
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(db.rows.venue_opportunity_invites).toHaveLength(0)
  })

  it('normalizes Eventbrite tier data into rollups used by analytics', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'Early Bird', ticket_tier_category: classifyTicketTier('Early Bird'), ticket_quantity: 1, total_amount_cents: 2500, fees_cents: 250, currency: 'usd' })),
      { platform: 'eventbrite', ticket_tier_name: 'Bird', ticket_tier_category: classifyTicketTier('Bird'), ticket_quantity: 1, total_amount_cents: 3000, fees_cents: 300, currency: 'usd' },
      ...Array.from({ length: 10 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'GA', ticket_tier_category: classifyTicketTier('GA'), ticket_quantity: 1, total_amount_cents: 4000, fees_cents: 400, currency: 'usd' })),
      ...Array.from({ length: 5 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'VIP Table', ticket_tier_category: classifyTicketTier('VIP Table'), ticket_quantity: 1, total_amount_cents: 9000, fees_cents: 900, currency: 'usd' })),
      { platform: 'eventbrite', ticket_tier_name: 'Founder Circle', ticket_tier_category: classifyTicketTier('Founder Circle'), ticket_quantity: 1, total_amount_cents: 12000, fees_cents: 1200, currency: 'usd' },
      { platform: 'eventbrite', ticket_tier_name: 'GA', ticket_tier_category: classifyTicketTier('GA'), ticket_quantity: -2, total_amount_cents: -8000, fees_cents: 0, currency: 'usd', is_refund: true },
    ]

    const rollups = buildTicketTierRollups(rows)

    expect(rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticket_tier_name: 'Early Bird', ticket_tier_category: 'early_bird', tickets_sold: 5, gross_revenue_cents: 12_500 }),
        expect.objectContaining({ ticket_tier_name: 'Bird', ticket_tier_category: 'early_bird', tickets_sold: 1, gross_revenue_cents: 3_000 }),
        expect.objectContaining({ ticket_tier_name: 'GA', ticket_tier_category: 'ga', tickets_sold: 10, tickets_refunded: 2, gross_revenue_cents: 40_000, refund_amount_cents: 8_000, net_revenue_cents: 28_000 }),
        expect.objectContaining({ ticket_tier_name: 'VIP Table', ticket_tier_category: 'vip', tickets_sold: 5, gross_revenue_cents: 45_000 }),
        expect.objectContaining({ ticket_tier_name: 'Founder Circle', ticket_tier_category: 'vip', tickets_sold: 1, gross_revenue_cents: 12_000 }),
      ])
    )
  })

  it('keeps contact_email out of anon catalog responses while admin catalog can see it', async () => {
    db.rows.vendor_profiles.push({
      id: VENDOR_ID,
      user_id: null,
      name: 'Saffron Catering',
      business_name: 'Saffron Catering',
      vendor_type: 'Caterer',
      service_type: 'catering',
      bio: 'Bay Area catering',
      city: 'San Francisco',
      state: 'CA',
      pricing_model: 'flat',
      is_published: true,
      is_admin_seeded: true,
      contact_email: 'owner@saffron.example',
    })

    const publicResponse = await listPublicVendors(makeRequest('/api/vendors'))
    const publicJson = await readJson(publicResponse)
    const publicVendorSelect = db.selects.find((select) => select.table === 'vendor_profiles')?.columns ?? ''

    expect(publicResponse.status).toBe(200)
    expect(publicVendorSelect).not.toMatch(/contact_email/i)
    expect(JSON.stringify(publicJson)).not.toContain('owner@saffron.example')

    const adminResponse = await listAdminVendors()
    const adminJson = await readJson(adminResponse)

    expect(adminResponse.status).toBe(200)
    expect(adminJson.vendors[0].contact_email).toBe('owner@saffron.example')
  })
})
