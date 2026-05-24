import type { NextRequest } from 'next/server'
import { POST as postVendorPayment } from '@/app/api/payments/vendor/route'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { getStripeClient } from '@/lib/stripe/connect'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')

      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

jest.mock('@/lib/billing/stripeConnectGuard', () => ({
  validateStripeConnectAccount: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

const mockValidateStripeConnectAccount = validateStripeConnectAccount as jest.Mock
const mockGetStripeClient = getStripeClient as jest.Mock
const mockGetBuilderProfileId = getBuilderProfileId as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockPaymentIntentsCreate = jest.fn()

const userId = '11111111-1111-4111-8111-111111111111'
const builderProfileId = '22222222-2222-4222-8222-222222222222'
const bookingId = '33333333-3333-4333-8333-333333333333'
const vendorId = '44444444-4444-4444-8444-444444444444'

describe('POST /api/payments/vendor', () => {
  let consoleInfoSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      },
    })
    mockGetBuilderProfileId.mockResolvedValue({ builderProfileId, error: null })
    mockGetStripeClient.mockReturnValue({ paymentIntents: { create: mockPaymentIntentsCreate } })
    mockValidateStripeConnectAccount.mockResolvedValue({
      accountId: null,
      mismatchCleared: true,
    })
    mockCreateServiceRoleClient.mockReturnValue(makeAdminClient())
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

  it('returns 409 vendor_requires_reconnect when a stored Connect account was cleared', async () => {
    const response = await postVendorPayment(makeRequest({
      bookingId,
      paymentMethodId: 'pm_card_visa',
      amount: 450,
    }))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json).toEqual({
      error: 'Vendor needs to reconnect Stripe before receiving payouts.',
      code: 'vendor_requires_reconnect',
      onboarding_required: true,
      reason: 'stripe_mode_mismatch',
    })
    expect(mockValidateStripeConnectAccount).toHaveBeenCalledWith(expect.objectContaining({
      table: 'vendor_stripe_accounts',
      rowId: vendorId,
      currentAccountId: 'acct_stale',
    }))
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled()
  })
})

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/payments/vendor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function makeAdminClient() {
  return {
    from: jest.fn((table: string) => {
      if (table === 'vendor_bookings') {
        return makeMaybeSingleQuery({
          id: bookingId,
          vendor_id: vendorId,
          event_id: '55555555-5555-4555-8555-555555555555',
          status: 'confirmed',
          vendor_profiles: { id: vendorId, name: 'Vendor' },
          events: { builder_id: builderProfileId },
        })
      }

      if (table === 'vendor_stripe_accounts') {
        return makeMaybeSingleQuery({
          stripe_account_id: 'acct_stale',
          charges_enabled: true,
          payouts_enabled: true,
        })
      }

      return makeMaybeSingleQuery(null)
    }),
  }
}

function makeMaybeSingleQuery(data: unknown) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  }
  return builder
}
