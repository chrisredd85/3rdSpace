import { getFreeEventUsageDisplay } from '@/lib/billing/display'

describe('billing display helpers', () => {
  it('caps displayed free-event usage to the granted trial amount', () => {
    expect(getFreeEventUsageDisplay({
      freeEventsGranted: 2,
      freeEventsUsed: 20,
      freeEventsRemaining: 0,
    })).toEqual({
      granted: 2,
      used: 2,
      remaining: 0,
      rawUsed: 20,
      hasOverage: true,
    })
  })

  it('derives remaining free events from capped usage when raw counters disagree', () => {
    expect(getFreeEventUsageDisplay({
      freeEventsGranted: 2,
      freeEventsUsed: 20,
      freeEventsRemaining: 2,
    })).toMatchObject({
      granted: 2,
      used: 2,
      remaining: 0,
      hasOverage: true,
    })
  })
})
