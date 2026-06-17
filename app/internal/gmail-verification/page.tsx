// Hidden verification-only route for Google OAuth restricted scope verification.
// Gated behind ENABLE_GMAIL_VERIFICATION_DEMO env flag.
// This is NOT part of the user-facing product. Real product flow uses
// the agent outreach loop (separate PR) which exercises the same scopes
// implicitly through normal planner usage. Delete this route once the
// outreach loop is in production and Google verification is approved.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { GmailVerificationClient } from './GmailVerificationClient'
import {
  loadGmailVerificationContext,
  loadGmailVerificationThreadsForContext,
} from './data'

export const dynamic = 'force-dynamic'

export default async function GmailVerificationPage() {
  if (process.env.ENABLE_GMAIL_VERIFICATION_DEMO !== 'true') notFound()

  const context = await loadGmailVerificationContext()
  let initialLoadError: string | null = null

  if (context.status !== 'ready') {
    return (
      <VerificationShell>
        <StatusCard status={context.status} />
      </VerificationShell>
    )
  }

  const threads = await loadGmailVerificationThreadsForContext(context).catch((error) => {
    initialLoadError = error instanceof Error ? error.message : 'Unable to load Gmail threads.'
    return []
  })

  return (
    <VerificationShell>
      <GmailVerificationClient
        accountEmail={context.account.email_address}
        initialThreads={threads}
        initialLoadError={initialLoadError}
      />
    </VerificationShell>
  )
}

function VerificationShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
          Verification demo only — not part of the user-facing product. This route exists to demonstrate OAuth scope use to Google&apos;s verification reviewers.
        </div>

        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Internal verification</p>
          <h1 className="font-display text-4xl font-semibold text-ink">Gmail OAuth scope demo</h1>
          <p className="max-w-3xl text-sm leading-6 text-ink-soft">
            This hidden page demonstrates Gmail send, read, and modify behavior for reviewers. The user-facing product keeps Gmail as a data pipeline for approved outreach.
          </p>
        </header>

        {children}
      </div>
    </main>
  )
}

function StatusCard({ status }: { status: 'unauthenticated' | 'forbidden' | 'missing_gmail' }) {
  if (status === 'missing_gmail') {
    return (
      <section className="rounded-md border border-tan bg-cream p-6 shadow-sm">
        <h2 className="font-display text-2xl font-semibold text-ink">Gmail is not connected</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Connect Gmail at{' '}
          <Link href="/planner/settings/integrations" className="font-semibold text-primary underline-offset-4 hover:underline">
            /planner/settings/integrations
          </Link>{' '}
          first, then return to this verification route.
        </p>
      </section>
    )
  }

  if (status === 'forbidden') {
    return (
      <section className="rounded-md border border-tan bg-cream p-6 shadow-sm">
        <h2 className="font-display text-2xl font-semibold text-ink">Community builder account required</h2>
        <p className="mt-2 text-sm text-ink-soft">
          This verification demo is only available to signed-in community builder accounts.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-tan bg-cream p-6 shadow-sm">
      <h2 className="font-display text-2xl font-semibold text-ink">Sign in required</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Sign in as a community builder, connect Gmail in settings, then return to this verification route.
      </p>
    </section>
  )
}
