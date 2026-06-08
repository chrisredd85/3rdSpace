import {
  classifyExecutionMode,
  isExecutableAgentActionType,
  isExecutionMode,
  requiresApprovalForAgentAction,
} from '@/lib/planner/executionModes'

describe('executionModes', () => {
  it('recognizes only the canonical execution modes', () => {
    expect(isExecutionMode('controlled_payment')).toBe(true)
    expect(isExecutionMode('external_checkout')).toBe(true)
    expect(isExecutionMode('concierge_admin_queue')).toBe(true)
    expect(isExecutionMode('browser_automation')).toBe(false)
  })

  it('classifies controlled payment only for connected payment actions', () => {
    expect(classifyExecutionMode({ actionType: 'payment' })).toBe('controlled_payment')
    expect(classifyExecutionMode({ hasControlledPaymentAccount: true })).toBe('controlled_payment')
  })

  it('classifies external checkout providers and links', () => {
    expect(classifyExecutionMode({ provider: 'Eventbrite' })).toBe('external_checkout')
    expect(classifyExecutionMode({ actionType: 'external_checkout' })).toBe('external_checkout')
    expect(classifyExecutionMode({ externalUrl: 'https://example.com/checkout' })).toBe('external_checkout')
  })

  it('routes unsupported or explicit fallback work to the admin queue', () => {
    expect(classifyExecutionMode({ actionType: 'vendor_contact' })).toBe('concierge_admin_queue')
    expect(classifyExecutionMode({ actionType: 'external_checkout', routeToAdminQueue: true })).toBe(
      'concierge_admin_queue'
    )
  })

  it('identifies executable planner actions that require approval records', () => {
    expect(isExecutableAgentActionType('hold_request')).toBe(true)
    expect(requiresApprovalForAgentAction('opportunity_send_venues')).toBe(true)
    expect(requiresApprovalForAgentAction('ai_query')).toBe(false)
    expect(requiresApprovalForAgentAction('export')).toBe(false)
  })
})
