'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Calendar, Check, Crown, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const PRICES = {
  payPerEvent: 30,
  proMonthly: 69,
  proAnnual: 690,
}

const annualSavings = PRICES.proMonthly * 12 - PRICES.proAnnual

const freeFeatures = [
  '1 free event included',
  'Book venues and vendors',
  'Messaging with vendors',
  'File sharing',
  'Basic analytics',
]

const payPerEventFeatures = [
  'One event credit per purchase',
  'Book venues and vendors',
  'Messaging with vendors',
  'File sharing',
  'Basic analytics',
  'Standard support',
]

const proFeatures = [
  'Unlimited events — no per-event fee',
  'Book venues and vendors',
  'Messaging with vendors',
  'Advanced analytics',
  'Priority support',
  'Early access to new features',
]

export default function PricingPage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')

  const proPrice = billing === 'monthly' ? PRICES.proMonthly : PRICES.proAnnual
  const proInterval = billing === 'monthly' ? 'month' : 'year'

  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">

        {/* Nav */}
        <nav className="mb-14 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold text-foreground">
            3rdSpace
          </Link>
          <Link href="/builder/billing">
            <Button size="sm" variant="outline">
              Manage Billing
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </nav>

        {/* Hero */}
        <section className="mb-14 text-center">
          <h1 className="font-display text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Start free. Scale as you grow. Vendors always keep their full service fee — platform fees never touch your talent.
          </p>
        </section>

        {/* Billing toggle */}
        <div className="mb-12 flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-xl bg-sidebar-accent/30 p-1">
            <button
              type="button"
              onClick={() => setBilling('monthly')}
              className={cn(
                'rounded-lg px-5 py-2 text-sm font-semibold transition-smooth',
                billing === 'monthly'
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBilling('annual')}
              className={cn(
                'flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-smooth',
                billing === 'annual'
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Annual
              <span className="rounded-full bg-lime-500/20 px-2 py-0.5 text-xs font-bold text-lime-400">
                Save ${annualSavings}
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards */}
        <section className="grid gap-6 md:grid-cols-3">

          {/* Free Trial */}
          <div className="flex flex-col rounded-2xl border border-border bg-gradient-card p-8 shadow-card">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-accent/40">
              <Calendar className="h-5 w-5 text-foreground" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Free Trial</h2>
            <p className="mt-1 text-sm text-muted-foreground">For every new builder</p>

            <div className="mt-6">
              <span className="text-5xl font-bold text-foreground">$0</span>
              <span className="ml-1 text-base text-muted-foreground">for 1 event</span>
            </div>

            <ul className="mt-8 flex-1 space-y-3">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>

            <Link href="/signup/builder" className="mt-8 block">
              <Button variant="outline" className="w-full">
                Start for free
              </Button>
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">No credit card required</p>
          </div>

          {/* Pay-Per-Event */}
          <div className="flex flex-col rounded-2xl border border-border bg-gradient-card p-8 shadow-card">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-accent/40">
              <Zap className="h-5 w-5 text-foreground" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Pay-Per-Event</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pay only when you need it</p>

            <div className="mt-6">
              <span className="text-5xl font-bold text-foreground">${PRICES.payPerEvent}</span>
              <span className="ml-1 text-base text-muted-foreground">/event</span>
            </div>

            <ul className="mt-8 flex-1 space-y-3">
              {payPerEventFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>

            <Link href="/builder/billing" className="mt-8 block">
              <Button variant="secondary" className="w-full">
                Buy an event credit
              </Button>
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">Best for 1–2 events / month</p>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-2xl border-2 border-primary bg-primary/5 p-8 shadow-glow">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-gradient-brand px-4 py-1 text-sm font-bold text-white">
                Most Popular
              </span>
            </div>

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold text-foreground">Pro</h2>
            <p className="mt-1 text-sm text-muted-foreground">Unlimited events, zero friction</p>

            <div className="mt-6">
              <span className="text-5xl font-bold text-foreground">${proPrice}</span>
              <span className="ml-1 text-base text-muted-foreground">/{proInterval}</span>
              {billing === 'annual' && (
                <p className="mt-1 text-sm font-semibold text-lime-400">
                  Save ${annualSavings}/year vs monthly
                </p>
              )}
            </div>

            <ul className="mt-8 flex-1 space-y-3">
              {proFeatures.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>

            <Link href="/builder/billing" className="mt-8 block">
              <Button variant="hero" className="w-full">
                Upgrade to Pro
              </Button>
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">Cancel anytime</p>
          </div>
        </section>

        {/* Break-even guide */}
        <section className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-8">
          <h2 className="font-display text-xl font-bold text-foreground">Which plan saves you money?</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">1–2 events / month</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Pay-Per-Event wins — spend $30–$60 vs $69 for Pro.
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-5">
              <p className="text-sm font-semibold text-foreground">3+ events / month</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Pro saves money. At 3 events you'd spend $90 on credits vs $69 for Pro.
              </p>
            </div>
            <div className="rounded-xl bg-background/60 p-5">
              <p className="text-sm font-semibold text-foreground">Break-even point</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                2.3 events / month. Pro makes sense the moment you cross 3.
              </p>
            </div>
          </div>
        </section>

        {/* Footnote */}
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Vendor service payments are separate from platform access fees. Vendors keep 100% of their service fee.
        </p>
      </div>
    </main>
  )
}
