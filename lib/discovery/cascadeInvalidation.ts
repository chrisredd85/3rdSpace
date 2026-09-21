import 'server-only'

import type { Json } from '@/lib/types'
import { applyPlanRevision, type SupabaseAdminClient } from '@/lib/planner/planRevisions'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { recordDiscoveryNotificationIfAllowed } from '@/lib/discovery/notificationRateLimit'

export type DiscoveryEntityType = 'discovery_venue' | 'discovery_vendor'

export type DiscoveryCascadeImpact = {
  invalidated_recommendation_ids: string[]
  flagged_commitment_ids: string[]
  superseded_outreach_thread_ids: string[]
  notifications_to_send: Array<{
    user_id: string
    type: 'thread_stale'
    context: Record<string, unknown>
  }>
}

type CascadeInput = {
  supabase: SupabaseAdminClient
  entityType: DiscoveryEntityType
  entityId: string
  changedField: string
  newValue: unknown
  actorId?: string | null
  source?: string | null
}

type PlanRef = {
  plan_id: string
  user_id: string
}

type OutreachThreadRef = {
  id: string
  plan_id: string
  user_id: string
}

const ACTIVE_RECOMMENDATION_STATUSES = ['pending', 'selected']
const ACTIVE_OUTREACH_STATES = ['draft', 'awaiting_reply', 'in_negotiation']

export async function cascadeInvalidationForEntityChange(input: CascadeInput): Promise<DiscoveryCascadeImpact> {
  const [recommendationRefs, candidatePlanIds, outreachThreads, committedPlans] = await Promise.all([
    loadRecommendationRefs(input.supabase, input.entityType, input.entityId),
    loadCandidatePlanIds(input.supabase, input.entityType, input.entityId),
    loadOutreachThreadRefs(input.supabase, input.entityType, input.entityId),
    loadCommittedPlanRefs(input.supabase, input.entityType, input.entityId),
  ])

  const impactedPlanIds = uniqueStrings([
    ...recommendationRefs.map((ref) => ref.plan_id),
    ...candidatePlanIds,
    ...outreachThreads.map((thread) => thread.plan_id),
    ...committedPlans.map((plan) => plan.plan_id),
  ])

  const planRefs = await loadPlanRefs(input.supabase, impactedPlanIds)
  const committedPlanSet = new Set(committedPlans.map((plan) => plan.plan_id))
  const flaggedCommitmentIds = committedPlans.map((plan) => `${input.entityType}:${input.entityId}:${plan.plan_id}`)

  await Promise.all([
    markDiscoveryCandidatesSuperseded(input.supabase, input.entityType, input.entityId),
    markOutreachThreadsStale(input.supabase, outreachThreads.map((thread) => thread.id)),
  ])

  for (const plan of planRefs) {
    try {
      await applyPlanRevision({
        supabase: input.supabase,
        writeSupabase: input.supabase,
        planId: plan.plan_id,
        // The revision RPC's p_user_id is the plan ownership identity, not the
        // vendor/admin actor that caused this service-owned cascade. Passing a
        // non-owner here makes the RPC reject the revision and silently leaves
        // stale approval/outreach state behind.
        userId: plan.user_id,
        trigger: {
          type: 'discovery_data_changed',
          field: input.changedField,
          actor_id: input.actorId ?? null,
          actor_source: input.source ?? 'discovery_change',
          value: {
            entity_type: input.entityType,
            entity_id: input.entityId,
            new_value: input.newValue,
            committed_entity_flagged: committedPlanSet.has(plan.plan_id),
          },
          source_message_excerpt: `Discovery data changed: ${input.changedField}`,
        },
      })
    } catch (error) {
      console.error('[discovery.cascade] plan_revision_failed', {
        plan_id: plan.plan_id,
        entity_type: input.entityType,
        entity_id: input.entityId,
        changed_field: input.changedField,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const notifications = uniqueByUserAndPlan(outreachThreads.map((thread) => ({
    user_id: thread.user_id,
    type: 'thread_stale' as const,
    context: {
      plan_id: thread.plan_id,
      thread_id: thread.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      changed_field: input.changedField,
    },
  })))

  await insertOutreachNotifications(input.supabase, notifications, {
    entityType: input.entityType,
    entityId: input.entityId,
    source: input.source ?? 'discovery_change',
  })

  await Promise.all(planRefs.map((plan) =>
    recomputePlanDerivedState({
      supabase: input.supabase,
      writeSupabase: input.supabase,
      planId: plan.plan_id,
      trigger: 'discovery_change',
      discoveryChangeId: `${input.entityType}:${input.entityId}:${input.changedField}`,
    }).catch((error) => {
      console.error('[discovery.cascade] derived_state_recompute_failed', {
        plan_id: plan.plan_id,
        entity_type: input.entityType,
        entity_id: input.entityId,
        changed_field: input.changedField,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  ))

  return {
    invalidated_recommendation_ids: uniqueStrings(recommendationRefs.map((ref) => ref.id)),
    flagged_commitment_ids: flaggedCommitmentIds,
    superseded_outreach_thread_ids: uniqueStrings(outreachThreads.map((thread) => thread.id)),
    notifications_to_send: notifications,
  }
}

async function loadRecommendationRefs(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
): Promise<Array<{ id: string; plan_id: string }>> {
  const type = entityType === 'discovery_venue' ? 'venue' : 'vendor'
  const { data, error } = await db
    .from('recommendations')
    .select('id,plan_id')
    .eq('type', type)
    .eq('reference_id', entityId)
    .in('status', ACTIVE_RECOMMENDATION_STATUSES)

  if (error) {
    console.error('[discovery.cascade] recommendation_lookup_failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({ id: readString(row.id), plan_id: readString(row.plan_id) }))
    .filter((row): row is { id: string; plan_id: string } => Boolean(row.id && row.plan_id))
}

async function loadCandidatePlanIds(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
): Promise<string[]> {
  const table = entityType === 'discovery_venue'
    ? 'plan_discovery_venue_candidates'
    : 'plan_discovery_vendor_candidates'
  const column = entityType === 'discovery_venue' ? 'discovery_venue_id' : 'discovery_vendor_id'
  const { data, error } = await db
    .from(table)
    .select('plan_id')
    .eq(column, entityId)
    .in('status', ['candidate', 'approval_created'])

  if (error) {
    console.error('[discovery.cascade] candidate_lookup_failed', error)
    return []
  }

  return uniqueStrings(((data ?? []) as Array<Record<string, unknown>>).map((row) => readString(row.plan_id)))
}

async function loadOutreachThreadRefs(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
): Promise<OutreachThreadRef[]> {
  const column = entityType === 'discovery_venue' ? 'discovery_venue_id' : 'discovery_vendor_id'
  const { data, error } = await db
    .from('outreach_threads')
    .select('id,plan_id,user_id')
    .eq(column, entityId)
    .in('state', ACTIVE_OUTREACH_STATES)

  if (error) {
    console.error('[discovery.cascade] outreach_thread_lookup_failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({ id: readString(row.id), plan_id: readString(row.plan_id), user_id: readString(row.user_id) }))
    .filter((row): row is OutreachThreadRef => Boolean(row.id && row.plan_id && row.user_id))
}

async function loadCommittedPlanRefs(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
): Promise<PlanRef[]> {
  if (entityType === 'discovery_venue') {
    const { data, error } = await db
      .from('plans')
      .select('id,user_id')
      .eq('committed_venue_id', entityId)
      .limit(200)

    if (error) {
      console.error('[discovery.cascade] committed_venue_lookup_failed', error)
      return []
    }

    return ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({ plan_id: readString(row.id), user_id: readString(row.user_id) }))
      .filter((row): row is PlanRef => Boolean(row.plan_id && row.user_id))
  }

  const { data, error } = await db
    .from('plans')
    .select('id,user_id,committed_vendors')
    .not('committed_vendors', 'is', null)
    .limit(500)

  if (error) {
    console.error('[discovery.cascade] committed_vendor_lookup_failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => committedVendorsContain(row.committed_vendors, entityId))
    .map((row) => ({ plan_id: readString(row.id), user_id: readString(row.user_id) }))
    .filter((row): row is PlanRef => Boolean(row.plan_id && row.user_id))
}

async function loadPlanRefs(db: SupabaseAdminClient, planIds: string[]): Promise<PlanRef[]> {
  const ids = uniqueStrings(planIds)
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('plans')
    .select('id,user_id')
    .in('id', ids)

  if (error) {
    console.error('[discovery.cascade] plan_lookup_failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({ plan_id: readString(row.id), user_id: readString(row.user_id) }))
    .filter((row): row is PlanRef => Boolean(row.plan_id && row.user_id))
}

async function markDiscoveryCandidatesSuperseded(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
) {
  const table = entityType === 'discovery_venue'
    ? 'plan_discovery_venue_candidates'
    : 'plan_discovery_vendor_candidates'
  const column = entityType === 'discovery_venue' ? 'discovery_venue_id' : 'discovery_vendor_id'
  const { error } = await db
    .from(table)
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq(column, entityId)
    .in('status', ['candidate', 'approval_created'])

  if (error) console.error('[discovery.cascade] candidate_supersede_failed', error)
}

async function markOutreachThreadsStale(db: SupabaseAdminClient, threadIds: string[]) {
  const ids = uniqueStrings(threadIds)
  if (ids.length === 0) return

  const now = new Date().toISOString()
  const { error: draftError } = await db
    .from('outreach_threads')
    .update({ state: 'cancelled', needs_attention: true, last_event_at: now })
    .in('id', ids)
    .eq('state', 'draft')

  if (draftError) console.error('[discovery.cascade] draft_thread_cancel_failed', draftError)

  const { error: sentError } = await db
    .from('outreach_threads')
    .update({ state: 'stale', needs_attention: true, last_event_at: now })
    .in('id', ids)
    .in('state', ['awaiting_reply', 'in_negotiation'])

  if (sentError) console.error('[discovery.cascade] thread_stale_mark_failed', sentError)
}

async function insertOutreachNotifications(
  db: SupabaseAdminClient,
  notifications: DiscoveryCascadeImpact['notifications_to_send'],
  context: {
    entityType: DiscoveryEntityType
    entityId: string
    source: string
  }
) {
  if (notifications.length === 0) return
  const allowedNotifications: DiscoveryCascadeImpact['notifications_to_send'] = []

  for (const notification of notifications) {
    const allowed = await recordDiscoveryNotificationIfAllowed({
      db,
      userId: notification.user_id,
      entityType: context.entityType,
      entityId: context.entityId,
      source: context.source,
      notificationType: notification.type,
    })
    if (allowed) allowedNotifications.push(notification)
  }

  if (allowedNotifications.length === 0) return

  const { error } = await db.from('outreach_notifications').insert(allowedNotifications.map((notification) => ({
    user_id: notification.user_id,
    thread_id: readString(notification.context.thread_id),
    notification_type: notification.type,
    payload_json: notification.context as Json,
  })))

  if (error) console.error('[discovery.cascade] notification_insert_failed', error)
}

function committedVendorsContain(value: unknown, entityId: string): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    const record = readRecord(item)
    return readString(record?.vendor_id) === entityId || readString(record?.id) === entityId
  })
}

function uniqueByUserAndPlan(
  notifications: DiscoveryCascadeImpact['notifications_to_send']
): DiscoveryCascadeImpact['notifications_to_send'] {
  const seen = new Set<string>()
  const deduped: DiscoveryCascadeImpact['notifications_to_send'] = []
  for (const notification of notifications) {
    const key = `${notification.user_id}:${notification.context.plan_id}:${notification.context.thread_id}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(notification)
  }
  return deduped
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
