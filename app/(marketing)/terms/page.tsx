import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | 3rdPlace',
  description: 'The terms governing use of 3rdPlace.',
}

const LAST_UPDATED = 'May 30, 2026'

const sections = [
  {
    title: 'Using 3rdPlace',
    body: '3rdPlace is an event planning and operations workspace for organizers, venues, and vendors. The system can propose actions, but purchases, bookings, payments, outreach, and refunds require explicit user approval.',
  },
  {
    title: 'Accounts and eligibility',
    body: 'You must be at least 18 years old, provide accurate account information, and keep your login credentials secure. Supply-side listings may be admin-seeded and later claimed through the product workflow.',
  },
  {
    title: 'Payments and payouts',
    body: '3rdPlace uses Stripe for subscriptions, venue rental payments, vendor payments, connected-account payouts, refunds, transfer reversals, and settlement records. Payment and refund outcomes depend on Stripe, bank, card network, and counterparty processing rules.',
  },
  {
    title: 'Approvals and third parties',
    body: 'The planner may recommend venues, vendors, budgets, contracts, messages, or payment actions. You are responsible for reviewing and approving terms before execution. Venues, vendors, ticketing platforms, and payment processors remain separate third parties.',
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
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-widest text-primary">Legal</p>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">
          <span className="text-gradient-brand">Terms of Service</span>
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        {/* TODO: Replace this launch placeholder with lawyer-reviewed copy before public launch. */}
        <div className="mt-8 rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
          <p className="text-sm leading-6 text-muted-foreground">
            This page is a launch-readiness placeholder. The preserved terms draft predated current in-product
            payment and refund flows, so this copy intentionally stays high-level until counsel reviews the final
            commercial terms, refund language, payout obligations, and AI recommendation disclaimers.
          </p>
        </div>

        <article className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-3xl border border-border bg-card/60 p-6 shadow-card">
              <h2 className="font-display text-xl font-bold text-foreground">{section.title}</h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </article>

        <section className="mt-6 rounded-3xl border border-border bg-card/60 p-6 shadow-card">
          <h2 className="font-display text-xl font-bold text-foreground">Contact</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Questions about these terms can be sent to{' '}
            <a className="text-primary underline" href="mailto:hello@3rdplace.io">
              hello@3rdplace.io
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
