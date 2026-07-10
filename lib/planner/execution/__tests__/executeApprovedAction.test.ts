import {
  executeApprovedAction,
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

  it('classifies explicitly approved Gmail outreach as outbound send', () => {
    const plan = planApprovedActionExecution({
      approval: { status: 'approved' },
      action: {
        action_type: 'email',
        payload_json: { kind: 'gmail_approved_outreach' },
        result_metadata: {},
      },
    })

    expect(plan).toEqual({
      kind: 'send_gmail_outreach',
      canStart: true,
      terminalActionStatus: 'complete',
      reason: 'Approval sends reviewed outreach through the connected Gmail account',
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

  it('dispatches an executable action through exactly one registered executor', async () => {
    const prepare = jest.fn(async () => ({ prepared: true }))
    const result = await executeApprovedAction({
      approval: { status: 'authorized' } as never,
      action: {
        action_type: 'opportunity_send_venues',
        payload_json: {},
        result_metadata: {},
      } as never,
      registry: { prepare_outreach_drafts: prepare },
    })

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      started: true,
      plan: { kind: 'prepare_outreach_drafts' },
      result: { prepared: true },
    })
  })

  it('does not invoke a registry handler for an approval that cannot execute', async () => {
    const prepare = jest.fn()
    const result = await executeApprovedAction({
      approval: { status: 'cancelled' } as never,
      action: {
        action_type: 'opportunity_send_venues',
        payload_json: {},
        result_metadata: {},
      } as never,
      registry: { prepare_outreach_drafts: prepare },
    })

    expect(prepare).not.toHaveBeenCalled()
    expect(result).toMatchObject({ started: false, plan: { kind: 'no_execution' } })
  })
})
