import { render } from '@testing-library/react'
import { BookingRequestForm } from '@/components/forms/BookingRequestForm'
import type { VenueBookingCostCents } from '@/lib/money'

const mockDepositDisplay = jest.fn(() => null)

jest.mock('@/components/builder/DepositDisplay', () => ({
  DepositDisplay: (props: unknown) => mockDepositDisplay(props),
}))

jest.mock('@/components/builder/VenueRulesDisplay', () => ({
  VenueRulesDisplay: () => null,
}))

describe('BookingRequestForm money boundary', () => {
  beforeEach(() => {
    mockDepositDisplay.mockClear()
  })

  it('converts the canonical booking estimate from cents to dollars once', () => {
    render(
      <BookingRequestForm
        type="venue"
        venueId="550e8400-e29b-41d4-a716-446655440101"
        bookingCostCents={9550 as VenueBookingCostCents}
        onSubmit={jest.fn()}
      />
    )

    expect(mockDepositDisplay).toHaveBeenCalled()
    for (const [props] of mockDepositDisplay.mock.calls) {
      expect(props).toEqual(expect.objectContaining({
        venueId: '550e8400-e29b-41d4-a716-446655440101',
        bookingCost: 95.5,
      }))
    }
  })
})
