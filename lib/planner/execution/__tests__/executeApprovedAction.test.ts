import {
  paymentAuthorizationTransitionEvents,
  paymentCaptureTransitionEvents,
  planApprovedActionExecution,
} from '../executeApprovedAction'

describe('approved action execution planning', () => {
  it('classifies outreach approval as draft preparation, not outbound send', () => {
    const plan = planApprovedActionExecution({
      approval: { status: 'authorized' },
      action: {
        action_type: 'email',
        payload_json: { kind: 'venue_outreach' },
        result_metadata: { action_type_fallback: 'opportunity_send_venues' },
      },
    })

    expect(plan).toEqual({
      kind: 'prepare_outreach_drafts',
      canStart: true,
      terminalActionStatus: 'complete',
      reason: 'Approval prepares outreach drafts but does not send outbound messages',
    })
  })

  it('keeps payment execution behind explicit payment confirmation', () => {
    expect(planApprovedActionExecution({
      approval: { status: 'authorized' },
      action: {
        action_type: 'payment',
        payload_json: {},
        result_metadata: {},
      },
    })).toEqual({
      kind: 'await_explicit_payment_confirmation',
      canStart: false,
      terminalActionStatus: 'approved',
      reason: 'Payment authorization and capture require explicit follow-up confirmation',
    })

    expect(paymentAuthorizationTransitionEvents('approved')).toEqual(['execution_started'])
    expect(paymentCaptureTransitionEvents('executing')).toEqual(['execution_completed'])
  })

  it('blocks payment transition planning for rejected or cancelled actions', () => {
    expect(() => paymentAuthorizationTransitionEvents('cancelled')).toThrow(/cancelled/)
    expect(() => paymentCaptureTransitionEvents('failed')).toThrow(/failed/)
  })
})
