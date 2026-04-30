import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Sparkles,
  Calendar,
  Building2,
  Users,
  Wallet,
  MessageSquare,
  ArrowRight,
  Ticket,
  Music2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: '3rdSpace — The Operating Layer for Live Events',
  description:
    "Plan it. Book it. Make it make money. 3rdSpace connects event creators, venues, and vendors in one platform.",
  openGraph: {
    title: '3rdSpace — The Operating Layer for Live Events',
    description:
      "3rdSpace connects three sides of every event — the creators throwing it, the venues hosting it, and the vendors making it run.",
  },
}

const roles = [
  {
    key: 'creator',
    title: 'Event Creators',
    icon: Ticket,
    pitch:
      'Plan events, invite collaborators, book venues + vendors, and watch ticket revenue vs costs in real time.',
    accent: 'from-primary to-primary-glow',
    cta: 'I plan events',
    href: '/signup/builder',
  },
  {
    key: 'venue',
    title: 'Venues & Bars',
    icon: Building2,
    pitch:
      'Show off your space, set house rules and kickback rates, and manage one calendar that prevents double-bookings.',
    accent: 'from-secondary to-primary',
    cta: 'I run a venue',
    href: '/signup/venue',
  },
  {
    key: 'vendor',
    title: 'Vendors',
    icon: Music2,
    pitch:
      'List your services, set your rates and deposit terms, and opt in to emergency last-minute gigs.',
    accent: 'from-accent to-secondary',
    cta: "I'm a vendor",
    href: '/signup/vendor',
  },
]

const features = [
  {
    icon: Calendar,
    title: 'Event Workspace',
    desc: 'Every booking, message, doc, and milestone — one screen per event.',
  },
  {
    icon: Building2,
    title: 'Venue Marketplace',
    desc: 'Filter by date, capacity, amenities, and book in a few taps.',
  },
  {
    icon: Users,
    title: 'Vendor Network',
    desc: 'DJs, caterers, photo, AV, florals — pick a package, send the request.',
  },
  {
    icon: Wallet,
    title: 'Live Finances',
    desc: 'Projected revenue, deposits due, kickbacks, and real profit/loss.',
  },
  {
    icon: MessageSquare,
    title: 'Event-Threaded Chat',
    desc: 'Conversations stay attached to the event they belong to.',
  },
  {
    icon: Sparkles,
    title: 'Status That Updates Itself',
    desc: 'Requested → quoted → confirmed. Everyone sees the same truth.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* Nav */}
      <nav className="absolute inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">3rdSpace</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm md:flex">
          <a href="#roles" className="text-muted-foreground transition-smooth hover:text-foreground">
            Who it&apos;s for
          </a>
          <a href="#features" className="text-muted-foreground transition-smooth hover:text-foreground">
            Features
          </a>
        </div>
        <div />
      </nav>

      {/* Hero */}
      <section className="relative pb-20 pt-32 lg:pb-28 lg:pt-40">
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="container relative mx-auto max-w-7xl px-6 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                The operating layer for live events
              </div>
              <h1 className="mt-6 font-display text-5xl font-bold leading-[0.95] tracking-tight md:text-6xl lg:text-7xl">
                Plan it.{' '}
                <span className="text-gradient-brand">Book it.</span>
                <br />
                Make it make money.
              </h1>
              <p className="mt-6 text-lg text-muted-foreground">
                3rdSpace connects three sides of every event — the creators throwing it, the venues
                hosting it, and the vendors making it run. Pick your side to get started.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button variant="hero" size="xl" asChild>
                  <a href="#roles">
                    Get Started <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button variant="glass" size="xl" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
              <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
                <div>
                  <span className="font-display text-2xl text-foreground">2.4k+</span>
                  <div className="text-xs">events planned</div>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <span className="font-display text-2xl text-foreground">480</span>
                  <div className="text-xs">venues</div>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <span className="font-display text-2xl text-foreground">1.2k</span>
                  <div className="text-xs">vendors</div>
                </div>
              </div>
            </div>

            {/* Hero visual — gradient placeholder */}
            <div className="relative">
              <div className="absolute -inset-8 bg-gradient-brand opacity-30 blur-3xl" />
              <div className="relative flex h-80 items-center justify-center overflow-hidden rounded-3xl border border-border bg-gradient-card shadow-glow lg:h-96">
                <div className="absolute inset-0 bg-gradient-mesh opacity-60" />
                <div className="relative text-center">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                    <Sparkles className="h-10 w-10 text-primary-foreground" />
                  </div>
                  <p className="font-display text-2xl font-bold">3rdSpace</p>
                  <p className="mt-1 text-sm text-muted-foreground">Event command center</p>
                </div>
              </div>
              <div className="absolute -bottom-6 -left-6 hidden rounded-2xl border border-border bg-card/90 p-4 shadow-card backdrop-blur-xl md:block">
                <p className="text-xs text-muted-foreground">Projected profit</p>
                <p className="font-display text-2xl font-bold text-green-400">+$6,200</p>
              </div>
              <div className="absolute -right-4 top-12 hidden rounded-2xl border border-border bg-card/90 p-4 shadow-card backdrop-blur-xl lg:block">
                <p className="text-xs text-muted-foreground">Venue confirmed</p>
                <p className="font-display text-base font-semibold">The Foundry Loft</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="py-20 lg:py-28">
        <div className="container mx-auto max-w-7xl px-6 lg:px-12">
          <div className="mb-14 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-secondary">
              Three roles. Three different sign-ups.
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold lg:text-5xl">
              Which side are you on?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Each role has its own onboarding because each role needs different info. Pick yours
              below.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {roles.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className="group relative flex min-h-[300px] flex-col overflow-hidden rounded-3xl border border-border bg-gradient-card p-7 shadow-card transition-smooth hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow md:min-h-[360px]"
              >
                <div
                  className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${r.accent} opacity-25 blur-2xl transition-smooth group-hover:opacity-50`}
                />
                <div className="relative flex flex-1 flex-col">
                  <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                    <r.icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <h3 className="font-display text-2xl font-bold md:text-3xl">{r.title}</h3>
                  <p className="mt-5 max-w-sm text-lg leading-relaxed text-muted-foreground">{r.pitch}</p>
                  <div className="mt-auto pt-8 text-base font-semibold text-primary">
                    {r.cta} <ArrowRight className="ml-2 inline h-5 w-5 transition-smooth group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 lg:py-28">
        <div className="container mx-auto max-w-7xl px-6 lg:px-12">
          <div className="mb-14 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              What&apos;s inside
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold lg:text-5xl">
              The shared operating layer for event planning.
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-card/40 p-6 transition-smooth hover:border-primary/50 hover:bg-card"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24">
        <div className="container mx-auto max-w-7xl px-6 lg:px-12">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-card p-10 text-center md:p-16">
            <div className="absolute inset-0 bg-gradient-brand opacity-20" />
            <div className="relative">
              <h2 className="font-display text-4xl font-bold lg:text-5xl">
                Your next event, fully booked.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Stop juggling DMs, spreadsheets, and three different calendars. Pick your role and
                join 3rdSpace.
              </p>
              <Button variant="hero" size="xl" className="mt-8" asChild>
                <a href="#roles">
                  Choose your role <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 3rdSpace. The operating layer for live events.
      </footer>
    </div>
  )
}
