'use client'

import { Check, CreditCard, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StripeOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onStart: () => void
  isLoading?: boolean
}

const STEPS = [
  {
    title: 'Confirm business details',
    description: 'Legal business name, address, and ownership information.',
  },
  {
    title: 'Add payout banking',
    description: 'Stripe stores the bank account. 3rdPlace never handles those credentials.',
  },
  {
    title: 'Complete identity checks',
    description: 'Stripe may request SSN last four, date of birth, or representative details.',
  },
  {
    title: 'Return to 3rdPlace',
    description: 'We refresh Stripe and enable payouts only after Stripe verifies the account.',
  },
]

/**
 * Step-by-step guide shown before sending vendors to Stripe.
 */
export function StripeOnboardingModal({
  isOpen,
  onClose,
  onStart,
  isLoading = false,
}: StripeOnboardingModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stripe-connect-title"
        aria-describedby="stripe-connect-description"
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-gradient-card shadow-card"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Payout verification
            </div>
            <h2 id="stripe-connect-title" className="mt-3 font-display text-2xl font-bold text-foreground">Connect Stripe</h2>
            <p id="stripe-connect-description" className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Stripe Express securely handles verification and payouts. 3rdPlace confirms account creation by refreshing Stripe after you return.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-2xl p-2 text-muted-foreground transition-smooth hover:bg-card/70 hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-border bg-background/45 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  {index === 0 ? <Check className="h-4 w-4" /> : <span className="text-sm font-semibold">{index + 1}</span>}
                </div>
                <div>
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-6 sm:flex-row sm:justify-end">
          <Button type="button" variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="hero" onClick={onStart} disabled={isLoading}>
            <CreditCard className="h-4 w-4" />
            Continue to Stripe
          </Button>
        </div>
      </div>
    </div>
  )
}
