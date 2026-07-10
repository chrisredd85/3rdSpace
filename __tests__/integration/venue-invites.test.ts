jest.mock('server-only', () => ({}))

import { inviteVenue } from '@/app/actions/venueInvites'
import { sendEmailNotification } from '@/lib/email'
import { attachVenueToActivePlan } from '@/lib/planner/planVenueSelections'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { verifyVenueClaimToken } from '@/lib/venues/venueInviteTokens'
import { headers } from 'next/headers'

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

jest.mock('@/lib/planner/planVenueSelections', () => ({
  attachVenueToActivePlan: jest.fn(),
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
const mockAttachVenueToActivePlan = attachVenueToActivePlan as jest.Mock
const mockHeaders = headers as jest.Mock

const organizerUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'organizer@example.com',
  user_metadata: { user_type: 'community_builder' },
}

const planId = '22222222-2222-4222-8222-222222222222'
const eventId = '33333333-3333-4333-8333-333333333333'
const legacyEventId = '33333333-3333-4333-8333-333333333334'
const venueId = '44444444-4444-4444-8444-444444444444'
const relationshipId = '55555555-5555-4555-8555-555555555555'
const agreementId = '66666666-6666-4666-8666-666666666666'
const invitedAt = '2026-06-25T12:00:00.000Z'

describe('inviteVenue server action', () => {
  let rpcMock: jest.Mock
  let fromMock: jest.Mock
  let planRow: Record<string, unknown>
  const originalSecret = process.env.VENUE_INVITE_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VENUE_INVITE_SECRET = 'test-venue-invite-secret-32-chars-minimum'
    mockHeaders.mockReturnValue(new Map([['origin', 'http://localhost:3000']]))
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: organizerUser }, error: null }),
      },
    })
    mockSendEmailNotification.mockResolvedValue({ sent: false })
    mockAttachVenueToActivePlan.mockResolvedValue({
      ok: true,
      plan: { id: planId, metadata: { shopping_list: { selected_venue: { venue_id: venueId } } } },
    })
    planRow = {
      id: planId,
      user_id: organizerUser.id,
      materialized_event_id: eventId,
      metadata: { event_id: legacyEventId },
    }
    rpcMock = jest.fn().mockResolvedValue({
      data: [{
        venue_id: venueId,
        relationship_id: relationshipId,
        term_agreement_id: agreementId,
        existing: false,
      }],
      error: null,
    })
    fromMock = jest.fn((table: string) => {
      if (table === 'plans') {
        return makeQueryBuilder(planRow)
      }
      if (table === 'venues') {
        return makeQueryBuilder({
          id: venueId,
          venue_name: 'Moongate Lounge',
          contact_email: 'events@moongate.example.com',
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
    process.env.VENUE_INVITE_SECRET = originalSecret
  })

  it('creates a venue invite with cents-based terms and a verifiable claim URL', async () => {
    const result = await inviteVenue(baseInviteInput({ planId }))

    expect(result).toMatchObject({
      ok: true,
      venueId,
      relationshipId,
      termAgreementId: agreementId,
      existing: false,
      plan: expect.objectContaining({ id: planId }),
    })
    expect(rpcMock).toHaveBeenCalledWith('create_venue_invite', expect.objectContaining({
      p_organizer_user_id: organizerUser.id,
      p_source_event_id: eventId,
      p_term_type: 'flat_rental',
      p_amount_cents: 180000,
    }))
    expect(mockAttachVenueToActivePlan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      planId,
      organizerUserId: organizerUser.id,
      venueId,
      termType: 'flat_rental',
      amountCents: 180000,
    }))

    const token = extractClaimToken(result.claimUrl)
    expect(verifyVenueClaimToken(token, Math.floor(Date.now() / 1000))).toMatchObject({
      venue_id: venueId,
      email: 'events@moongate.example.com',
      invited_at: invitedAt,
    })
  })

  it('does not attach to a plan when no active plan id is provided', async () => {
    await inviteVenue(baseInviteInput({ planId: null }))

    expect(rpcMock).toHaveBeenCalledWith('create_venue_invite', expect.objectContaining({
      p_source_event_id: null,
    }))
    expect(mockAttachVenueToActivePlan).not.toHaveBeenCalled()
  })

  it('does not use legacy metadata when no canonical event FK exists', async () => {
    planRow.materialized_event_id = null

    await inviteVenue(baseInviteInput({ planId }))

    expect(rpcMock).toHaveBeenCalledWith('create_venue_invite', expect.objectContaining({
      p_source_event_id: null,
    }))
  })

  it('reuses an existing organizer venue invite without throwing', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        venue_id: venueId,
        relationship_id: relationshipId,
        term_agreement_id: agreementId,
        existing: true,
      }],
      error: null,
    })

    const result = await inviteVenue(baseInviteInput({ planId }))

    expect(result).toMatchObject({
      ok: true,
      venueId,
      existing: true,
    })
  })
})

function baseInviteInput({ planId: inputPlanId }: { planId?: string | null } = {}) {
  return {
    venueName: 'Moongate Lounge',
    contactEmail: 'events@moongate.example.com',
    contactName: 'Sam',
    contactRole: 'Events manager',
    venueType: 'restaurant' as const,
    city: 'Oakland',
    state: 'CA',
    standingCapacity: 80,
    seatedCapacity: 40,
    termType: 'flat_rental' as const,
    proposedAmount: 1800,
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
