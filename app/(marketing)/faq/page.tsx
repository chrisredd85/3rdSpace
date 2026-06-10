import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'FAQ | 3rdPlace',
  description: 'Answers about approvals, venues, vendors, and money movement in 3rdPlace.',
}

const questions = [
  {
    q: 'Does the agent ever book or pay without me?',
    a: 'No. Every booking, every payment, every contract waits on your approval. The agent proposes; you ship.',
  },
  {
    q: "What if my venue or vendor isn't on the platform?",
    a: 'Add them. The agent learns your roster and uses it first on future events.',
  },
  {
    q: 'Where does the money actually move?',
    a: 'Through Stripe Connect. Venues, vendors, and you each have your own connected account. 3rdPlace never holds funds.',
  },
  {
    q: 'Can I start with an event that is already on the calendar?',
    a: 'Yes. Describe the event, current holds, budget, expected guests, and any signed terms. The agent starts from what is already true.',
  },
  {
    q: 'What happens after the event closes?',
    a: '3rdPlace records margin, refunds, Community Host Incentives, vendor payments, and the pieces worth repeating next time.',
  },
]

function Caps({ children }: { children: ReactNode }) {
  return <span className="label-caps text-clay-deep">{children}</span>
}

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <section className="mx-auto max-w-[820px]">
        <Caps>Common questions</Caps>
        <h1 className="mt-4 font-display text-[44px] leading-[1.05] text-ink sm:text-[64px]">
          Clear answers. No fine print.
        </h1>

        <div className="mt-10 border-t border-tan">
          {questions.map((item) => (
            <section key={item.q} className="border-b border-tan py-6">
              <h2 className="font-display text-[22px] leading-tight text-ink">{item.q}</h2>
              <p className="mt-3 text-[15.5px] leading-[1.65] text-ink-soft">{item.a}</p>
            </section>
          ))}
        </div>

        <div className="mt-10">
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-md bg-clay px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
          >
            Start running events
          </Link>
        </div>
      </section>
    </main>
  )
}
