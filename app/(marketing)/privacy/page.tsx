import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | 3rdPlace',
  description: 'How 3rdPlace collects, uses, and protects information.',
}

const LAST_UPDATED = 'June 7, 2026'

const sections = [
  {
    title: 'Information we collect',
    body: [
      'Account information such as name, email, role, organization, venue, or vendor profile details.',
      'Event execution details you provide to the system, including dates, headcount, budget, neighborhoods, ticketing preferences, partner needs, and approval decisions.',
      'Google account information, such as your Google email address and basic profile details, when you choose to sign in with Google.',
      'Gmail authorization data, including encrypted OAuth tokens and Gmail account identifiers, when you choose to connect Gmail for outreach.',
      'Gmail outreach data needed to operate approved outreach workflows, such as message IDs, thread IDs, recipients, subject lines, message content for approved drafts, sent-message status, and replies to outreach threads.',
      'Payment and payout metadata from Stripe, including transaction identifiers, status, and reconciliation details. Full payment credentials are handled by Stripe.',
      'Operational data such as product usage, error reports, logs, and support requests used to keep the service reliable.',
    ],
  },
  {
    title: 'How we use information',
    body: [
      'To shape event runs, recommend venues and vendors, coordinate approvals, and show financial estimates.',
      'To authenticate your account when you choose Google sign-in.',
      'To send Gmail outreach messages only when you approve a specific message or configure an explicit outreach autonomy policy.',
      'To monitor Gmail replies to outreach threads so your planner workspace can show partner responses, follow-up needs, and outreach history.',
      "To mark outreach reply threads as read or apply organizational labels in your Gmail account so processed threads do not appear unread, only after you approve the underlying outreach flow.",
      'To classify, summarize, and draft follow-ups for outreach replies using automated systems and service providers acting on our behalf.',
      'To process subscriptions, venue rental payments, vendor payments, and revenue-share settlement records through Stripe.',
      'To send transactional email through Resend, including account, payment, refund, and operational notifications.',
      'To monitor reliability, debug errors, prevent abuse, and improve the event workspace.',
    ],
  },
  {
    title: 'Google user data and Gmail Limited Use',
    body: [
      '3rdPlace uses Google user data only to provide user-facing account sign-in and Gmail outreach features that you choose to enable.',
      'We do not sell Google user data, use Google user data for advertising, transfer Google user data to advertising platforms or data brokers, or use Google user data to determine creditworthiness or lending eligibility.',
      'Automated systems may process Gmail outreach messages and replies to draft responses, identify partner interest, detect follow-up needs, and maintain outreach history for your event plans.',
      'We do not allow humans to read Gmail message content except when necessary for security, abuse investigation, support requested by you, legal compliance, or service operation with appropriate access controls.',
      '3rdPlace use and transfer of information received from Google APIs to any other app adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
      'You can disconnect Gmail from the Integrations settings page, which stops new Gmail outreach access. You may also request deletion of stored Gmail outreach records by contacting privacy@3rdplace.io.',
    ],
  },
  {
    title: 'Sharing',
    body: [
      'We share data with service providers required to operate 3rdPlace, including Supabase, Stripe, Resend, Sentry, Vercel, and AI model providers.',
      'When you approve outreach, booking, payment, or refund flows, we share the relevant event and transaction details with the counterparty needed to complete that flow.',
      'When you send outreach through Gmail, Google processes the message and related account data under your Google account and Google permissions.',
      'We do not sell personal information.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'You can request account export, correction, or deletion by emailing privacy@3rdplace.io.',
      'You can revoke Google access from your Google Account permissions page or disconnect Gmail inside 3rdPlace integrations.',
      'California residents may request access, deletion, correction, and information about how personal information is used.',
      'Some transaction, tax, security, and fraud-prevention records may need to be retained where required by law or platform obligations.',
    ],
  },
  {
    title: 'Security and retention',
    body: [
      'We use hosted infrastructure, role-based access, and third-party processors to help protect production data.',
      'Gmail OAuth tokens are encrypted at rest and used server-side only to provide connected Gmail features.',
      'We retain account and event records while your account is active, then retain only what is needed for legal, security, payment, and operational obligations.',
      'We retain Gmail outreach records only as long as needed to provide outreach history, reply tracking, support, security, legal compliance, or account recovery, unless you request deletion sooner where deletion is legally and technically available.',
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

        <div className="mt-8 rounded-md border border-tan bg-cream-deep p-6 shadow-sm">
          <p className="text-[15px] leading-6 text-ink-soft">
            This policy explains how 3rdPlace handles account, event, payment, outreach, and connected Google data.
            Gmail access is optional and is used only for the outreach features you enable or approve.
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
          <h2 className="font-display text-[24px] leading-tight text-ink">
            Google API Services Limited Use disclosure
          </h2>
          <p className="mt-4 text-[15px] leading-6 text-ink-soft">
            3rdPlace&apos;s use and transfer to any other app of information received from Google APIs will adhere
            to the{' '}
            <a
              className="text-clay underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

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
