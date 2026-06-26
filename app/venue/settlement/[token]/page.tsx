import { notFound } from 'next/navigation'

import { SettlementAckClient } from '@/components/venue/SettlementAckClient'
import { verifyVenueSettlementToken } from '@/lib/finance/settlement-checkout'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{
    token: string
  }>
}

export default async function VenueSettlementPage({ params }: PageProps) {
  const { token } = await params
  const admin = createServiceRoleClient()
  const verified = await verifyVenueSettlementToken(admin, token)
  if (!verified) notFound()

  const { context } = verified
  const amount = formatCents(context.run.total_cents ?? 0)
  const eventName = context.event?.event_name ?? context.plan?.title ?? 'Recent event'
  const eventDate = context.event?.event_date ? formatDate(context.event.event_date) : 'Date on file'

  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">3rdPlace settlement</p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight">
            Review community host incentive settlement
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The host approved this settlement. Paying here does not create a booking or new terms; it only completes
            the approved post-event settlement through Stripe Checkout.
          </p>

          <div className="mt-8 grid gap-3 rounded-xl border border-border bg-background p-4 text-sm md:grid-cols-2">
            <SummaryRow label="Venue" value={context.venue.venue_name} />
            <SummaryRow label="Event" value={eventName} />
            <SummaryRow label="Event date" value={eventDate} />
            <SummaryRow label="Amount due" value={amount} strong />
            <SummaryRow label="Status" value={formatStatus(context.run.status)} />
            <SummaryRow label="Settlement method" value="Stripe Checkout" />
          </div>

          <div className="mt-6">
            <SettlementAckClient token={token} initialStatus={context.run.status} />
          </div>
        </div>
      </section>
    </main>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={strong ? 'mt-1 font-mono text-xl font-bold text-forest' : 'mt-1 font-semibold text-foreground'}>
        {value}
      </p>
    </div>
  )
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
