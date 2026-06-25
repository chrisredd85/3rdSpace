import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { supportCategoryLabel, supportSeverityLabel, supportStatusLabel, type SupportTicketRow } from '@/lib/support/tickets'

export const dynamic = 'force-dynamic'

export default async function PlannerSupportTicketsPage() {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect('/login/builder')

  const { data: tickets, error: ticketsError } = await (supabase as any)
    .from('support_tickets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (ticketsError) {
    return (
      <div className="rounded-lg border border-brick/30 bg-brick-tint p-5 text-brick">
        Could not load support tickets. Please email support@3rdplace.io.
      </div>
    )
  }

  const rows = (tickets ?? []) as SupportTicketRow[]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-caps text-clay-deep">Support history</p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Your tickets</h1>
          <p className="mt-2 text-ink-soft">Track requests submitted from your 3rdPlace account.</p>
        </div>
        <Button asChild>
          <Link href="/planner/support">New support request</Link>
        </Button>
      </header>

      <div className="space-y-4">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-tan bg-cream p-8 text-center text-ink-soft">
            No support tickets yet.
          </div>
        ) : rows.map((ticket) => (
          <article key={ticket.id} className="rounded-lg border border-tan bg-cream p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-clay">{ticket.ticket_id}</p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-ink">{ticket.subject}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {supportCategoryLabel(ticket.category)} · {supportSeverityLabel(ticket.severity)} · submitted {new Date(ticket.created_at).toLocaleDateString()}
                </p>
              </div>
              <span className="rounded-full border border-tan bg-cream-deep px-3 py-1 text-sm font-semibold text-ink-soft">
                {supportStatusLabel(ticket.status)}
              </span>
            </div>
            <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{ticket.description}</p>
            {ticket.resolution_notes ? (
              <div className="mt-4 rounded-md border border-forest/25 bg-forest-tint px-4 py-3 text-sm text-forest">
                <span className="font-semibold">Resolution note:</span> {ticket.resolution_notes}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
