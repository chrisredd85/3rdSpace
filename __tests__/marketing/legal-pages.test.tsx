import { fireEvent, render, screen } from '@testing-library/react'
import PrivacyPage from '@/app/(marketing)/privacy/page'
import TermsPage from '@/app/(marketing)/terms/page'
import { CookieBanner } from '@/components/marketing/CookieBanner'

describe('legal scaffold pages', () => {
  it('renders privacy policy draft banner and required sections', () => {
    render(<PrivacyPage />)

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getByText(/DRAFT - pending legal review/i)).toBeInTheDocument()
    expect(screen.getByText('1. Introduction')).toBeInTheDocument()
    expect(screen.getByText('2. Information we collect')).toBeInTheDocument()
    expect(screen.getByText('5. Google user data and Gmail Limited Use')).toBeInTheDocument()
    expect(screen.getByText('6. Cookies and tracking')).toBeInTheDocument()
    expect(screen.getByText('12. Contact us')).toBeInTheDocument()
  })

  it('renders terms draft banner and required sections', () => {
    render(<TermsPage />)

    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
    expect(screen.getByText(/DRAFT - pending legal review/i)).toBeInTheDocument()
    expect(screen.getByText('1. Acceptance of terms')).toBeInTheDocument()
    expect(screen.getByText('5. Subscriptions and billing')).toBeInTheDocument()
    expect(screen.getByText('7. Outreach and Gmail integration')).toBeInTheDocument()
    expect(screen.getByText('14. Contact')).toBeInTheDocument()
    expect(screen.getByText(/\$79 per month for Pro/i)).toBeInTheDocument()
    expect(screen.queryByText(/\$69 per month for Pro/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Last updated: July 1, 2026/i).length).toBeGreaterThan(0)
  })
})

describe('CookieBanner', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('appears on first visit and hides after consent', () => {
    render(<CookieBanner />)

    expect(screen.getByText(/We use cookies to improve your experience/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toHaveClass('z-40')
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toHaveClass('top-[calc(env(safe-area-inset-top)+0.75rem)]')
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toHaveClass('sm:bottom-0')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(window.localStorage.getItem('cookie_consent_v1')).toBe('accepted')
    expect(screen.queryByText(/We use cookies to improve your experience/i)).not.toBeInTheDocument()
  })

  it('stays hidden when consent was already recorded', () => {
    window.localStorage.setItem('cookie_consent_v1', 'accepted')
    render(<CookieBanner />)

    expect(screen.queryByText(/We use cookies to improve your experience/i)).not.toBeInTheDocument()
  })
})
