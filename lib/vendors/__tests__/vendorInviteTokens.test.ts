jest.mock('server-only', () => ({}))

import { createVendorClaimToken, verifyVendorClaimToken } from '@/lib/vendors/vendorInviteTokens'

describe('vendor invite claim tokens', () => {
  const originalSecret = process.env.VENDOR_INVITE_SECRET

  beforeEach(() => {
    process.env.VENDOR_INVITE_SECRET = 'test-vendor-invite-secret'
  })

  afterAll(() => {
    process.env.VENDOR_INVITE_SECRET = originalSecret
  })

  it('creates a token that verifies for the invited vendor payload', () => {
    const token = createVendorClaimToken({
      vendorId: 'vendor-123',
      email: 'Maya@Example.com',
      invitedAt: '2026-05-13T12:00:00.000Z',
      now: 100,
    })

    const payload = verifyVendorClaimToken(token, 100)
    expect(payload).toMatchObject({
      vendor_id: 'vendor-123',
      email: 'maya@example.com',
      invited_at: '2026-05-13T12:00:00.000Z',
    })
  })

  it('rejects tampered tokens', () => {
    const token = createVendorClaimToken({
      vendorId: 'vendor-123',
      email: 'maya@example.com',
      invitedAt: '2026-05-13T12:00:00.000Z',
      now: 100,
    })

    expect(verifyVendorClaimToken(`${token}tampered`, 100)).toBeNull()
  })
})
