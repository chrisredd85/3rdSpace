import { defaultOutreachAutonomyPolicy, type OutreachAutonomyPolicy } from '@/lib/outreach/autonomy'
import { evaluateOutreachPolicyGate, type OutreachEvalGateStatus } from '@/lib/outreach/policyGate'

const passingEvalGate: OutreachEvalGateStatus = {
  passed: true,
  checked_at: '2026-06-08T00:00:00.000Z',
  reply_classifier_accuracy: 1,
  outreach_scenario_pass_rate: 1,
}

function policy(overrides: Partial<OutreachAutonomyPolicy> = {}): OutreachAutonomyPolicy {
  return {
    ...defaultOutreachAutonomyPolicy,
    ...overrides,
  }
}

describe('evaluateOutreachPolicyGate', () => {
  it('defaults to approval-required when no host policy is configured', () => {
    const decision = evaluateOutreachPolicyGate({
      action: 'send_follow_up',
      eval_gate: passingEvalGate,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.requires_approval).toBe(true)
    expect(decision.reasons).toContain('action_not_explicitly_allowed')
  })

  it('requires eval gates before an explicitly allowed action can run autonomously', () => {
    const decision = evaluateOutreachPolicyGate({
      policy: policy({ allowed_autonomous_actions: ['send_follow_up'] }),
      action: 'send_follow_up',
      eval_gate: { ...passingEvalGate, passed: false },
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('outreach_eval_gate_not_passed')
  })

  it('allows a reversible follow-up only when policy and eval gates both pass', () => {
    const decision = evaluateOutreachPolicyGate({
      policy: policy({ allowed_autonomous_actions: ['send_follow_up'] }),
      action: 'send_follow_up',
      eval_gate: passingEvalGate,
      message_text: 'Could you confirm availability?',
    })

    expect(decision).toEqual({
      execution_mode: 'autonomous_allowed',
      allowed: true,
      requires_approval: false,
      reasons: [],
    })
  })

  it('keeps first contact approval-required unless the host explicitly allows it', () => {
    const defaultFirstContact = evaluateOutreachPolicyGate({
      policy: policy({ allowed_autonomous_actions: ['send_first_contact'] }),
      action: 'send_first_contact',
      is_first_contact: true,
      eval_gate: passingEvalGate,
    })
    const explicitlyAllowedFirstContact = evaluateOutreachPolicyGate({
      policy: policy({
        allowed_autonomous_actions: ['send_first_contact'],
        require_approval_for_first_contact: false,
      }),
      action: 'send_first_contact',
      is_first_contact: true,
      eval_gate: passingEvalGate,
    })

    expect(defaultFirstContact.allowed).toBe(false)
    expect(defaultFirstContact.reasons).toContain('first_contact_requires_approval')
    expect(explicitlyAllowedFirstContact.allowed).toBe(true)
  })

  it('never allows irreversible outreach actions to execute autonomously', () => {
    const decision = evaluateOutreachPolicyGate({
      policy: policy({
        allowed_autonomous_actions: ['pay'],
        irreversible_autonomous_actions: ['pay'],
      }),
      action: 'pay',
      eval_gate: passingEvalGate,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.requires_approval).toBe(true)
    expect(decision.reasons).toContain('irreversible_action_requires_approval')
  })
})
