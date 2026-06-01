import {
  InvalidOutreachTransitionError,
  transition,
} from '@/lib/outreach/threadState'

describe('outreach thread state machine', () => {
  it('moves a draft to awaiting_reply after an outbound send', () => {
    expect(transition({ state: 'draft' }, { type: 'outbound_sent' })).toBe('awaiting_reply')
  })

  it('moves actionable replies into negotiation', () => {
    expect(transition({ state: 'awaiting_reply' }, { type: 'reply_price_quote' })).toBe('in_negotiation')
    expect(transition({ state: 'awaiting_reply' }, { type: 'reply_needs_info' })).toBe('in_negotiation')
  })

  it('moves unavailable replies to declined', () => {
    expect(transition({ state: 'awaiting_reply' }, { type: 'reply_unavailable' })).toBe('declined')
  })

  it('rejects invalid terminal transitions', () => {
    expect(() => transition({ state: 'cancelled' }, { type: 'outbound_sent' })).toThrow(
      InvalidOutreachTransitionError
    )
  })
})
