'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Lock, Mail, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  }
}

export function VendorClaimFlow({ token, details }: VendorClaimFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState(details.email)
  const [password, setPassword] = useState('')
  const [rateDecision, setRateDecision] = useState<'accept' | 'counter'>('accept')
  const [counterAmount, setCounterAmount] = useState('')
  const [publicBaseRateAmount, setPublicBaseRateAmount] = useState('')
  const [publicRateType, setPublicRateType] = useState<'flat' | 'per_person' | 'hourly'>(
    details.proposed_rate?.rate_type || 'flat'
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const proposedRate = details.proposed_rate

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

      router.push(payload.redirectTo || '/vendor')
    })
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <div className="w-full rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Package className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Vendor invite</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
              Hi {details.vendor_name}, {details.organizer_name} invited you to 3rdPlace.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your account, confirm the private rate for this organizer, then set the public rate new clients see in the vendor catalog.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                step === item ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-background/40 text-muted-foreground'
              }`}
            >
              Step {item}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-border bg-background/50 p-4">
              <p className="font-semibold text-foreground">Create your vendor login</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the invited email so your listing and private rate attach correctly.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={email} onChange={(event) => setEmail(event.target.value)} className="pl-9" />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={password} onChange={(event) => setPassword(event.target.value)} className="pl-9" type="password" minLength={8} />
              </div>
            </label>
            <StepFooter onNext={() => setStep(2)} nextDisabled={!email || password.length < 8} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-border bg-background/50 p-4">
              <p className="font-semibold text-foreground">Confirm the private booking rate</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {details.organizer_name} proposed{' '}
                <span className="font-bold text-foreground">
                  {proposedRate ? formatDollars(proposedRate.amount) : 'a rate to confirm'}
                </span>{' '}
                {proposedRate ? formatRateType(proposedRate.rate_type) : 'for this booking'}.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRateDecision('accept')}
                className={`rounded-2xl border p-4 text-left transition-smooth ${
                  rateDecision === 'accept' ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/40'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <p className="mt-3 font-semibold text-foreground">Accept {proposedRate ? formatDollars(proposedRate.amount) : 'rate'}</p>
                <p className="mt-1 text-sm text-muted-foreground">Confirm this private organizer rate.</p>
              </button>
              <button
                type="button"
                onClick={() => setRateDecision('counter')}
                className={`rounded-2xl border p-4 text-left transition-smooth ${
                  rateDecision === 'counter' ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/40'
                }`}
              >
                <p className="font-semibold text-foreground">Counter</p>
                <p className="mt-1 text-sm text-muted-foreground">Send a revised private rate back to the organizer.</p>
              </button>
            </div>
            {rateDecision === 'counter' ? (
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Counter amount</span>
                <Input value={counterAmount} onChange={(event) => setCounterAmount(event.target.value)} type="number" min="1" step="1" placeholder="550" />
              </label>
            ) : null}
            <StepFooter onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={rateDecision === 'counter' && Number(counterAmount) <= 0} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-border bg-background/50 p-4">
              <p className="font-semibold text-foreground">Set your public catalog rate</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This is different from your private rate with {details.organizer_name}. It is what new clients see when they browse vendors.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Public base rate</span>
                <Input value={publicBaseRateAmount} onChange={(event) => setPublicBaseRateAmount(event.target.value)} type="number" min="1" step="1" placeholder="650" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Public rate type</span>
                <select
                  value={publicRateType}
                  onChange={(event) => setPublicRateType(event.target.value as typeof publicRateType)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="flat">Flat</option>
                  <option value="per_person">Per person</option>
                  <option value="hourly">Hourly</option>
                </select>
              </label>
            </div>
            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
                {error}
              </div>
            ) : null}
            <StepFooter
              onBack={() => setStep(2)}
              onNext={submitClaim}
              nextLabel={isPending ? 'Claiming...' : 'Claim vendor profile'}
              nextDisabled={isPending || Number(publicBaseRateAmount) <= 0}
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
