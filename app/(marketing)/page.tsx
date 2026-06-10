import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { HomePlannerStart } from '@/components/planner/HomePlannerStart'

export const metadata: Metadata = {
  title: '3rdPlace - Know what worked. Repeat what paid.',
  description:
    '3rdPlace models event economics, executes event ops, and shows what every event returned.',
  openGraph: {
    title: '3rdPlace - Know what worked. Repeat what paid.',
    description:
      '3rdPlace models event economics, executes event ops, and shows what every event returned.',
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
    title: 'Propose',
    body: 'The agent reads the event, pulls your best venues and vendors from history, and lays out the run with cost, margin, and a working timeline.',
  },
  {
    n: '02',
    title: 'Approve',
    body: 'You see every move before it ships. Holds, deposits, contracts, vendor dispatch: nothing moves until you authorize it.',
  },
  {
    n: '03',
    title: 'Settle',
    body: 'After the event, 3rdPlace closes the books. Refunds reviewed, Community Host Incentives reconciled, margin recorded, next event pre-loaded.',
  },
]

const featureCards = [
  {
    title: 'Venue holds, locked in writing',
    body: 'The agent reaches your shortlist, negotiates terms, and locks holds with deposit windows you can authorize in one click.',
  },
  {
    title: 'Vendors dispatched on your terms',
    body: 'Photo, catering, bar, AV, DJ. The agent finds the right vendor for the budget, sends the brief, and gets the quote signed off. Your approval required at every step.',
  },
  {
    title: 'Money settled, cents-accurate',
    body: 'Deposits collected, vendor payments routed through Stripe Connect, refunds handled, Community Host Incentives reconciled. Every dollar tagged to an event.',
  },
  {
    title: 'Margin on every event',
    body: 'A real P&L per event the moment it closes. Know which formats actually paid, which ones leaked, and which ones to run again.',
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
      <section className="relative">
        <div className="mx-auto grid max-w-[1320px] items-start gap-8 px-6 py-8 sm:py-10 lg:grid-cols-12 lg:items-stretch lg:gap-8 lg:py-4 xl:py-5">
          <div className="animate-entrance lg:col-span-7 lg:flex lg:h-full lg:flex-col">
            <Caps className="text-[13px]">Bay Area · 2026</Caps>
            <h1 className="mt-4 font-display text-[46px] font-medium leading-[0.98] tracking-normal text-ink sm:text-[62px] lg:text-[60px] xl:text-[68px]">
              <span className="block sm:whitespace-nowrap">Know what worked.</span>
              <span className="block text-clay sm:whitespace-nowrap">Repeat what paid.</span>
            </h1>
            <p className="mt-4 max-w-[720px] text-[18px] leading-[1.4] text-ink-soft lg:text-[19px]">
              See what every event actually returned — then run the next one.
            </p>
            <div className="mt-3 max-w-[720px]">
              <HomePlannerStart />
            </div>
          </div>

          <div className="relative hidden animate-entrance md:block lg:col-span-5 lg:h-full" style={{ animationDelay: '120ms' }}>
            <div className="relative h-[420px] overflow-hidden rounded-md border border-tan shadow-sm md:h-[500px] lg:h-[calc(100vh-116px)] lg:min-h-[560px] lg:max-h-[760px]">
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
                    Three venues fit. Holding The Valencia Room for 24 hours while you authorize.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-forest-tint px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-forest">Verified-attendance incentive</span>
                    <span className="inline-flex items-center rounded-full bg-cream-deep px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-ink-soft">$1,800 rental</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-tan/70">
        <div className="mx-auto max-w-[1100px] px-6 py-24">
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

      <section className="border-t border-tan/70 bg-cream-deep/40">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <Caps>How it runs</Caps>
          <h2 className="mt-4 max-w-3xl font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            Three moves. Every event.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {runSteps.map((step) => (
              <article key={step.n} className="rounded-md border border-tan bg-cream p-7 shadow-sm">
                <span className="font-mono text-[12px] tracking-[0.18em] text-clay">{step.n}</span>
                <h3 className="mt-5 font-display text-[30px] leading-tight text-ink">{step.title}</h3>
                <p className="mt-4 text-[16px] leading-[1.6] text-ink-soft">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-tan/70">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
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
        <div className="mx-auto max-w-[1000px] px-6 py-24">
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
        <div className="mx-auto max-w-[1000px] px-6 py-24">
          <Caps>Pricing</Caps>
          <h2 className="mt-4 font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            First two events on us.
          </h2>
          <p className="mt-5 max-w-3xl text-[18px] leading-[1.6] text-ink-soft">
            Run two events end-to-end before you commit. No card required. After that, pay per event
            or move to Pro for unlimited runs and the full margin history.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <article className="rounded-md border border-tan bg-cream p-7 shadow-sm">
              <Caps>Per event</Caps>
              <h3 className="mt-3 font-display text-[30px] text-ink">Pay only when you ship.</h3>
              <p className="mt-3 text-[16px] leading-[1.6] text-ink-soft">Pay only for events you actually ship.</p>
            </article>
            <article className="rounded-md border border-tan bg-cream p-7 shadow-sm">
              <Caps>Pro</Caps>
              <h3 className="mt-3 font-display text-[30px] text-ink">Run without the meter.</h3>
              <p className="mt-3 text-[16px] leading-[1.6] text-ink-soft">Unlimited events, full historical margin, priority 3rdPlace team support.</p>
            </article>
          </div>
          <Link href="/pricing" className="mt-8 inline-flex text-[15px] font-semibold text-ink transition-colors hover:text-clay">
            See pricing -&gt;
          </Link>
        </div>
      </section>

      <section id="faq" className="border-t border-tan/70">
        <div className="mx-auto max-w-[820px] px-6 py-24">
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
        <div className="mx-auto max-w-[900px] px-6 py-28 text-center">
          <h2 className="font-display text-[46px] leading-[1.0] text-ink sm:text-[72px]">
            Your next event is already on the calendar.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-[1.6] text-ink-soft">
            Describe it. The agent lays out the run, locks the holds, and waits for your green light.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4">
            <PrimaryLink href="/planner">Start running events -&gt;</PrimaryLink>
            <p className="font-mono text-[12px] text-ink-faint">
              First two events free. Approval required before booking or payment.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-tan/70">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-14 sm:grid-cols-4">
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
          <div className="mx-auto max-w-[1200px] px-6 py-5">
            <p className="font-mono text-[11px] text-ink-faint">
              &copy; 2026 3rdPlace · Built in the Bay Area for hosts who run events on repeat.
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
