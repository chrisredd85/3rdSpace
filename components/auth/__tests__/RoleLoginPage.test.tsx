import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const originalFetch = global.fetch

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

describe('RoleLoginPage account creation placement', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('places account creation next to the form sign-in action', () => {
    renderRoleLoginPage()

    expect(screen.getByText('Creator portal')).toBeInTheDocument()
    expect(screen.queryByText('New here?')).not.toBeInTheDocument()

    const loginActions = screen.getByRole('group', { name: 'Login actions' })
    expect(loginActions).toHaveClass('sm:grid-cols-2')
    expect(within(loginActions).getByRole('button', { name: /Sign in/i })).toHaveAttribute('type', 'submit')
    const formCreateAccount = within(loginActions).getByRole('link', { name: 'Create account' })
    expect(formCreateAccount).toHaveAttribute('href', '/signup/builder')
    expect(formCreateAccount).toHaveClass('w-full')

    const createAccountLinks = screen.getAllByRole('link', { name: 'Create account' })
    expect(createAccountLinks[0]).toHaveAttribute('href', '/signup/builder')
    expect(createAccountLinks[0]).toHaveClass('hidden')
    expect(createAccountLinks[0]).toHaveClass('sm:inline-flex')
  })

  it('stacks partner login links centered underneath the form actions', () => {
    renderRoleLoginPage()

    const partnerLinks = screen.getByLabelText('Partner login links')
    expect(partnerLinks).toHaveClass('flex-col')
    expect(partnerLinks).toHaveClass('items-center')
    expect(partnerLinks).toHaveClass('text-center')
    expect(within(partnerLinks).getByRole('link', { name: 'Venue partner login' })).toHaveAttribute('href', '/login/venue')
    expect(within(partnerLinks).getByRole('link', { name: 'Vendor login' })).toHaveAttribute('href', '/login/vendor')
    expect(within(partnerLinks).queryByText('·')).not.toBeInTheDocument()
  })

  it('shows a credentials error when email and password do not match an account', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'We could not find an account matching that email and password.',
    }), { status: 401 })) as typeof fetch

    renderRoleLoginPage()

    await user.type(screen.getByLabelText('Email'), 'missing@example.com')
    await user.type(screen.getByLabelText('Password'), 'not-the-password')
    await user.click(screen.getByRole('button', { name: /Sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find an account matching that email and password.')
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'missing@example.com',
        password: 'not-the-password',
        expectedUserType: 'community_builder',
      }),
    }))
  })
})
