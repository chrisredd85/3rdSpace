'use client'

import { useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type VenueOpportunityDeclineFormProps = {
  token: string
  venueName: string
  eventTitle: string
}

export function VenueOpportunityDeclineForm({
  token,
  venueName,
  eventTitle,
}: VenueOpportunityDeclineFormProps) {
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const encodedToken = encodeURIComponent(token)

  function submitDecline() {
    setError(null)
    startTransition(async () => {
      const response = await fetch(`/api/venue/opportunity/${encodedToken}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not decline this opportunity.')
        return
      }
      setSubmitted(true)
    })
  }

  if (submitted) {
    return (
      <Shell venueName={venueName} eyebrow="Decline recorded">
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-forest/10 text-forest">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold">Thanks, we recorded your response.</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            The organizer has been notified that {venueName} is not a fit for <span>&ldquo;{eventTitle}&rdquo;</span>.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell venueName={venueName} eyebrow="Decline opportunity">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Decline &ldquo;{eventTitle}&rdquo;?</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This only closes this opportunity. It does not remove your venue from future 3rdPlace outreach.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <label className="text-sm font-semibold text-foreground" htmlFor="declineReason">
            Optional note to the organizer
          </label>
          <Textarea
            id="declineReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Unavailable date, private buyout minimum, not a fit for this event type..."
          />
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-foreground">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="outline" asChild>
            <Link href={`/v/respond/${encodedToken}`}>Back to response</Link>
          </Button>
          <Button type="button" onClick={submitDecline} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm decline
          </Button>
        </div>
      </section>
    </Shell>
  )
}

function Shell({
  venueName,
  eyebrow,
  children,
}: {
  venueName: string
  eyebrow: string
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          <p className="mt-2 font-display text-2xl font-bold text-foreground">{venueName}</p>
        </div>
        {children}
      </div>
    </main>
  )
}
