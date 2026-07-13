import {
  transitionSettlementCharge,
  transitionSettlementRun,
  transitionSettlementRunStatus,
  type SettlementRunStatus,
} from '@/lib/finance/settlement-run-state'
import {
  SETTLEMENT_RUN_ID,
  SettlementMemoryDb,
} from '@/test-utils/settlementCheckoutDb'

describe('settlement run state machine', () => {
  it('covers epsilon.2 organizer review transitions', () => {
    expect(transitionSettlementRunStatus('pending', 'attendance_recorded')).toEqual({
      ok: true,
      to: 'awaiting_organizer_review',
    })
    expect(transitionSettlementRunStatus('awaiting_attendance', 'attendance_recorded')).toEqual({
      ok: true,
      to: 'awaiting_organizer_review',
    })
    expect(transitionSettlementRunStatus('awaiting_organizer_review', 'organizer_approved')).toEqual({
      ok: true,
      to: 'awaiting_venue_ack',
    })
    expect(transitionSettlementRunStatus('awaiting_organizer_review', 'organizer_disputed')).toEqual({
      ok: true,
      to: 'disputed',
    })
  })

  it('keeps epsilon.3 transitions explicit but unavailable until the right state', () => {
    expect(transitionSettlementRunStatus('awaiting_venue_ack', 'venue_acknowledged')).toEqual({
      ok: true,
      to: 'awaiting_venue_payment',
    })
    expect(transitionSettlementRunStatus('awaiting_venue_payment', 'venue_paid')).toEqual({
      ok: true,
      to: 'settled',
    })
    expect(transitionSettlementRunStatus('blocked', 'venue_paid')).toEqual({
      ok: true,
      to: 'settled',
    })
    expect(transitionSettlementRunStatus('awaiting_venue_payment', 'venue_disputed')).toEqual({
      ok: true,
      to: 'disputed',
    })
    expect(transitionSettlementRunStatus('awaiting_organizer_review', 'stripe_settled')).toMatchObject({
      ok: false,
    })
  })

  it('rejects terminal-state transitions', () => {
    for (const status of ['settled', 'cancelled'] as SettlementRunStatus[]) {
      expect(transitionSettlementRunStatus(status, 'organizer_approved')).toMatchObject({
        ok: false,
      })
    }
  })

  it('atomically transitions a settlement run and writes an audit row', async () => {
    const db = new SettlementMemoryDb()

    const result = await transitionSettlementRun({
      db: db as never,
      runId: SETTLEMENT_RUN_ID,
      fromStatus: 'awaiting_venue_ack',
      toStatus: 'awaiting_venue_payment',
      action: 'venue_payment_initiated',
      actor: { id: null, type: 'venue' },
      reason: 'Venue started checkout.',
    })

    expect(result.success).toBe(true)
    expect(db.rows.settlement_runs[0].status).toBe('awaiting_venue_payment')
    expect(db.rows.settlement_audit_log).toHaveLength(1)
    expect(db.rows.settlement_audit_log[0]).toMatchObject({
      entity_type: 'settlement_run',
      entity_id: SETTLEMENT_RUN_ID,
      action: 'venue_payment_initiated',
      actor_type: 'venue',
      reason: 'Venue started checkout.',
    })
  })

  it('does not write an audit row when the optimistic lock loses', async () => {
    const db = new SettlementMemoryDb()

    const result = await transitionSettlementRun({
      db: db as never,
      runId: SETTLEMENT_RUN_ID,
      fromStatus: 'awaiting_venue_payment',
      toStatus: 'settled',
      action: 'venue_paid',
      actor: { id: null, type: 'stripe_webhook' },
      reason: 'Stripe marked paid.',
    })

    expect(result).toMatchObject({ success: false, reason: 'concurrent_update' })
    expect(db.rows.settlement_runs[0].status).toBe('awaiting_venue_ack')
    expect(db.rows.settlement_audit_log ?? []).toHaveLength(0)
  })

  it('attributes settlement charge transitions to Stripe webhooks', async () => {
    const db = new SettlementMemoryDb()
    db.rows.settlement_charges.push({
      id: 'charge-1',
      settlement_run_id: SETTLEMENT_RUN_ID,
      status: 'checkout_created',
    })

    const result = await transitionSettlementCharge({
      db: db as never,
      chargeId: 'charge-1',
      fromStatus: 'checkout_created',
      toStatus: 'paid',
      action: 'checkout.session.completed',
      actor: { id: null, type: 'stripe_webhook' },
      reason: 'Stripe Checkout completed.',
      patch: { stripe_payment_intent_id: 'pi_123' },
    })

    expect(result.success).toBe(true)
    expect(db.rows.settlement_charges[0]).toMatchObject({
      status: 'paid',
      stripe_payment_intent_id: 'pi_123',
    })
    expect(db.rows.settlement_audit_log[0]).toMatchObject({
      entity_type: 'settlement_charge',
      entity_id: 'charge-1',
      action: 'checkout.session.completed',
      actor_type: 'stripe_webhook',
    })
  })
})
