import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorState } from '../ErrorState'

describe('ErrorState Component', () => {
  it('should render error message', () => {
    const error = new Error('Something went wrong')
    render(<ErrorState error={error} />)

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
  })

  it('should call onRetry when retry button is clicked', async () => {
    const error = new Error('Network error')
    const onRetry = jest.fn()
    const user = userEvent.setup()

    render(<ErrorState error={error} onRetry={onRetry} />)

    const retryButton = screen.getByRole('button', { name: /retry/i })
    await user.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('should display network error message for network errors', () => {
    const error = new TypeError('Failed to fetch')
    render(<ErrorState error={error} />)

    expect(screen.getByText(/connection lost/i)).toBeInTheDocument()
  })

  it('should display 404 error message for not found errors', () => {
    const error = { response: { status: 404 } }
    render(<ErrorState error={error} />)

    expect(screen.getByText(/not found/i)).toBeInTheDocument()
  })

  it('should display support link when provided', () => {
    const error = new Error('Error')
    render(<ErrorState error={error} supportLink="/contact" />)

    expect(screen.getByRole('link', { name: /contact support/i })).toHaveAttribute('href', '/contact')
  })
})
