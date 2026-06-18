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
  },
}))

jest.mock('@sentry/nextjs', () => ({
  captureMessage: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { POST } from '@/app/api/venue/community-host-incentive/[id]/checkout/route'
import { getStripeClient } from '@/lib/stripe/connect'

const mockCaptureMessage = Sentry.captureMessage as jest.Mock
const mockGetStripeClient = getStripeClient as jest.Mock

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111'

function makeRequest() {
  return new Request(`http://localhost/api/venue/community-host-incentive/${PAYMENT_ID}/checkout`, {
    method: 'POST',
  }) as never
}

describe('legacy CHI checkout disabled route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 410 Gone, alerts Sentry, and never calls Stripe', async () => {
    const response = await POST(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(410)
    expect(json).toEqual({
      error:
        'This payment flow has been replaced. CHI settlements now run automatically on a schedule. Check Settings -> Settlements for your active settlement records.',
      code: 'legacy_chi_checkout_disabled',
    })
    expect(mockCaptureMessage).toHaveBeenCalledWith('legacy_chi_checkout_called', {
      level: 'warning',
      tags: { action: 'legacy_chi_checkout_called' },
    })
    expect(mockGetStripeClient).not.toHaveBeenCalled()
  })
})
