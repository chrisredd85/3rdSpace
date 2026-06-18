import 'server-only'

export type SettlementRunStatus =
  | 'pending'
  | 'awaiting_attendance'
  | 'awaiting_organizer_review'
  | 'awaiting_venue_ack'
  | 'ready_to_settle'
  | 'settled'
  | 'disputed'
  | 'cancelled'

export type SettlementRunTransition =
  | 'attendance_recorded'
  | 'organizer_approved'
  | 'organizer_disputed'
  | 'venue_acknowledged'
  | 'stripe_settled'
  | 'admin_resolved'
  | 'admin_cancelled'

const VALID_TRANSITIONS: Record<
  SettlementRunStatus,
  Partial<Record<SettlementRunTransition, SettlementRunStatus>>
> = {
  pending: { attendance_recorded: 'awaiting_organizer_review' },
  awaiting_attendance: { attendance_recorded: 'awaiting_organizer_review' },
  awaiting_organizer_review: {
    organizer_approved: 'awaiting_venue_ack',
    organizer_disputed: 'disputed',
    admin_cancelled: 'cancelled',
  },
  awaiting_venue_ack: {
    venue_acknowledged: 'ready_to_settle',
    organizer_disputed: 'disputed',
    admin_cancelled: 'cancelled',
  },
  ready_to_settle: {
    stripe_settled: 'settled',
    admin_cancelled: 'cancelled',
  },
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
