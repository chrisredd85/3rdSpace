import {
  cancelApprovedActionExecution,
  executeApprovedAction,
  paymentAuthorizationTransitionEvents,
  paymentCaptureTransitionEvents,
  planApprovedActionExecution,
  planApprovedActionCancellation,
  planApprovedActionRetry,
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

  it.each(['opportunity_send_venues', 'opportunity_send_vendors'])(
    'does not advertise crash-unsafe retry for %s preparation',
    (actionType) => {
      expect(planApprovedActionRetry({
        approval: { status: 'authorized' },
        action: {
          action_type: actionType,
          payload_json: {},
          result_metadata: {},
        },
      })).toEqual({
        kind: 'no_retry',
        canRetry: false,
        reason: 'Outreach preparation retry is blocked until each preparation step has a durable identity',
      })
    }
  )

  it.each([
    ['email', { kind: 'gmail_approved_outreach' }, 'send_gmail_outreach'],
    ['external_checkout', { external_url: 'https://tickets.example/checkout' }, 'await_external_checkout'],
    ['hold_request', {}, 'await_concierge_queue'],
  ])('keeps %s in the durable retry subset', (actionType, payload, expectedKind) => {
    expect(planApprovedActionRetry({
      approval: { status: 'authorized' },
      action: {
        action_type: actionType,
        payload_json: payload,
        result_metadata: {},
      },
    })).toEqual(expect.objectContaining({
      kind: expectedKind,
      canRetry: true,
    }))
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

  it('starts an external checkout handoff but leaves completion with the host', () => {
    expect(planApprovedActionExecution({
      approval: { status: 'authorized' },
      action: {
        action_type: 'external_checkout',
        payload_json: { external_url: 'https://tickets.example.org/checkout' },
        result_metadata: {},
      },
    })).toEqual({
      kind: 'await_external_checkout',
      canStart: true,
      terminalActionStatus: 'executing',
      reason: 'Approval unlocks a host-controlled external checkout handoff',
    })
  })

  it.each([
    ['hold_request', {}],
    ['vendor_contact', {}],
    ['concierge_queue', { kind: 'canonical_quote_booking' }],
  ])('routes %s through the concierge handoff executor', (actionType, payload) => {
    expect(planApprovedActionExecution({
      approval: { status: 'authorized' },
      action: {
        action_type: actionType,
        payload_json: payload,
        result_metadata: {},
      },
    })).toEqual({
      kind: 'await_concierge_queue',
      canStart: true,
      terminalActionStatus: 'executing',
      reason: 'Approval creates a durable concierge task, draft, or canonical booking handoff',
    })
  })

  it('does not mistake a vendor reply capture for outbound concierge work', () => {
    expect(planApprovedActionExecution({
      approval: { status: 'authorized' },
      action: {
        action_type: 'vendor_contact',
        payload_json: { kind: 'vendor_reply_capture' },
        result_metadata: {},
      },
    })).toEqual(expect.objectContaining({ kind: 'no_execution', canStart: false }))
  })

  it('routes only durable executing handoffs to cancellation handlers', async () => {
    const action = {
      action_type: 'external_checkout',
      payload_json: { kind: 'external_checkout' },
      result_metadata: { external_checkout: { status: 'ready' } },
      status: 'executing',
    }
    expect(planApprovedActionCancellation({
      approval: { status: 'authorized' },
      action,
    })).toBe('cancel_external_checkout')

    const cancel = jest.fn(async () => ({ cancelled: true }))
    const result = await cancelApprovedActionExecution({
      approval: { status: 'authorized' } as never,
      action: action as never,
      registry: { cancel_external_checkout: cancel },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      kind: 'cancel_external_checkout',
      cancelled: true,
    }))

    expect(planApprovedActionCancellation({
      approval: { status: 'authorized' },
      action: {
        action_type: 'payment',
        payload_json: { kind: 'venue_deposit' },
        result_metadata: {},
        status: 'approved',
      },
    })).toBe('no_cancellation')
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
