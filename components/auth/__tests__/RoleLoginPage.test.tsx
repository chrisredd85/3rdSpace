import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { RoleLoginPage } from '@/components/auth/RoleLoginPage'
import { ToastProvider } from '@/components/ui/toast'

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient() {
    return {
      auth: {
        signInWithOAuth: jest.fn(),
      },
    }
  },
}))

function renderRoleLoginPage() {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RoleLoginPage portal="builder" />
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe('RoleLoginPage mobile account creation placement', () => {
  it('places account creation next to the form sign-in action', () => {
    renderRoleLoginPage()

    expect(screen.getByText('Creator portal')).toBeInTheDocument()
    expect(screen.queryByText('New here?')).not.toBeInTheDocument()

    const loginActions = screen.getByRole('group', { name: 'Login actions' })
    expect(within(loginActions).getByRole('button', { name: /Sign in/i })).toHaveAttribute('type', 'submit')
    expect(within(loginActions).getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/signup/builder')

    const createAccountLinks = screen.getAllByRole('link', { name: 'Create account' })
    expect(createAccountLinks[0]).toHaveAttribute('href', '/signup/builder')
    expect(createAccountLinks[0]).toHaveClass('hidden')
    expect(createAccountLinks[0]).toHaveClass('sm:inline-flex')
  })
})
