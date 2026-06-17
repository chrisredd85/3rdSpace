import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VendorClaimFlow } from '@/components/vendor/VendorClaimFlow'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter() {
    return { push }
  },
}))

const originalFetch = global.fetch
const originalLocation = window.location

describe('VendorClaimFlow Stripe step', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('renders the Stripe step after claim completion and lets vendors skip onboarding', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, redirectTo: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, dashboardPath: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, redirectTo: '/vendor?claim_complete=1&stripe_skipped=1' })) as typeof fetch

    render(<VendorClaimFlow token="claim-token" details={baseDetails()} />)

    await completeClaimSteps(user)

    expect(await screen.findByText('Connect Stripe to receive payouts')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /I'll connect later/i }))

    expect(global.fetch).toHaveBeenLastCalledWith('/api/vendor/claim', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'skip_stripe' }),
    }))
    expect(push).toHaveBeenCalledWith('/vendor?claim_complete=1&stripe_skipped=1')
  })

  it('starts Stripe onboarding with the claim return path', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, redirectTo: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, dashboardPath: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ accountLinkUrl: 'https://connect.stripe.test/onboard' })) as typeof fetch

    render(<VendorClaimFlow token="claim-token" details={baseDetails()} />)

    await completeClaimSteps(user)
    await user.click(await screen.findByRole('button', { name: 'Connect Stripe' }))
    await user.click(screen.getByRole('button', { name: /Continue to Stripe/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith('/api/vendor/stripe/connect', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          returnTo: '/vendor?claim_complete=1&stripe=connected',
        }),
      }))
    })
    expect(window.location.href).toBe('https://connect.stripe.test/onboard')
  })

  it('uses the continue onboarding CTA when a Stripe account exists but is incomplete', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, redirectTo: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, dashboardPath: '/vendor' })) as typeof fetch

    render(<VendorClaimFlow token="claim-token" details={baseDetails({
      stripe_account: {
        stripe_account_id: 'acct_existing',
        account_status: 'pending_onboarding',
        charges_enabled: false,
        payouts_enabled: false,
      },
    })} />)

    await completeClaimSteps(user)

    expect(await screen.findByText(/onboarding is not complete yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue Stripe onboarding/i })).toBeInTheDocument()
  })

  it('routes directly to the dashboard when Stripe is already connected', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, redirectTo: '/vendor' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, dashboardPath: '/vendor' })) as typeof fetch

    render(<VendorClaimFlow token="claim-token" details={baseDetails({
      stripe_account: {
        stripe_account_id: 'acct_ready',
        account_status: 'active',
        charges_enabled: true,
        payouts_enabled: true,
      },
    })} />)

    await completeClaimSteps(user)

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/vendor?claim_complete=1&stripe=connected')
    })
  })
})

async function completeClaimSteps(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Password/i), 'strong-password')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: /Claim and continue/i }))

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith('/api/vendor/claim', expect.objectContaining({ method: 'POST' }))
  })
}

function baseDetails(overrides: Partial<React.ComponentProps<typeof VendorClaimFlow>['details']> = {}) {
  return {
    vendor_id: 'vendor-1',
    vendor_name: 'DJ Maya',
    service_type: 'dj',
    email: 'maya@example.com',
    claim_status: 'invited_unclaimed',
    organizer_name: 'Bay Area Hosts',
    proposed_rate: {
      id: 'rate-1',
      amount: 500,
      rate_type: 'flat' as const,
      status: 'proposed',
    },
    stripe_account: null,
    ...overrides,
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
