'use client'

import { useEffect, useMemo, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js'
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PaymentType = 'deposit' | 'final_payment'

type PaymentFormProps = {
  bookingId: string
  paymentType?: PaymentType
  onPaymentSucceeded?: (transaction: unknown) => void
}

type CreateIntentResponse = {
  clientSecret?: string
  paymentIntentId?: string
  error?: string
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

function InnerPaymentForm({
  paymentIntentId,
  onPaymentSucceeded,
}: {
  paymentIntentId: string
  onPaymentSucceeded?: (transaction: unknown) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitPayment = async () => {
    if (!stripe || !elements) return

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      })

      if (result.error) {
        setError(result.error.message || 'Payment could not be confirmed.')
        setIsSubmitting(false)
        return
      }

      const confirmResponse = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paymentIntentId: result.paymentIntent?.id || paymentIntentId,
        }),
      })
      const confirmData = await confirmResponse.json()

      if (!confirmResponse.ok) {
        throw new Error(confirmData.error || 'Payment was accepted, but finalization failed.')
      }

      onPaymentSucceeded?.(confirmData.transaction)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Payment failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}
      <Button type="button" onClick={submitPayment} disabled={!stripe || !elements || isSubmitting}>
        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
        Pay now
      </Button>
    </div>
  )
}

/**
 * Stripe Payment Element form for vendor booking payments.
 */
export function PaymentForm({
  bookingId,
  paymentType = 'deposit',
  onPaymentSucceeded,
}: PaymentFormProps) {
  const [intent, setIntent] = useState<CreateIntentResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function createIntent() {
      if (!stripePromise) {
        setError('Stripe publishable key is not configured.')
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/payments/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ bookingId, paymentType }),
        })
        const data = await response.json()

        if (!response.ok) throw new Error(data.error || 'Unable to start payment.')
        if (isMounted) setIntent(data)
      } catch (loadError) {
        if (isMounted) setError(loadError instanceof Error ? loadError.message : 'Unable to start payment.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    createIntent()

    return () => {
      isMounted = false
    }
  }, [bookingId, paymentType])

  const options = useMemo<StripeElementsOptions | undefined>(() => {
    if (!intent?.clientSecret) return undefined

    return {
      clientSecret: intent.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          borderRadius: '8px',
          colorPrimary: '#2f6f4e',
        },
      },
    }
  }, [intent?.clientSecret])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing secure payment...
      </div>
    )
  }

  if (error || !stripePromise || !intent?.clientSecret || !intent.paymentIntentId || !options) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <div className="flex gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error || 'Payment could not be started.'}</span>
        </div>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <InnerPaymentForm paymentIntentId={intent.paymentIntentId} onPaymentSucceeded={onPaymentSucceeded} />
    </Elements>
  )
}
