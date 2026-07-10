import type { Json, Plan, PlanRevisionTriggerType } from '@/lib/types'
import { canonicalCity, deriveEventCity, getAdjacentCities } from '@/lib/planner/geography'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { rootLogger } from '@/lib/server/logger'

export type SupabaseAdminClient = {
  from: (table: string) => any
  rpc?: (fn: string, args?: Record<string, unknown>) => any
}

export type PlanRevisionTrigger = {
  type: PlanRevisionTriggerType
  field: string
  value: unknown
  source_message_excerpt?: string
  /**
   * The real actor when a service-owned cascade applies a revision on behalf
   * of the plan owner. `userId` remains the ownership identity required by the
   * database RPC; this field preserves who caused the change in trigger audit
   * data without weakening the owner check.
   */
  actor_id?: string | null
  actor_source?: string | null
}

export type PlanRevisionBriefSection =
  | 'event_summary'
  | 'venue_area'
  | 'vendor_stack'
  | 'budget'
  | 'costs'
  | 'projections'
  | 'analytics'
  | 'recommendations'
  | 'approvals'
  | 'outreach'

export type PlanRevisionImpact = {
  invalidated_recommendation_ids: string[]
  superseded_approval_ids: string[]
  superseded_outreach_thread_ids: string[]
  flagged_committed_ids: string[]
  triggers_rediscovery: string[]
  event_brief_sections: PlanRevisionBriefSection[]
}

export async function applyPlanRevision(opts: {
  supabase: SupabaseAdminClient
  baselineSupabase?: SupabaseAdminClient
  planId: string
  userId: string
  trigger: PlanRevisionTrigger
  sourceMessageId?: string
}): Promise<{ revision_id: string; impact: PlanRevisionImpact }> {
  const plan = await loadPlan(opts.supabase, opts.planId)
  if (!plan) throw new Error('Plan not found')

  const impact = await computeRevisionImpact({
    supabase: opts.supabase,
    plan,
    trigger: opts.trigger,
  })
  const nextRevisionCount = (plan.plan_revision_count ?? 0) + 1
  const planUpdates = buildPlanRevisionUpdates(plan, opts.trigger, nextRevisionCount, impact)

  if (!opts.supabase.rpc) {
    throw new Error('Plan revision RPC client is unavailable')
  }

  const { data, error } = await opts.supabase
    .rpc('apply_plan_revision_atomic', {
      p_plan_id: opts.planId,
      p_user_id: opts.userId,
      p_trigger: opts.trigger as unknown as Json,
      p_source_message_id: opts.sourceMessageId ?? null,
      p_plan_updates: planUpdates as Json,
      p_impact: impact as unknown as Json,
      p_reason: revisionReason(opts.trigger),
    })

  if (error) throw new Error(`Revision failed: ${error.message}`)

  const resultRow = readRecord(Array.isArray(data) ? data[0] : data)
  const revisionId = readString(resultRow?.revision_id)
  if (!revisionId) throw new Error('Revision RPC did not return a revision id')

  try {
    await triggerRediscovery({
      supabase: opts.supabase,
      planId: opts.planId,
      revisionId,
      trigger: opts.trigger,
      targets: impact.triggers_rediscovery,
      eventBriefSections: impact.event_brief_sections,
    })
  } catch (error) {
    rootLogger.warn('Plan revision rediscovery enqueue failed', {
      plan_id: opts.planId,
      revision_id: revisionId,
      trigger_type: opts.trigger.type,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  await recomputePlanDerivedState({
    supabase: opts.supabase,
    baselineSupabase: opts.baselineSupabase,
    planId: opts.planId,
    trigger: 'plan_revision',
    revisionId,
  })

  return { revision_id: revisionId, impact }
}

export function detectPlanRevisionTrigger(input: {
  plan: Pick<Plan, 'event_type' | 'guest_count' | 'budget_cap_cents' | 'neighborhood' | 'date_window_start' | 'date_window_end' | 'status'>
  message: string
}): PlanRevisionTrigger | null {
  if (!hasMaterialPlanState(input.plan)) return null
  const message = input.message.trim()
  const normalized = message.toLowerCase()

  const negativeCuisine = matchNegativeCuisine(normalized)
  if (negativeCuisine) {
    return {
      type: 'negative_preference',
      field: 'excluded_cuisines',
      value: [negativeCuisine],
      source_message_excerpt: message,
    }
  }

  const removedService = matchRemovedVendorService(normalized)
  if (removedService) {
    return {
      type: 'vendor_stack_removal',
      field: 'service_type',
      value: removedService,
      source_message_excerpt: message,
    }
  }

  const addedService = matchAddedVendorService(normalized)
  if (addedService) {
    return {
      type: 'vendor_stack_addition',
      field: 'service_type',
      value: addedService,
      source_message_excerpt: message,
    }
  }

  if (/\b(black-owned|women-owned|queer-owned|local vendors?|deliver|delivery|full service|staffed)\b/i.test(message)) {
    return {
      type: 'positive_preference',
      field: 'vendor_attributes',
      value: message,
      source_message_excerpt: message,
    }
  }

  return null
}

export async function computeRevisionImpact(opts: {
  supabase: SupabaseAdminClient
  plan: Plan
  trigger: PlanRevisionTrigger
}): Promise<PlanRevisionImpact> {
  const [recommendationIds, approvalIds, outreachThreads] = await Promise.all([
    loadActiveRecommendationIds(opts.supabase, opts.plan.id),
    loadActiveApprovalIds(opts.supabase, opts.plan.id),
    loadActiveOutreachThreads(opts.supabase, opts.plan.id),
  ])

  return {
    invalidated_recommendation_ids: recommendationIds,
    superseded_approval_ids: approvalIds,
    superseded_outreach_thread_ids: outreachThreads.map((thread) => thread.id),
    flagged_committed_ids: readCommittedEntityIds(opts.plan),
    triggers_rediscovery: deriveRediscoveryTargets(opts.trigger),
    event_brief_sections: deriveEventBriefSections(opts.trigger),
  }
}

export async function supersedeAffectedEntities(opts: {
  supabase: SupabaseAdminClient
  planId: string
  revisionId: string
  impact: PlanRevisionImpact
  reason: string
}): Promise<void> {
  const supersededAt = new Date().toISOString()
  await Promise.all([
    supersedeRecommendations(opts.supabase, opts.impact.invalidated_recommendation_ids, opts.revisionId, supersededAt, opts.reason),
    supersedeApprovals(opts.supabase, opts.impact.superseded_approval_ids, opts.revisionId, supersededAt, opts.reason),
    supersedeOutreachThreads(opts.supabase, opts.impact.superseded_outreach_thread_ids, opts.revisionId, supersededAt, opts.reason),
    markApprovalMessagesSuperseded(opts.supabase, opts.planId, opts.impact.superseded_approval_ids, opts.revisionId, supersededAt, opts.reason),
  ])
}

export async function triggerRediscovery(opts: {
  supabase: SupabaseAdminClient
  planId: string
  revisionId: string
  trigger: PlanRevisionTrigger
  targets: string[]
  eventBriefSections: PlanRevisionBriefSection[]
}): Promise<{ job_ids: string[] }> {
  if (opts.targets.length === 0) return { job_ids: [] }
  if (await hasRecentRediscovery(opts.supabase, opts.planId, opts.revisionId)) return { job_ids: [] }

  const { data, error } = await opts.supabase
    .from('plan_messages')
    .insert({
      plan_id: opts.planId,
      role: 'agent',
      content: buildRediscoveryMessage(opts.trigger, opts.targets),
      message_type: 'status_update',
      metadata: {
        reason: 'plan_revision_rediscovery_requested',
        revision_id: opts.revisionId,
        rediscovery_targets: opts.targets,
        event_brief_sections: opts.eventBriefSections,
        refreshes_event_brief: true,
        requires_recommendation_refresh: true,
      } as Json,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[planner.revisions] Rediscovery status message insert failed', error)
    return { job_ids: [] }
  }

  return { job_ids: data?.id ? [String(data.id)] : [] }
}

async function loadPlan(db: SupabaseAdminClient, planId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(`
      id,
      user_id,
      title,
      event_type,
      status,
      guest_count,
      budget_cap_cents,
      neighborhood,
      event_city,
      date_window_start,
      date_window_end,
      ticketed,
      ticketing_model,
      food_responsibility,
      venue_terms,
      agent_action,
      profit_goal_cents,
      notes,
      committed_venue_id,
      committed_vendors,
      excluded_cuisines,
      excluded_vendor_attributes,
      preferred_vendor_attributes,
      vendor_same_city_required,
      vendor_out_of_city_approved,
      vendor_approved_adjacent_cities,
      special_supply_radius_miles,
      plan_revision_count,
      metadata,
      created_at,
      updated_at
    `)
    .eq('id', planId)
    .maybeSingle()

  if (error) {
    console.error('[planner.revisions] Plan lookup failed', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadActiveRecommendationIds(db: SupabaseAdminClient, planId: string): Promise<string[]> {
  const { data, error } = await db
    .from('recommendations')
    .select('id')
    .eq('plan_id', planId)
    .in('status', ['pending', 'selected'])

  if (error) {
    console.error('[planner.revisions] Active recommendation lookup failed', error)
    return []
  }

  return ((data ?? []) as Array<{ id?: unknown }>).map((row) => readString(row.id)).filter(isString)
}

async function loadActiveApprovalIds(db: SupabaseAdminClient, planId: string): Promise<string[]> {
  const { data, error } = await db
    .from('approvals')
    .select('id')
    .eq('plan_id', planId)
    .in('status', ['pending', 'approved', 'authorized'])

  if (error) {
    console.error('[planner.revisions] Active approval lookup failed', error)
    return []
  }

  return ((data ?? []) as Array<{ id?: unknown }>).map((row) => readString(row.id)).filter(isString)
}

async function loadActiveOutreachThreads(
  db: SupabaseAdminClient,
  planId: string
): Promise<Array<{ id: string; state: string }>> {
  const { data, error } = await db
    .from('outreach_threads')
    .select('id, state')
    .eq('plan_id', planId)
    .in('state', ['draft', 'awaiting_reply', 'in_negotiation'])

  if (error) {
    console.error('[planner.revisions] Outreach thread lookup failed', error)
    return []
  }

  return ((data ?? []) as Array<{ id?: unknown; state?: unknown }>)
    .map((row) => ({ id: readString(row.id), state: readString(row.state) }))
    .filter((row): row is { id: string; state: string } => Boolean(row.id && row.state))
}

function buildPlanRevisionUpdates(
  plan: Plan,
  trigger: PlanRevisionTrigger,
  nextRevisionCount: number,
  impact: PlanRevisionImpact
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    plan_revision_count: nextRevisionCount,
    metadata: mergeRevisionMetadata(plan.metadata, trigger, impact),
  }

  if (trigger.type === 'negative_preference') {
    if (trigger.field === 'excluded_cuisines' || /cuisine|food|taco|menu/i.test(trigger.field)) {
      updates.excluded_cuisines = mergeStringArrays(plan.excluded_cuisines, coerceStringArray(trigger.value))
    } else {
      updates.excluded_vendor_attributes = mergeAttributeValue(plan.excluded_vendor_attributes, trigger.field, trigger.value)
    }
  }

  if (trigger.type === 'positive_preference') {
    updates.preferred_vendor_attributes = mergeAttributeValue(plan.preferred_vendor_attributes, trigger.field, trigger.value)
    if (trigger.field === 'vendor_out_of_city_approved') {
      updates.vendor_out_of_city_approved = true
      updates.vendor_approved_adjacent_cities = mergeStringArrays(
        plan.vendor_approved_adjacent_cities ?? [],
        readAdjacentCitiesFromTrigger(plan, trigger)
      )
    }
  }

  if (trigger.type === 'vendor_stack_addition') {
    updates.preferred_vendor_attributes = mergeAttributeValue(
      updates.preferred_vendor_attributes ?? plan.preferred_vendor_attributes,
      'service_types',
      coerceStringArray(trigger.value)
    )
    const vendorRequest = readRecord(trigger.value)
    const vendorCity = canonicalCity(readString(vendorRequest?.vendor_city) ?? readString(vendorRequest?.city))
    if (trigger.field === 'specific_vendor' && vendorCity) {
      updates.vendor_out_of_city_approved = true
      updates.vendor_approved_adjacent_cities = mergeStringArrays(plan.vendor_approved_adjacent_cities ?? [], [vendorCity])
      updates.preferred_vendor_attributes = mergeAttributeValue(
        updates.preferred_vendor_attributes,
        'specific_vendor',
        trigger.value
      )
    }
  }

  if (trigger.type === 'vendor_stack_removal') {
    updates.excluded_vendor_attributes = mergeAttributeValue(
      updates.excluded_vendor_attributes ?? plan.excluded_vendor_attributes,
      'service_types',
      coerceStringArray(trigger.value)
    )
  }

  if (trigger.type === 'date_change') {
    const dateValue = readString(trigger.value) ?? readString(readRecord(trigger.value)?.date)
    const start = readString(readRecord(trigger.value)?.start) ?? dateValue
    const end = readString(readRecord(trigger.value)?.end) ?? start
    if (start) updates.date_window_start = start
    if (end) updates.date_window_end = end
  }

  if (trigger.type === 'guest_count_change') {
    const count = readNumber(trigger.value)
    if (typeof count === 'number') updates.guest_count = count
  }

  if (trigger.type === 'budget_change') {
    const budget = readNumber(trigger.value)
    if (typeof budget === 'number') updates.budget_cap_cents = budget
  }

  if (trigger.type === 'venue_swap') {
    const area = readString(trigger.value) ?? readString(readRecord(trigger.value)?.neighborhood) ?? readString(readRecord(trigger.value)?.city)
    if (area) updates.neighborhood = area
    const eventCity = deriveEventCity(area)
    if (eventCity) updates.event_city = eventCity
  }

  return updates
}

async function supersedeRecommendations(
  db: SupabaseAdminClient,
  recommendationIds: string[],
  revisionId: string,
  supersededAt: string,
  reason: string
) {
  if (recommendationIds.length === 0) return
  const { error } = await db
    .from('recommendations')
    .update({
      status: 'superseded',
      superseded_at: supersededAt,
      superseded_by_revision_id: revisionId,
      metadata: {
        superseded_reason: reason,
        superseded_at: supersededAt,
        superseded_by_revision_id: revisionId,
      } as Json,
    })
    .in('id', recommendationIds)

  if (error) console.error('[planner.revisions] Recommendation supersession failed', error)
}

async function supersedeApprovals(
  db: SupabaseAdminClient,
  approvalIds: string[],
  revisionId: string,
  supersededAt: string,
  reason: string
) {
  if (approvalIds.length === 0) return
  const { error } = await db
    .from('approvals')
    .update({
      status: 'superseded',
      superseded_at: supersededAt,
      superseded_by_revision_id: revisionId,
      superseded_reason: reason,
    })
    .in('id', approvalIds)
    .in('status', ['pending', 'approved', 'authorized'])

  if (error) console.error('[planner.revisions] Approval supersession failed', error)
}

async function supersedeOutreachThreads(
  db: SupabaseAdminClient,
  threadIds: string[],
  revisionId: string,
  supersededAt: string,
  reason: string
) {
  if (threadIds.length === 0) return
  const { error: draftError } = await db
    .from('outreach_threads')
    .update({
      state: 'cancelled',
      needs_attention: true,
      last_event_at: supersededAt,
    })
    .in('id', threadIds)
    .eq('state', 'draft')

  if (draftError) console.error('[planner.revisions] Draft outreach cancellation failed', draftError)

  const { error: sentError } = await db
    .from('outreach_threads')
    .update({
      state: 'stale',
      needs_attention: true,
      last_event_at: supersededAt,
    })
    .in('id', threadIds)
    .in('state', ['awaiting_reply', 'in_negotiation'])

  if (sentError) console.error('[planner.revisions] Sent outreach stale mark failed', sentError)

  await insertOutreachSupersessionMessages(db, threadIds, revisionId, supersededAt, reason)
}

async function insertOutreachSupersessionMessages(
  db: SupabaseAdminClient,
  threadIds: string[],
  revisionId: string,
  supersededAt: string,
  reason: string
) {
  if (threadIds.length === 0) return
  const rows = threadIds.map((threadId) => ({
    thread_id: threadId,
    direction: 'outbound',
    subject: 'Plan update superseded this outreach',
    body_text: reason,
    headers_json: {
      system_event: 'plan_revision_superseded',
      revision_id: revisionId,
      superseded_at: supersededAt,
    },
  }))

  const { error } = await db.from('outreach_messages').insert(rows)
  if (error) console.error('[planner.revisions] Outreach supersession message insert failed', error)
}

async function markApprovalMessagesSuperseded(
  db: SupabaseAdminClient,
  planId: string,
  approvalIds: string[],
  revisionId: string,
  supersededAt: string,
  reason: string
) {
  if (approvalIds.length === 0) return
  const { data, error } = await db
    .from('plan_messages')
    .select('id, metadata')
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')

  if (error) {
    console.error('[planner.revisions] Approval message lookup failed', error)
    return
  }

  await Promise.all(((data ?? []) as Array<{ id: string; metadata: unknown }>).map(async (message) => {
    const metadata = readRecord(message.metadata)
    const approval = readRecord(metadata?.approval)
    const approvalId = readString(approval?.id) ?? readString(metadata?.approval_id)
    if (!approvalId || !approvalIds.includes(approvalId)) return

    const nextMetadata = {
      ...metadata,
      status: 'superseded',
      superseded_at: supersededAt,
      superseded_by_revision_id: revisionId,
      superseded_reason: reason,
      approval: approval ? {
        ...approval,
        status: 'superseded',
        superseded_at: supersededAt,
        superseded_by_revision_id: revisionId,
        superseded_reason: reason,
      } : approval,
    } as Json

    const { error: updateError } = await db
      .from('plan_messages')
      .update({ metadata: nextMetadata })
      .eq('id', message.id)

    if (updateError) console.error('[planner.revisions] Approval message supersession failed', updateError)
  }))
}

async function hasRecentRediscovery(db: SupabaseAdminClient, planId: string, currentRevisionId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { data, error } = await db
    .from('plan_revisions')
    .select('id')
    .eq('plan_id', planId)
    .neq('id', currentRevisionId)
    .gte('applied_at', since)
    .not('rediscovery_triggered_for', 'eq', '{}')
    .limit(1)

  if (error) {
    console.error('[planner.revisions] Rediscovery debounce lookup failed', error)
    return false
  }

  return Array.isArray(data) && data.length > 0
}

function mergeRevisionMetadata(value: unknown, trigger: PlanRevisionTrigger, impact: PlanRevisionImpact): Json {
  const metadata = readRecord(value) ?? {}
  const revisions = Array.isArray(metadata.plan_revision_triggers)
    ? metadata.plan_revision_triggers.slice(-9)
    : []
  const appliedAt = new Date().toISOString()

  return {
    ...metadata,
    latest_plan_revision: {
      type: trigger.type,
      field: trigger.field,
      value: trigger.value,
      source_message_excerpt: trigger.source_message_excerpt ?? null,
      event_brief_sections: impact.event_brief_sections,
      impact_summary: impact,
      refreshes_event_brief: true,
      applied_at: appliedAt,
    },
    event_brief_refresh: {
      revision_type: trigger.type,
      revision_field: trigger.field,
      sections: impact.event_brief_sections,
      last_refreshed_at: appliedAt,
      stale_recommendation_ids: impact.invalidated_recommendation_ids,
      superseded_approval_ids: impact.superseded_approval_ids,
      stale_outreach_thread_ids: impact.superseded_outreach_thread_ids,
    },
    plan_revision_triggers: [
      ...revisions,
      {
        type: trigger.type,
        field: trigger.field,
        value: trigger.value,
        source_message_excerpt: trigger.source_message_excerpt ?? null,
        event_brief_sections: impact.event_brief_sections,
      },
    ],
  } as Json
}

function readCommittedEntityIds(plan: Plan): string[] {
  const ids = new Set<string>()
  const planRecord = plan as unknown as Record<string, unknown>
  const venueId = readString(planRecord.committed_venue_id)
  if (venueId) ids.add(`venue:${venueId}`)

  const committedVendors = planRecord.committed_vendors
  if (Array.isArray(committedVendors)) {
    for (const vendor of committedVendors) {
      const record = readRecord(vendor)
      const id = readString(record?.vendor_id) ?? readString(record?.id)
      if (id) ids.add(`vendor:${id}`)
    }
  }

  return Array.from(ids)
}

function deriveRediscoveryTargets(trigger: PlanRevisionTrigger): string[] {
  if (trigger.type === 'discovery_data_changed') return ['venue', 'vendor']
  if (trigger.type === 'venue_swap') return ['venue', 'vendor']
  if (trigger.type === 'date_change' || trigger.type === 'guest_count_change' || trigger.type === 'budget_change') {
    return ['venue', 'vendor']
  }
  if (trigger.type === 'scope_change') return ['venue', 'vendor']

  const serviceTypes = extractServiceTypes(trigger.value)
  if (serviceTypes.length > 0) return serviceTypes
  if (/cuisine|food|menu|taco|cater/i.test(trigger.field)) return ['catering']
  if (/flower|flor/i.test(`${trigger.field} ${JSON.stringify(trigger.value)}`)) return ['florist']

  return ['vendor']
}

export function deriveEventBriefSections(trigger: PlanRevisionTrigger): PlanRevisionBriefSection[] {
  const sections = new Set<PlanRevisionBriefSection>([
    'event_summary',
    'recommendations',
    'approvals',
    'projections',
    'analytics',
  ])

  if (trigger.type === 'date_change') {
    sections.add('outreach')
    sections.add('costs')
  }

  if (trigger.type === 'guest_count_change') {
    sections.add('budget')
    sections.add('costs')
    sections.add('vendor_stack')
  }

  if (trigger.type === 'budget_change') {
    sections.add('budget')
    sections.add('costs')
  }

  if (trigger.type === 'venue_swap') {
    sections.add('venue_area')
    sections.add('costs')
    sections.add('outreach')
  }

  if (
    trigger.type === 'negative_preference' ||
    trigger.type === 'positive_preference' ||
    trigger.type === 'vendor_stack_addition' ||
    trigger.type === 'vendor_stack_removal' ||
    trigger.type === 'scope_change' ||
    trigger.type === 'discovery_data_changed'
  ) {
    sections.add('vendor_stack')
    sections.add('costs')
  }

  return Array.from(sections)
}

function hasMaterialPlanState(plan: Pick<Plan, 'event_type' | 'guest_count' | 'budget_cap_cents' | 'neighborhood' | 'date_window_start' | 'date_window_end' | 'status'>): boolean {
  if (plan.status !== 'drafting') return true
  return Boolean(plan.event_type || plan.guest_count || plan.budget_cap_cents || plan.neighborhood || plan.date_window_start || plan.date_window_end)
}

function matchNegativeCuisine(value: string): string | null {
  if (!/\b(no|not|don't want|do not want|exclude|avoid|skip)\b/.test(value)) return null
  if (/\btacos?\b/.test(value)) return 'tacos'
  if (/\bmexican\b/.test(value)) return 'Mexican'
  if (/\bpizza\b/.test(value)) return 'pizza'
  if (/\bsushi\b/.test(value)) return 'sushi'
  if (/\balcohol\b|\bbeer\b|\bwine\b|\bbar\b/.test(value)) return 'alcohol'
  return null
}

function matchAddedVendorService(value: string): string | null {
  if (!/\b(need|want|add|include|bring in|source|find|book)\b/.test(value)) return null
  if (/\bflowers?|florist|floral\b/.test(value)) return 'florist'
  if (/\blighting|lights?\b/.test(value)) return 'lighting'
  if (/\bsecurity|guard\b/.test(value)) return 'security'
  if (/\bphotographer|photo\b/.test(value)) return 'photographer'
  if (/\bvideographer|video\b/.test(value)) return 'videographer'
  if (/\bdj\b/.test(value)) return 'dj'
  if (/\bcater|food|taco|menu\b/.test(value)) return 'catering'
  return null
}

function matchRemovedVendorService(value: string): string | null {
  if (!/\b(no|not|don't want|do not want|remove|skip|drop|cancel)\b/.test(value)) return null
  if (/\bflowers?|florist|floral\b/.test(value)) return 'florist'
  if (/\bphotographer|photo\b/.test(value)) return 'photographer'
  if (/\bvideographer|video\b/.test(value)) return 'videographer'
  if (/\bdj\b/.test(value)) return 'dj'
  if (/\bcater|food|taco|menu\b/.test(value)) return 'catering'
  return null
}

function extractServiceTypes(value: unknown): string[] {
  const record = readRecord(value)
  const direct = [
    readString(record?.service_type),
    readString(record?.vendor_service_type),
    readString(value),
  ].filter(isString)
  if (direct.length > 0) return direct.map(normalizeServiceType)

  return coerceStringArray(value).map(normalizeServiceType)
}

function normalizeServiceType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (/\bflower|florist|floral\b/.test(normalized)) return 'florist'
  if (/\btaco|food|cater|cuisine|menu\b/.test(normalized)) return 'catering'
  if (/\bphoto|photographer\b/.test(normalized)) return 'photographer'
  if (/\bvideo|videographer\b/.test(normalized)) return 'videographer'
  if (/\blight|lighting\b/.test(normalized)) return 'lighting'
  return normalized.replace(/[\s-]+/g, '_')
}

function revisionReason(trigger: PlanRevisionTrigger): string {
  if (trigger.source_message_excerpt) {
    return `Superseded by plan update: ${trigger.source_message_excerpt}`
  }
  return `Superseded by ${trigger.type.replace(/_/g, ' ')} update`
}

function buildRediscoveryMessage(trigger: PlanRevisionTrigger, targets: string[]): string {
  const targetText = targets.includes('venue') && targets.includes('vendor')
    ? 'venues and vendors'
    : targets.join(', ')
  const source = trigger.source_message_excerpt
    ? `: ${trigger.source_message_excerpt}`
    : '.'
  return `Plan updated${source} I’m refreshing ${targetText} against the current brief.`
}

function mergeAttributeValue(value: unknown, field: string, nextValue: unknown): Json {
  const record = { ...(readRecord(value) ?? {}) }
  const values = mergeStringArrays(coerceStringArray(record[field]), coerceStringArray(nextValue))
  record[field] = values.length === 1 ? values[0] : values
  return record as Json
}

function mergeStringArrays(existing: unknown, additions: unknown): string[] {
  const values = new Set<string>()
  for (const item of [...coerceStringArray(existing), ...coerceStringArray(additions)]) {
    const trimmed = item.trim()
    if (trimmed) values.add(trimmed)
  }
  return Array.from(values)
}

function readAdjacentCitiesFromTrigger(plan: Plan, trigger: PlanRevisionTrigger): string[] {
  const record = readRecord(trigger.value)
  const direct = coerceStringArray(record?.adjacent_cities ?? record?.cities)
  if (direct.length > 0) return direct
  const scalarCity = canonicalCity(readString(trigger.value))
  if (scalarCity) return [scalarCity]
  return getAdjacentCities(plan.event_city ?? deriveEventCity(plan.neighborhood))
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(coerceStringArray)
  }
  const record = readRecord(value)
  if (record) {
    const direct = readString(record.value) ?? readString(record.label) ?? readString(record.name) ?? readString(record.service_type)
    if (direct) return [direct]
    return Object.values(record).flatMap(coerceStringArray)
  }
  const text = readString(value)
  return text ? [text] : []
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '').toLowerCase()
    const numberValue = normalized.endsWith('k')
      ? Number.parseFloat(normalized) * 1000
      : Number.parseFloat(normalized)
    return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : null
  }
  return null
}

function isString(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}
