import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Pricing | 3rdPlace',
  description: 'First two events on us. Then pay per event or move to Pro.',
}

const tiers = [
  {
    label: 'Per event',
    title: 'Pay only when you ship.',
    body: 'Pay only for events you actually ship.',
    detail: 'Best for hosts testing a new cadence or running a small seasonal calendar.',
  },
  {
    label: 'Pro',
    title: 'Run without the meter.',
    body: 'Unlimited events, full historical margin, priority concierge.',
    detail: 'Best for recurring hosts who need every event measured against the last one.',
  },
]

function Caps({ children }: { children: ReactNode }) {
  return <span className="label-caps text-clay-deep">{children}</span>
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <section className="mx-auto max-w-[1000px]">
        <Caps>Pricing</Caps>
        <h1 className="mt-4 font-display text-[46px] leading-[1.02] text-ink sm:text-[68px]">
          First two events on us.
        </h1>
        <p className="mt-5 max-w-3xl text-[18px] leading-[1.6] text-ink-soft">
          Run two events end-to-end before you commit. No card required. After that, pay per event
          or move to Pro for unlimited runs and the full margin history.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {tiers.map((tier) => (
            <article key={tier.label} className="rounded-md border border-tan bg-cream p-7 shadow-sm">
              <Caps>{tier.label}</Caps>
              <h2 className="mt-3 font-display text-[30px] leading-tight text-ink">{tier.title}</h2>
              <p className="mt-3 text-[16px] leading-[1.6] text-ink-soft">{tier.body}</p>
              <p className="mt-6 border-t border-tan pt-5 text-[14px] leading-[1.6] text-ink-soft">{tier.detail}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-md bg-clay px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
          >
            Start running events
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center justify-center rounded-md border border-tan bg-cream px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-clay hover:text-clay-deep"
          >
            Read FAQ
          </Link>
        </div>
      </section>
    </main>
  )
}
