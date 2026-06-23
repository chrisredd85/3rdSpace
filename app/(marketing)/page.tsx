import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: '3rdPlace - Your event operating agent.',
  description:
    '3rdPlace plans events, prepares approved outreach, tracks quotes, and keeps the event operating record current.',
  openGraph: {
    title: '3rdPlace - Your event operating agent.',
    description:
      '3rdPlace plans events, prepares approved outreach, tracks quotes, and keeps the event operating record current.',
  },
}

const hostTags = [
  'Founder dinners',
  'Supper clubs',
  'Salon nights',
  'Monthly mixers',
  'Recurring tastings',
  'Community meetups',
]

const runSteps = [
  {
    n: '01',
    title: 'Plan',
    body: 'The agent turns your chat into an event brief: date, guests, budget, location, partner needs, ticketing, and target economics.',
  },
  {
    n: '02',
    title: 'Reach out',
    body: '3rdPlace prepares approved outreach to venues and vendors, tracks replies, and updates the brief as terms change.',
  },
  {
    n: '03',
    title: 'Approve',
    body: 'You approve every message, hold, payment, date change, and booking step before it executes.',
  },
  {
    n: '04',
    title: 'Operate',
    body: 'The system keeps the event record current: quotes, deposits, payments, guest counts, margin, and follow-up tasks.',
  },
]

const featureCards = [
  {
    title: 'Approved outreach, not cold chaos',
    body: 'The agent finds likely partners, drafts the message, and sends only after you approve.',
  },
  {
    title: 'Verified quotes before decisions',
    body: 'Compare real terms: price, deposit, capacity, deadlines, food/bar rules, cancellation, and payment path.',
  },
  {
    title: 'Event brief that stays current',
    body: 'Replies, date changes, guest count shifts, and partner terms update the operating record.',
  },
  {
    title: 'Payments with guardrails',
    body: 'Venue and vendor payments run through approved flows. Nothing books or pays without an approval record.',
  },
]

const faqs = [
  {
    q: 'Does the agent ever book or pay without me?',
    a: 'No. Every booking, every payment, every contract waits on your approval. The agent proposes; you approve.',
  },
  {
    q: "What if my venue or vendor isn't on the platform?",
    a: 'Add them. The agent learns your roster and uses it first on future events.',
  },
  {
    q: 'Where does the money actually move?',
    a: 'Through Stripe Connect. Venues, vendors, and you each have their own connected account. 3rdPlace never holds funds.',
  },
]

function Caps({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`label-caps text-clay-deep ${className}`}>{children}</span>
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-md bg-clay px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
    >
      {children}
    </Link>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="relative lg:min-h-[calc(100svh-74px)]">
        <div className="mx-auto grid w-full max-w-[1480px] items-start gap-8 px-5 py-8 sm:px-6 sm:py-10 lg:min-h-[calc(100svh-74px)] lg:grid-cols-[minmax(0,0.98fr)_minmax(380px,0.88fr)] lg:items-center lg:gap-14 lg:px-8 lg:py-8 2xl:max-w-[1600px] 2xl:gap-16 2xl:px-10">
          <div className="animate-entrance lg:flex lg:h-full lg:flex-col lg:justify-center">
            <h1 className="mt-4 max-w-[840px] font-display text-[clamp(3rem,4.85vw,5.35rem)] font-medium leading-[0.96] tracking-normal text-ink">
              Your event operating agent.
            </h1>
            <p className="mt-4 max-w-[760px] text-[18px] leading-[1.45] text-ink-soft lg:text-[19px] 2xl:text-[20px]">
              Describe the event. The agent builds the plan, finds partners, prepares the outreach.
              You approve every move before it ships.
            </p>
            <p className="mt-5 max-w-[720px] text-[15.5px] leading-[1.65] text-ink-soft">
              Built for Bay Area hosts running dinners, mixers, salons, tastings, community events,
              and ticketed gatherings on repeat.
            </p>
            <div className="mt-8">
              <PrimaryLink href="/planner">Start running events -&gt;</PrimaryLink>
            </div>
          </div>

          <div className="relative hidden animate-entrance md:block lg:h-full" style={{ animationDelay: '120ms' }}>
            <div className="relative h-[420px] overflow-hidden rounded-md border border-tan shadow-sm md:h-[500px] lg:h-[clamp(560px,calc(100vh-132px),780px)]">
              <Image
                src="/lovable/hero-venue.jpg"
                alt="Private dining room in the Mission at golden hour"
                fill
                priority
                sizes="(min-width: 1024px) 42vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent" />
              <div className="absolute right-5 top-5 max-w-[82%] rounded-full border border-tan bg-cream/95 px-5 py-3 text-[17px] text-ink shadow-md backdrop-blur">
                60 person dinner, Mission, June 12, $5,000 budget
              </div>
              <div className="absolute bottom-5 left-5 max-w-[88%]">
                <div className="rounded-md border border-tan bg-cream/95 px-4 py-3 shadow-lg backdrop-blur">
                  <div className="flex items-center justify-between gap-5">
                    <Caps>Operator · 3rdPlace</Caps>
                    <span className="font-mono text-[11px] text-ink-faint">14:02</span>
                  </div>
                  <p className="mt-3 text-[17px] leading-snug text-ink">
                    3 venues fit. 2 need quotes. 1 can hold the date. Review before we send outreach.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-forest-tint px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-forest">Review required</span>
                    <span className="inline-flex items-center rounded-full bg-cream-deep px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-ink-soft">Quote tracking</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-tan/70">
        <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <Caps>Who it&apos;s for</Caps>
          <h2 className="mt-4 max-w-3xl font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            Built for hosts who run events on repeat.
          </h2>
          <p className="mt-6 max-w-3xl text-[18px] leading-[1.65] text-ink-soft">
            Founder dinners. Supper clubs. Salon nights. Monthly mixers. Recurring tasting events. If
            your calendar has the same format on it again next month, 3rdPlace compounds. The agent
            remembers your venues, your vendors, your margins, and starts the next event with
            everything it already knows.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {hostTags.map((tag) => (
              <span key={tag} className="rounded-full border border-tan bg-cream-deep px-4 py-2 text-[13px] font-semibold text-ink-soft">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-tan/70 bg-cream-deep/40">
        <div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24 2xl:px-10">
          <h2 className="max-w-3xl font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            How it runs
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {runSteps.map((step) => (
              <article key={step.n} className="rounded-md border border-tan bg-cream p-7 shadow-sm">
                <span className="font-mono text-[12px] tracking-[0.18em] text-clay">{step.n}</span>
                <h3 className="mt-5 font-display text-[30px] leading-tight text-ink">{step.title}</h3>
                <p className="mt-4 text-[16px] leading-[1.6] text-ink-soft">{step.body}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-[16px] leading-[1.65] text-ink-soft">
            Built for hosts running events on repeat — each event leaves a playbook for the next.
          </p>
        </div>
      </section>

      <section className="border-t border-tan/70">
        <div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24 2xl:px-10">
          <Caps>What ships in the box</Caps>
          <h2 className="mt-4 max-w-3xl font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            The operations work, handled.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {featureCards.map((item) => (
              <article key={item.title} className="rounded-md border border-tan bg-cream p-7 shadow-sm">
                <h3 className="font-display text-[24px] leading-tight text-ink">{item.title}</h3>
                <p className="mt-4 text-[15.5px] leading-[1.65] text-ink-soft">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-tan/70 bg-cream-deep/40">
        <div className="mx-auto max-w-[1080px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <h2 className="font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            Nonstandard event? 3rdPlace switches modes.
          </h2>
          <p className="mt-6 text-[18px] leading-[1.65] text-ink-soft">
            Yacht parties, rooftops, warehouses, private estates, and outdoor events require verified
            quotes. The agent gathers the right intake details, labels leads as quote-required, and
            routes execution through concierge, external checkout, or controlled payment only when
            the provider is ready.
          </p>
        </div>
      </section>

      <section className="border-t border-tan/70 bg-cream-deep/40">
        <div className="mx-auto max-w-[1080px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <Caps>From the calendar</Caps>
          <blockquote className="mt-5 font-display text-[30px] leading-[1.15] text-ink sm:text-[42px]">
            &ldquo;I used to spend a full day chasing vendors and reconciling receipts
            after every dinner. Now I run the next one before the last one is fully settled,
            and I actually know what I made.&rdquo;
          </blockquote>
          <p className="mt-7 font-mono text-[13px] tracking-[0.08em] text-ink-soft">
            Founder dinner host · Mission · 14 events in 2025
          </p>
        </div>
      </section>

      <section id="pricing" className="border-t border-tan/70">
        <div className="mx-auto max-w-[1120px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <Caps>Pricing</Caps>
          <h2 className="mt-4 font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            First 2 events free.
          </h2>
          <p className="mt-5 max-w-3xl text-[18px] leading-[1.6] text-ink-soft">
            Run two events end-to-end before you commit. No card required. After that, pay per event
            or move to Pro for unlimited runs and the full margin history.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <article className="rounded-md border border-tan bg-cream p-7 shadow-sm">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Caps>Per event</Caps>
                  <h3 className="mt-3 font-display text-[30px] leading-tight text-ink">Pay only when you ship.</h3>
                </div>
                <div className="sm:text-right">
                  <p className="font-display text-[46px] leading-none text-ink">$30</p>
                  <p className="mt-1 text-[13px] font-semibold text-ink-soft">/event</p>
                </div>
              </div>
              <p className="mt-4 text-[16px] leading-[1.6] text-ink-soft">
                After your first 2 events free, buy one event credit at a time.
              </p>
              <p className="mt-6 border-t border-tan pt-5 text-[14px] leading-[1.6] text-ink-soft">
                Includes the planner, approvals, payment coordination, and event margin record for one shipped event.
              </p>
            </article>
            <article className="rounded-md border border-tan bg-cream p-7 shadow-sm">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Caps>Pro</Caps>
                  <h3 className="mt-3 font-display text-[30px] leading-tight text-ink">Run without the meter.</h3>
                </div>
                <div className="sm:text-right">
                  <p className="font-display text-[46px] leading-none text-ink">$69</p>
                  <p className="mt-1 text-[13px] font-semibold text-ink-soft">/month</p>
                </div>
              </div>
              <p className="mt-4 text-[16px] leading-[1.6] text-ink-soft">
                Unlimited events, full historical margin, priority 3rdPlace team support.
              </p>
              <p className="mt-6 border-t border-tan pt-5 text-[14px] leading-[1.6] text-ink-soft">
                Annual plan available at $690/year, about $58/month.
              </p>
            </article>
          </div>
          <Link href="/pricing" className="mt-8 inline-flex text-[15px] font-semibold text-ink transition-colors hover:text-clay">
            See pricing -&gt;
          </Link>
        </div>
      </section>

      <section id="faq" className="border-t border-tan/70">
        <div className="mx-auto max-w-[860px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <Caps>Common questions</Caps>
          <h2 className="mt-4 font-display text-[40px] leading-[1.05] text-ink sm:text-[52px]">
            Clear answers. No fine print.
          </h2>
          <div className="mt-10 border-t border-tan">
            {faqs.map((item) => (
              <div key={item.q} className="border-b border-tan py-5">
                <h3 className="font-display text-[20px] text-ink">{item.q}</h3>
                <p className="mt-3 pr-10 text-[15.5px] leading-[1.65] text-ink-soft">{item.a}</p>
              </div>
            ))}
          </div>
          <Link href="/faq" className="mt-8 inline-flex text-[15px] font-semibold text-ink transition-colors hover:text-clay">
            Read the full FAQ -&gt;
          </Link>
        </div>
      </section>

      <section className="border-t border-tan/70 bg-cream-deep/50">
        <div className="mx-auto max-w-[980px] px-5 py-24 text-center sm:px-6 lg:px-8 lg:py-28">
          <h2 className="font-display text-[46px] leading-[1.0] text-ink sm:text-[72px]">
            Your next event is already on the calendar.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-[1.6] text-ink-soft">
            Describe it. The agent lays out the run, locks the holds, and waits for your green light.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4">
            <PrimaryLink href="/planner">Start running events -&gt;</PrimaryLink>
            <p className="font-mono text-[12px] text-ink-faint">
              First 2 events free. Approval required before booking or payment.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-tan/70">
        <div className="mx-auto grid max-w-[1480px] gap-10 px-5 py-14 sm:grid-cols-4 sm:px-6 lg:px-8 2xl:px-10">
          <div>
            <Link href="/" className="font-display text-[24px] text-clay">3rdPlace</Link>
            <p className="mt-3 text-[14px] leading-[1.6] text-ink-soft">The operations agent for Bay Area hosts.</p>
          </div>
          <div>
            <Caps>Product</Caps>
            <ul className="mt-4 space-y-2 text-[14px] text-ink-soft">
              <li><Link href="/pricing" className="hover:text-ink">Pricing</Link></li>
              <li><Link href="/faq" className="hover:text-ink">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <Caps>Company</Caps>
            <ul className="mt-4 space-y-2 text-[14px] text-ink-soft">
              <li><a href="mailto:hello@3rdplace.io" className="hover:text-ink">Contact</a></li>
              <li><a href="mailto:hello@3rdplace.io" className="hover:text-ink">3rdPlace support</a></li>
            </ul>
          </div>
          <div>
            <Caps>Legal</Caps>
            <ul className="mt-4 space-y-2 text-[14px] text-ink-soft">
              <li><Link href="/terms" className="hover:text-ink">Terms</Link></li>
              <li><Link href="/privacy" className="hover:text-ink">Privacy</Link></li>
            </ul>
          </div>
          <div className="rounded-card border border-tan/70 bg-cream-deep/60 p-5 sm:col-span-4">
            <Caps>3rdPlace Outreach SMS</Caps>
            <p className="mt-3 max-w-4xl text-[13px] leading-[1.7] text-ink-soft">
              3rdPlace may send event operations texts to hosts, venues, and vendors who opt in, including
              planning updates, booking coordination, payment reminders, and support messages. Message frequency
              varies by event activity. Message and data rates may apply. Reply STOP to unsubscribe or HELP for
              support. SMS consent is not a condition of purchase.
            </p>
            <p className="mt-3 max-w-4xl text-[13px] leading-[1.7] text-ink-soft">
              We do not sell, rent, or share mobile opt-in data or SMS consent with third parties for their
              marketing or promotional purposes. For help, email{' '}
              <a className="font-semibold text-clay underline-offset-4 hover:underline" href="mailto:hello@3rdplace.io">
                hello@3rdplace.io
              </a>
              . See our{' '}
              <Link className="font-semibold text-clay underline-offset-4 hover:underline" href="/terms">
                Terms
              </Link>{' '}
              and{' '}
              <Link className="font-semibold text-clay underline-offset-4 hover:underline" href="/privacy">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="border-t border-tan/70">
          <div className="mx-auto max-w-[1480px] px-5 py-5 sm:px-6 lg:px-8 2xl:px-10">
            <p className="font-mono text-[11px] text-ink-faint">
              &copy; 2026 3rdPlace · Built in the Bay Area for hosts who run events on repeat.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
