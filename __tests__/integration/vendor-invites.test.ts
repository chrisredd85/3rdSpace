jest.mock('server-only', () => ({}))

import { inviteVendor } from '@/app/actions/vendorInvites'
import { sendEmailNotification } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { verifyVendorClaimToken } from '@/lib/vendors/vendorInviteTokens'
import { headers } from 'next/headers'

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockSendEmailNotification = sendEmailNotification as jest.Mock
const mockHeaders = headers as jest.Mock

const organizerUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'organizer@example.com',
  user_metadata: { user_type: 'community_builder' },
}

const planId = '22222222-2222-4222-8222-222222222222'
const eventId = '33333333-3333-4333-8333-333333333333'
const legacyEventId = '33333333-3333-4333-8333-333333333334'
const vendorId = '44444444-4444-4444-8444-444444444444'
const relationshipId = '55555555-5555-4555-8555-555555555555'
const agreementId = '66666666-6666-4666-8666-666666666666'
const invitedAt = '2026-05-13T12:00:00.000Z'

describe('inviteVendor server action', () => {
  let rpcMock: jest.Mock
  let fromMock: jest.Mock
  let planRow: Record<string, unknown>
  const originalSecret = process.env.VENDOR_INVITE_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VENDOR_INVITE_SECRET = 'test-vendor-invite-secret-32-chars-minimum'
    mockHeaders.mockReturnValue(new Map([['origin', 'http://localhost:3000']]))
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: organizerUser }, error: null }),
      },
    })
    mockSendEmailNotification.mockResolvedValue({ sent: false })
    planRow = {
      id: planId,
      user_id: organizerUser.id,
      materialized_event_id: eventId,
      metadata: { event_id: legacyEventId },
    }
    rpcMock = jest.fn().mockResolvedValue({
      data: [{
        vendor_id: vendorId,
        relationship_id: relationshipId,
        rate_agreement_id: agreementId,
        existing: false,
      }],
      error: null,
    })
    fromMock = jest.fn((table: string) => {
      if (table === 'plans') {
        return makeQueryBuilder(planRow)
      }
      if (table === 'vendor_profiles') {
        return makeQueryBuilder({
          id: vendorId,
          name: 'DJ Maya',
          contact_email: 'maya@example.com',
          invited_at: invitedAt,
        })
      }
      return makeQueryBuilder(null)
    })
    mockCreateServiceRoleClient.mockReturnValue({
      rpc: rpcMock,
      from: fromMock,
    })
  })

  afterAll(() => {
    process.env.VENDOR_INVITE_SECRET = originalSecret
  })

  it('passes the active plan event id into the invite RPC and returns a verifiable claim URL', async () => {
    const result = await inviteVendor(baseInviteInput({ planId }))

    expect(result).toMatchObject({
      ok: true,
      vendorId,
      relationshipId,
      rateAgreementId: agreementId,
      existing: false,
    })
    expect(rpcMock).toHaveBeenCalledWith('create_vendor_invite', expect.objectContaining({
      p_organizer_user_id: organizerUser.id,
      p_source_event_id: eventId,
      p_amount: 450,
      p_rate_type: 'flat',
    }))

    const token = extractClaimToken(result.claimUrl)
    expect(verifyVendorClaimToken(token, Math.floor(Date.now() / 1000))).toMatchObject({
      vendor_id: vendorId,
      email: 'maya@example.com',
      invited_at: invitedAt,
    })
  })

  it('leaves source_event_id null when no plan id is provided', async () => {
    await inviteVendor(baseInviteInput({ planId: null }))

    expect(rpcMock).toHaveBeenCalledWith('create_vendor_invite', expect.objectContaining({
      p_source_event_id: null,
    }))
  })

  it('uses legacy metadata only when no canonical event FK exists', async () => {
    planRow.materialized_event_id = null

    await inviteVendor(baseInviteInput({ planId }))

    expect(rpcMock).toHaveBeenCalledWith('create_vendor_invite', expect.objectContaining({
      p_source_event_id: legacyEventId,
    }))
  })

  it('surfaces RPC idempotency on duplicate organizer and vendor email without throwing', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        vendor_id: vendorId,
        relationship_id: relationshipId,
        rate_agreement_id: agreementId,
        existing: true,
      }],
      error: null,
    })

    const result = await inviteVendor(baseInviteInput({ planId }))

    expect(result).toMatchObject({
      ok: true,
      vendorId,
      existing: true,
    })
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})

function baseInviteInput({ planId: inputPlanId }: { planId?: string | null } = {}) {
  return {
    vendorName: 'DJ Maya',
    email: 'maya@example.com',
    phone: '415-555-0100',
    serviceType: 'dj' as const,
    rateType: 'flat' as const,
    proposedRateAmount: 450,
    planId: inputPlanId,
  }
}

function extractClaimToken(claimUrl: string | undefined) {
  expect(claimUrl).toBeTruthy()
  const url = new URL(claimUrl as string)
  const token = url.searchParams.get('token')
  expect(token).toBeTruthy()
  return token as string
}

function makeQueryBuilder(data: unknown) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  }
  return builder
}
