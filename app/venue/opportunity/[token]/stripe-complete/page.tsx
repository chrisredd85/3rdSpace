import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadVenueOpportunityRecoveryContext } from '@/lib/venues/venueOpportunityRecovery'

export const dynamic = 'force-dynamic'

type VenueOpportunityStripeCompletePageProps = {
  params: {
    token: string
  }
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function VenueOpportunityStripeCompletePage({
  params,
  searchParams,
}: VenueOpportunityStripeCompletePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const admin = createServiceRoleClient()
  const context = await loadVenueOpportunityRecoveryContext(admin, params.token)
  if (!context) notFound()

  const errorMessage = readSearchParam(resolvedSearchParams.message)
  const hasError = readSearchParam(resolvedSearchParams.stripe) === 'error'
  const ready = context.stripeReady
  const Icon = hasError ? XCircle : ready ? CheckCircle2 : Clock
  const tone = hasError ? 'text-destructive bg-destructive/10' : ready ? 'text-forest bg-forest/10' : 'text-primary bg-primary/10'

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center">
        <section className="w-full rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${tone}`}>
              <Icon className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-primary">
                Payout setup
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                {hasError ? 'Stripe setup needs attention' : ready ? 'Payout setup is ready' : 'Stripe is reviewing your setup'}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {hasError
                  ? errorMessage ?? 'Stripe did not complete onboarding. You can retry from this opportunity link.'
                  : ready
                    ? `3rdPlace notified the organizer that ${readString(context.venue.venue_name) ?? 'your venue'} can now receive the venue payment.`
                    : 'Stripe has not marked payouts ready yet. If you just submitted details, this can take a few minutes.'}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
            No payment is charged automatically. The organizer still has to review and confirm payment from their planner workspace.
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            {!ready ? (
              <Button asChild>
                <Link href={`/api/venue/opportunity/${encodeURIComponent(params.token)}/stripe-resume`}>
                  Continue Stripe setup
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href={`/v/respond/${encodeURIComponent(params.token)}`}>View opportunity</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  )
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
