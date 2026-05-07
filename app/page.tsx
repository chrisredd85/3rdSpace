import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Sparkles,
  Building2,
  Store,
  Zap,
  ShieldCheck,
  BarChart3,
  ArrowRight,
} from 'lucide-react'
import { HomePlannerStart } from '@/components/planner/HomePlannerStart'
import { Button } from '@/components/ui/button'
import {
  FloatingStartChip,
  StartPlanningButton,
} from '@/components/landing/StartPlanningActions'

export const metadata: Metadata = {
  title: '3rdPlace - Event Profitability Optimization',
  description:
    "3rdPlace is the Bay Area's leading event profitability engine.",
  openGraph: {
    title: '3rdPlace - Event Profitability Optimization',
    description:
      "3rdPlace helps event creators book venues and vendors, coordinate partners, and understand profitability before the doors open.",
  },
}

const personas = [
  {
    title: 'Dinner series hosts',
    body: 'Intimate founder dinners, supper clubs, tasting events',
  },
  {
    title: 'Pop-up producers',
    body: 'Markets, art shows, brand activations, seasonal events',
  },
  {
    title: 'Community builders',
    body: 'Networking events, meetups, rooftop socials, mixers',
  },
]

const features = [
  {
    icon: Zap,
    title: 'Agent-first planning',
    body: 'Describe your event in plain language. The agent builds the plan, sources venues, and coordinates vendors automatically.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval-gated spending',
    body: 'Nothing gets booked without your say. Review holds, deposits, and contracts before any money moves.',
  },
  {
    icon: BarChart3,
    title: 'Profitability tracking',
    body: 'Real-time budget tracking, ticket revenue projections, and post-event P&L — built for operators who need to make money.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <FloatingStartChip />

      {/* Nav */}
      <nav className="absolute inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">3rdPlace</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm md:flex">
          <a href="#who" className="text-muted-foreground transition-smooth hover:text-foreground">
            Who it&apos;s for
          </a>
          <a href="#features" className="text-muted-foreground transition-smooth hover:text-foreground">
            Features
          </a>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <Button variant="glass" size="sm" asChild>
            <Link href="/signup/venue">
              <Building2 className="h-4 w-4" />
              List your venue
            </Link>
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link href="/signup/vendor">
              <Store className="h-4 w-4" />
              List as vendor
            </Link>
          </Button>
          <Link
            href="/login"
            className="ml-2 text-xs font-medium text-muted-foreground transition-smooth hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pb-20 pt-32 lg:pb-28 lg:pt-40">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="container relative mx-auto max-w-7xl px-6 lg:px-12">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Bay Area event profitability engine
              </div>
              <h1 className="mt-8 font-display text-5xl font-bold leading-[1.0] tracking-tight md:text-6xl lg:text-7xl">
                3rdPlace is the{' '}
                <span className="text-gradient-brand">Bay Area&apos;s leading</span>{' '}
                event profitability engine.
              </h1>
              <p className="mt-8 max-w-xl text-lg text-muted-foreground">
                Describe the event first. The agent builds the plan, recommends venues and vendors,
                and asks you to sign in only when you save, book, pay, or export.
              </p>
            </div>

            {/* Live chat composer (the hero's primary action) */}
            <div id="hero-chat" className="relative scroll-mt-24">
              <div className="absolute -inset-8 bg-gradient-brand opacity-25 blur-3xl" />
              <div className="relative">
                <span className="absolute -top-3 left-6 z-10 inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary-foreground shadow-glow">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  Try it now — free
                </span>
                <HomePlannerStart />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="py-20 lg:py-28">
        <div className="container mx-auto max-w-6xl px-6 lg:px-12">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-primary">
              Who it&apos;s for
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold lg:text-5xl">
              Small-scale professional event organizers
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              If you run 5–50 events a year and care about margins, 3rdPlace is your operating
              system. We handle the sourcing, logistics, and vendor coordination — you focus on
              curation and community.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {personas.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-border bg-card/50 px-6 py-8 text-center transition-smooth hover:border-primary/40 hover:bg-card/70"
              >
                <p className="font-display text-xl font-bold text-foreground">{p.title}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 lg:py-28">
        <div className="container mx-auto max-w-6xl px-6 lg:px-12">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-primary">
              Features
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold lg:text-5xl">
              Built for profitable events
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-card/50 p-7 transition-smooth hover:border-primary/40 hover:bg-card/70"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                  <f.icon className="h-6 w-6 text-primary-foreground" />
                </div>
                <h3 className="mt-6 font-display text-xl font-bold text-foreground">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 pt-12">
        <div className="container mx-auto max-w-4xl px-6 lg:px-12 text-center">
          <h2 className="font-display text-4xl font-bold lg:text-5xl">
            Ready to plan profitably?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            No sign-up required. Describe your event and see what the agent builds.
          </p>
          <StartPlanningButton className="mt-10">
            Start your first event <ArrowRight className="h-4 w-4" />
          </StartPlanningButton>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 3rdPlace. Agent-first event planning for the Bay Area.
      </footer>
    </div>
  )
}
