import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_planner_setup'

const mockConfirmSetup = jest.fn()
const mockElements = {}

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: jest.fn(async () => ({ id: 'stripe-js' })),
}))

jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div>Secure Stripe card fields</div>,
  useStripe: () => ({ confirmSetup: mockConfirmSetup }),
  useElements: () => mockElements,
}))

import { PlannerPaymentMethodSelector } from '@/components/payments/PlannerPaymentMethodSelector'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PlannerPaymentMethodSelector', () => {
  const originalCrypto = globalThis.crypto

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        ...originalCrypto,
        randomUUID: jest.fn(() => '550e8400-e29b-41d4-a716-446655440501'),
      },
    })
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  })

  it('reaches SetupIntent binding from an empty state and selects the verified organizer card', async () => {
    const onSelect = jest.fn()
    mockConfirmSetup.mockResolvedValue({
      setupIntent: { id: 'seti_planner_bound', status: 'succeeded' },
    })
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/planner/payment-methods' && !init?.method) {
        return jsonResponse({ paymentMethods: [] })
      }
      if (url === '/api/planner/payment-methods' && init?.method === 'POST') {
        return jsonResponse({
          setupIntentId: 'seti_planner_bound',
          clientSecret: 'seti_planner_bound_secret_test',
        })
      }
      if (url === '/api/planner/payment-methods/confirm') {
        return jsonResponse({
          paymentMethod: {
            id: 'pm_organizer_bound',
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2032,
            isDefault: false,
          },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as jest.Mock

    render(
      <PlannerPaymentMethodSelector
        selectedPaymentMethodId={null}
        onSelect={onSelect}
      />
    )

    expect(await screen.findByText(/Add a payment method before authorizing/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a payment method' }))

    expect(await screen.findByText('Secure Stripe card fields')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/planner/payment-methods', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ setupAttemptId: '550e8400-e29b-41d4-a716-446655440501' }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Save payment method' }))

    await waitFor(() => expect(mockConfirmSetup).toHaveBeenCalledWith(expect.objectContaining({
      elements: mockElements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    })))
    expect(await screen.findByText(/Visa ending in 4242/)).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith('pm_organizer_bound')
    expect(global.fetch).toHaveBeenCalledWith('/api/planner/payment-methods/confirm', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ setupIntentId: 'seti_planner_bound' }),
    }))
  })
})
