import type { Metadata } from 'next'
import { DraftLegalBanner } from '@/components/marketing/DraftLegalBanner'
import { LEGAL_LAST_UPDATED } from '@/lib/legal/constants'

export const metadata: Metadata = {
  title: 'Terms of Service | 3rdPlace',
  description: 'The draft terms governing use of 3rdPlace.',
}

const sections = [
  {
    title: '1. Acceptance of terms',
    body: 'By creating an account or using 3rdPlace, you agree to these draft terms and the Privacy Policy. These terms are pending legal review and may change before final launch terms are adopted.',
  },
  {
    title: '2. Service description',
    body: '3rdPlace is an approval-gated event operating system for recurring hosts. The agent can propose plans, partner outreach, booking actions, payment actions, and operational updates, but users remain responsible for reviewing and approving execution.',
  },
  {
    title: '3. User accounts',
    body: 'You must provide accurate information, keep account credentials secure, and use the correct account role. Creator accounts are for event hosts. Venue and vendor accounts are partner accounts and may be created through self-serve signup or claim flows.',
  },
  {
    title: '4. Acceptable use',
    body: 'You may not use 3rdPlace for spam, unlawful events, deceptive outreach, harassment, unauthorized scraping, payment abuse, attempts to bypass approval gates, or activity that harms service reliability or third-party platforms.',
  },
  {
    title: '5. Subscriptions and billing',
    body: '3rdPlace pricing is currently planned as $30 per event, $79 per month for Pro, and $690 per year for Annual Pro. Billing is subject to Stripe processing and final legal and pricing review. Plan creation may remain free while agent execution, outreach, or booking workflows can require an active entitlement.',
  },
  {
    title: '6. Settlement and payments',
    body: '3rdPlace uses Stripe for organizer billing, venue rental payments, vendor payments, connected-account payouts, refunds, transfer reversals, and settlement records. Venue and vendor relationships remain between the organizer and the counterparty; 3rdPlace facilitates approved workflows and records.',
  },
  {
    title: '7. Outreach and Gmail integration',
    body: 'When you connect Gmail, you authorize 3rdPlace to prepare, send, read, and organize outreach only for approved or explicitly configured event outreach workflows. You remain responsible for recipients, message content, timing, CAN-SPAM compliance, and honoring opt-out or partner requests.',
  },
  {
    title: '8. Content and IP',
    body: 'You retain ownership of content you provide, including event details, messages, brand information, and uploaded materials. 3rdPlace may generate recommendations, drafts, summaries, and operational artifacts from that content to provide the service.',
  },
  {
    title: '9. Third-party services',
    body: '3rdPlace integrates with services such as Stripe, Google, Gmail, Eventbrite, Posh, Luma, Partiful, Resend, Supabase, Vercel, Sentry, and OpenAI. Those services may have their own terms, policies, and availability limits.',
  },
  {
    title: '10. Termination',
    body: 'You may stop using 3rdPlace at any time. We may suspend or terminate accounts that violate these terms, create legal or security risk, abuse outreach or payment systems, or interfere with service operation.',
  },
  {
    title: '11. Disclaimers and limitation of liability',
    body: 'The service is provided as-is during MVP and pilot operation. We do not guarantee specific event outcomes, partner availability, revenue, profit, attendance, successful bookings, or uninterrupted service. Liability terms are placeholders pending legal review.',
  },
  {
    title: '12. Governing law',
    body: 'Governing law, venue, arbitration, and dispute-resolution language are pending legal review. The product is currently operated from the United States.',
  },
  {
    title: '13. Changes to these terms',
    body: 'We may update these terms as the service, legal review, pricing, or integrations change. The latest version will be posted on this page with an updated date.',
  },
  {
    title: '14. Contact',
    body: 'Questions about these terms can be sent to legal@3rdplace.io. Privacy requests should be sent to privacy@3rdplace.io.',
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
        <p className="mt-4 font-mono text-[12px] text-ink-faint">Last updated: {LEGAL_LAST_UPDATED}</p>

        <div className="mt-8">
          <DraftLegalBanner />
        </div>

        <div className="mt-8 rounded-md border border-tan bg-cream-deep p-6 shadow-sm">
          <p className="text-[15px] leading-6 text-ink-soft">
            These draft terms describe how hosts, venues, vendors, and connected services use 3rdPlace. The
            agent proposes; the user approves; the system executes only after the appropriate approval gate.
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
      </div>
    </main>
  )
}
