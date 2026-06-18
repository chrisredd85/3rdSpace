'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Gift, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PlannerBillingSummary = {
  freeEventsRemaining?: number
  free_events_remaining?: number
  paidEventCredits?: number
  hasProAccess?: boolean
  canCreateEvent?: boolean
  can_create_event?: boolean
}

const dismissalKey = 'planner_billing_access_banner_dismissed'

export function PlannerBillingAccessBanner() {
  const [billing, setBilling] = useState<PlannerBillingSummary | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsDismissed(window.sessionStorage.getItem(dismissalKey) === '1')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadBilling() {
      try {
        const response = await fetch('/api/builder/billing/status', {
          cache: 'no-store',
          credentials: 'include',
        })
        if (!response.ok) return
        const payload = (await response.json()) as { billing?: PlannerBillingSummary }
        if (!cancelled) setBilling(payload.billing ?? null)
      } catch {
        if (!cancelled) setBilling(null)
      }
    }

    void loadBilling()
    return () => {
      cancelled = true
    }
  }, [])

  const state = useMemo(() => {
    if (!billing) return null
    const freeEventsRemaining = billing.freeEventsRemaining ?? billing.free_events_remaining ?? 0
    const paidEventCredits = billing.paidEventCredits ?? 0
    if (freeEventsRemaining > 0) {
      return {
        tone: 'free' as const,
        label: `${freeEventsRemaining} free event${freeEventsRemaining === 1 ? '' : 's'} remaining`,
        body: 'After your free events, planner sessions are $30 each or $69/mo unlimited.',
      }
    }

    if (!billing.hasProAccess && paidEventCredits <= 0) {
      return {
        tone: 'upgrade' as const,
        label: "You've used your 2 free events.",
        body: 'Continue for $30 per event or $69/mo unlimited.',
      }
    }

    return null
  }, [billing])

  if (isDismissed || !state) return null

  function dismiss() {
    setIsDismissed(true)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(dismissalKey, '1')
    }
  }

  return (
    <div className="mx-auto mb-4 max-w-5xl px-4 lg:px-6">
      <div className="flex flex-col gap-3 rounded-md border border-tan bg-cream px-4 py-3 text-sm text-ink shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Gift className="mt-0.5 h-4 w-4 shrink-0 text-clay-deep" />
          <p className="min-w-0 leading-6">
            <span className="font-semibold text-ink">{state.label}</span>
            <span className="text-ink-soft"> {state.body}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.tone === 'upgrade' ? (
            <Button asChild size="sm">
              <Link href="/planner/billing">Upgrade</Link>
            </Button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss billing access banner"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-cream-deep hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
