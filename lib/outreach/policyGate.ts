import 'server-only'

import type {
  CreatorOutreachPolicy,
  Json,
  OutreachChannel,
  OutreachNotificationType,
  OutreachPolicyAction,
  OutreachPolicyAuditLog,
  OutreachPolicyDecision,
} from '@/lib/types'

type OutreachDb = { from(table: string): any }

export type PolicyGateContext = {
  planId?: string | null
  threadId?: string | null
  messageId?: string | null
  targetId?: string | null
  targetName?: string | null
  targetType?: string | null
  targetSource?: string | null
  channel?: OutreachChannel | null
  priceCents?: number | null
  budgetCapCents?: number | null
  keywords?: string[]
  bodyText?: string | null
  isFirstContact?: boolean
  followUpCount?: number | null
  inquiriesForPlan?: number | null
  moneyMovement?: boolean
  requiresSignature?: boolean
  legalCommitment?: boolean
  irreversible?: boolean
  now?: Date
  modelName?: string | null
}

export type PolicyGateResult = {
  allowed: boolean
  reason: string
  required_approval_type?: string
  policy?: CreatorOutreachPolicy | null
}

const POLICY_SELECT = `
  id,
  user_id,
  version,
  max_unattended_budget_cents,
  allowed_autonomous_actions,
  quiet_hours_start_local,
  quiet_hours_end_local,
  max_inquiries_per_event,
  max_followups_per_thread,
  blacklisted_venue_ids,
  blacklisted_keywords,
  require_approval_for_first_contact,
  irreversible_autonomous_actions,
  trust_level,
  created_at,
  updated_at
`

const HIGH_STAKES_APPROVAL = 'creator_approval_required'

const REQUIRED_TRUST: Record<OutreachPolicyAction, number> = {
  send_follow_up: 60,
  reply_to_needs_info: 65,
  ask_for_quote: 70,
  first_contact: 75,
  schedule_walkthrough: 75,
  reply_to_price_quote: 80,
  accept_quote_under_cap: 85,
  escalate_channel: 80,
}

const POLICY_ACTIONS = new Set<OutreachPolicyAction>([
  'ask_for_quote',
  'send_follow_up',
  'accept_quote_under_cap',
  'schedule_walkthrough',
  'first_contact',
  'reply_to_needs_info',
  'reply_to_price_quote',
  'escalate_channel',
])

/**
 * Central policy gate for earned outreach autonomy.
 * New creators and creators without explicit allowed actions always receive allowed=false.
 */
export async function canActAutonomously(input: {
  db: OutreachDb
  userId: string
  action: OutreachPolicyAction
  context?: PolicyGateContext
}): Promise<PolicyGateResult> {
  const context = input.context ?? {}
  const policy = await loadLatestOutreachPolicy(input.db, input.userId)
  if (!policy) {
    return blocked('no_policy', 'outreach_policy_required', null)
  }

  if (policy.allowed_autonomous_actions.length === 0) {
    return blocked('autonomy_disabled', 'approval', policy)
  }

  if (!policy.allowed_autonomous_actions.includes(input.action)) {
    return blocked(`action_not_allowed:${input.action}`, 'approval', policy)
  }

  if ((input.action === 'first_contact' || context.isFirstContact) && policy.require_approval_for_first_contact) {
    return blocked('first_contact_requires_approval', 'first_contact_approval', policy)
  }

  if (isHighStakesContext(context)) {
    return blocked('high_stakes_action_requires_creator', HIGH_STAKES_APPROVAL, policy)
  }

  if (context.irreversible && !policy.irreversible_autonomous_actions.includes(input.action)) {
    return blocked('irreversible_action_not_consented', HIGH_STAKES_APPROVAL, policy)
  }

  const requiredTrust = REQUIRED_TRUST[input.action] ?? 100
  if (policy.trust_level < requiredTrust) {
    return blocked(`trust_level_below_${requiredTrust}`, 'trust_upgrade_or_approval', policy)
  }

  if (isInsideQuietHours(policy, context.now ?? new Date())) {
    return blocked('quiet_hours', 'approval_after_quiet_hours', policy)
  }

  const effectivePrice = context.priceCents ?? null
  if (effectivePrice !== null && effectivePrice > policy.max_unattended_budget_cents) {
    return blocked('price_above_unattended_budget_cap', 'quote_approval', policy)
  }

  if (policy.max_followups_per_thread > 0 && (context.followUpCount ?? 0) > policy.max_followups_per_thread) {
    return blocked('max_followups_per_thread_reached', 'follow_up_approval', policy)
  }

  if (policy.max_inquiries_per_event > 0 && (context.inquiriesForPlan ?? 0) > policy.max_inquiries_per_event) {
    return blocked('max_inquiries_per_event_reached', 'inquiry_approval', policy)
  }

  if (context.targetId && policy.blacklisted_venue_ids.includes(context.targetId)) {
    return blocked('target_blacklisted', 'approval', policy)
  }

  if (matchesBlacklistedKeyword(policy, context)) {
    return blocked('blacklisted_keyword', 'approval', policy)
  }

  return { allowed: true, reason: 'allowed_by_creator_policy', policy }
}

export async function loadLatestOutreachPolicy(
  db: OutreachDb,
  userId: string
): Promise<CreatorOutreachPolicy | null> {
  const { data, error } = await db
    .from('creator_outreach_policies')
    .select(POLICY_SELECT)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(error.message ?? 'Failed to load outreach autonomy policy')
  }

  return data ? normalizePolicy(data as Record<string, unknown>) : null
}

export async function recordPolicyDecision(input: {
  db: OutreachDb
  userId: string
  action: OutreachPolicyAction | string
  decision: OutreachPolicyDecision
  reason: string
  policy?: CreatorOutreachPolicy | null
  context?: PolicyGateContext
  result?: Record<string, unknown>
  reversibleUntil?: string | null
  humanIntervened?: boolean
}) {
  const context = input.context ?? {}
  const { data, error } = await input.db
    .from('outreach_policy_audit_logs')
    .insert({
      user_id: input.userId,
      thread_id: context.threadId ?? null,
      message_id: context.messageId ?? null,
      policy_id: input.policy?.id ?? null,
      policy_version: input.policy?.version ?? null,
      action: input.action,
      decision: input.decision,
      reason: input.reason,
      required_approval_type: input.result?.required_approval_type ?? null,
      model_name: context.modelName ?? null,
      human_intervened: input.humanIntervened ?? false,
      context_json: serializeContext(context) as Json,
      result_json: input.result ?? {},
      reversible_until: input.reversibleUntil ?? null,
    })
    .select('*')
    .single()

  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(error.message ?? 'Failed to record outreach policy decision')
  }

  return data as OutreachPolicyAuditLog
}

export async function createOutreachNotification(input: {
  db: OutreachDb
  userId: string
  threadId?: string | null
  notificationType: OutreachNotificationType
  payload?: Record<string, unknown>
}) {
  const { data, error } = await input.db
    .from('outreach_notifications')
    .insert({
      user_id: input.userId,
      thread_id: input.threadId ?? null,
      notification_type: input.notificationType,
      payload_json: input.payload ?? {},
    })
    .select('id')
    .single()

  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(error.message ?? 'Failed to create outreach notification')
  }

  return data as { id: string }
}

export function isOutreachPolicyAction(value: string): value is OutreachPolicyAction {
  return POLICY_ACTIONS.has(value as OutreachPolicyAction)
}

export function getRequiredTrustLevel(action: OutreachPolicyAction) {
  return REQUIRED_TRUST[action] ?? 100
}

function blocked(reason: string, requiredApprovalType: string, policy: CreatorOutreachPolicy | null): PolicyGateResult {
  return {
    allowed: false,
    reason,
    required_approval_type: requiredApprovalType,
    policy,
  }
}

function isHighStakesContext(context: PolicyGateContext) {
  return Boolean(context.moneyMovement || context.requiresSignature || context.legalCommitment)
}

function matchesBlacklistedKeyword(policy: CreatorOutreachPolicy, context: PolicyGateContext) {
  if (policy.blacklisted_keywords.length === 0) return false
  const haystack = [
    context.targetName,
    context.bodyText,
    ...(context.keywords ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return policy.blacklisted_keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
}

function isInsideQuietHours(policy: CreatorOutreachPolicy, now: Date) {
  const start = parseLocalTime(policy.quiet_hours_start_local)
  const end = parseLocalTime(policy.quiet_hours_end_local)
  if (!start || !end) return false
  if (start.minutes === end.minutes) return false

  const current = now.getHours() * 60 + now.getMinutes()
  if (start.minutes < end.minutes) {
    return current >= start.minutes && current < end.minutes
  }

  return current >= start.minutes || current < end.minutes
}

function parseLocalTime(value: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { minutes: hours * 60 + minutes }
}

function normalizePolicy(row: Record<string, unknown>): CreatorOutreachPolicy {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    version: Number(row.version ?? 1),
    max_unattended_budget_cents: Number(row.max_unattended_budget_cents ?? 0),
    allowed_autonomous_actions: readPolicyActions(row.allowed_autonomous_actions),
    quiet_hours_start_local: readNullableString(row.quiet_hours_start_local),
    quiet_hours_end_local: readNullableString(row.quiet_hours_end_local),
    max_inquiries_per_event: Number(row.max_inquiries_per_event ?? 0),
    max_followups_per_thread: Number(row.max_followups_per_thread ?? 0),
    blacklisted_venue_ids: readStringArray(row.blacklisted_venue_ids),
    blacklisted_keywords: readStringArray(row.blacklisted_keywords),
    require_approval_for_first_contact: row.require_approval_for_first_contact !== false,
    irreversible_autonomous_actions: readPolicyActions(row.irreversible_autonomous_actions),
    trust_level: Number(row.trust_level ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function readPolicyActions(value: unknown): OutreachPolicyAction[] {
  return readStringArray(value).filter(isOutreachPolicyAction)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function serializeContext(context: PolicyGateContext) {
  return {
    ...context,
    now: context.now?.toISOString(),
  }
}

function isMissingTableError(error: { code?: string; message?: string }) {
  return error.code === '42P01' || /does not exist/i.test(error.message ?? '')
}
