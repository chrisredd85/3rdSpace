import { render, screen } from '@testing-library/react'
import { DepositDisplay } from '@/components/builder/DepositDisplay'

describe('DepositDisplay money units', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('calculates a percentage deposit from a cent-precision dollar estimate', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        requires_deposit: true,
        deposit_type: 'percentage',
        deposit_percentage: 25,
        deposit_refundable: true,
      }),
    }) as jest.Mock

    render(
      <DepositDisplay
        venueId="550e8400-e29b-41d4-a716-446655440101"
        bookingCost={95.5}
      />
    )

    expect((await screen.findAllByText('$23.88')).length).toBeGreaterThan(0)
    expect(screen.getByText('$71.63')).toBeInTheDocument()
    expect(screen.queryByText('$2,387.50')).not.toBeInTheDocument()
  })
})
