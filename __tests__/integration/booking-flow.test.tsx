/**
 * Integration test for booking flow
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/lib/test-utils'
import { BookingRequestForm } from '@/components/forms/BookingRequestForm'

// Mock Supabase
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: { id: 'booking-1' }, error: null })),
        })),
      })),
    })),
  },
}))

describe('Booking Flow Integration', () => {
  it('should create a booking request', async () => {
    const user = userEvent.setup()
    const onSubmit = jest.fn()

    renderWithProviders(
      <BookingRequestForm
        type="venue"
        venueId="venue-1"
        onSubmit={onSubmit}
      />
    )

    // Fill in form
    const dateInput = screen.getByLabelText(/date/i)
    await user.type(dateInput, '2024-12-31')

    const guestCountInput = screen.getByLabelText(/guest/i)
    await user.type(guestCountInput, '100')

    // Submit form
    const submitButton = screen.getByRole('button', { name: /submit/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })
  })
})
