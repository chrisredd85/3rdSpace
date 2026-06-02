import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | 3rdPlace',
  description: 'How 3rdPlace collects, uses, and protects information.',
}

const LAST_UPDATED = 'May 30, 2026'

const sections = [
  {
    title: 'Information we collect',
    body: [
      'Account information such as name, email, role, organization, venue, or vendor profile details.',
      'Event execution details you provide to the system, including dates, headcount, budget, neighborhoods, ticketing preferences, partner needs, and approval decisions.',
      'Payment and payout metadata from Stripe, including transaction identifiers, status, and reconciliation details. Full payment credentials are handled by Stripe.',
      'Operational data such as product usage, error reports, logs, and support requests used to keep the service reliable.',
    ],
  },
  {
    title: 'How we use information',
    body: [
      'To shape event runs, recommend venues and vendors, coordinate approvals, and show financial estimates.',
      'To process subscriptions, venue rental payments, vendor payments, and revenue-share settlement records through Stripe.',
      'To send transactional email through Resend, including account, payment, refund, and operational notifications.',
      'To monitor reliability, debug errors, prevent abuse, and improve the event workspace.',
    ],
  },
  {
    title: 'Sharing',
    body: [
      'We share data with service providers required to operate 3rdPlace, including Supabase, Stripe, Resend, Sentry, Vercel, and AI model providers.',
      'When you approve outreach, booking, payment, or refund flows, we share the relevant event and transaction details with the counterparty needed to complete that flow.',
      'We do not sell personal information.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'You can request account export, correction, or deletion by emailing privacy@3rdplace.io.',
      'California residents may request access, deletion, correction, and information about how personal information is used.',
      'Some transaction, tax, security, and fraud-prevention records may need to be retained where required by law or platform obligations.',
    ],
  },
  {
    title: 'Security and retention',
    body: [
      'We use hosted infrastructure, role-based access, and third-party processors to help protect production data.',
      'We retain account and event records while your account is active, then retain only what is needed for legal, security, payment, and operational obligations.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <div className="mx-auto max-w-4xl">
        <p className="label-caps text-clay-deep">Legal</p>
        <h1 className="mt-4 font-display text-[44px] leading-[1.04] text-ink sm:text-[64px]">
          Privacy Policy
        </h1>
        <p className="mt-4 font-mono text-[12px] text-ink-faint">Last updated: {LAST_UPDATED}</p>

        {/* TODO: Replace this launch placeholder with lawyer-reviewed copy before public launch. */}
        <div className="mt-8 rounded-md border border-tan bg-cream-deep p-6 shadow-sm">
          <p className="text-[15px] leading-6 text-ink-soft">
            This page is a launch-readiness placeholder based on the preserved policy draft. It should be reviewed
            by counsel before public launch, especially for payment, payout, AI processing, and California privacy
            language.
          </p>
        </div>

        <article className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-md border border-tan bg-cream p-6 shadow-sm">
              <h2 className="font-display text-[24px] leading-tight text-ink">{section.title}</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-6 text-ink-soft">
                {section.body.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </article>

        <section className="mt-6 rounded-md border border-tan bg-cream p-6 shadow-sm">
          <h2 className="font-display text-[24px] leading-tight text-ink">Contact</h2>
          <p className="mt-4 text-[15px] leading-6 text-ink-soft">
            Questions or privacy requests can be sent to{' '}
            <a className="text-clay underline" href="mailto:privacy@3rdplace.io">
              privacy@3rdplace.io
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
