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

import { POST } from '@/app/api/venue/community-host-incentive/[id]/checkout/route'
import { getStripeClient } from '@/lib/stripe/connect'

const mockGetStripeClient = getStripeClient as jest.Mock

describe('CHI settlement legacy checkout guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps the legacy direct checkout endpoint disabled', async () => {
    const response = await POST(
      new Request('https://www.3rdplace.io/api/venue/community-host-incentive/payment-1/checkout', {
        method: 'POST',
      }) as never,
    )

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      code: 'legacy_chi_checkout_disabled',
    })
    expect(mockGetStripeClient).not.toHaveBeenCalled()
  })
})
