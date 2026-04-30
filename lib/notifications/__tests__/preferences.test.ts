jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

import { isEmailEnabled, isInAppEnabled, type NotificationPreferences } from '@/lib/notifications'

describe('notification preferences', () => {
  const preferences = {
    email_enabled: true,
    push_enabled: false,
    sound_enabled: false,
    preferences: {
      new_message: { email: false },
      payment_received: { in_app: false },
      review_received: { push: true },
    },
  } satisfies NotificationPreferences

  it('enables in-app notifications by default per type', () => {
    expect(isInAppEnabled(preferences, 'new_booking')).toBe(true)
    expect(isInAppEnabled(preferences, 'payment_received')).toBe(false)
  })

  it('honors global and per-type email preferences', () => {
    expect(isEmailEnabled(preferences, 'new_booking')).toBe(true)
    expect(isEmailEnabled(preferences, 'new_message')).toBe(false)
    expect(isEmailEnabled({ ...preferences, email_enabled: false }, 'new_booking')).toBe(false)
  })
})
