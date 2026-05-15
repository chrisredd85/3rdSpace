import type { Metadata } from 'next'
import {
  Zap,
  ShieldCheck,
  BarChart3,
  ArrowRight,
} from 'lucide-react'
import { HomePlannerStart } from '@/components/planner/HomePlannerStart'
import {
  FloatingStartChip,
  StartPlanningButton,
} from '@/components/landing/StartPlanningActions'

export const metadata: Metadata = {
  title: '3rdPlace - The Repeat Event OS for Bay Area Creators',
  description:
    "Stop planning the same event from scratch. 3rdPlace remembers your venues, vendors, and margins so every event runs faster than the last.",
  openGraph: {
    title: '3rdPlace - The Repeat Event OS for Bay Area Creators',
    description:
      "3rdPlace is the operating system for Bay Area creators running 3+ events a month. The agent plans, sources, and tracks margins across your entire calendar.",
  },
}

const personas = [
  {
    title: 'Monthly series hosts',
    body: 'Founder dinners, supper clubs, tasting events — same vibe, different guests, every time.',
  },
  {
    title: 'Pop-up producers',
    body: 'Markets, brand activations, and art shows that run on a calendar, not a whim.',
  },
  {
    title: 'Community builders',
    body: 'Weekly meetups, monthly socials, recurring mixers — your community is your calendar.',
  },
]

const features = [
  {
    icon: Zap,
    title: 'Plan your next event in minutes',
    body: 'Describe it in plain language. The agent pulls your best venues, matches vendors from your history, and builds a full plan — including the profit window.',
  },
  {
    icon: ShieldCheck,
    title: 'Nothing moves without your approval',
    body: 'Review venue holds, vendor quotes, and contracts before a dollar commits. You stay in control across every event on your calendar.',
  },
  {
    icon: BarChart3,
    title: 'Know your margins before you commit',
    body: 'Track P&L across your full calendar, not just one event. See where you\'re making money and where you\'re leaving it on the table.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <FloatingStartChip />

      {/* Hero */}
      <section className="relative flex min-h-screen items-center overflow-hidden py-28 lg:py-32">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent via-background/20 to-background" />
        <div className="container relative mx-auto max-w-7xl px-6 lg:px-12">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                The repeat event OS · Bay Area
              </div>
              <h1 className="mt-8 font-display text-5xl font-bold leading-[1.0] tracking-tight md:text-6xl lg:text-7xl">
                Stop planning{' '}
                <span className="text-gradient-brand">the same event</span>{' '}
                from scratch.
              </h1>
              <p className="mt-8 max-w-xl text-lg text-muted-foreground">
                3rdPlace remembers your venues, vendors, and margins from every event you&apos;ve run.
                Describe what&apos;s next — the agent builds the plan, pulls your best partners, and
                shows you the profit window before you spend a dollar.
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
      <section id="who" className="relative pt-12 pb-20 lg:pt-14 lg:pb-28">
        <div className="container mx-auto max-w-6xl px-6 lg:px-12">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-primary">
              Who it&apos;s for
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold lg:text-5xl">
              For creators who never stop hosting
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              If you&apos;re running 3+ events a month and tired of rebuilding the same plan,
              3rdPlace is your operating system. We handle sourcing, logistics, and vendor
              coordination — so your tenth event runs faster than your first.
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
              Gets faster every time you host
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
