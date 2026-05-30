import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VenueRentalPaymentMethodPicker } from '@/components/planner/VenueRentalPaymentMethodPicker'

describe('VenueRentalPaymentMethodPicker', () => {
  it('renders exact card and ACH fee math and selects a method', async () => {
    const onSelect = jest.fn()
    const user = userEvent.setup()

    render(
      <VenueRentalPaymentMethodPicker
        venuePaymentTransactionId={null}
        amountCents={120000}
        onSelect={onSelect}
        isSubmitting={false}
      />
    )

    expect(screen.getByText('Pay by card')).toBeInTheDocument()
    expect(screen.getByText('Pay by ACH')).toBeInTheDocument()
    expect(screen.getByText('$35.10')).toBeInTheDocument()
    expect(screen.getByText('$1,235.10')).toBeInTheDocument()
    expect(screen.getByText('$5.00')).toBeInTheDocument()
    expect(screen.getByText('$1,205.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Pay by ACH/i }))

    expect(onSelect).toHaveBeenCalledWith('us_bank_account')
  })
})
