import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

export const dynamic = 'force-dynamic'

type ReportPageProps = {
  params: { eventId: string }
}

export default async function EventReportPage({ params }: ReportPageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <ReportShell title="Sign in required" body="Sign in as a creator to view this event report." />
  }

  const { builderProfileId } = await getBuilderProfileId(supabase, user.id)
  if (!builderProfileId) {
    return <ReportShell title="Report unavailable" body="No creator profile was found for this account." />
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, event_name, event_date, expected_attendance')
    .eq('id', params.eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (!event) {
    return <ReportShell title="Event not found" body="This report is not available for the current creator account." />
  }

  const [{ data: attendees }, { data: salesRows }] = await Promise.all([
    supabase
      .from('imported_attendees')
      .select('checked_in')
      .eq('event_id', params.eventId)
      .limit(10000),
    supabase
      .from('event_sales_data')
      .select('ticket_quantity, total_amount_cents, is_refund')
      .eq('event_id', params.eventId)
      .limit(10000),
  ])
  const attendeeRows = ((attendees ?? []) as Array<{ checked_in: boolean | null }>)
  const sales = ((salesRows ?? []) as Array<{ ticket_quantity: number | null; total_amount_cents: number | null; is_refund: boolean | null }>)
  const checkedIn = attendeeRows.filter((attendee) => attendee.checked_in).length
  const ticketsSold = sales
    .filter((sale) => !sale.is_refund)
    .reduce((sum, sale) => sum + Math.max(sale.ticket_quantity ?? 0, 0), 0)
  const grossRevenueCents = sales
    .filter((sale) => !sale.is_refund)
    .reduce((sum, sale) => sum + Math.max(sale.total_amount_cents ?? 0, 0), 0)
  const refundCents = sales
    .filter((sale) => sale.is_refund)
    .reduce((sum, sale) => sum + Math.abs(sale.total_amount_cents ?? 0), 0)

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Post-event report
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
            {(event as { event_name?: string | null }).event_name ?? 'Imported event'}
          </h1>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Tickets sold" value={String(ticketsSold)} />
          <Metric label="Checked in" value={String(checkedIn)} />
          <Metric label="Gross revenue" value={formatCents(grossRevenueCents)} />
          <Metric label="Refunds" value={formatCents(refundCents)} />
        </div>
        <div className="rounded-md border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            These values come from `event_sales_data` and `imported_attendees`. The full analytics page uses the same imported rows for rollups and recommendations.
          </p>
          <Link
            href={`/planner/analytics?eventId=${params.eventId}`}
            className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open analytics
          </Link>
        </div>
      </section>
    </main>
  )
}

function ReportShell({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl rounded-md border border-border bg-card p-6">
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
