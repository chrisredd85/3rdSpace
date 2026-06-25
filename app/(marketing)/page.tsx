import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { HomepageSnapScroller } from '@/components/marketing/HomepageSnapScroller'
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

const capabilityShowcases = [
  {
    eyebrow: 'Step one',
    title: 'Describe what you are running.',
    body: 'Drop in the brief the way you would tell a chief of staff. Date, headcount, budget, and the room you want. 3rdPlace turns it into an operating plan.',
    visual: 'brief',
  },
  {
    eyebrow: 'Step two',
    title: 'Authorize the moves.',
    body: 'Every venue, vendor, message, and payment surfaces as an approval card with plain-English terms. You read, you authorize. Nothing executes without you.',
    visual: 'approval',
  },
  {
    eyebrow: 'Step three',
    title: 'Compare the real replies.',
    body: 'When venues and vendors answer, 3rdPlace pulls out price, capacity, terms, availability, and risk so you can choose the strongest option.',
    visual: 'compare',
  },
  {
    eyebrow: 'Step four',
    title: 'Close the loop.',
    body: 'After the event, payments, ticketing, check-ins, incentives, and margin roll into the event brief so the next run starts smarter.',
    visual: 'settle',
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

function ProductPanel({ type }: { type: string }) {
  if (type === 'approval') {
    return (
      <div className="rounded-md border border-tan bg-cream p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Caps>Authorization required</Caps>
          <span className="w-fit rounded-full bg-forest-tint px-3 py-1.5 text-[12px] font-semibold text-forest">
            Hold expires 19:00
          </span>
        </div>
        <h3 className="mt-5 font-display text-[26px] leading-tight text-ink sm:text-[32px]">
          Lock in venue rental — The Valencia Room
        </h3>
        <p className="mt-2 text-[15px] text-ink-soft">June 12, 6:00pm-11:00pm · 60 guests · CHI eligible</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Metric label="Rental" value="$1,800.00" />
          <Metric label="Deposit" value="$600.00" />
          <Metric label="Potential incentive" value="up to $300" tone="forest" />
        </div>
        <button className="mt-7 inline-flex rounded-md bg-clay px-5 py-3 text-[15px] font-semibold text-primary-foreground">
          Authorize $1,800
        </button>
        <p className="mt-5 font-mono text-[12px] text-ink-faint">
          Authorization layer · 3rdPlace never executes without your approval.
        </p>
      </div>
    )
  }

  if (type === 'compare') {
    return (
      <div className="rounded-md border border-tan bg-cream p-5 shadow-sm sm:p-7">
        <Caps>Best fit based on responses</Caps>
        <div className="mt-5 space-y-3">
          <QuoteRow
            name="Moongate Lounge"
            meta="$1,800 rental · 70 cap · private room"
            note="Best fit for intimate dinner. Needs final date confirmation."
            active
          />
          <QuoteRow
            name="Stable Cafe"
            meta="$1,200 minimum · 45 cap · patio"
            note="Lower cost, but capacity is tight for the guest target."
          />
          <QuoteRow
            name="Mission Social Hall"
            meta="$2,400 rental · 90 cap · AV included"
            note="Strong logistics, but above target budget."
          />
        </div>
      </div>
    )
  }

  if (type === 'settle') {
    return (
      <div className="rounded-md border border-tan bg-cream p-5 shadow-sm sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <Caps>Run sheet</Caps>
          <span className="font-mono text-[12px] tracking-[0.16em] text-clay">T-21 DAYS</span>
        </div>
        <h3 className="mt-5 font-display text-[28px] leading-tight text-ink sm:text-[34px]">
          Founders Dinner — June 12
        </h3>
        <div className="mt-6 divide-y divide-tan">
          <RunRow day="T-21" task="The Valencia Room — rental settled" state="Settled" />
          <RunRow day="T-14" task="Photographer — deposit dispatched" state="Settled" />
          <RunRow day="T-7" task="Guest count and ticketing import checked" state="In flight" tone="clay" />
          <RunRow day="T+1" task="Margin, check-ins, and incentives recorded" state="Ready" />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-tan bg-cream p-5 shadow-sm sm:p-7">
      <div className="rounded-md border border-clay/20 bg-clay/5 p-4 text-[16px] leading-[1.5] text-ink">
        Founders dinner, about 60, Mission, evening of June 12. Budget around $5k all-in. I want the room to feel like a private supper, not a conference dinner.
      </div>
      <Caps className="mt-7 block text-ink-faint">Operator</Caps>
      <div className="mt-3 rounded-md border border-tan bg-cream-deep p-4 text-[16px] leading-[1.5] text-ink">
        Reading you. Three Mission venues fit 60 for a private dinner under $2k rental. Pulling terms now — I will surface them as approvals.
      </div>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-tan bg-cream-deep px-4 py-2 text-[13px] text-ink-soft">
        <span className="h-2 w-2 rounded-full bg-clay" />
        Preparing outreach to 3 venues
      </div>
    </div>
  )
}

function Metric({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'forest' }) {
  return (
    <div className="rounded-sm border border-tan bg-cream-deep px-4 py-3">
      <span className="block font-mono text-[12px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
      <span className={`mt-2 block font-mono text-[17px] font-semibold ${tone === 'forest' ? 'text-forest' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

function QuoteRow({ name, meta, note, active = false }: { name: string; meta: string; note: string; active?: boolean }) {
  return (
    <div className={`rounded-md border p-4 ${active ? 'border-forest/35 bg-forest-tint/70' : 'border-tan bg-cream-deep'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="font-display text-[22px] leading-tight text-ink">{name}</h4>
          <p className="mt-1 text-[13px] font-semibold text-ink-soft">{meta}</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${active ? 'bg-forest text-primary-foreground' : 'bg-cream text-ink-soft'}`}>
          {active ? 'Best fit' : 'Compare'}
        </span>
      </div>
      <p className="mt-3 text-[14px] leading-[1.55] text-ink-soft">{note}</p>
    </div>
  )
}

function RunRow({ day, task, state, tone = 'forest' }: { day: string; task: string; state: string; tone?: 'forest' | 'clay' }) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:items-center">
      <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-ink-faint">{day}</span>
      <span className="text-[15px] font-medium text-ink">{task}</span>
      <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${tone === 'forest' ? 'bg-forest-tint text-forest' : 'bg-clay/10 text-clay-deep'}`}>
        {state}
      </span>
    </div>
  )
}

export default function HomePage() {
  const snapSectionClass = 'min-h-[calc(100dvh-74px)] snap-start lg:snap-always'
  const tallSnapSectionClass = 'min-h-[calc(100dvh-74px)] snap-start'
  const snapContentClass = 'mx-auto flex min-h-[calc(100dvh-74px)] w-full flex-col justify-center'

  return (
    <>
      <HomepageSnapScroller>
      <section className={`relative ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1480px] items-start gap-8 px-5 py-8 sm:px-6 sm:py-10 lg:grid lg:grid-cols-[minmax(0,0.98fr)_minmax(380px,0.88fr)] lg:items-center lg:gap-14 lg:px-8 lg:py-8 2xl:max-w-[1600px] 2xl:gap-16 2xl:px-10`}>
          <div className="animate-entrance lg:flex lg:h-full lg:flex-col lg:justify-center">
            <Caps className="text-[13px]">Bay Area · 2026</Caps>
            <h1 className="mt-4 max-w-[840px] font-display text-[clamp(3rem,4.85vw,5.35rem)] font-medium leading-[0.96] tracking-normal text-ink">
              <span className="block">Know what worked.</span>
              <span className="block text-clay">Repeat what paid.</span>
            </h1>
            <p className="mt-4 max-w-[760px] text-[18px] leading-[1.45] text-ink-soft lg:text-[19px] 2xl:text-[20px]">
              See what every event actually returned — then run the next one.
            </p>
            <div className="mt-3 max-w-[760px]">
              <HomePlannerStart />
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
                    Three venues fit. Holding The Valencia Room for 24 hours while you authorize.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-sm border border-forest/15 bg-forest-tint px-2.5 py-2">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-forest">Incentive</span>
                      <span className="mt-1 block text-[13px] font-semibold text-forest">$5 / checked-in guest</span>
                    </div>
                    <div className="rounded-sm border border-tan bg-cream-deep px-2.5 py-2">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Return</span>
                      <span className="mt-1 block text-[13px] font-semibold text-ink">up to $300 back</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`border-t border-tan/70 ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1180px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20`}>
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

      <section className={`border-t border-tan/70 bg-cream-deep/40 ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1480px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20 2xl:px-10`}>
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

      <section id="capabilities" className={`border-t border-tan/70 ${tallSnapSectionClass}`}>
        <div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-6 lg:px-8 lg:py-24 2xl:px-10">
          <Caps>Operating system</Caps>
          <h2 className="mt-4 max-w-4xl font-display text-[40px] leading-[1.02] text-ink sm:text-[56px]">
            See the agent turn intent into approved action.
          </h2>
          <div className="mt-12 space-y-14 lg:space-y-20">
            {capabilityShowcases.map((item, index) => (
              <article
                key={item.title}
                className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(520px,1fr)] lg:items-center lg:gap-12"
              >
                <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
                  <Caps>{item.eyebrow}</Caps>
                  <h3 className="mt-4 max-w-xl font-display text-[38px] leading-[1.03] text-ink sm:text-[52px]">
                    {item.title}
                  </h3>
                  <p className="mt-5 max-w-xl text-[18px] leading-[1.65] text-ink-soft">
                    {item.body}
                  </p>
                </div>
                <div className={index % 2 === 1 ? 'lg:order-1' : undefined}>
                  <ProductPanel type={item.visual} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`border-t border-tan/70 ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1480px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20 2xl:px-10`}>
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

      <section className={`border-t border-tan/70 bg-cream-deep/40 ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1080px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20`}>
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

      <section id="pricing" className={`border-t border-tan/70 ${tallSnapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[1120px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20`}>
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
                  <p className="font-display text-[46px] leading-none text-ink">$79</p>
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

      <section id="faq" className={`border-t border-tan/70 ${tallSnapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[860px] px-5 py-16 sm:px-6 lg:px-8 lg:py-20`}>
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

      <section className={`border-t border-tan/70 bg-cream-deep/50 ${snapSectionClass}`}>
        <div className={`${snapContentClass} max-w-[980px] px-5 py-20 text-center sm:px-6 lg:px-8 lg:py-24`}>
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

      </HomepageSnapScroller>

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
    </>
  )
}
