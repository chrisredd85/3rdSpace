'use client'

import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StripeOnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onStart: () => void
  isLoading?: boolean
}

const STEPS = [
  'Confirm your business details',
  'Add payout banking information',
  'Complete Stripe identity verification',
  'Return to 3rdPlace to start receiving payments',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-card/40 shadow-xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">Connect Stripe</h2>
            <p className="mt-1 text-sm text-muted-foreground">Stripe Express securely handles verification and payouts.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          {STEPS.map((step, index) => (
            <div key={step} className="flex gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                {index === 0 ? <Check className="h-4 w-4" /> : <span className="text-sm font-semibold">{index + 1}</span>}
              </div>
              <p className="pt-1 text-sm font-medium text-foreground">{step}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onStart} disabled={isLoading}>
            Continue to Stripe
          </Button>
        </div>
      </div>
    </div>
  )
}
