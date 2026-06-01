import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | 3rdPlace',
  description: 'The terms governing use of 3rdPlace.',
}

const LAST_UPDATED = 'May 30, 2026'

const sections = [
  {
    title: 'Using 3rdPlace',
    body: '3rdPlace is an event execution and operations system for organizers, venues, and vendors. The system can propose actions, but purchases, bookings, payments, outreach, and refunds require explicit user approval.',
  },
  {
    title: 'Accounts and eligibility',
    body: 'You must be at least 18 years old, provide accurate account information, and keep your login credentials secure. Supply-side listings may be admin-seeded and later claimed through the product claim flow.',
  },
  {
    title: 'Payments and payouts',
    body: '3rdPlace uses Stripe for subscriptions, venue rental payments, vendor payments, connected-account payouts, refunds, transfer reversals, and settlement records. Payment and refund outcomes depend on Stripe, bank, card network, and counterparty processing rules.',
  },
  {
    title: 'Approvals and third parties',
    body: 'The system may recommend venues, vendors, budgets, contracts, messages, or payment actions. You are responsible for reviewing and approving terms before execution. Venues, vendors, ticketing platforms, and payment processors remain separate third parties.',
  },
  {
    title: 'Acceptable use',
    body: 'Do not misrepresent your events, abuse outreach workflows, scrape catalog data, bypass payment flows, interfere with service reliability, or use the product for unlawful activity.',
  },
  {
    title: 'Availability and warranty disclaimer',
    body: 'The service is provided as-is. We do not guarantee uninterrupted availability, specific event outcomes, exact estimates, partner availability, or successful bookings.',
  },
  {
    title: 'Limitation of liability',
    body: 'To the maximum extent allowed by law, 3rdPlace is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service.',
  },
]

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <div className="mx-auto max-w-4xl">
        <p className="label-caps text-clay-deep">Legal</p>
        <h1 className="mt-4 font-display text-[44px] leading-[1.04] text-ink sm:text-[64px]">
          Terms of Service
        </h1>
        <p className="mt-4 font-mono text-[12px] text-ink-faint">Last updated: {LAST_UPDATED}</p>

        {/* TODO: Replace this launch placeholder with lawyer-reviewed copy before public launch. */}
        <div className="mt-8 rounded-md border border-tan bg-cream-deep p-6 shadow-sm">
          <p className="text-[15px] leading-6 text-ink-soft">
            This page is a launch-readiness placeholder. The preserved terms draft predated current in-product
            payment and refund flows, so this copy intentionally stays high-level until counsel reviews the final
            commercial terms, refund language, payout obligations, and AI recommendation disclaimers.
          </p>
        </div>

        <article className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-md border border-tan bg-cream p-6 shadow-sm">
              <h2 className="font-display text-[24px] leading-tight text-ink">{section.title}</h2>
              <p className="mt-4 text-[15px] leading-6 text-ink-soft">{section.body}</p>
            </section>
          ))}
        </article>

        <section className="mt-6 rounded-md border border-tan bg-cream p-6 shadow-sm">
          <h2 className="font-display text-[24px] leading-tight text-ink">Contact</h2>
          <p className="mt-4 text-[15px] leading-6 text-ink-soft">
            Questions about these terms can be sent to{' '}
            <a className="text-clay underline" href="mailto:hello@3rdplace.io">
              hello@3rdplace.io
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
