'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Lock, Mail, Package, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StripeConnectButton } from '@/components/vendor/StripeConnectButton'
import { StripeOnboardingModal } from '@/components/vendor/StripeOnboardingModal'

interface VendorClaimFlowProps {
  token: string
  details: {
    vendor_id: string
    vendor_name: string
    service_type: string | null
    email: string
    claim_status: string
    organizer_name: string
    proposed_rate: {
      id: string
      amount: number
      rate_type: 'flat' | 'per_person' | 'hourly'
      status: string
    } | null
    stripe_account: {
      stripe_account_id: string | null
      account_status: string | null
      charges_enabled: boolean
      payouts_enabled: boolean
    } | null
  }
}

export function VendorClaimFlow({ token, details }: VendorClaimFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [email, setEmail] = useState(details.email)
  const [password, setPassword] = useState('')
  const [rateDecision, setRateDecision] = useState<'accept' | 'counter'>('accept')
  const [counterAmount, setCounterAmount] = useState('')
  const [publicBaseRateAmount, setPublicBaseRateAmount] = useState('')
  const [publicRateType, setPublicRateType] = useState<'flat' | 'per_person' | 'hourly'>(
    details.proposed_rate?.rate_type || 'flat'
  )
  const [claimComplete, setClaimComplete] = useState(false)
  const [isStripeModalOpen, setIsStripeModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isStripePending, startStripeTransition] = useTransition()

  const proposedRate = details.proposed_rate
  const stripeAccount = details.stripe_account
  const hasStripeAccount = Boolean(stripeAccount?.stripe_account_id)
  const stripeReady = Boolean(stripeAccount?.charges_enabled)

  function submitClaim() {
    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/vendor/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          password,
          rateDecision,
          counterAmount: rateDecision === 'counter' ? counterAmount : null,
          publicBaseRateAmount,
          publicRateType,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Could not claim this vendor invite.')
        return
      }

      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          expectedUserType: 'vendor',
        }),
      })
      const loginPayload = await loginResponse.json().catch(() => ({}))
      if (!loginResponse.ok) {
        setError(
          loginPayload.error ||
            'Your vendor profile was claimed, but we could not sign you in automatically. Sign in to connect Stripe.'
        )
        return
      }

      setClaimComplete(true)
      if (stripeReady) {
        router.push('/vendor?claim_complete=1&stripe=connected')
        return
      }
      setStep(4)
    })
  }

  function skipStripe() {
    setError(null)
    startStripeTransition(async () => {
      const response = await fetch('/api/vendor/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip_stripe' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not save Stripe skip preference.')
        return
      }

      router.push(payload.redirectTo || '/vendor?claim_complete=1&stripe_skipped=1')
    })
  }

  function startStripeOnboarding() {
    startStripeTransition(async () => {
      const response = await fetch('/api/vendor/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnTo: '/vendor?claim_complete=1&stripe=connected',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not start Stripe onboarding.')
        setIsStripeModalOpen(false)
        return
      }

      const url = payload.accountLinkUrl || payload.url
      if (!url) {
        setError('Stripe did not return an onboarding link.')
        setIsStripeModalOpen(false)
        return
      }

      window.location.href = url
    })
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <div className="w-full rounded-lg border border-tan bg-cream p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay">
            <Package className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Vendor invite</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-ink">
              Hi {details.vendor_name}, {details.organizer_name} invited you to 3rdPlace.
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Create your account and confirm the private rate for this organizer. You can add a public catalog rate later if you want new clients to discover you.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                step === item ? 'border-clay/40 bg-clay/10 text-clay' : 'border-tan bg-cream/40 text-ink-soft'
              }`}
            >
              Step {item}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-tan bg-cream/50 p-4">
              <p className="font-semibold text-ink">Create your vendor login</p>
              <p className="mt-1 text-sm text-ink-soft">
                Use the invited email so your listing and private rate attach correctly.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-ink-soft">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                <Input value={email} onChange={(event) => setEmail(event.target.value)} className="pl-9" />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-ink-soft">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                <Input value={password} onChange={(event) => setPassword(event.target.value)} className="pl-9" type="password" minLength={8} />
              </div>
            </label>
            <StepFooter onNext={() => setStep(2)} nextDisabled={!email || password.length < 8} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-tan bg-cream/50 p-4">
              <p className="font-semibold text-ink">Confirm the private booking rate</p>
              <p className="mt-1 text-sm text-ink-soft">
                {details.organizer_name} proposed{' '}
                <span className="font-bold text-ink">
                  {proposedRate ? formatDollars(proposedRate.amount) : 'a rate to confirm'}
                </span>{' '}
                {proposedRate ? formatRateType(proposedRate.rate_type) : 'for this booking'}.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRateDecision('accept')}
                className={`rounded-lg border p-4 text-left transition-smooth ${
                  rateDecision === 'accept' ? 'border-clay/50 bg-clay/10' : 'border-tan bg-cream/40'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 text-clay" />
                <p className="mt-3 font-semibold text-ink">Accept {proposedRate ? formatDollars(proposedRate.amount) : 'rate'}</p>
                <p className="mt-1 text-sm text-ink-soft">Confirm this private organizer rate.</p>
              </button>
              <button
                type="button"
                onClick={() => setRateDecision('counter')}
                className={`rounded-lg border p-4 text-left transition-smooth ${
                  rateDecision === 'counter' ? 'border-clay/50 bg-clay/10' : 'border-tan bg-cream/40'
                }`}
              >
                <p className="font-semibold text-ink">Counter</p>
                <p className="mt-1 text-sm text-ink-soft">Send a revised private rate back to the organizer.</p>
              </button>
            </div>
            {rateDecision === 'counter' ? (
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink-soft">Counter amount</span>
                <Input value={counterAmount} onChange={(event) => setCounterAmount(event.target.value)} type="number" min="1" step="1" placeholder="550" />
              </label>
            ) : null}
            <StepFooter onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={rateDecision === 'counter' && Number(counterAmount) <= 0} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-tan bg-cream/50 p-4">
              <p className="font-semibold text-ink">Public catalog rate optional</p>
              <p className="mt-1 text-sm text-ink-soft">
                Leave this blank to stay private to {details.organizer_name}. Add a public rate only when you want this profile listed for new clients. Stripe setup happens before your first in-app payment, not during claim.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink-soft">Public base rate (optional)</span>
                <Input value={publicBaseRateAmount} onChange={(event) => setPublicBaseRateAmount(event.target.value)} type="number" min="1" step="1" placeholder="650" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink-soft">Public rate type</span>
                <select
                  value={publicRateType}
                  onChange={(event) => setPublicRateType(event.target.value as typeof publicRateType)}
                  className="h-10 w-full rounded-lg border border-tan bg-cream px-3 text-sm text-ink"
                >
                  <option value="flat">Flat</option>
                  <option value="per_person">Per person</option>
                  <option value="hourly">Hourly</option>
                </select>
              </label>
            </div>
            {error ? (
              <div className="rounded-lg border border-brick/30 bg-brick/10 px-4 py-3 text-sm text-ink">
                {error}
              </div>
            ) : null}
            <StepFooter
              onBack={() => setStep(2)}
              onNext={submitClaim}
              nextLabel={isPending ? 'Claiming...' : 'Claim and continue'}
              nextDisabled={isPending}
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-tan bg-cream/50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-ink">Connect Stripe to receive payouts</p>
                  <p className="mt-1 text-sm leading-6 text-ink-soft">
                    3rdPlace uses Stripe Connect to pay you for completed bookings. Connect now to start receiving payouts the moment a booking settles. If you skip, you can connect from your vendor settings later — but you won&apos;t receive payouts until you do.
                  </p>
                </div>
              </div>
            </div>

            {stripeReady ? (
              <div className="rounded-lg border border-forest/25 bg-forest/10 p-4 text-sm text-ink">
                Stripe is already connected for this vendor profile. Sending you to your dashboard.
              </div>
            ) : null}

            {hasStripeAccount && !stripeReady ? (
              <div className="rounded-lg border border-tan bg-cream/50 p-4 text-sm text-ink-soft">
                A Stripe account exists for this profile but onboarding is not complete yet. Continue onboarding to unlock payouts.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-brick/30 bg-brick/10 px-4 py-3 text-sm text-ink">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-ink-soft">
                Stripe will ask for your business or personal payout details. 3rdPlace never sees your bank info.
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={skipStripe} disabled={!claimComplete || isStripePending}>
                  I&apos;ll connect later
                </Button>
                <StripeConnectButton
                  isConnected={hasStripeAccount}
                  isLoading={isStripePending}
                  disabled={!claimComplete}
                  onConnect={() => setIsStripeModalOpen(true)}
                />
              </div>
            </div>

            <StripeOnboardingModal
              isOpen={isStripeModalOpen}
              onClose={() => setIsStripeModalOpen(false)}
              onStart={startStripeOnboarding}
              isLoading={isStripePending}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StepFooter({
  onBack,
  onNext,
  nextDisabled,
  nextLabel = 'Next',
}: {
  onBack?: () => void
  onNext: () => void
  nextDisabled?: boolean
  nextLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onBack ? (
        <Button type="button" variant="glass" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button type="button" variant="hero" onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </Button>
    </div>
  )
}

function formatDollars(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatRateType(rateType: string) {
  if (rateType === 'per_person') return 'per person'
  if (rateType === 'hourly') return 'per hour'
  return 'flat'
}
