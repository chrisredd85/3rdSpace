'use client'

import { CreditCard } from 'lucide-react'

interface StripeIntegrationNoticeProps {
  context?: 'settings' | 'booking' | 'inline'
  className?: string
}

const COPY = {
  settings: {
    title: 'Stripe payments are coming soon',
    body: 'Deposit terms can be saved now, but automated payment collection, refunds, and payout handling will stay as placeholders until Stripe is connected.',
  },
  booking: {
    title: 'No payment will be collected yet',
    body: 'This request records the deposit terms for review. Stripe checkout and saved payment methods will be connected before live collection is enabled.',
  },
  inline: {
    title: 'Stripe pending',
    body: 'Payment collection is temporarily informational until Stripe is connected.',
  },
}

/**
 * Shows a consistent placeholder while Stripe payment flows are not connected.
 *
 * @param props - Notice context and optional CSS classes.
 * @returns Stripe integration placeholder notice.
 */
export function StripeIntegrationNotice({
  context = 'inline',
  className = '',
}: StripeIntegrationNoticeProps) {
  const copy = COPY[context]

  return (
    <div className={`rounded-lg border border-primary/30 bg-primary/10 p-3 text-foreground ${className}`}>
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary/80" />
        <div>
          <p className="text-sm font-semibold">{copy.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{copy.body}</p>
        </div>
      </div>
    </div>
  )
}
