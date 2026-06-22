import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SignupExperience } from '@/components/auth/SignupExperience'
import { ToastProvider } from '@/components/ui/toast'
import { migratePlannerDraftToServer } from '@/lib/planner/migrateDraft'
import { createClient } from '@/lib/supabase/client'

jest.mock('@/lib/planner/migrateDraft', () => ({
  migratePlannerDraftToServer: jest.fn(),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockMigratePlannerDraftToServer = migratePlannerDraftToServer as jest.Mock
const mockSignInWithOAuth = jest.fn()
const originalFetch = global.fetch

function renderSignup(initialUserType: 'community_builder' | 'venue_owner' | 'vendor') {
  return render(
    <ToastProvider>
      <SignupExperience initialUserType={initialUserType} />
    </ToastProvider>
  )
}

function continueButton() {
  return screen.getByRole('button', { name: /^continue$/i })
}

describe('SignupExperience step validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = originalFetch
    mockCreateClient.mockReturnValue({
      auth: {
        signInWithOAuth: mockSignInWithOAuth.mockResolvedValue({ error: null }),
      },
    })
    mockMigratePlannerDraftToServer.mockResolvedValue(null)
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('shows creator as a 5-step flow and gates each signup step', async () => {
    renderSignup('community_builder')

    expect(screen.getByText(/Creator sign-up · Step 1 of 5/i)).toBeInTheDocument()
    expect(screen.queryByText(/Step 1 of 4/i)).not.toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Alex Rivera'), { target: { value: 'Alex Rivera' } })
    fireEvent.change(screen.getByPlaceholderText('alex@brand.com'), { target: { value: 'alex@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    expect(continueButton()).toBeEnabled()

    fireEvent.click(continueButton())
    expect(screen.getByText(/Creator sign-up · Step 2 of 5/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Organization name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Sunset Social Club'), { target: { value: 'Sunset Social Club' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Social group / Community' } })
    fireEvent.change(screen.getByPlaceholderText("What's your scene? Who do you throw events for?"), {
      target: { value: 'Recurring community dinners and talks.' },
    })
    expect(continueButton()).toBeEnabled()

    fireEvent.click(continueButton())
    expect(screen.getByText(/Creator sign-up · Step 3 of 5/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Networking mixer/i }))
    fireEvent.change(screen.getByPlaceholderText('e.g. 150'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: /Full bar/i }))
    expect(continueButton()).toBeEnabled()

    fireEvent.click(continueButton())
    expect(screen.getByText(/Creator sign-up · Step 4 of 5/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create account & activate/i })).toBeDisabled()

    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      requiresEmailConfirmation: false,
      user: { email: 'alex@example.com' },
      ticketingConnections: [],
    }), { status: 200 })) as jest.Mock

    fireEvent.click(screen.getByRole('button', { name: /Eventbrite/i }))
    expect(screen.getByRole('button', { name: /Create account & activate/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Create account & activate/i }))

    await waitFor(() => {
      expect(screen.getByText(/Creator sign-up · Step 5 of 5/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: /Connect Gmail to send outreach/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect Gmail/i })).toHaveAttribute(
      'href',
      '/api/integrations/gmail/connect?returnTo=%2Fplanner%3Fsignup%3Dcomplete%26gmail%3Dconnected'
    )
    expect(screen.getByRole('button', { name: /I'll connect later/i })).toBeInTheDocument()
  })

  it('starts creator Google signup with the signup callback flags', async () => {
    renderSignup('community_builder')

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: expect.stringContaining('/auth/callback'),
        },
      })
    })

    const redirectTo = mockSignInWithOAuth.mock.calls[0][0].options.redirectTo as string
    const callbackUrl = new URL(redirectTo)
    expect(callbackUrl.searchParams.get('expected_user_type')).toBe('community_builder')
    expect(callbackUrl.searchParams.get('auth_flow')).toBe('signup')
    expect(callbackUrl.searchParams.get('next')).toBe(
      '/api/integrations/gmail/connect?returnTo=%2Fplanner%3Fsignup%3Dcomplete%26gmail%3Dconnected'
    )
  })

  it('does not show Google signup on venue or vendor signup forms', () => {
    const { unmount } = renderSignup('venue_owner')
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).not.toBeInTheDocument()
    unmount()

    renderSignup('vendor')
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).not.toBeInTheDocument()
  })

  it('gates venue signup contact and listing-detail steps', async () => {
    renderSignup('venue_owner')

    expect(screen.getByText(/Venue sign-up · Step 1 of 5/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Point-of-contact name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Jordan Lee'), { target: { value: 'Jordan Lee' } })
    fireEvent.change(screen.getByPlaceholderText('GM / Owner / Booker'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByPlaceholderText('bookings@venue.com'), { target: { value: 'bookings@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 555-5555'), { target: { value: '555-555-5555' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    expect(continueButton()).toBeEnabled()

    fireEvent.click(continueButton())
    expect(screen.getByText(/Venue sign-up · Step 2 of 5/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Venue name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('The Foundry Loft'), { target: { value: 'The Foundry Loft' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Rooftop' } })
    fireEvent.change(screen.getByPlaceholderText('123 Industry Rd, Brooklyn NY'), { target: { value: '123 Market St' } })
    fireEvent.change(screen.getByPlaceholderText('Brooklyn'), { target: { value: 'San Francisco' } })
    fireEvent.change(screen.getByPlaceholderText('NY'), { target: { value: 'CA' } })
    fireEvent.change(screen.getByPlaceholderText('11201'), { target: { value: '94103' } })
    fireEvent.change(screen.getByPlaceholderText('250'), { target: { value: '250' } })
    expect(continueButton()).toBeEnabled()
  })

  it('collects venue-supported commercial terms without asking venues to set CHI rates', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      requiresEmailConfirmation: true,
      user: { email: 'bookings@example.com' },
    }), { status: 200 })) as jest.Mock
    renderSignup('venue_owner')

    fireEvent.change(screen.getByPlaceholderText('Jordan Lee'), { target: { value: 'Jordan Lee' } })
    fireEvent.change(screen.getByPlaceholderText('GM / Owner / Booker'), { target: { value: 'Owner' } })
    fireEvent.change(screen.getByPlaceholderText('bookings@venue.com'), { target: { value: 'bookings@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 555-5555'), { target: { value: '555-555-5555' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(continueButton())

    fireEvent.change(screen.getByPlaceholderText('The Foundry Loft'), { target: { value: 'The Foundry Loft' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Bar' } })
    fireEvent.change(screen.getByPlaceholderText('123 Industry Rd, Brooklyn NY'), { target: { value: '123 Market St' } })
    fireEvent.change(screen.getByPlaceholderText('Brooklyn'), { target: { value: 'San Francisco' } })
    fireEvent.change(screen.getByPlaceholderText('NY'), { target: { value: 'CA' } })
    fireEvent.change(screen.getByPlaceholderText('11201'), { target: { value: '94103' } })
    fireEvent.change(screen.getByPlaceholderText('250'), { target: { value: '250' } })
    fireEvent.click(continueButton())

    fireEvent.click(screen.getByRole('button', { name: /Full bar/i }))
    fireEvent.change(screen.getByPlaceholderText(/No outside alcohol/i), {
      target: { value: 'No outside alcohol. Music off by midnight.' },
    })
    fireEvent.click(continueButton())

    fireEvent.click(screen.getByRole('switch', { name: /This venue has bar or beverage sales/i }))
    expect(screen.getByText('Commercial terms you are open to')).toBeInTheDocument()
    expect(screen.getByText(/3rdPlace calculates the recommended CHI/i)).toBeInTheDocument()
    expect(screen.queryByText(/Bar Community Host Incentive to creator/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('2000'), { target: { value: '2000' } })
    fireEvent.change(screen.getByPlaceholderText('3500'), { target: { value: '3500' } })
    fireEvent.change(screen.getByPlaceholderText('1500'), { target: { value: '1500' } })
    fireEvent.change(screen.getByPlaceholderText(/Full refund 30/i), {
      target: { value: 'Full refund 30+ days out.' },
    })
    fireEvent.click(continueButton())

    fireEvent.click(screen.getByRole('button', { name: 'Fri' }))
    fireEvent.click(screen.getByRole('button', { name: /Publish my venue listing/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/signup', expect.objectContaining({
        method: 'POST',
      }))
    })
    const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(payload).toEqual(expect.objectContaining({
      userType: 'venue_owner',
      has_bar: true,
      supported_commercial_terms: ['minimum_spend', 'bar_consumption_chi'],
      bar_chi_pct: null,
      per_head_drink_pct: null,
      min_bar_spend: 2000,
    }))
  })

  it('gates vendor signup contact and service-detail steps', async () => {
    renderSignup('vendor')

    expect(screen.getByText(/Vendor sign-up · Step 1 of 4/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Sam Carter'), { target: { value: 'Sam Carter' } })
    fireEvent.change(screen.getByPlaceholderText('DJ Solstice'), { target: { value: 'DJ Solstice' } })
    fireEvent.change(screen.getByPlaceholderText('hello@vendor.com'), { target: { value: 'hello@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('+1 (555) 555-5555'), { target: { value: '555-555-5555' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    expect(continueButton()).toBeEnabled()

    fireEvent.click(continueButton())
    expect(screen.getByText(/Vendor sign-up · Step 2 of 4/i)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByText('Select at least one service.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /DJ/i }))
    fireEvent.change(screen.getByPlaceholderText('NYC + tri-state, will travel'), { target: { value: 'Bay Area' } })
    fireEvent.change(screen.getByPlaceholderText('https://instagram.com/...'), { target: { value: 'https://instagram.com/djsolstice' } })
    fireEvent.change(screen.getByPlaceholderText('What do you bring to a room? Notable past gigs, vibe, specialties...'), {
      target: { value: 'Open-format DJ for founder events.' },
    })
    expect(continueButton()).toBeEnabled()
  })
})
