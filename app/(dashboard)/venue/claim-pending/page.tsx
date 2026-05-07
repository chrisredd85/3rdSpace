import { cn } from '@/lib/utils'

/**
 * Shows venue owners that an admin-seeded listing claim is pending verification.
 *
 * @returns Static claim-pending status page for venue owners.
 */
export default function VenueClaimPendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className={cn('w-full max-w-2xl rounded-lg border border-border bg-card p-8 shadow-lg')}>
        <div className="space-y-4">
          <p className="font-display text-xs font-semibold uppercase text-primary">
            Claim pending
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Your listing is being set up
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            We&apos;ve received your claim request. We&apos;ll send a confirmation to your
            email once your listing is verified and active.
          </p>
        </div>
      </section>
    </main>
  )
}
