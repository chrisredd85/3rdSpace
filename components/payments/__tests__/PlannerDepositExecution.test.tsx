import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockHandleNextAction = jest.fn()
const mockLoadStripe = jest.fn(async () => ({
  handleNextAction: mockHandleNextAction,
}))

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: (...args: unknown[]) => mockLoadStripe(...args),
}))

import { PlannerDepositExecution } from '@/components/payments/PlannerDepositExecution'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PlannerDepositExecution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_planner_sca'
  })

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  })

  it('surfaces SCA, resumes authorization, and waits for a separate capture click', async () => {
    let authorizationCalls = 0
    let resolveVerification: ((value: unknown) => void) | undefined
    mockHandleNextAction.mockReturnValue(new Promise((resolve) => {
      resolveVerification = resolve
    }))
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/payments/authorize')) {
        authorizationCalls += 1
        return authorizationCalls === 1
          ? jsonResponse({
              paymentIntent: { id: '550e8400-e29b-41d4-a716-446655440301', status: 'requested' },
              requires_action: true,
              client_secret: 'pi_sca_secret_test',
              stripe_status: 'requires_action',
            })
          : jsonResponse({
              paymentIntent: { id: '550e8400-e29b-41d4-a716-446655440301', status: 'authorized' },
            })
      }
      if (url === '/api/payments/capture') {
        return jsonResponse({
          paymentIntent: { id: '550e8400-e29b-41d4-a716-446655440301', status: 'captured' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as jest.Mock

    render(
      <PlannerDepositExecution
        planId="550e8400-e29b-41d4-a716-446655440302"
        approvalId="550e8400-e29b-41d4-a716-446655440303"
        provider="Test vendor"
        amountLabel="$100.00"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Authorize deposit' }))
    expect(await screen.findByText(/Additional verification required/)).toBeInTheDocument()

    resolveVerification?.({
      paymentIntent: { id: 'pi_sca', status: 'requires_capture' },
    })
    expect(await screen.findByText(/Card verified/)).toBeInTheDocument()
    expect(mockHandleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_sca_secret_test' })
    expect(global.fetch).not.toHaveBeenCalledWith('/api/payments/capture', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Capture approved deposit' }))
    expect(await screen.findByText(/Deposit captured/)).toBeInTheDocument()
    expect(authorizationCalls).toBe(2)
    expect(global.fetch).toHaveBeenCalledWith('/api/payments/capture', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        paymentIntentId: '550e8400-e29b-41d4-a716-446655440301',
        approvalId: '550e8400-e29b-41d4-a716-446655440303',
        explicitUserConfirmation: true,
      }),
    }))
  })

  it('clears an abandoned SCA attempt and allows an idempotent retry', async () => {
    mockHandleNextAction.mockResolvedValue({
      error: { message: 'The verification window was closed.' },
    })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/payments/authorize')) {
        return jsonResponse({
          paymentIntent: { id: '550e8400-e29b-41d4-a716-446655440311', status: 'requested' },
          requires_action: true,
          client_secret: 'pi_abandoned_secret_test',
          stripe_status: 'requires_action',
        })
      }
      if (url.endsWith('/payments/authentication')) {
        return jsonResponse({ status: 'retry_allowed', outcome: 'abandoned' })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as jest.Mock

    render(
      <PlannerDepositExecution
        planId="550e8400-e29b-41d4-a716-446655440312"
        approvalId="550e8400-e29b-41d4-a716-446655440313"
        provider="Test venue"
        amountLabel="$250.00"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Authorize deposit' }))

    expect(await screen.findByText('The verification window was closed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeEnabled()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/payments/authentication'),
      expect.objectContaining({
        body: JSON.stringify({
          approvalId: '550e8400-e29b-41d4-a716-446655440313',
          outcome: 'abandoned',
        }),
      })
    )
    expect(global.fetch).not.toHaveBeenCalledWith('/api/payments/capture', expect.anything())
  })

  it('deduplicates concurrent authorization clicks in the client', async () => {
    let resolveAuthorization: ((response: Response) => void) | undefined
    const authorization = new Promise<Response>((resolve) => {
      resolveAuthorization = resolve
    })
    global.fetch = jest.fn(() => authorization) as jest.Mock

    render(
      <PlannerDepositExecution
        planId="550e8400-e29b-41d4-a716-446655440322"
        approvalId="550e8400-e29b-41d4-a716-446655440323"
        provider="Test vendor"
        amountLabel="$75.00"
      />
    )

    const button = screen.getByRole('button', { name: 'Authorize deposit' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    resolveAuthorization?.(jsonResponse({
      paymentIntent: { id: '550e8400-e29b-41d4-a716-446655440321', status: 'authorized' },
    }))
    await waitFor(() => expect(screen.getByText(/Card verified/)).toBeInTheDocument())
  })
})
