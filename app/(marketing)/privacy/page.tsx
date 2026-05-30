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
      'Event planning details you provide to the planner, including dates, headcount, budget, neighborhoods, ticketing preferences, partner needs, and approval decisions.',
      'Payment and payout metadata from Stripe, including transaction identifiers, status, and reconciliation details. Full payment credentials are handled by Stripe.',
      'Operational data such as product usage, error reports, logs, and support requests used to keep the service reliable.',
    ],
  },
  {
    title: 'How we use information',
    body: [
      'To create event plans, recommend venues and vendors, coordinate approvals, and show financial estimates.',
      'To process subscriptions, venue rental payments, vendor payments, and revenue-share settlement records through Stripe.',
      'To send transactional email through Resend, including account, payment, refund, and operational notifications.',
      'To monitor reliability, debug errors, prevent abuse, and improve the planner experience.',
    ],
  },
  {
    title: 'Sharing',
    body: [
      'We share data with service providers required to operate 3rdPlace, including Supabase, Stripe, Resend, Sentry, Vercel, and AI model providers.',
      'When you approve outreach, booking, payment, or refund workflows, we share the relevant event and transaction details with the counterparty needed to complete that workflow.',
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
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-widest text-primary">Legal</p>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">
          <span className="text-gradient-brand">Privacy Policy</span>
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        {/* TODO: Replace this launch placeholder with lawyer-reviewed copy before public launch. */}
        <div className="mt-8 rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
          <p className="text-sm leading-6 text-muted-foreground">
            This page is a launch-readiness placeholder based on the preserved policy draft. It should be reviewed
            by counsel before public launch, especially for payment, payout, AI processing, and California privacy
            language.
          </p>
        </div>

        <article className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-3xl border border-border bg-card/60 p-6 shadow-card">
              <h2 className="font-display text-xl font-bold text-foreground">{section.title}</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                {section.body.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </article>

        <section className="mt-6 rounded-3xl border border-border bg-card/60 p-6 shadow-card">
          <h2 className="font-display text-xl font-bold text-foreground">Contact</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Questions or privacy requests can be sent to{' '}
            <a className="text-primary underline" href="mailto:privacy@3rdplace.io">
              privacy@3rdplace.io
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
