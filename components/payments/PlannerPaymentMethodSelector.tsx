'use client'

import { useEffect, useMemo, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js'
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type PlannerPaymentMethodSummary = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

type PaymentMethodListResponse = {
  paymentMethods?: PlannerPaymentMethodSummary[]
  error?: string
}

type SetupIntentResponse = {
  setupIntentId?: string
  clientSecret?: string
  error?: string
}

type ConfirmSetupResponse = {
  paymentMethod?: PlannerPaymentMethodSummary
  error?: string
}

let stripePromise: ReturnType<typeof loadStripe> | null = null

function getStripePromise() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  if (!publishableKey) return null
  stripePromise ??= loadStripe(publishableKey)
  return stripePromise
}

export function PlannerPaymentMethodSelector({
  selectedPaymentMethodId,
  onSelect,
  disabled = false,
}: {
  selectedPaymentMethodId: string | null
  onSelect: (paymentMethodId: string) => void
  disabled?: boolean
}) {
  const [paymentMethods, setPaymentMethods] = useState<PlannerPaymentMethodSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStartingSetup, setIsStartingSetup] = useState(false)
  const [setupIntent, setSetupIntent] = useState<{ id: string; clientSecret: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function hydratePaymentMethods() {
      setIsLoading(true)
      setError(null)
      try {
        const setupIntentId = readReturnedSetupIntentId()
        let confirmedMethod: PlannerPaymentMethodSummary | null = null
        if (setupIntentId) {
          confirmedMethod = await confirmBoundPaymentMethod(setupIntentId)
          clearReturnedSetupIntentParams()
        }

        const methods = await loadPaymentMethods()
        if (cancelled) return
        const nextMethods = mergePaymentMethod(methods, confirmedMethod)
        setPaymentMethods(nextMethods)

        const selectedStillExists = selectedPaymentMethodId &&
          nextMethods.some((method) => method.id === selectedPaymentMethodId)
        if (!selectedStillExists) {
          const preferred = confirmedMethod ?? nextMethods.find((method) => method.isDefault) ?? nextMethods[0]
          if (preferred) onSelect(preferred.id)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load saved cards.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void hydratePaymentMethods()
    return () => {
      cancelled = true
    }
  }, [onSelect, selectedPaymentMethodId])

  async function startSetup() {
    if (disabled || isStartingSetup) return
    if (!getStripePromise() || !globalThis.crypto?.randomUUID) {
      setError('Secure card setup is not configured.')
      return
    }

    setIsStartingSetup(true)
    setError(null)
    try {
      const response = await fetch('/api/planner/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ setupAttemptId: globalThis.crypto.randomUUID() }),
      })
      const payload = (await response.json().catch(() => ({}))) as SetupIntentResponse
      if (!response.ok || !payload.setupIntentId || !payload.clientSecret) {
        throw new Error(payload.error || 'Unable to start secure card setup.')
      }
      setSetupIntent({ id: payload.setupIntentId, clientSecret: payload.clientSecret })
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Unable to start secure card setup.')
    } finally {
      setIsStartingSetup(false)
    }
  }

  function handleBound(method: PlannerPaymentMethodSummary) {
    setPaymentMethods((current) => mergePaymentMethod(current, method))
    onSelect(method.id)
    setSetupIntent(null)
    setError(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading saved payment methods...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {paymentMethods.length > 0 ? (
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Payment method
          </legend>
          {paymentMethods.map((method) => {
            const selected = selectedPaymentMethodId === method.id
            return (
              <label
                key={method.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${
                  selected ? 'border-forest bg-forest-tint' : 'border-tan bg-cream-deep'
                }`}
              >
                <input
                  type="radio"
                  name="planner-payment-method"
                  value={method.id}
                  checked={selected}
                  onChange={() => onSelect(method.id)}
                  disabled={disabled}
                />
                <CreditCard className="h-4 w-4 text-forest" />
                <span className="flex-1 text-ink">
                  {formatCardBrand(method.brand)} ending in {method.last4}
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  {String(method.expMonth).padStart(2, '0')}/{String(method.expYear).slice(-2)}
                </span>
                {selected ? <CheckCircle2 className="h-4 w-4 text-forest" /> : null}
              </label>
            )
          })}
        </fieldset>
      ) : (
        <p className="text-sm text-ink-soft">Add a payment method before authorizing this deposit.</p>
      )}

      {error ? (
        <div className="flex items-start gap-2 text-sm text-brick" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {setupIntent && getStripePromise() ? (
        <Elements
          stripe={getStripePromise()}
          options={setupElementsOptions(setupIntent.clientSecret)}
          key={setupIntent.clientSecret}
        >
          <SetupPaymentMethodForm
            setupIntentId={setupIntent.id}
            onBound={handleBound}
            onCancel={() => setSetupIntent(null)}
          />
        </Elements>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void startSetup()}
          disabled={disabled || isStartingSetup}
        >
          {isStartingSetup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add a payment method
        </Button>
      )}
    </div>
  )
}

function SetupPaymentMethodForm({
  setupIntentId,
  onBound,
  onCancel,
}: {
  setupIntentId: string
  onBound: (method: PlannerPaymentMethodSummary) => void
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitSetup() {
    if (!stripe || !elements || isSubmitting) return
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      })
      if (result.error) {
        throw new Error(result.error.message || 'Stripe could not save this payment method.')
      }

      const method = await confirmBoundPaymentMethod(result.setupIntent?.id ?? setupIntentId)
      onBound(method)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save this payment method.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-tan bg-cream-deep p-3">
      <PaymentElement />
      {error ? <p className="text-sm text-brick" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void submitSetup()}
          disabled={!stripe || !elements || isSubmitting}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Save payment method
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function setupElementsOptions(clientSecret: string): StripeElementsOptions {
  return {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        borderRadius: '8px',
        colorPrimary: '#42624f',
      },
    },
  }
}

async function loadPaymentMethods() {
  const response = await fetch('/api/planner/payment-methods', {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = (await response.json().catch(() => ({}))) as PaymentMethodListResponse
  if (!response.ok) throw new Error(payload.error || 'Unable to load saved payment methods.')
  return Array.isArray(payload.paymentMethods) ? payload.paymentMethods : []
}

async function confirmBoundPaymentMethod(setupIntentId: string) {
  const response = await fetch('/api/planner/payment-methods/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ setupIntentId }),
  })
  const payload = (await response.json().catch(() => ({}))) as ConfirmSetupResponse
  if (!response.ok || !payload.paymentMethod) {
    throw new Error(payload.error || 'Stripe setup completed, but 3rdPlace could not bind the card.')
  }
  return payload.paymentMethod
}

function mergePaymentMethod(
  methods: PlannerPaymentMethodSummary[],
  method: PlannerPaymentMethodSummary | null
) {
  if (!method) return methods
  return [method, ...methods.filter((candidate) => candidate.id !== method.id)]
}

function readReturnedSetupIntentId() {
  if (typeof window === 'undefined') return null
  return new URL(window.location.href).searchParams.get('setup_intent')
}

function clearReturnedSetupIntentParams() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('setup_intent')
  url.searchParams.delete('setup_intent_client_secret')
  url.searchParams.delete('redirect_status')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function formatCardBrand(brand: string) {
  if (!brand) return 'Card'
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}
