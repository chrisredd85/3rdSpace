import 'server-only'

import type Stripe from 'stripe'
import {
  applyPlannerStripePaymentIntentWebhook,
  PAYMENT_INTENT_SELECT_COLUMNS,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'

type StripeAdminClient = {
  from: (table: string) => any
}

type StripeNeutralizationClient = {
  paymentIntents: {
    retrieve: (id: string) => Promise<Stripe.PaymentIntent>
    cancel: (
      id: string,
      params?: Stripe.PaymentIntentCancelParams,
      options?: Stripe.RequestOptions
    ) => Promise<Stripe.PaymentIntent>
  }
  checkout: {
    sessions: {
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>
      expire: (
        id: string,
        params?: Stripe.Checkout.SessionExpireParams,
        options?: Stripe.RequestOptions
      ) => Promise<Stripe.Checkout.Session>
    }
  }
}

type RestrictionScope = {
  vendorIds: string[]
  venueOwnerIds: string[]
  venueIds: string[]
  builderUserIds: string[]
}

type StripeObjectSource =
  | 'planner_payment_intent'
  | 'vendor_transaction'
  | 'venue_checkout_session'
  | 'settlement_checkout_session'

type NeutralizationAuditInput = {
  entityId: string
  source: StripeObjectSource
  action: string
  stripeObjectId: string
  stripeObjectType: 'payment_intent' | 'checkout_session'
  stripeStatus: string | null
  accountId: string
  eventId: string
  reason: string
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
}

type PaymentCandidate = {
  entityId: string
  source: 'planner_payment_intent' | 'vendor_transaction'
  localStatus: string
  stripePaymentIntentId: string
  plannerPaymentIntent?: PlannerPaymentIntentRow
}

type CheckoutCandidate = {
  entityId: string
  source: 'venue_checkout_session' | 'settlement_checkout_session'
  localStatus: string
  stripeCheckoutSessionId: string
}

export type StripeRestrictionNeutralizationResult = {
  payment_intents_cancelled: number
  payment_intents_already_cancelled: number
  payment_intents_routed_to_reconciliation: number
  capturing_payment_intents_preserved: number
  checkout_sessions_expired: number
  checkout_sessions_already_expired: number
  checkout_sessions_routed_to_reconciliation: number
}

const CANCELABLE_PAYMENT_INTENT_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_capture',
  'requires_confirmation',
  'requires_action',
  'processing',
])

const ACTIVE_PLANNER_PAYMENT_STATUSES = [
  'pending',
  'requested',
  'authorized',
  'blocked_by_account_state',
  'capturing',
]

/**
 * Neutralizes platform-created Stripe objects after a connected account becomes
 * restricted. Stripe is retrieved before every mutation. A planner capture
 * already holding the `capturing` lease is never canceled; Stripe truth and the
 * stale-capture reconciler remain responsible for finishing that attempt.
 */
export async function neutralizeRestrictedStripeAccountObjects(input: {
  db: StripeAdminClient
  stripe: StripeNeutralizationClient
  accountId: string
  eventId: string
  reason?: string
}): Promise<StripeRestrictionNeutralizationResult> {
  const reason = input.reason ?? 'account_restricted'
  const scope = await loadRestrictionScope(input.db, input.accountId)
  const result: StripeRestrictionNeutralizationResult = {
    payment_intents_cancelled: 0,
    payment_intents_already_cancelled: 0,
    payment_intents_routed_to_reconciliation: 0,
    capturing_payment_intents_preserved: 0,
    checkout_sessions_expired: 0,
    checkout_sessions_already_expired: 0,
    checkout_sessions_routed_to_reconciliation: 0,
  }

  const paymentCandidates = await loadPaymentCandidates(input.db, scope)
  for (const candidate of paymentCandidates) {
    await neutralizePaymentIntent({
      ...input,
      reason,
      candidate,
      result,
    })
  }

  const checkoutCandidates = await loadCheckoutCandidates(input.db, scope, input.accountId)
  for (const candidate of checkoutCandidates) {
    await neutralizeCheckoutSession({
      ...input,
      reason,
      candidate,
      result,
    })
  }

  return result
}

async function neutralizePaymentIntent(input: {
  db: StripeAdminClient
  stripe: StripeNeutralizationClient
  accountId: string
  eventId: string
  reason: string
  candidate: PaymentCandidate
  result: StripeRestrictionNeutralizationResult
}) {
  let stripeIntent = await input.stripe.paymentIntents.retrieve(
    input.candidate.stripePaymentIntentId
  )

  if (input.candidate.localStatus === 'capturing') {
    if (stripeIntent.status === 'succeeded') {
      await writeNeutralizationAudit(input.db, {
        ...paymentAuditBase(input, stripeIntent),
        action: 'stripe_object.reconciliation_required',
        afterState: { local_status: 'captured' },
      })
      await routeSucceededPaymentToReconciliation(input.db, input.candidate, stripeIntent)
      input.result.payment_intents_routed_to_reconciliation += 1
      return
    }

    if (stripeIntent.status === 'canceled') {
      await writeNeutralizationAudit(input.db, {
        ...paymentAuditBase(input, stripeIntent),
        action: 'stripe_object.already_cancelled',
        afterState: { local_status: 'failed' },
      })
      await markPaymentCandidateFailed(input.db, input.candidate)
      input.result.payment_intents_already_cancelled += 1
      return
    }

    input.result.capturing_payment_intents_preserved += 1
    await writeNeutralizationAudit(input.db, {
      ...paymentAuditBase(input, stripeIntent),
      action: 'stripe_object.capture_preserved',
      afterState: { local_status: 'capturing', reconciler_required: true },
    })
    return
  }

  if (stripeIntent.status === 'succeeded') {
    await writeNeutralizationAudit(input.db, {
      ...paymentAuditBase(input, stripeIntent),
      action: 'stripe_object.reconciliation_required',
      afterState: { local_status: input.candidate.source === 'planner_payment_intent' ? 'captured' : 'succeeded' },
    })
    await routeSucceededPaymentToReconciliation(input.db, input.candidate, stripeIntent)
    input.result.payment_intents_routed_to_reconciliation += 1
    return
  }

  if (stripeIntent.status === 'canceled') {
    await writeNeutralizationAudit(input.db, {
      ...paymentAuditBase(input, stripeIntent),
      action: 'stripe_object.already_cancelled',
      afterState: { local_status: 'failed' },
    })
    await markPaymentCandidateFailed(input.db, input.candidate)
    input.result.payment_intents_already_cancelled += 1
    return
  }

  if (!CANCELABLE_PAYMENT_INTENT_STATUSES.has(stripeIntent.status)) {
    throw new Error(
      `Restricted account PaymentIntent ${stripeIntent.id} has unsupported Stripe status ${stripeIntent.status}`
    )
  }

  try {
    stripeIntent = await input.stripe.paymentIntents.cancel(
      stripeIntent.id,
      { cancellation_reason: 'abandoned' },
      { idempotencyKey: restrictionIdempotencyKey('cancel', input.eventId, stripeIntent.id) }
    )
  } catch (error) {
    const refreshed = await input.stripe.paymentIntents.retrieve(stripeIntent.id)
    if (refreshed.status !== 'canceled' && refreshed.status !== 'succeeded') throw error
    stripeIntent = refreshed
  }

  if (stripeIntent.status === 'succeeded') {
    await writeNeutralizationAudit(input.db, {
      ...paymentAuditBase(input, stripeIntent),
      action: 'stripe_object.reconciliation_required',
      afterState: { local_status: input.candidate.source === 'planner_payment_intent' ? 'captured' : 'succeeded' },
    })
    await routeSucceededPaymentToReconciliation(input.db, input.candidate, stripeIntent)
    input.result.payment_intents_routed_to_reconciliation += 1
    return
  }

  await writeNeutralizationAudit(input.db, {
    ...paymentAuditBase(input, stripeIntent),
    action: 'stripe_object.cancelled',
    afterState: { local_status: 'failed', stripe_status: stripeIntent.status },
  })
  await markPaymentCandidateFailed(input.db, input.candidate)
  input.result.payment_intents_cancelled += 1
}

async function neutralizeCheckoutSession(input: {
  db: StripeAdminClient
  stripe: StripeNeutralizationClient
  accountId: string
  eventId: string
  reason: string
  candidate: CheckoutCandidate
  result: StripeRestrictionNeutralizationResult
}) {
  const session = await input.stripe.checkout.sessions.retrieve(
    input.candidate.stripeCheckoutSessionId
  )

  if (session.status === 'complete' || session.payment_status === 'paid') {
    input.result.checkout_sessions_routed_to_reconciliation += 1
    await writeNeutralizationAudit(input.db, {
      ...checkoutAuditBase(input, session),
      action: 'stripe_object.reconciliation_required',
      afterState: { local_status: input.candidate.localStatus, payment_status: session.payment_status },
    })
    return
  }

  if (session.status === 'expired') {
    await writeNeutralizationAudit(input.db, {
      ...checkoutAuditBase(input, session),
      action: 'stripe_object.already_expired',
      afterState: { local_status: 'failed' },
    })
    await markCheckoutCandidateExpired(input.db, input.candidate)
    input.result.checkout_sessions_already_expired += 1
    return
  }

  if (session.status !== 'open' && session.status !== null) {
    throw new Error(
      `Restricted account Checkout Session ${session.id} has unsupported Stripe status ${session.status}`
    )
  }

  let expired: Stripe.Checkout.Session
  try {
    expired = await input.stripe.checkout.sessions.expire(
      session.id,
      {},
      { idempotencyKey: restrictionIdempotencyKey('expire', input.eventId, session.id) }
    )
  } catch (error) {
    const refreshed = await input.stripe.checkout.sessions.retrieve(session.id)
    if (refreshed.status !== 'expired' && refreshed.status !== 'complete') throw error
    if (refreshed.status === 'complete') {
      input.result.checkout_sessions_routed_to_reconciliation += 1
      await writeNeutralizationAudit(input.db, {
        ...checkoutAuditBase(input, refreshed),
        action: 'stripe_object.reconciliation_required',
        afterState: { local_status: input.candidate.localStatus, payment_status: refreshed.payment_status },
      })
      return
    }
    expired = refreshed
  }

  await writeNeutralizationAudit(input.db, {
    ...checkoutAuditBase(input, expired),
    action: 'stripe_object.expired',
    afterState: { local_status: 'failed', stripe_status: expired.status },
  })
  await markCheckoutCandidateExpired(input.db, input.candidate)
  input.result.checkout_sessions_expired += 1
}

async function loadRestrictionScope(
  db: StripeAdminClient,
  accountId: string
): Promise<RestrictionScope> {
  const [vendorRows, venueRows, builderRows] = await Promise.all([
    loadRows(db, 'vendor_stripe_accounts', 'vendor_id', 'stripe_account_id', accountId),
    loadRows(db, 'venue_stripe_accounts', 'owner_id', 'stripe_account_id', accountId),
    loadRows(db, 'builder_stripe_accounts', 'user_id', 'stripe_account_id', accountId),
  ])
  const vendorIds = readIds(vendorRows, 'vendor_id')
  const venueOwnerIds = readIds(venueRows, 'owner_id')
  const builderUserIds = readIds(builderRows, 'user_id')
  const venueRowsByOwner = venueOwnerIds.length > 0
    ? await loadRowsIn(db, 'venues', 'id, owner_id', 'owner_id', venueOwnerIds)
    : []

  return {
    vendorIds,
    venueOwnerIds,
    venueIds: readIds(venueRowsByOwner, 'id'),
    builderUserIds,
  }
}

async function loadPaymentCandidates(
  db: StripeAdminClient,
  scope: RestrictionScope
): Promise<PaymentCandidate[]> {
  const plannerRows = [
    ...(scope.vendorIds.length > 0
      ? await loadPartnerPlannerPayments(db, 'vendor', scope.vendorIds)
      : []),
    ...(scope.venueIds.length > 0
      ? await loadPartnerPlannerPayments(db, 'venue', scope.venueIds)
      : []),
  ]
  const vendorTransactions = scope.vendorIds.length > 0
    ? await loadRowsIn(
        db,
        'vendor_transactions',
        'id, status, stripe_payment_intent_id, vendor_id',
        'vendor_id',
        scope.vendorIds,
        (query) => query
          .in('status', ['pending', 'processing', 'blocked_by_account_state'])
          .not('stripe_payment_intent_id', 'is', null)
      )
    : []

  return dedupeByStripeObject([
    ...plannerRows.map((row) => ({
      entityId: row.id,
      source: 'planner_payment_intent' as const,
      localStatus: row.status,
      stripePaymentIntentId: row.stripe_payment_intent_id!,
      plannerPaymentIntent: row,
    })),
    ...vendorTransactions.flatMap((row) => {
      const id = readId(row.id)
      const status = readId(row.status)
      const stripeId = readId(row.stripe_payment_intent_id)
      return id && status && stripeId
        ? [{
            entityId: id,
            source: 'vendor_transaction' as const,
            localStatus: status,
            stripePaymentIntentId: stripeId,
          }]
        : []
    }),
  ], (candidate) => candidate.stripePaymentIntentId)
}

async function loadPartnerPlannerPayments(
  db: StripeAdminClient,
  partnerKind: 'venue' | 'vendor',
  partnerIds: string[]
): Promise<PlannerPaymentIntentRow[]> {
  const rows = await loadRowsIn(
    db,
    'payment_intents',
    PAYMENT_INTENT_SELECT_COLUMNS,
    'partner_id',
    partnerIds,
    (query) => query
      .eq('partner_kind', partnerKind)
      .in('status', ACTIVE_PLANNER_PAYMENT_STATUSES)
      .not('stripe_payment_intent_id', 'is', null)
  )
  return rows as unknown as PlannerPaymentIntentRow[]
}

async function loadCheckoutCandidates(
  db: StripeAdminClient,
  scope: RestrictionScope,
  accountId: string
): Promise<CheckoutCandidate[]> {
  const venueTransactions = scope.venueOwnerIds.length > 0
    ? await loadRowsIn(
        db,
        'venue_payment_transactions',
        'id, status, stripe_checkout_session_id, venue_owner_id',
        'venue_owner_id',
        scope.venueOwnerIds,
        (query) => query
          .in('status', ['pending_builder_payment', 'checkout_created', 'blocked_by_account_state'])
          .not('stripe_checkout_session_id', 'is', null)
      )
    : []
  const settlementCharges = await loadRows(
    db,
    'settlement_charges',
    'id, status, stripe_checkout_session_id, blocked_stripe_account_id',
    'blocked_stripe_account_id',
    accountId,
    (query) => query
      .eq('status', 'blocked')
      .not('stripe_checkout_session_id', 'is', null)
  )

  return dedupeByStripeObject([
    ...venueTransactions.flatMap((row) => checkoutCandidate(row, 'venue_checkout_session')),
    ...settlementCharges.flatMap((row) => checkoutCandidate(row, 'settlement_checkout_session')),
  ], (candidate) => candidate.stripeCheckoutSessionId)
}

function checkoutCandidate(
  row: Record<string, unknown>,
  source: CheckoutCandidate['source']
): CheckoutCandidate[] {
  const entityId = readId(row.id)
  const localStatus = readId(row.status)
  const stripeCheckoutSessionId = readId(row.stripe_checkout_session_id)
  return entityId && localStatus && stripeCheckoutSessionId
    ? [{ entityId, source, localStatus, stripeCheckoutSessionId }]
    : []
}

async function routeSucceededPaymentToReconciliation(
  db: StripeAdminClient,
  candidate: PaymentCandidate,
  stripeIntent: Stripe.PaymentIntent
) {
  if (candidate.source === 'planner_payment_intent') {
    await applyPlannerStripePaymentIntentWebhook(db, stripeIntent)
    return
  }

  const { error } = await db
    .from('vendor_transactions')
    .update({ status: 'succeeded', paid_at: new Date().toISOString() })
    .eq('id', candidate.entityId)
    .eq('stripe_payment_intent_id', stripeIntent.id)
  if (error) throw new Error(`Failed to route vendor payment to reconciliation: ${error.message}`)
}

async function markPaymentCandidateFailed(
  db: StripeAdminClient,
  candidate: PaymentCandidate
) {
  if (candidate.source === 'planner_payment_intent') {
    const { error } = await db
      .from('payment_intents')
      .update({
        status: 'failed',
        failure_reason: 'Stripe PaymentIntent canceled after connected account restriction',
        capture_effects_started_at: null,
        capture_effects_completed_at: null,
      })
      .eq('id', candidate.entityId)
      .eq('stripe_payment_intent_id', candidate.stripePaymentIntentId)
      .in('status', ACTIVE_PLANNER_PAYMENT_STATUSES)
    if (error) throw new Error(`Failed to record canceled planner payment: ${error.message}`)
    return
  }

  const { error } = await db
    .from('vendor_transactions')
    .update({ status: 'failed' })
    .eq('id', candidate.entityId)
    .eq('stripe_payment_intent_id', candidate.stripePaymentIntentId)
  if (error) throw new Error(`Failed to record canceled vendor payment: ${error.message}`)
}

async function markCheckoutCandidateExpired(
  db: StripeAdminClient,
  candidate: CheckoutCandidate
) {
  const now = new Date().toISOString()
  if (candidate.source === 'venue_checkout_session') {
    const { error } = await db
      .from('venue_payment_transactions')
      .update({
        status: 'failed',
        failure_reason: 'Checkout Session expired after connected account restriction',
        failed_at: now,
      })
      .eq('id', candidate.entityId)
      .eq('stripe_checkout_session_id', candidate.stripeCheckoutSessionId)
    if (error) throw new Error(`Failed to record expired venue checkout: ${error.message}`)
    return
  }

  const { error } = await db
    .from('settlement_charges')
    .update({
      status: 'failed',
      failure_reason: 'Checkout Session expired after connected account restriction',
      failed_at: now,
      checkout_url: null,
      updated_at: now,
    })
    .eq('id', candidate.entityId)
    .eq('stripe_checkout_session_id', candidate.stripeCheckoutSessionId)
  if (error) throw new Error(`Failed to record expired settlement checkout: ${error.message}`)
}

function paymentAuditBase(
  input: {
    accountId: string
    eventId: string
    reason: string
    candidate: PaymentCandidate
  },
  stripeIntent: Stripe.PaymentIntent
): Omit<NeutralizationAuditInput, 'action'> {
  return {
    entityId: input.candidate.entityId,
    source: input.candidate.source,
    stripeObjectId: stripeIntent.id,
    stripeObjectType: 'payment_intent',
    stripeStatus: stripeIntent.status,
    accountId: input.accountId,
    eventId: input.eventId,
    reason: input.reason,
    beforeState: {
      local_status: input.candidate.localStatus,
      stripe_status: stripeIntent.status,
    },
  }
}

function checkoutAuditBase(
  input: {
    accountId: string
    eventId: string
    reason: string
    candidate: CheckoutCandidate
  },
  session: Stripe.Checkout.Session
): Omit<NeutralizationAuditInput, 'action'> {
  return {
    entityId: input.candidate.entityId,
    source: input.candidate.source,
    stripeObjectId: session.id,
    stripeObjectType: 'checkout_session',
    stripeStatus: session.status,
    accountId: input.accountId,
    eventId: input.eventId,
    reason: input.reason,
    beforeState: {
      local_status: input.candidate.localStatus,
      stripe_status: session.status,
      payment_status: session.payment_status,
    },
  }
}

async function writeNeutralizationAudit(
  db: StripeAdminClient,
  input: NeutralizationAuditInput
) {
  const metadata = {
    actor: 'system',
    reason: 'account_restricted',
    stripe_account_id: input.accountId,
    stripe_event_id: input.eventId,
    stripe_object_id: input.stripeObjectId,
    stripe_object_type: input.stripeObjectType,
    stripe_status: input.stripeStatus,
    action_taken: input.action,
  }
  const { data: existing, error: lookupError } = await db
    .from('admin_audit_log')
    .select('id')
    .eq('entity_type', input.source)
    .eq('entity_id', input.entityId)
    .eq('action', input.action)
    .contains('metadata', {
      stripe_event_id: input.eventId,
      stripe_object_id: input.stripeObjectId,
    })
    .limit(1)

  if (lookupError) throw new Error(`Failed to check Stripe neutralization audit: ${lookupError.message}`)
  if (Array.isArray(existing) && existing.length > 0) return

  const { error } = await db.from('admin_audit_log').insert({
    admin_user_id: null,
    action: input.action,
    entity_type: input.source,
    entity_id: input.entityId,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
    reason: input.reason,
    metadata,
  })
  if (error) throw new Error(`Failed to write Stripe neutralization audit: ${error.message}`)
}

async function loadRows(
  db: StripeAdminClient,
  table: string,
  columns: string,
  filterColumn: string,
  filterValue: string,
  refine?: (query: any) => any
): Promise<Array<Record<string, unknown>>> {
  let query = db.from(table).select(columns).eq(filterColumn, filterValue)
  if (refine) query = refine(query)
  const { data, error } = await query
  if (error) throw new Error(`Failed to load ${table} for Stripe restriction: ${error.message}`)
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : []
}

async function loadRowsIn(
  db: StripeAdminClient,
  table: string,
  columns: string,
  filterColumn: string,
  filterValues: string[],
  refine?: (query: any) => any
): Promise<Array<Record<string, unknown>>> {
  let query = db.from(table).select(columns).in(filterColumn, filterValues)
  if (refine) query = refine(query)
  const { data, error } = await query
  if (error) throw new Error(`Failed to load ${table} for Stripe restriction: ${error.message}`)
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : []
}

function readIds(rows: Array<Record<string, unknown>>, column: string) {
  return rows.map((row) => readId(row[column])).filter((value): value is string => Boolean(value))
}

function readId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function dedupeByStripeObject<T>(rows: T[], getId: (row: T) => string) {
  return [...new Map(rows.map((row) => [getId(row), row])).values()]
}

function restrictionIdempotencyKey(action: 'cancel' | 'expire', eventId: string, objectId: string) {
  return `account_restricted_${action}_${eventId}_${objectId}`.slice(0, 255)
}
