'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CreditCard, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VenueRentalPaymentMethodPicker } from '@/components/planner/VenueRentalPaymentMethodPicker'
import { usePlannerBillingGate } from '@/components/planner/usePlannerBillingGate'
import { centsToDollars } from '@/lib/money'
import type { VenueRentalPaymentMethodType } from '@/lib/payments/venue-rental'

interface VenueRentalPaymentButtonProps {
  planId: string
  venueBookingId: string
  venueName: string
  amountCents: number
  venuePaymentTransactionId?: string | null
  onSuccess?: () => void
  onError?: (msg: string) => void
  redirectTo?: (url: string) => void
}

type CheckoutResponse = {
  hosted_checkout_url?: string
  transaction_id?: string
  error?: string
  message?: string
  concierge_required?: boolean
  concierge_review_required?: boolean
  max_amount_cents?: number
}

export function VenueRentalPaymentButton({
  planId,
  venueBookingId,
  venueName,
  amountCents,
  venuePaymentTransactionId = null,
  onSuccess,
  onError,
  redirectTo,
}: VenueRentalPaymentButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const billingGate = usePlannerBillingGate()

  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false)
      setError(null)
    }
  }, [isOpen])

  async function startCheckout(paymentMethodType: VenueRentalPaymentMethodType) {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${planId}/venue-payment/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          venue_booking_id: venueBookingId,
          payment_method_type: paymentMethodType,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as CheckoutResponse

      if (billingGate.handleBillingRequiredResponse(response, payload)) {
        setIsSubmitting(false)
        return
      }

      if (!response.ok) {
        throw new Error(getCheckoutErrorMessage(response.status, payload))
      }

      if (!payload.hosted_checkout_url) {
        throw new Error('Stripe did not return a Checkout link.')
      }

      onSuccess?.()
      const redirect = redirectTo ?? ((url: string) => {
        window.location.href = url
      })
      redirect(payload.hosted_checkout_url)
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : 'Unable to start venue rental checkout.'
      setError(message)
      onError?.(message)
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button type="button" variant="hero" onClick={() => setIsOpen(true)}>
        <CreditCard className="h-4 w-4" />
        Pay {formatCents(amountCents)} to {venueName}
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 px-4 py-6 backdrop-blur-xl">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-rental-checkout-title"
            className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-tan bg-cream shadow-card"
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 rounded-full border border-tan bg-cream-deep p-2 text-ink-soft transition-smooth hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
              aria-label="Close venue rental checkout"
              disabled={isSubmitting}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="border-b border-tan px-6 py-5">
              <p className="label-caps text-clay">Venue rental</p>
              <h2 id="venue-rental-checkout-title" className="mt-2 font-display text-2xl font-semibold text-ink">
                Pay {venueName}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
                Choose card or ACH before Stripe Checkout opens. ACH transfers take 2-3 business days to settle in the venue&apos;s account.
              </p>
            </div>

            <div className="max-h-[calc(90vh-8rem)] overflow-y-auto p-6">
              {isSubmitting ? (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-clay/25 bg-clay-tint px-4 py-3 text-sm font-semibold text-clay">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating secure Stripe Checkout...
                </div>
              ) : null}

              <VenueRentalPaymentMethodPicker
                venuePaymentTransactionId={venuePaymentTransactionId}
                amountCents={amountCents}
                onSelect={(method) => void startCheckout(method)}
                isSubmitting={isSubmitting}
                error={error}
              />
            </div>
          </div>
        </div>
      ) : null}

      {billingGate.modal}
    </>
  )
}

function getCheckoutErrorMessage(status: number, payload: CheckoutResponse) {
  if (payload.concierge_required) {
    return 'Contact concierge to complete this booking: hello@3rdplace.io'
  }

  if (payload.concierge_review_required || payload.error === 'amount_exceeds_max') {
    const limit = payload.max_amount_cents ? ` Self-serve limit: ${formatCents(payload.max_amount_cents)}.` : ''
    return `This booking exceeds the self-serve limit. Contact concierge.${limit}`
  }

  if (status >= 500) {
    return payload.error || 'Something went wrong starting Checkout. Try again.'
  }

  return payload.error || payload.message || 'Unable to start venue rental checkout.'
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(centsToDollars(value))
}
