'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calendar, Check, Crown, ExternalLink, Loader2, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { getFreeEventUsageDisplay } from '@/lib/billing/display'
import { cn } from '@/lib/utils'

type BillingTier = 'free_trial' | 'pay_per_event' | 'pro_monthly' | 'pro_annual'
type CheckoutType = 'pay_per_event' | 'pro_monthly' | 'pro_annual'

type BillingSummary = {
  tier: BillingTier
  tierLabel: string
  subscriptionStatus: string
  freeEventsGranted: number
  freeEventsUsed: number
  freeEventsRemaining: number
  paidEventCredits: number
  hasProAccess: boolean
  canCreateEvent: boolean
  prices: {
    payPerEventAmount: number
    proMonthlyAmount: number
    proAnnualAmount: number
  }
}

type BillingStatusResponse = {
  billing: BillingSummary
  error?: string
}

export default function BuilderBillingPage() {
  const { addToast } = useToast()
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<CheckoutType | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [proBilling, setProBilling] = useState<'monthly' | 'annual'>('monthly')

  useEffect(() => {
    async function loadBilling() {
      setLoading(true)
      try {
        const response = await fetch('/api/builder/billing/status', { credentials: 'include' })
        const data = (await response.json()) as BillingStatusResponse
        if (!response.ok) throw new Error(data.error || 'Could not load billing')
        setBilling(data.billing)
        // Pre-select the toggle to match current sub
        if (data.billing.tier === 'pro_annual') setProBilling('annual')
      } catch (error) {
        addToast({
          title: 'Billing unavailable',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    loadBilling()
  }, [addToast])

  async function startCheckout(type: CheckoutType) {
    setCheckoutLoading(type)
    try {
      const response = await fetch('/api/builder/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not start checkout')
      window.location.href = data.checkoutUrl
    } catch (error) {
      addToast({
        title: 'Checkout unavailable',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
      setCheckoutLoading(null)
    }
  }

  async function cancelSubscription() {
    if (!confirm('Cancel your Pro subscription? You will keep access until the end of the billing period.')) return
    setCancelLoading(true)
    try {
      const response = await fetch('/api/builder/subscription/cancel', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not cancel subscription')
      addToast({ title: 'Subscription cancelled', description: 'Access continues until the end of your billing period.' })
      // Refresh billing state
      const statusRes = await fetch('/api/builder/billing/status', { credentials: 'include' })
      const statusData = (await statusRes.json()) as BillingStatusResponse
      if (statusRes.ok) setBilling(statusData.billing)
    } catch (error) {
      addToast({
        title: 'Cancellation failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setCancelLoading(false)
    }
  }

  async function openBillingPortal() {
    setPortalLoading(true)
    try {
      const response = await fetch('/api/builder/billing/portal', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not open billing portal')
      window.location.href = data.portalUrl
    } catch (error) {
      addToast({
        title: 'Billing portal unavailable',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
      setPortalLoading(false)
    }
  }

  const statusBanner = useMemo(() => {
    if (!billing) return null
    const freeUsage = getFreeEventUsageDisplay(billing)
    if (billing.hasProAccess) {
      return {
        variant: 'pro' as const,
        headline: `You're on ${billing.tierLabel}`,
        detail: 'Unlimited event creation — no per-event fee.',
      }
    }
    if (freeUsage.remaining > 0) {
      return {
        variant: 'free' as const,
        headline: `You have ${freeUsage.remaining} free ${freeUsage.remaining === 1 ? 'event' : 'events'} remaining`,
        detail: `Use ${freeUsage.remaining === 1 ? 'it' : 'them'} for approval-gated planner execution. Upgrade or buy a credit after that.`,
      }
    }
    if (billing.paidEventCredits > 0) {
      return {
        variant: 'credits' as const,
        headline: `${billing.paidEventCredits} event credit${billing.paidEventCredits === 1 ? '' : 's'} available`,
        detail: 'Each credit lets you create one event.',
      }
    }
    return {
      variant: 'empty' as const,
      headline: 'No event access remaining',
      detail: 'Choose a plan below to create your next event.',
    }
  }, [billing])

  const proCheckoutType: CheckoutType = proBilling === 'annual' ? 'pro_annual' : 'pro_monthly'
  const proPrice = billing
    ? proBilling === 'annual'
      ? billing.prices.proAnnualAmount
      : billing.prices.proMonthlyAmount
    : null
  const annualSavings = billing
    ? Math.max(billing.prices.proMonthlyAmount * 12 - billing.prices.proAnnualAmount, 0)
    : 0
  const annualMonthlyEquivalent = billing
    ? Math.round((billing.prices.proAnnualAmount / 12) * 100) / 100
    : null

  const isProActive = billing?.hasProAccess ?? false
  const isCurrentProPlan =
    (billing?.tier === 'pro_monthly' && proBilling === 'monthly') ||
    (billing?.tier === 'pro_annual' && proBilling === 'annual')
  const freeUsage = billing ? getFreeEventUsageDisplay(billing) : null

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading billing…
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Billing</h1>
        <p className="mt-1 text-ink-soft">Manage your event access and plan</p>
      </div>

      {/* Status banner */}
      {statusBanner && (
        <div
          className={cn(
            'flex items-start gap-4 rounded-lg border p-5',
            statusBanner.variant === 'pro' && 'border-clay/30 bg-clay-tint',
            statusBanner.variant === 'free' && 'border-forest/30 bg-forest-tint',
            statusBanner.variant === 'credits' && 'border-tan bg-cream',
            statusBanner.variant === 'empty' && 'border-brick/30 bg-brick-tint'
          )}
        >
          <div
            className={cn(
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md',
              statusBanner.variant === 'pro' && 'bg-clay-tint',
              statusBanner.variant === 'free' && 'bg-forest-tint',
              statusBanner.variant === 'credits' && 'bg-cream-deep/60',
              statusBanner.variant === 'empty' && 'bg-brick-tint'
            )}
          >
            {statusBanner.variant === 'pro' && <Crown className="h-5 w-5 text-clay" />}
            {statusBanner.variant === 'free' && <Calendar className="h-5 w-5 text-forest" />}
            {statusBanner.variant === 'credits' && <Zap className="h-5 w-5 text-ink" />}
            {statusBanner.variant === 'empty' && <AlertTriangle className="h-5 w-5 text-brick" />}
          </div>
          <div>
            <p className="font-semibold text-ink">{statusBanner.headline}</p>
            <p className="mt-0.5 text-sm text-ink-soft">{statusBanner.detail}</p>
          </div>
        </div>
      )}

      {/* Usage stats row */}
      {billing && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Free trial</CardDescription>
              <CardTitle className="text-2xl">{freeUsage?.remaining ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-soft">
                {freeUsage?.used ?? 0} of {freeUsage?.granted ?? 0} used
              </p>
              {freeUsage?.hasOverage && (
                <p className="mt-2 text-xs text-ink-soft">
                  Additional planner sessions are tracked separately after the free trial.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Event credits</CardDescription>
              <CardTitle className="text-2xl">{billing.paidEventCredits}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-soft">Pay-per-event credits available</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pro status</CardDescription>
              <CardTitle className="flex items-center gap-2 text-2xl">
                {billing.hasProAccess ? (
                  <>
                    <Check className="h-5 w-5 text-forest" />
                    Active
                  </>
                ) : (
                  'Inactive'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-soft">{billing.tierLabel}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plan options */}
      <div>
        <h2 className="mb-4 font-display text-xl font-semibold text-ink">Choose a plan</h2>
        <div className="grid gap-4 md:grid-cols-3">

          {/* Pay-Per-Event */}
          <Card className={cn(billing?.tier === 'pay_per_event' && !isProActive && 'border-clay')}>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-cream-deep/60">
                <Zap className="h-5 w-5 text-ink" />
              </div>
              <CardTitle>Pay-Per-Event</CardTitle>
              <CardDescription>One event credit per purchase</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {billing && (
                <div className="text-3xl font-bold text-ink">
                  ${billing.prices.payPerEventAmount}
                  <span className="ml-1 text-base font-normal text-ink-soft">/event</span>
                </div>
              )}
              <ul className="space-y-2 text-sm text-ink-soft">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-forest" />All platform features</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-forest" />Credits never expire</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-forest" />No monthly commitment</li>
              </ul>
              <Button
                type="button"
                className="w-full"
                variant="secondary"
                disabled={Boolean(checkoutLoading) || cancelLoading || portalLoading}
                onClick={() => startCheckout('pay_per_event')}
              >
                {checkoutLoading === 'pay_per_event' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Buy a credit
              </Button>
            </CardContent>
          </Card>

          {/* Pro */}
          <Card className={cn('md:col-span-2', isProActive && 'border-clay shadow-glow')}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-clay-tint">
                    <Crown className="h-5 w-5 text-clay" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Pro
                    {isProActive && (
                      <span className="rounded-full bg-clay-tint px-2 py-0.5 text-xs font-semibold text-clay">
                        Current plan
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>Unlimited events — no per-event fee</CardDescription>
                </div>

                {/* Monthly / Annual toggle */}
                <div className="inline-flex items-center gap-1 rounded-lg bg-cream-deep/55 p-1">
                  <button
                    type="button"
                    onClick={() => setProBilling('monthly')}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-semibold transition-smooth',
                      proBilling === 'monthly'
                        ? 'bg-cream text-ink shadow-sm'
                        : 'text-ink-soft hover:text-ink'
                    )}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setProBilling('annual')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-smooth',
                      proBilling === 'annual'
                        ? 'bg-cream text-ink shadow-sm'
                        : 'text-ink-soft hover:text-ink'
                    )}
                  >
                    Annual
                    {annualSavings > 0 && (
                      <span className="rounded-full bg-forest-tint px-1.5 py-0.5 text-xs font-bold text-forest">
                        Save ${annualSavings}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {proPrice !== null && (
                <div className="text-3xl font-bold text-ink">
                  ${proPrice}
                  <span className="ml-1 text-base font-normal text-ink-soft">
                    /{proBilling === 'monthly' ? 'month' : 'year'}
                  </span>
                  {proBilling === 'annual' && (
                    <span className="ml-2 text-sm font-semibold text-forest">
                      ~${annualMonthlyEquivalent}/mo
                    </span>
                  )}
                </div>
              )}

              <ul className="grid gap-2 sm:grid-cols-2 text-sm text-ink-soft">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />Unlimited events</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />No per-event platform fee</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />Advanced analytics</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />Priority support</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />Early feature access</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-clay" />Cancel anytime</li>
              </ul>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  className="flex-1"
                  variant={isCurrentProPlan ? 'outline' : 'hero'}
                  disabled={Boolean(checkoutLoading) || cancelLoading || portalLoading || isCurrentProPlan}
                  onClick={() => startCheckout(proCheckoutType)}
                >
                  {checkoutLoading === proCheckoutType ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isCurrentProPlan ? 'Current plan' : isProActive ? 'Switch billing' : 'Upgrade to Pro'}
                </Button>

                {isProActive && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={portalLoading || cancelLoading || Boolean(checkoutLoading)}
                      onClick={openBillingPortal}
                    >
                      {portalLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-2 h-4 w-4" />
                      )}
                      Manage in Stripe
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancelLoading || portalLoading || Boolean(checkoutLoading)}
                      onClick={cancelSubscription}
                      className="text-brick hover:bg-brick-tint hover:text-brick"
                    >
                      {cancelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pricing footnote */}
      <p className="text-sm text-ink-soft">
        Vendor service payments are always separate from platform access fees. Vendors keep 100% of their service fee.
      </p>
    </div>
  )
}
