'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type VenueOpportunityClaimFlowProps = {
  token: string
  venueName: string
  eventTitle: string
  organizerName: string
  alreadyClaimed: boolean
  userCanClaim: boolean
}

export function VenueOpportunityClaimFlow({
  token,
  venueName,
  eventTitle,
  organizerName,
  alreadyClaimed,
  userCanClaim,
}: VenueOpportunityClaimFlowProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const encodedToken = encodeURIComponent(token)

  function claimOpportunity() {
    setError(null)
    startTransition(async () => {
      const response = await fetch(`/api/venue/opportunity/${encodedToken}/claim`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not claim this venue opportunity.')
        return
      }

      router.push(payload.redirectTo || `/venue/profile/complete?opportunity_token=${encodedToken}`)
    })
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center">
        <section className="w-full rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-primary">
                Venue claim
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Claim {venueName}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {organizerName} invited your venue to host <span>&ldquo;{eventTitle}&rdquo;</span>. Claim the venue profile,
                confirm missing details, then finish Stripe payout setup before the organizer confirms payment.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Step label="1" title="Claim venue" body="Attach this opportunity to your venue account." />
            <Step label="2" title="Complete profile" body="Confirm address, capacity, and contact details." />
            <Step label="3" title="Set up payouts" body="Finish Stripe Connect before payment can move." />
          </div>

          {alreadyClaimed ? (
            <div className="mt-6 rounded-xl border border-forest/20 bg-forest/10 p-4 text-sm text-foreground">
              This venue is already claimed. Continue to payout setup if Stripe is not complete yet.
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-foreground">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            {alreadyClaimed ? (
              <Button asChild>
                <Link href={`/api/venue/opportunity/${encodedToken}/stripe-resume`}>
                  Continue payout setup
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : userCanClaim ? (
              <Button type="button" onClick={claimOpportunity} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Claim and continue
              </Button>
            ) : (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/login/venue?redirect=${encodeURIComponent(`/venue/claim?token=${encodedToken}`)}`}>
                    Sign in as venue
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/signup/venue?opportunity_token=${encodedToken}`}>
                    Create venue account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function Step({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-mono text-xs font-bold text-primary">{label}</p>
      <p className="mt-2 font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  )
}
