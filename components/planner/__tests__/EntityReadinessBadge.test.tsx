import { render, screen } from '@testing-library/react'

import { EntityReadinessBadge } from '@/components/planner/EntityReadinessBadge'
import type { EntityReadinessIndicator } from '@/lib/planner/entityStripeReadiness'

describe('EntityReadinessBadge', () => {
  it.each([
    ['Awaiting claim', 'Clock', 'muted'],
    ['Stripe setup needed', 'AlertCircle', 'warning'],
    ['Stripe restricted', 'AlertTriangle', 'destructive'],
    ['Stripe-ready', 'CheckCircle2', 'success'],
    ['Committed · $5,500', 'ShieldCheck', 'success'],
  ] as const)('renders %s with its configured icon and tone', (label, icon, tone) => {
    const indicator: EntityReadinessIndicator = {
      status: label === 'Committed · $5,500' ? 'committed' : 'invited',
      label,
      subtext: 'Status detail',
      icon,
      tone,
    }

    render(<EntityReadinessBadge indicator={indicator} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('Status detail')).toBeInTheDocument()
    const badge = screen.getByText(label).closest('[data-readiness-icon]')
    expect(badge).toHaveAttribute('data-readiness-icon', icon)
    expect(badge).toHaveAttribute('data-readiness-tone', tone)
  })

  it('does not render an empty subtext span', () => {
    render(<EntityReadinessBadge indicator={{
      status: 'stripe_ready',
      label: 'Stripe-ready',
      subtext: null,
      icon: 'CheckCircle2',
      tone: 'success',
    }} />)

    expect(screen.getByText('Stripe-ready')).toBeInTheDocument()
    expect(screen.queryByText('Status detail')).not.toBeInTheDocument()
  })

  it('renders nothing for a null indicator', () => {
    const { container } = render(<EntityReadinessBadge indicator={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
