import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VenueRentalPaymentButton } from '@/components/planner/VenueRentalPaymentButton'

describe('VenueRentalPaymentButton', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    global.fetch = jest.fn()
  })

  it('opens the method picker and redirects to hosted Checkout on success', async () => {
    const fetchMock = global.fetch as jest.Mock
    const redirectTo = jest.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      hosted_checkout_url: 'https://checkout.test/session',
      transaction_id: 'tx-1',
    }))
    const user = userEvent.setup()

    render(
      <VenueRentalPaymentButton
        planId="plan-1"
        venueBookingId="booking-1"
        approvalId="approval-1"
        venueName="The Roof"
        amountCents={120000}
        redirectTo={redirectTo}
      />
    )

    await user.click(screen.getByRole('button', { name: /Pay \$1,200.00 to The Roof/i }))
    await user.click(screen.getByRole('button', { name: /Pay by card/i }))

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith('https://checkout.test/session'))
    expect(fetchMock).toHaveBeenCalledWith('/api/planner/plans/plan-1/venue-payment/checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        venue_booking_id: 'booking-1',
        approval_id: 'approval-1',
        payment_method_type: 'card',
      }),
    }))
  })

  it('opens the billing gate when the checkout route returns 402', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({
      error: 'Upgrade to create more events.',
      billingRequired: true,
    }, 402))
    const user = userEvent.setup()
    const redirectTo = jest.fn()

    render(
      <VenueRentalPaymentButton
        planId="plan-1"
        venueBookingId="booking-1"
        approvalId="approval-1"
        venueName="The Roof"
        amountCents={120000}
        redirectTo={redirectTo}
      />
    )

    await user.click(screen.getByRole('button', { name: /Pay \$1,200.00 to The Roof/i }))
    await user.click(screen.getByRole('button', { name: /Pay by ACH/i }))

    expect(await screen.findByText(/Choose how to keep planning/i)).toBeInTheDocument()
    expect(screen.getByText(/Upgrade to create more events/i)).toBeInTheDocument()
    expect(redirectTo).not.toHaveBeenCalled()
  })

  it('shows team-handoff errors without redirecting', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({
      error: 'venue_concierge_required',
      concierge_required: true,
    }, 409))
    const user = userEvent.setup()
    const redirectTo = jest.fn()

    render(
      <VenueRentalPaymentButton
        planId="plan-1"
        venueBookingId="booking-1"
        approvalId="approval-1"
        venueName="Team Venue"
        amountCents={120000}
        redirectTo={redirectTo}
      />
    )

    await user.click(screen.getByRole('button', { name: /Pay \$1,200.00 to Team Venue/i }))
    await user.click(screen.getByRole('button', { name: /Pay by card/i }))

    expect(await screen.findByText(/Contact the 3rdPlace team to complete this booking/i)).toBeInTheDocument()
    expect(redirectTo).not.toHaveBeenCalled()
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
