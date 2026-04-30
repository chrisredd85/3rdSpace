'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calendar, Check, Crown, Loader2, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
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

  const statusBanner = useMemo(() => {
    if (!billing) return null
    if (billing.hasProAccess) {
      return {
        variant: 'pro' as const,
        headline: `You're on ${billing.tierLabel}`,
        detail: 'Unlimited event creation — no per-event fee.',
      }
    }
    if (billing.freeEventsRemaining > 0) {
      return {
        variant: 'free' as const,
        headline: `You have ${billing.freeEventsRemaining} free event remaining`,
        detail: 'Use it for your first event. Upgrade or buy a credit after that.',
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading billing…
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Billing</h1>
        <p className="mt-1 text-muted-foreground">Manage your event access and plan</p>
      </div>

      {/* Status banner */}
      {statusBanner && (
        <div
          className={cn(
            'flex items-start gap-4 rounded-2xl border p-5',
            statusBanner.variant === 'pro' && 'border-primary/30 bg-primary/10',
            statusBanner.variant === 'free' && 'border-emerald-500/30 bg-emerald-500/10',
            statusBanner.variant === 'credits' && 'border-border bg-gradient-card',
            statusBanner.variant === 'empty' && 'border-destructive/30 bg-destructive/10'
          )}
        >
          <div
            className={cn(
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
              statusBanner.variant === 'pro' && 'bg-primary/20',
              statusBanner.variant === 'free' && 'bg-emerald-500/20',
              statusBanner.variant === 'credits' && 'bg-sidebar-accent/40',
              statusBanner.variant === 'empty' && 'bg-destructive/20'
            )}
          >
            {statusBanner.variant === 'pro' && <Crown className="h-5 w-5 text-primary" />}
            {statusBanner.variant === 'free' && <Calendar className="h-5 w-5 text-emerald-400" />}
            {statusBanner.variant === 'credits' && <Zap className="h-5 w-5 text-foreground" />}
            {statusBanner.variant === 'empty' && <AlertTriangle className="h-5 w-5 text-destructive" />}
          </div>
          <div>
            <p className="font-semibold text-foreground">{statusBanner.headline}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{statusBanner.detail}</p>
          </div>
        </div>
      )}

      {/* Usage stats row */}
      {billing && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Free trial</CardDescription>
              <CardTitle className="text-2xl">{billing.freeEventsRemaining}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {billing.freeEventsUsed} of {billing.freeEventsGranted} used
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Event credits</CardDescription>
              <CardTitle className="text-2xl">{billing.paidEventCredits}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Pay-per-event credits available</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pro status</CardDescription>
              <CardTitle className="flex items-center gap-2 text-2xl">
                {billing.hasProAccess ? (
                  <>
                    <Check className="h-5 w-5 text-emerald-400" />
                    Active
                  </>
                ) : (
                  'Inactive'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{billing.tierLabel}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plan options */}
      <div>
        <h2 className="mb-4 font-display text-xl font-semibold text-foreground">Choose a plan</h2>
        <div className="grid gap-4 md:grid-cols-3">

          {/* Pay-Per-Event */}
          <Card className={cn(billing?.tier === 'pay_per_event' && !isProActive && 'border-primary')}>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-accent/40">
                <Zap className="h-5 w-5 text-foreground" />
              </div>
              <CardTitle>Pay-Per-Event</CardTitle>
              <CardDescription>One event credit per purchase</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {billing && (
                <div className="text-3xl font-bold text-foreground">
                  ${billing.prices.payPerEventAmount}
                  <span className="ml-1 text-base font-normal text-muted-foreground">/event</span>
                </div>
              )}
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" />All platform features</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" />Credits never expire</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" />No monthly commitment</li>
              </ul>
              <Button
                type="button"
                className="w-full"
                variant="secondary"
                disabled={Boolean(checkoutLoading) || cancelLoading}
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
          <Card className={cn('md:col-span-2', isProActive && 'border-primary shadow-glow')}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="flex items-center gap-2">
                    Pro
                    {isProActive && (
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                        Current plan
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>Unlimited events — no per-event fee</CardDescription>
                </div>

                {/* Monthly / Annual toggle */}
                <div className="inline-flex items-center gap-1 rounded-lg bg-sidebar-accent/30 p-1">
                  <button
                    type="button"
                    onClick={() => setProBilling('monthly')}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-semibold transition-smooth',
                      proBilling === 'monthly'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
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
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Annual
                    {annualSavings > 0 && (
                      <span className="rounded-full bg-lime-500/20 px-1.5 py-0.5 text-xs font-bold text-lime-400">
                        Save ${annualSavings}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {proPrice !== null && (
                <div className="text-3xl font-bold text-foreground">
                  ${proPrice}
                  <span className="ml-1 text-base font-normal text-muted-foreground">
                    /{proBilling === 'monthly' ? 'month' : 'year'}
                  </span>
                  {proBilling === 'annual' && (
                    <span className="ml-2 text-sm font-semibold text-lime-400">
                      ~${annualMonthlyEquivalent}/mo
                    </span>
                  )}
                </div>
              )}

              <ul className="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />Unlimited events</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />No per-event platform fee</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />Advanced analytics</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />Priority support</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />Early feature access</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />Cancel anytime</li>
              </ul>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  className="flex-1"
                  variant={isCurrentProPlan ? 'outline' : 'hero'}
                  disabled={Boolean(checkoutLoading) || cancelLoading || isCurrentProPlan}
                  onClick={() => startCheckout(proCheckoutType)}
                >
                  {checkoutLoading === proCheckoutType ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isCurrentProPlan ? 'Current plan' : isProActive ? 'Switch billing' : 'Upgrade to Pro'}
                </Button>

                {isProActive && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cancelLoading || Boolean(checkoutLoading)}
                    onClick={cancelSubscription}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {cancelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pricing footnote */}
      <p className="text-sm text-muted-foreground">
        Vendor service payments are always separate from platform access fees. Vendors keep 100% of their service fee.
      </p>
    </div>
  )
}
