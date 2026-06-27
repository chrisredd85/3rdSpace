import 'server-only'

import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { lookupBaseline } from '@/lib/planner/baselines'
import type { Approval, Json, Plan, Recommendation } from '@/lib/types'
import { rootLogger } from '@/lib/server/logger'

export type RecomputeTrigger = 'plan_revision' | 'discovery_change' | 'commit_changed' | 'cancel_commit'

export type RecomputePlanDerivedStateResult = {
  profit_assumptions_changed: boolean
  shopping_list_changed: boolean
  auth_cards_changed: boolean
  baseline_source_changed: boolean
  new_brief_render_version: number
}

type PlannerDb = {
  from: (table: string) => any
}

type ExistingDerivedState = {
  profit_assumptions: Json | null
  shopping_list: Json | null
  authorization_cards: Json | null
  baseline_source: string | null
  baseline_n_events: number | null
  brief_render_version: number | null
}

type RecomputeInput = {
  supabase: PlannerDb
  planId: string
  trigger: RecomputeTrigger
  revisionId?: string
  discoveryChangeId?: string
}

export async function recomputePlanDerivedState(opts: RecomputeInput): Promise<RecomputePlanDerivedStateResult> {
  const [plan, recommendations, approvals, existing] = await Promise.all([
    loadPlan(opts.supabase, opts.planId),
    loadActiveRecommendations(opts.supabase, opts.planId),
    loadActiveApprovals(opts.supabase, opts.planId),
    loadExistingDerivedState(opts.supabase, opts.planId),
  ])

  if (!plan) throw new Error('Plan not found for derived state recompute')

  const baseline = await lookupBaseline(opts.supabase as never, {
    organizerId: plan.user_id,
    archetype: plan.event_type,
    neighborhood: plan.neighborhood,
  })

  const profitAssumptions = buildProfitAssumptions(plan, recommendations, baseline)
  const shoppingList = buildShoppingList(plan, recommendations)
  const authorizationCards = buildAuthorizationCards(approvals)
  const nextVersion = Math.max(0, plan.brief_render_version ?? existing?.brief_render_version ?? 0) + 1
  const computedAt = new Date().toISOString()
  const result = {
    profit_assumptions_changed: !deepEqual(existing?.profit_assumptions, profitAssumptions),
    shopping_list_changed: !deepEqual(existing?.shopping_list, shoppingList),
    auth_cards_changed: !deepEqual(existing?.authorization_cards, authorizationCards),
    baseline_source_changed: existing?.baseline_source !== baseline.source || existing?.baseline_n_events !== baseline.nEvents,
    new_brief_render_version: nextVersion,
  }

  const { error: upsertError } = await opts.supabase
    .from('plan_derived_state')
    .upsert({
      plan_id: opts.planId,
      profit_assumptions: profitAssumptions as Json,
      shopping_list: shoppingList as Json,
      authorization_cards: authorizationCards as Json,
      baseline_source: baseline.source,
      baseline_n_events: baseline.nEvents,
      computed_at: computedAt,
      brief_render_version: nextVersion,
    }, { onConflict: 'plan_id' })

  if (upsertError) {
    throw new Error(`Failed to cache plan derived state: ${upsertError.message}`)
  }

  const { error: planUpdateError } = await opts.supabase
    .from('plans')
    .update({
      brief_render_version: nextVersion,
      derived_state_recomputed_at: computedAt,
    })
    .eq('id', opts.planId)

  if (planUpdateError) {
    throw new Error(`Failed to update plan brief render version: ${planUpdateError.message}`)
  }

  rootLogger.info('Plan derived state recomputed', {
    plan_id: opts.planId,
    trigger: opts.trigger,
    revision_id: opts.revisionId,
    discovery_change_id: opts.discoveryChangeId,
    new_version: nextVersion,
    changes: {
      profit_assumptions_changed: result.profit_assumptions_changed,
      shopping_list_changed: result.shopping_list_changed,
      auth_cards_changed: result.auth_cards_changed,
      baseline_source_changed: result.baseline_source_changed,
    },
  })

  return result
}

async function loadPlan(db: PlannerDb, planId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load plan for derived state recompute: ${error.message}`)
  return (data as Plan | null) ?? null
}

async function loadActiveRecommendations(db: PlannerDb, planId: string): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .select('id, plan_id, type, reference_id, external_name, price_cents, notes, rank, is_best_fit, status, metadata, created_at')
    .eq('plan_id', planId)
    .in('status', ['pending', 'selected'])
    .order('rank', { ascending: true })

  if (error) throw new Error(`Failed to load recommendations for derived state recompute: ${error.message}`)
  return (data ?? []) as Recommendation[]
}

async function loadActiveApprovals(db: PlannerDb, planId: string): Promise<Approval[]> {
  const { data, error } = await db
    .from('approvals')
    .select('id, plan_id, agent_action_id, action_label, provider, event_date, price_cents, fees_cents, refund_terms, cancellation_terms, package_details, delivery_email, payment_method_id, status, requested_amount_cents, authorized_amount_cents, authorized_by, authorized_at, approved_by, approved_at, expires_at, snapshot_hash, created_at, updated_at')
    .eq('plan_id', planId)
    .in('status', ['pending', 'approved', 'authorized'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load approvals for derived state recompute: ${error.message}`)
  return (data ?? []) as Approval[]
}

async function loadExistingDerivedState(db: PlannerDb, planId: string): Promise<ExistingDerivedState | null> {
  const { data, error } = await db
    .from('plan_derived_state')
    .select('profit_assumptions, shopping_list, authorization_cards, baseline_source, baseline_n_events, brief_render_version')
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load existing plan derived state: ${error.message}`)
  return (data as ExistingDerivedState | null) ?? null
}

function buildProfitAssumptions(plan: Plan, recommendations: Recommendation[], baseline: Awaited<ReturnType<typeof lookupBaseline>>) {
  const committedVenueCost = plan.committed_venue_quoted_price_cents ?? null
  const topVenueRecommendation = recommendations.find((rec) => rec.type === 'venue' && rec.price_cents !== null)
  const venueCostCents = committedVenueCost ?? topVenueRecommendation?.price_cents ?? null
  const committedVendorCostCents = readCommittedVendors(plan.committed_vendors)
    .reduce((sum, vendor) => sum + (readNumber(vendor.quoted_package_cents) ?? readNumber(vendor.quoted_minimum_cents) ?? 0), 0)
  const recommendationVendorCostCents = committedVendorCostCents > 0
    ? 0
    : recommendations
      .filter((rec) => rec.type === 'vendor')
      .reduce((sum, rec) => sum + (rec.price_cents ?? 0), 0)
  const vendorCostCents = committedVendorCostCents + recommendationVendorCostCents
  const ticketPriceTargetCents = readNumber(readRecord(plan.metadata)?.ticket_price_target_cents) ?? null
  const ticketRevenueCents = plan.ticketed && ticketPriceTargetCents && plan.guest_count
    ? Math.round(ticketPriceTargetCents * plan.guest_count * baseline.avgSellThrough)
    : 0
  const totalCostCents = (venueCostCents ?? 0) + vendorCostCents
  const projectedProfitCents = ticketRevenueCents - totalCostCents
  const perAttendeeNetCents = plan.guest_count && plan.guest_count > 0
    ? Math.round(projectedProfitCents / plan.guest_count)
    : null

  return {
    ticket_revenue_cents: ticketRevenueCents,
    venue_cost_cents: venueCostCents,
    venue_cost_source: committedVenueCost !== null ? 'committed_quote' : topVenueRecommendation ? 'active_recommendation' : 'none',
    vendor_cost_cents: vendorCostCents,
    vendor_cost_source: committedVendorCostCents > 0 ? 'committed_quotes' : recommendationVendorCostCents > 0 ? 'active_recommendations' : 'none',
    custom_cost_cents: 0,
    total_cost_cents: totalCostCents,
    projected_profit_cents: projectedProfitCents,
    per_attendee_net_cents: perAttendeeNetCents,
    baseline_source: baseline.source,
    baseline_n_events: baseline.nEvents,
    baseline_basis_label: baseline.basisLabel,
  }
}

function buildShoppingList(plan: Plan, recommendations: Recommendation[]) {
  const venueItems = plan.committed_venue_id
    ? [{
        kind: 'venue',
        source: 'committed_quote',
        discovery_id: plan.committed_venue_id,
        price_cents: plan.committed_venue_quoted_price_cents ?? null,
        status: 'committed',
      }]
    : recommendations
      .filter((rec) => rec.type === 'venue')
      .slice(0, 3)
      .map((rec) => recommendationToShoppingItem(rec))
  const vendorCommitments = readCommittedVendors(plan.committed_vendors).map((vendor) => ({
    kind: 'vendor',
    source: 'committed_quote',
    discovery_id: readString(vendor.discovery_vendor_id ?? vendor.vendor_id),
    service_type: readString(vendor.service_type),
    price_cents: readNumber(vendor.quoted_package_cents) ?? readNumber(vendor.quoted_minimum_cents),
    status: 'committed',
  }))
  const vendorRecommendations = vendorCommitments.length > 0
    ? []
    : recommendations
      .filter((rec) => rec.type === 'vendor')
      .slice(0, 6)
      .map((rec) => recommendationToShoppingItem(rec))

  return [...venueItems, ...vendorCommitments, ...vendorRecommendations]
}

function recommendationToShoppingItem(rec: Recommendation) {
  return {
    kind: rec.type,
    source: 'active_recommendation',
    recommendation_id: rec.id,
    reference_id: rec.reference_id,
    name: rec.external_name,
    price_cents: rec.price_cents,
    rank: rec.rank,
    status: rec.status,
  }
}

function buildAuthorizationCards(approvals: Approval[]) {
  return approvals.map((approval) => ({
    id: approval.id,
    action_label: approval.action_label,
    provider: approval.provider,
    status: approval.status,
    price_cents: approval.price_cents,
    fees_cents: approval.fees_cents,
    requested_amount_cents: approval.requested_amount_cents ?? null,
    authorized_amount_cents: approval.authorized_amount_cents ?? null,
    event_date: approval.event_date,
    expires_at: approval.expires_at,
  }))
}

function readCommittedVendors(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = readRecord(item)
        return record ? [record] : []
      })
    : []
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function deepEqual(first: unknown, second: unknown) {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null)
}
