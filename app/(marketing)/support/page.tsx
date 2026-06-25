import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketing/Header'
import { SupportContactForm } from '@/components/support/SupportContactForm'

export const metadata: Metadata = {
  title: 'Support | 3rdPlace',
  description: 'Contact the 3rdPlace support team.',
}

export default function PublicSupportPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-background px-6 py-16 text-foreground">
        <section className="mx-auto max-w-4xl">
          <p className="label-caps text-clay-deep">Support</p>
          <h1 className="mt-3 font-display text-[44px] leading-tight text-ink sm:text-[64px]">
            Get help from the 3rdPlace team.
          </h1>
          <p className="mt-5 max-w-2xl text-[18px] leading-8 text-ink-soft">
            Use this form for account access, billing, planner, outreach, ticketing, or payment questions. Signed-in organizers can submit with plan context from the planner support page.
          </p>
          <div className="mt-8">
            <SupportContactForm mode="public" />
          </div>
          <p className="mt-5 text-sm text-ink-soft">
            Already signed in? <Link href="/planner/support" className="font-semibold text-clay hover:text-clay-deep">Open planner support</Link>.
          </p>
        </section>
      </main>
    </>
  )
}
