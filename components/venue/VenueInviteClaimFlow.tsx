'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CheckCircle2, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { centsToDollars } from '@/lib/money'

interface VenueInviteClaimFlowProps {
  token: string
  details: {
    venue_id: string
    venue_name: string
    venue_type: string | null
    email: string
    contact_name: string | null
    contact_role: string | null
    claim_status: string
    organizer_name: string
    proposed_terms: {
      id: string
      amount_cents: number | null
      term_type: 'flat_rental' | 'minimum_spend' | 'per_head_chi' | 'bar_chi' | 'no_charge' | 'tbd'
      status: string
    } | null
  }
}

export function VenueInviteClaimFlow({ token, details }: VenueInviteClaimFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState(details.email)
  const [password, setPassword] = useState('')
  const [termDecision, setTermDecision] = useState<'accept' | 'counter'>('accept')
  const [counterAmount, setCounterAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const proposedTerms = details.proposed_terms

  function submitClaim() {
    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/venue/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          password,
          termDecision,
          counterAmountCents: termDecision === 'counter'
            ? Math.max(Math.round(Number(counterAmount || 0) * 100), 0)
            : null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not claim this venue invite.')
        return
      }

      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          expectedUserType: 'venue_owner',
        }),
      })
      const loginPayload = await loginResponse.json().catch(() => ({}))
      if (!loginResponse.ok) {
        setError(
          loginPayload.error ||
            'Your venue profile was claimed, but we could not sign you in automatically. Sign in to complete the profile.'
        )
        return
      }

      router.push(payload.redirectTo || '/venue/profile/complete?claim_complete=1')
    })
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <div className="w-full rounded-lg border border-tan bg-cream p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Venue invite</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-ink">
              Hi {details.venue_name}, {details.organizer_name} invited you to 3rdPlace.
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Create the venue owner account, confirm the proposed terms, then complete the profile. Stripe setup happens before your first in-app payment.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
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
              <p className="font-semibold text-ink">Create your venue login</p>
              <p className="mt-1 text-sm text-ink-soft">
                Use the invited email so the private organizer terms attach correctly.
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
              <p className="font-semibold text-ink">Confirm the proposed organizer terms</p>
              <p className="mt-1 text-sm text-ink-soft">
                {details.organizer_name} proposed{' '}
                <span className="font-bold text-ink">
                  {proposedTerms ? formatTerm(proposedTerms.amount_cents, proposedTerms.term_type) : 'terms to confirm'}
                </span>.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTermDecision('accept')}
                className={`rounded-lg border p-4 text-left transition-smooth ${
                  termDecision === 'accept' ? 'border-clay/50 bg-clay/10' : 'border-tan bg-cream/40'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 text-clay" />
                <p className="mt-3 font-semibold text-ink">Accept terms</p>
                <p className="mt-1 text-sm text-ink-soft">Confirm this private organizer agreement.</p>
              </button>
              <button
                type="button"
                onClick={() => setTermDecision('counter')}
                className={`rounded-lg border p-4 text-left transition-smooth ${
                  termDecision === 'counter' ? 'border-clay/50 bg-clay/10' : 'border-tan bg-cream/40'
                }`}
              >
                <p className="font-semibold text-ink">Counter</p>
                <p className="mt-1 text-sm text-ink-soft">Save a revised amount for organizer review.</p>
              </button>
            </div>
            {termDecision === 'counter' ? (
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-ink-soft">Counter amount</span>
                <Input value={counterAmount} onChange={(event) => setCounterAmount(event.target.value)} type="number" min="0" step="1" placeholder="1800" />
              </label>
            ) : null}
            <StepFooter onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={termDecision === 'counter' && Number(counterAmount) < 0} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-tan bg-cream/50 p-4">
              <p className="font-semibold text-ink">Private until you finish setup</p>
              <p className="mt-1 text-sm text-ink-soft">
                This venue stays unpublished while you complete profile details, amenities, and payout setup. Organizers cannot pay without a separate approval and Stripe readiness check.
              </p>
            </div>
            {error ? (
              <div className="rounded-lg border border-brick/30 bg-brick/10 px-4 py-3 text-sm text-ink">
                {error}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="glass" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button type="button" variant="hero" onClick={submitClaim} disabled={isPending}>
                {isPending ? 'Claiming venue...' : 'Claim venue and continue'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StepFooter({ onBack, onNext, nextDisabled }: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button type="button" variant="glass" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button type="button" variant="hero" onClick={onNext} disabled={nextDisabled}>
        Continue
      </Button>
    </div>
  )
}

type VenueInviteTermType = NonNullable<VenueInviteClaimFlowProps['details']['proposed_terms']>['term_type']

function formatTerm(amountCents: number | null, termType: VenueInviteTermType) {
  if (termType === 'no_charge') return 'no venue charge'
  if (termType === 'tbd') return 'terms to confirm'
  const amount = typeof amountCents === 'number' ? centsToDollars(amountCents) : 'an amount to confirm'
  const labels: Record<string, string> = {
    flat_rental: 'flat rental',
    minimum_spend: 'minimum spend',
    per_head_chi: 'per-head CHI',
    bar_chi: 'bar consumption CHI',
  }
  return `${amount} ${labels[termType] ?? 'terms'}`
}
