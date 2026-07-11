'use client'

import { useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type AuthorizationResponse = {
  paymentIntent?: {
    id?: string
    status?: string
  }
  requires_action?: boolean
  client_secret?: string
  stripe_status?: string
  error?: string
}

type CaptureResponse = {
  paymentIntent?: {
    id?: string
    status?: string
  }
  error?: string
}

type ExecutionState =
  | 'idle'
  | 'authorizing'
  | 'awaiting_authentication'
  | 'authorized'
  | 'capturing'
  | 'captured'
  | 'retry_allowed'

let stripePromise: ReturnType<typeof loadStripe> | null = null

function getStripePromise() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  if (!publishableKey) return null
  stripePromise ??= loadStripe(publishableKey)
  return stripePromise
}

/**
 * Organizer-controlled on-session SCA and capture flow for planner deposits.
 * Completing 3DS never captures money automatically; it reveals the separate
 * explicit capture confirmation required by the product contract.
 */
export function PlannerDepositExecution({
  planId,
  approvalId,
  provider,
  amountLabel,
  onCaptured,
}: {
  planId: string
  approvalId: string
  provider: string
  amountLabel: string
  onCaptured?: () => void
}) {
  const [state, setState] = useState<ExecutionState>('idle')
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  async function authorizeDeposit() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setState('authorizing')
    setError(null)

    try {
      const authorization = await requestAuthorization(planId, approvalId)
      await handleAuthorizationResponse(authorization)
    } catch (authorizationError) {
      setState('retry_allowed')
      setError(
        authorizationError instanceof Error
          ? authorizationError.message
          : 'Deposit authorization could not be completed.'
      )
    } finally {
      inFlightRef.current = false
    }
  }

  async function handleAuthorizationResponse(authorization: AuthorizationResponse) {
    const localPaymentIntentId = authorization.paymentIntent?.id
    if (!localPaymentIntentId) {
      throw new Error(authorization.error || '3rdPlace did not receive a payment authorization record.')
    }
    setPaymentIntentId(localPaymentIntentId)

    if (!authorization.requires_action) {
      if (authorization.paymentIntent?.status !== 'authorized') {
        throw new Error('Payment authorization is still pending. Retry to refresh Stripe status.')
      }
      setState('authorized')
      return
    }

    if (!authorization.client_secret) {
      throw new Error('Stripe requested verification but did not return a verification secret.')
    }
    const currentStripePromise = getStripePromise()
    if (!currentStripePromise) {
      throw new Error('Secure card verification is not configured.')
    }

    setState('awaiting_authentication')
    const stripe = await currentStripePromise
    if (!stripe) throw new Error('Secure card verification could not be loaded.')

    const verification = await stripe.handleNextAction({
      clientSecret: authorization.client_secret,
    })
    if (verification.error) {
      const outcome = verification.error.code === 'payment_intent_authentication_failure'
        ? 'failed'
        : 'abandoned'
      await recordAuthenticationOutcome(planId, approvalId, outcome)
      setState('retry_allowed')
      setError(
        verification.error.message ||
          'Additional verification was not completed. You can retry without creating a duplicate charge.'
      )
      return
    }

    const resumed = await requestAuthorization(planId, approvalId)
    if (resumed.requires_action) {
      throw new Error('Stripe still requires verification. Retry to continue the same authorization.')
    }
    if (!resumed.paymentIntent?.id || resumed.paymentIntent.status !== 'authorized') {
      throw new Error('Verification completed, but the authorization is still being finalized. Retry safely.')
    }

    setPaymentIntentId(resumed.paymentIntent.id)
    setState('authorized')
  }

  async function captureDeposit() {
    if (inFlightRef.current || !paymentIntentId) return
    inFlightRef.current = true
    setState('capturing')
    setError(null)

    try {
      const response = await fetch('/api/payments/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paymentIntentId,
          approvalId,
          explicitUserConfirmation: true,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as CaptureResponse
      if (!response.ok) throw new Error(payload.error || 'Deposit capture failed.')
      if (payload.paymentIntent?.status !== 'captured') {
        throw new Error('Deposit capture is still being reconciled. Refresh before trying again.')
      }

      setState('captured')
      onCaptured?.()
    } catch (captureError) {
      setState('authorized')
      setError(captureError instanceof Error ? captureError.message : 'Deposit capture failed.')
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-tan bg-cream p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-forest-tint text-forest">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Secure deposit authorization</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            Authorize {amountLabel} for {provider}. Verification does not move money; capture still requires your separate confirmation.
          </p>

          <div className="mt-3" aria-live="polite">
            {state === 'awaiting_authentication' ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-clay">
                <Loader2 className="h-4 w-4 animate-spin" />
                Additional verification required. Complete the Stripe challenge to continue.
              </div>
            ) : null}
            {state === 'authorized' ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                <CheckCircle2 className="h-4 w-4" />
                Card verified. Review once more before capturing the deposit.
              </div>
            ) : null}
            {state === 'captured' ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-forest">
                <CheckCircle2 className="h-4 w-4" />
                Deposit captured. 3rdPlace is finalizing the payment record.
              </div>
            ) : null}
            {error ? (
              <div className="flex items-start gap-2 text-sm text-brick" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {state === 'idle' || state === 'retry_allowed' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void authorizeDeposit()}
              >
                <CreditCard className="h-4 w-4" />
                {state === 'retry_allowed' ? 'Retry verification' : 'Authorize deposit'}
              </Button>
            ) : null}
            {state === 'authorizing' ? (
              <Button type="button" variant="outline" size="sm" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Authorizing...
              </Button>
            ) : null}
            {state === 'authorized' ? (
              <Button type="button" size="sm" onClick={() => void captureDeposit()}>
                <CreditCard className="h-4 w-4" />
                Capture approved deposit
              </Button>
            ) : null}
            {state === 'capturing' ? (
              <Button type="button" size="sm" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Capturing...
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

async function requestAuthorization(planId: string, approvalId: string) {
  const response = await fetch(`/api/planner/plans/${planId}/payments/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ approvalId }),
  })
  const payload = (await response.json().catch(() => ({}))) as AuthorizationResponse
  if (!response.ok) throw new Error(payload.error || 'Deposit authorization failed.')
  return payload
}

async function recordAuthenticationOutcome(
  planId: string,
  approvalId: string,
  outcome: 'failed' | 'abandoned'
) {
  const response = await fetch(`/api/planner/plans/${planId}/payments/authentication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ approvalId, outcome }),
  })
  if (!response.ok) {
    throw new Error('Verification stopped, but 3rdPlace could not save the retry state. Refresh before retrying.')
  }
}
