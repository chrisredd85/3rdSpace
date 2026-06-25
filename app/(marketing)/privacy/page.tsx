import type { Metadata } from 'next'
import { DraftLegalBanner } from '@/components/marketing/DraftLegalBanner'
import { LEGAL_LAST_UPDATED } from '@/lib/legal/constants'

export const metadata: Metadata = {
  title: 'Privacy Policy | 3rdPlace',
  description: 'How 3rdPlace collects, uses, and protects information.',
}

const sections = [
  {
    id: 'introduction',
    title: '1. Introduction',
    body: [
      '3rdPlace is an approval-gated event operating system for recurring hosts. This draft policy explains how we handle information used to plan events, recommend venues and vendors, prepare outreach, track ticketing, process payments, and operate the planner workspace.',
      'This page is scaffolding pending legal review. It is written to reflect current product behavior and will be replaced or revised before legal copy is finalized.',
    ],
  },
  {
    id: 'information-we-collect',
    title: '2. Information we collect',
    body: [
      'We collect account information such as name, email, role, organization, venue, vendor, social handle, website, and profile details supplied during signup or account setup.',
      'We collect event planning information such as event type, dates, guest targets, budget, area preferences, ticketing platform choices, venue and vendor needs, messages, approvals, and operational notes.',
      'When you connect integrations, we collect the data needed to operate them: ticketing connection metadata, Gmail OAuth identifiers and encrypted tokens, Stripe customer or connected account identifiers, payment status, and settlement records. Full payment credentials are handled by Stripe.',
    ],
  },
  {
    id: 'how-we-use-information',
    title: '3. How we use information',
    body: [
      'We use information to create event plans, rank venue and vendor options, draft outreach, prepare approval cards, model event economics, update event briefs, and show ticketing or payment status.',
      'We use operational and support information to keep the product reliable, debug errors, respond to support requests, prevent abuse, and improve the planner experience.',
    ],
  },
  {
    id: 'sharing',
    title: '4. How we share information',
    body: [
      'We share information with service providers that help operate 3rdPlace, including Supabase, Stripe, Google Gmail APIs, Resend, Sentry, Vercel, OpenAI, and ticketing platforms such as Eventbrite, Posh, Luma, or Partiful when you connect or import them.',
      'When you approve outreach, booking, payment, or settlement workflows, we share the relevant event and transaction details with the venue, vendor, payment processor, or connected service needed to complete that approved action.',
      'We do not sell personal information or Google user data.',
    ],
  },
  {
    id: 'google-user-data',
    title: '5. Google user data and Gmail Limited Use',
    body: [
      'Google sign-in is used for account authentication when you choose it. Gmail access is separate and optional; it is used only for outreach features that you approve or explicitly configure.',
      '3rdPlace may use Gmail send, read, and modify permissions to send approved venue or vendor outreach, read replies to threads started by 3rdPlace, classify follow-up needs, maintain outreach history, and mark processed outreach threads as read or organized.',
      '3rdPlace use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. We do not use Google user data for advertising, sale, or creditworthiness decisions.',
    ],
  },
  {
    id: 'cookies-and-tracking',
    title: '6. Cookies and tracking',
    body: [
      'We use cookies, local storage, and similar technologies to keep users signed in, remember preferences, measure product behavior, and protect the service from abuse.',
      'The current MVP cookie banner records a simple accept or dismiss choice in local storage. Granular cookie preference controls are deferred until legal review defines the final consent model.',
    ],
  },
  {
    id: 'data-retention',
    title: '7. Data retention',
    body: [
      'Retention periods are pending legal review. As a working rule, we retain account, event, support, and transaction records while your account is active and then retain only records needed for legal, security, payment, tax, abuse-prevention, or operational obligations.',
      'You may request deletion of stored Gmail outreach records or account data by contacting privacy@3rdplace.io. Some records may be retained where deletion is not legally or technically available.',
    ],
  },
  {
    id: 'rights',
    title: '8. Your rights',
    body: [
      'Depending on where you live, you may have rights to access, correct, delete, export, or restrict use of personal information. California and EU residents may have additional rights under CCPA/CPRA or GDPR.',
      'To make a privacy request, email privacy@3rdplace.io. We may need to verify your identity before processing the request.',
    ],
  },
  {
    id: 'international-transfers',
    title: '9. International transfers',
    body: [
      '3rdPlace is operated from the United States and uses service providers that may process data in the United States and other countries.',
      'International transfer language and safeguards are pending legal review.',
    ],
  },
  {
    id: 'childrens-privacy',
    title: "10. Children's privacy",
    body: [
      '3rdPlace is intended for adults running events and is not directed to children under 13. We do not knowingly collect information from children under 13.',
    ],
  },
  {
    id: 'changes',
    title: '11. Changes to this policy',
    body: [
      'We may update this policy as the product, legal review, or service providers change. Material changes will be reflected by updating the date at the top of this page.',
    ],
  },
  {
    id: 'contact',
    title: '12. Contact us',
    body: [
      'Questions or privacy requests can be sent to privacy@3rdplace.io. Legal notices can be sent to legal@3rdplace.io.',
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
        <p className="mt-4 font-mono text-[12px] text-ink-faint">Last updated: {LEGAL_LAST_UPDATED}</p>

        <div className="mt-8">
          <DraftLegalBanner />
        </div>

        <div className="mt-8 rounded-md border border-tan bg-cream-deep p-6 shadow-sm">
          <p className="text-[15px] leading-6 text-ink-soft">
            This policy explains how 3rdPlace handles account, event, payment, outreach, ticketing, and connected
            service data. Gmail access is optional and used only for outreach features you approve or configure.
          </p>
        </div>

        <article className="mt-10 space-y-6">
          {sections.map((section) => (
            <section id={section.id} key={section.id} className="scroll-mt-24 rounded-md border border-tan bg-cream p-6 shadow-sm">
              <h2 className="font-display text-[24px] leading-tight text-ink">{section.title}</h2>
              <div className="mt-4 space-y-3 text-[15px] leading-6 text-ink-soft">
                {section.body.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
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
      </div>
    </main>
  )
}
