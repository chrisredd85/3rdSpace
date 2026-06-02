import type { OutreachThreadState } from '@/lib/types'

export type OutreachThreadLike = {
  state: OutreachThreadState
}

export type OutreachThreadEvent =
  | { type: 'draft_created' }
  | { type: 'outbound_sent' }
  | { type: 'reply_available' }
  | { type: 'reply_needs_info' }
  | { type: 'reply_price_quote' }
  | { type: 'reply_contract_request' }
  | { type: 'reply_redirect' }
  | { type: 'reply_unavailable' }
  | { type: 'mark_confirmed' }
  | { type: 'mark_declined' }
  | { type: 'mark_stale' }
  | { type: 'require_creator_review' }
  | { type: 'cancel' }

const transitions: Record<OutreachThreadState, Partial<Record<OutreachThreadEvent['type'], OutreachThreadState>>> = {
  draft: {
    draft_created: 'draft',
    outbound_sent: 'awaiting_reply',
    require_creator_review: 'awaiting_creator_review',
    cancel: 'cancelled',
  },
  awaiting_reply: {
    outbound_sent: 'awaiting_reply',
    reply_available: 'in_negotiation',
    reply_needs_info: 'in_negotiation',
    reply_price_quote: 'in_negotiation',
    reply_contract_request: 'in_negotiation',
    reply_redirect: 'in_negotiation',
    reply_unavailable: 'declined',
    mark_confirmed: 'confirmed',
    mark_declined: 'declined',
    mark_stale: 'stale',
    require_creator_review: 'awaiting_creator_review',
    cancel: 'cancelled',
  },
  in_negotiation: {
    outbound_sent: 'awaiting_reply',
    reply_available: 'in_negotiation',
    reply_needs_info: 'in_negotiation',
    reply_price_quote: 'in_negotiation',
    reply_contract_request: 'in_negotiation',
    reply_redirect: 'in_negotiation',
    reply_unavailable: 'declined',
    mark_confirmed: 'confirmed',
    mark_declined: 'declined',
    mark_stale: 'stale',
    require_creator_review: 'awaiting_creator_review',
    cancel: 'cancelled',
  },
  confirmed: {
    cancel: 'cancelled',
  },
  declined: {
    cancel: 'cancelled',
  },
  stale: {
    reply_available: 'in_negotiation',
    reply_needs_info: 'in_negotiation',
    reply_price_quote: 'in_negotiation',
    reply_contract_request: 'in_negotiation',
    reply_redirect: 'in_negotiation',
    reply_unavailable: 'declined',
    require_creator_review: 'awaiting_creator_review',
    cancel: 'cancelled',
  },
  awaiting_creator_review: {
    outbound_sent: 'awaiting_reply',
    reply_available: 'in_negotiation',
    reply_needs_info: 'in_negotiation',
    reply_price_quote: 'in_negotiation',
    reply_contract_request: 'in_negotiation',
    reply_redirect: 'in_negotiation',
    reply_unavailable: 'declined',
    mark_confirmed: 'confirmed',
    mark_declined: 'declined',
    mark_stale: 'stale',
    cancel: 'cancelled',
  },
  cancelled: {},
}

export class InvalidOutreachTransitionError extends Error {
  constructor(state: OutreachThreadState, eventType: OutreachThreadEvent['type']) {
    super(`Invalid outreach thread transition from ${state} via ${eventType}`)
    this.name = 'InvalidOutreachTransitionError'
  }
}

/**
 * Applies the explicit outreach state machine.
 */
export function transition(
  thread: OutreachThreadLike,
  event: OutreachThreadEvent
): OutreachThreadState {
  const nextState = transitions[thread.state]?.[event.type]
  if (!nextState) throw new InvalidOutreachTransitionError(thread.state, event.type)
  return nextState
}

export function eventForSuggestedState(state: OutreachThreadState): OutreachThreadEvent | null {
  if (state === 'awaiting_reply') return { type: 'outbound_sent' }
  if (state === 'in_negotiation') return { type: 'reply_needs_info' }
  if (state === 'confirmed') return { type: 'mark_confirmed' }
  if (state === 'declined') return { type: 'mark_declined' }
  if (state === 'stale') return { type: 'mark_stale' }
  if (state === 'cancelled') return { type: 'cancel' }
  if (state === 'awaiting_creator_review') return { type: 'require_creator_review' }
  return null
}
