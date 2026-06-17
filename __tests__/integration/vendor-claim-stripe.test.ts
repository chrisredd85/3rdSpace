jest.mock('server-only', () => ({}))

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
    redirect: (url: string | URL, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status ?? 307
      return new Response(null, {
        status,
        headers: { location: String(url) },
      })
    },
  },
  NextRequest: Request,
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/vendors/vendorClaims', () => ({
  claimInvitedVendor: jest.fn(),
  getVendorClaimDetails: jest.fn(),
  markVendorStripeSkippedForAuthenticatedUser: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'http://localhost'),
  getAuthenticatedVendor: jest.fn(),
  getStripeClient: jest.fn(),
  getStripeCompletionPercent: jest.fn(() => 45),
  saveVendorStripeAccount: jest.fn((_: unknown, vendorId: string, account: { id: string }) => ({
    vendor_id: vendorId,
    stripe_account_id: account.id,
    charges_enabled: false,
  })),
}))

jest.mock('@/lib/billing/stripeConnectGuard', () => ({
  validateStripeConnectAccount: jest.fn(),
}))

import { POST as postVendorClaim } from '@/app/api/vendor/claim/route'
import { POST as postVendorStripeConnect } from '@/app/api/vendor/stripe/connect/route'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAuthenticatedVendor,
  getStripeClient,
  saveVendorStripeAccount,
} from '@/lib/stripe/connect'
import { markVendorStripeSkippedForAuthenticatedUser } from '@/lib/vendors/vendorClaims'

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockGetAuthenticatedVendor = getAuthenticatedVendor as jest.Mock
const mockGetStripeClient = getStripeClient as jest.Mock
const mockSaveVendorStripeAccount = saveVendorStripeAccount as jest.Mock
const mockMarkStripeSkipped = markVendorStripeSkippedForAuthenticatedUser as jest.Mock
const mockValidateStripeConnectAccount = validateStripeConnectAccount as jest.Mock

describe('vendor claim Stripe onboarding routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'vendor-user-1',
              user_metadata: { user_type: 'vendor' },
            },
          },
          error: null,
        }),
      },
    })
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() => makeMaybeSingleQuery(null)),
    })
    mockMarkStripeSkipped.mockResolvedValue({ ok: true })
  })

  it('marks Stripe as skipped for an authenticated claimed vendor', async () => {
    const response = await postVendorClaim(makeJsonRequest('/api/vendor/claim', {
      action: 'skip_stripe',
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      redirectTo: '/vendor?claim_complete=1&stripe_skipped=1',
    })
    expect(mockMarkStripeSkipped).toHaveBeenCalledWith('vendor-user-1')
  })

  it('creates a Stripe account link with a safe claim return URL', async () => {
    const accountsCreate = jest.fn().mockResolvedValue({
      id: 'acct_vendor_new',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {},
    })
    const accountLinksCreate = jest.fn().mockResolvedValue({
      url: 'https://connect.stripe.test/onboard',
    })
    mockGetAuthenticatedVendor.mockResolvedValue({
      error: null,
      status: 200,
      user: { id: 'vendor-user-1', email: 'vendor@example.com' },
      vendor: { id: 'vendor-1', name: 'DJ Maya', user_id: 'vendor-user-1' },
    })
    mockGetStripeClient.mockReturnValue({
      accounts: { create: accountsCreate },
      accountLinks: { create: accountLinksCreate },
    })

    const response = await postVendorStripeConnect(makeJsonRequest('/api/vendor/stripe/connect', {
      returnTo: '/vendor?claim_complete=1&stripe=connected',
    }) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      accountLinkUrl: 'https://connect.stripe.test/onboard',
      url: 'https://connect.stripe.test/onboard',
    }))
    expect(accountsCreate).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        vendor_id: 'vendor-1',
        user_id: 'vendor-user-1',
      },
    }))
    expect(accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_vendor_new',
      refresh_url: 'http://localhost/api/vendor/stripe/callback?refresh=1&returnTo=%2Fvendor%3Fclaim_complete%3D1%26stripe%3Dconnected',
      return_url: 'http://localhost/api/vendor/stripe/callback?returnTo=%2Fvendor%3Fclaim_complete%3D1%26stripe%3Dconnected',
      type: 'account_onboarding',
    })
    expect(mockSaveVendorStripeAccount).toHaveBeenCalled()
    expect(mockValidateStripeConnectAccount).not.toHaveBeenCalled()
  })
})

function makeJsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeMaybeSingleQuery(data: unknown) {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  }
  return query
}
