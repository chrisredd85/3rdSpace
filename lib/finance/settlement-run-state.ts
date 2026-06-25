import 'server-only'

export type SettlementRunStatus =
  | 'pending'
  | 'awaiting_attendance'
  | 'awaiting_organizer_review'
  | 'awaiting_venue_ack'
  | 'awaiting_venue_payment'
  | 'ready_to_settle'
  | 'blocked'
  | 'settled'
  | 'disputed'
  | 'cancelled'

export type SettlementRunTransition =
  | 'attendance_recorded'
  | 'organizer_approved'
  | 'organizer_disputed'
  | 'venue_acknowledged'
  | 'venue_payment_initiated'
  | 'venue_paid'
  | 'venue_disputed'
  | 'stripe_account_blocked'
  | 'stripe_settled'
  | 'admin_resolved'
  | 'admin_cancelled'

const VALID_TRANSITIONS: Record<
  SettlementRunStatus,
  Partial<Record<SettlementRunTransition, SettlementRunStatus>>
> = {
  pending: { attendance_recorded: 'awaiting_organizer_review', stripe_account_blocked: 'blocked' },
  awaiting_attendance: { attendance_recorded: 'awaiting_organizer_review', stripe_account_blocked: 'blocked' },
  awaiting_organizer_review: {
    organizer_approved: 'awaiting_venue_ack',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  awaiting_venue_ack: {
    venue_acknowledged: 'awaiting_venue_payment',
    venue_payment_initiated: 'awaiting_venue_payment',
    venue_disputed: 'disputed',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  awaiting_venue_payment: {
    venue_paid: 'settled',
    stripe_settled: 'settled',
    venue_disputed: 'disputed',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  ready_to_settle: {
    stripe_settled: 'settled',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  blocked: { admin_cancelled: 'cancelled' },
  settled: {},
  disputed: { admin_resolved: 'awaiting_organizer_review', admin_cancelled: 'cancelled' },
  cancelled: {},
}

export function transitionSettlementRunStatus(
  current: SettlementRunStatus,
  event: SettlementRunTransition,
): { ok: true; to: SettlementRunStatus } | { ok: false; reason: string } {
  const next = VALID_TRANSITIONS[current]?.[event]
  if (!next) {
    return { ok: false, reason: `Cannot apply '${event}' to status '${current}'` }
  }
  return { ok: true, to: next }
}
