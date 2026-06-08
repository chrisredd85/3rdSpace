import {
  isIrreversibleOutreachAction,
  normalizeOutreachAutonomyPolicy,
  type OutreachAutonomousAction,
  type OutreachAutonomyPolicy,
} from '@/lib/outreach/autonomy'

export type OutreachEvalGateStatus = {
  passed: boolean
  checked_at: string | null
  reply_classifier_accuracy: number | null
  outreach_scenario_pass_rate: number | null
}

export type OutreachPolicyGateInput = {
  policy?: OutreachAutonomyPolicy | null
  action: OutreachAutonomousAction
  is_first_contact?: boolean
  eval_gate?: OutreachEvalGateStatus | null
  message_text?: string | null
  target_venue_id?: string | null
}

export type OutreachPolicyGateDecision = {
  execution_mode: 'approval_required' | 'autonomous_allowed'
  allowed: boolean
  requires_approval: boolean
  reasons: string[]
}

export function evaluateOutreachPolicyGate(input: OutreachPolicyGateInput): OutreachPolicyGateDecision {
  const policy = normalizeOutreachAutonomyPolicy(input.policy)
  const reasons: string[] = []

  if (!input.eval_gate?.passed) reasons.push('outreach_eval_gate_not_passed')
  if (!policy.allowed_autonomous_actions.includes(input.action)) reasons.push('action_not_explicitly_allowed')
  if (isIrreversibleOutreachAction(input.action)) reasons.push('irreversible_action_requires_approval')
  if (input.is_first_contact && policy.require_approval_for_first_contact) reasons.push('first_contact_requires_approval')
  if (hasBlacklistedKeyword(input.message_text, policy.blacklisted_keywords)) reasons.push('blacklisted_keyword')
  if (input.target_venue_id && policy.blacklisted_venue_ids.includes(input.target_venue_id)) reasons.push('blacklisted_venue')

  if (reasons.length > 0) {
    return {
      execution_mode: 'approval_required',
      allowed: false,
      requires_approval: true,
      reasons,
    }
  }

  return {
    execution_mode: 'autonomous_allowed',
    allowed: true,
    requires_approval: false,
    reasons: [],
  }
}

function hasBlacklistedKeyword(message: string | null | undefined, keywords: string[]) {
  if (!message || keywords.length === 0) return false
  const normalized = message.toLowerCase()
  return keywords.some((keyword) => keyword.trim() && normalized.includes(keyword.trim().toLowerCase()))
}
