jest.mock('server-only', () => ({}))

import { getScheduledSendDelayMs, getUndoWindowExpiresAt } from '@/lib/outreach/autonomy'

describe('outreach autonomy helpers', () => {
  it('enforces real scheduled-send delays by channel', () => {
    expect(getScheduledSendDelayMs('email')).toBe(5 * 60 * 1000)
    expect(getScheduledSendDelayMs('sms')).toBe(30 * 1000)
    expect(getScheduledSendDelayMs('voice')).toBe(0)
    expect(getScheduledSendDelayMs('instagram')).toBe(0)
  })

  it('sets the autonomous undo window to four hours', () => {
    expect(getUndoWindowExpiresAt(new Date('2026-06-01T12:00:00.000Z'))).toBe('2026-06-01T16:00:00.000Z')
  })
})
