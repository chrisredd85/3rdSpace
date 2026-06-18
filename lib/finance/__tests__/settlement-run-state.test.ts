import {
  transitionSettlementRunStatus,
  type SettlementRunStatus,
} from '@/lib/finance/settlement-run-state'

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
})
