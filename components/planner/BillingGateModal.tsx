'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, CalendarClock, Crown, Loader2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Plan } from '@/lib/types'

type CheckoutType = 'pay_per_event' | 'pro_monthly'

type BillingGatePlanSummary = Pick<Plan, 'id' | 'title' | 'event_type' | 'status' | 'updated_at'>

type PlannerListPlansResponse = {
  plans?: BillingGatePlanSummary[]
  error?: string
}

interface BillingGateModalProps {
  isOpen: boolean
  message?: string | null
  onClose: () => void
  onPlanArchived?: (planId: string) => void
}

export function BillingGateModal({
  isOpen,
  message,
  onClose,
  onPlanArchived,
}: BillingGateModalProps) {
  const [view, setView] = useState<'choices' | 'archive'>('choices')
  const [isStartingCheckout, setIsStartingCheckout] = useState<CheckoutType | null>(null)
  const [plans, setPlans] = useState<BillingGatePlanSummary[]>([])
  const [isLoadingPlans, setIsLoadingPlans] = useState(false)
  const [archivePlanId, setArchivePlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const activePlans = useMemo(
    () => plans.filter((plan) => plan.status !== 'archived'),
    [plans]
  )

  useEffect(() => {
    if (!isOpen) return
    setView('choices')
    setError(null)
    setSuccessMessage(null)
    setIsStartingCheckout(null)
    setArchivePlanId(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || view !== 'archive') return
    void loadPlans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view])

  if (!isOpen) return null

  async function startCheckout(type: CheckoutType) {
    setIsStartingCheckout(type)
    setError(null)
    try {
      const response = await fetch('/api/builder/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type }),
      })
      const payload = await response.json().catch(() => ({} as { checkoutUrl?: string; error?: string }))
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error ?? 'Could not start checkout.')
      }
      window.location.href = payload.checkoutUrl
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Could not start checkout.')
      setIsStartingCheckout(null)
    }
  }

  async function loadPlans() {
    setIsLoadingPlans(true)
    setError(null)
    try {
      const response = await fetch('/api/planner/plans?limit=50', {
        method: 'GET',
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => ({}))) as PlannerListPlansResponse
      if (!response.ok) throw new Error(payload.error ?? 'Could not load your plans.')
      setPlans(Array.isArray(payload.plans) ? payload.plans : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your plans.')
    } finally {
      setIsLoadingPlans(false)
    }
  }

  async function archivePlan(planId: string) {
    setArchivePlanId(planId)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await fetch(`/api/planner/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'archived' }),
      })
      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) throw new Error(payload.error ?? 'Could not archive this plan.')
      setPlans((current) => current.map((plan) => plan.id === planId ? { ...plan, status: 'archived' } : plan))
      setSuccessMessage('Plan archived. You can create a new event now.')
      onPlanArchived?.(planId)
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not archive this plan.')
    } finally {
      setArchivePlanId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 px-4 py-6 backdrop-blur-xl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-gate-title"
        className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg border border-tan bg-cream shadow-card"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-tan bg-cream-deep p-2 text-ink-soft transition-smooth hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
          aria-label="Close billing options"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-tan px-6 py-5">
          <p className="label-caps text-clay">Planner access</p>
          <h2 id="billing-gate-title" className="mt-2 font-display text-2xl font-semibold text-ink">
            Choose how to keep planning
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
            {message ?? 'Your free event slots are full. Buy one more event, upgrade, or archive an older plan.'}
          </p>
        </div>

        <div className="max-h-[calc(90vh-9rem)] overflow-y-auto p-6">
          {view === 'choices' ? (
            <div className="space-y-4">
              <BillingChoiceCard
                icon={<Zap className="h-5 w-5" />}
                title="Buy single event"
                price="$30"
                description="Unlock one more planner event. Good for one-off hosts or a live demo."
                actionLabel="Buy single event"
                isLoading={isStartingCheckout === 'pay_per_event'}
                disabled={isStartingCheckout !== null}
                onClick={() => void startCheckout('pay_per_event')}
              />
              <BillingChoiceCard
                icon={<Crown className="h-5 w-5" />}
                title="Upgrade to Pro"
                price="$69/month"
                description="Unlimited event creation for repeat organizers and recurring series."
                actionLabel="Upgrade to Pro"
                isLoading={isStartingCheckout === 'pro_monthly'}
                disabled={isStartingCheckout !== null}
                onClick={() => void startCheckout('pro_monthly')}
              />
              <BillingChoiceCard
                icon={<Archive className="h-5 w-5" />}
                title="Archive an old plan"
                price="Free"
                description="Move an older active plan out of the free-event count, then create a new one."
                actionLabel="Review plans"
                buttonVariant="glass"
                disabled={isStartingCheckout !== null}
                onClick={() => setView('archive')}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink">Archive an old plan</h3>
                  <p className="mt-1 text-sm text-ink-soft">
                    Archiving keeps the record in history and removes it from your active free-event count.
                  </p>
                </div>
                <Button type="button" variant="glass" size="sm" onClick={() => setView('choices')}>
                  Back
                </Button>
              </div>

              {isLoadingPlans ? (
                <div className="flex items-center gap-2 rounded-md border border-tan bg-cream-deep/55 px-4 py-3 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading plans...
                </div>
              ) : null}

              {!isLoadingPlans && activePlans.length === 0 ? (
                <div className="rounded-md border border-tan bg-cream-deep/55 px-4 py-8 text-center text-sm text-ink-soft">
                  No active plans are available to archive.
                </div>
              ) : null}

              {!isLoadingPlans && activePlans.length > 0 ? (
                <div className="space-y-3">
                  {activePlans.map((plan) => (
                    <div
                      key={plan.id}
                      className="flex flex-col gap-3 rounded-lg border border-tan bg-cream-deep/55 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-display text-base font-semibold text-ink">{plan.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                          <span className="rounded-full bg-cream px-2 py-0.5">{formatPlanType(plan.event_type)}</span>
                          <span className="rounded-full bg-cream px-2 py-0.5">{plan.status}</span>
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {formatUpdatedAt(plan.updated_at)}
                          </span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="glass"
                        size="sm"
                        disabled={archivePlanId !== null}
                        onClick={() => void archivePlan(plan.id)}
                      >
                        {archivePlanId === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                        Archive
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {successMessage ? (
            <div className="mt-4 rounded-md border border-forest/30 bg-forest-tint px-4 py-3 text-sm font-semibold text-forest">
              {successMessage}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-md border border-brick/40 bg-brick-tint px-4 py-3 text-sm text-brick">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BillingChoiceCard({
  icon,
  title,
  price,
  description,
  actionLabel,
  isLoading = false,
  disabled = false,
  buttonVariant = 'hero',
  onClick,
}: {
  icon: ReactNode
  title: string
  price: string
  description: string
  actionLabel: string
  isLoading?: boolean
  disabled?: boolean
  buttonVariant?: 'hero' | 'glass'
  onClick: () => void
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-tan bg-cream-deep/55 p-4 shadow-card sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-clay-tint text-clay">
          {icon}
        </div>
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
            <span className="text-sm font-bold text-clay">{price}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{description}</p>
        </div>
      </div>
      <Button
        type="button"
        variant={buttonVariant}
        className={cn('min-h-11 w-full sm:w-auto', buttonVariant === 'glass' && 'border border-tan')}
        disabled={disabled}
        onClick={onClick}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {actionLabel}
      </Button>
    </div>
  )
}

function formatPlanType(value: string | null) {
  if (!value) return 'Event'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Updated recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Updated recently'
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
