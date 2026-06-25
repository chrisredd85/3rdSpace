'use client'

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { supportCategoryLabel, supportSeverityLabel, supportStatusLabel, type SupportStatus, type SupportTicketRow } from '@/lib/support/tickets'

const statusOptions: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed']

export function AdminSupportInbox({ initialTickets }: { initialTickets: SupportTicketRow[] }) {
  const [tickets, setTickets] = useState(initialTickets)
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(initialTickets[0]?.ticket_id ?? null)
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const openCount = useMemo(() => tickets.filter((ticket) => ticket.status === 'open').length, [tickets])

  async function updateTicket(ticket: SupportTicketRow, status: SupportStatus) {
    setPendingTicketId(ticket.ticket_id)
    try {
      const response = await fetch(`/api/admin/support/${ticket.ticket_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status,
          resolution_notes: notes[ticket.ticket_id] ?? ticket.resolution_notes ?? '',
        }),
      })
      const payload = await response.json().catch(() => ({} as { ticket?: SupportTicketRow; error?: string }))
      if (!response.ok || !payload.ticket) throw new Error(payload.error ?? 'Could not update ticket')
      setTickets((current) => current.map((item) => item.ticket_id === ticket.ticket_id ? payload.ticket! : item))
    } finally {
      setPendingTicketId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-6xl">
        <p className="label-caps text-clay-deep">Admin support</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold text-ink">Support inbox</h1>
            <p className="mt-2 text-ink-soft">{openCount} open ticket{openCount === 1 ? '' : 's'} awaiting review.</p>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            {tickets.length === 0 ? (
              <div className="rounded-lg border border-tan bg-cream p-6 text-sm text-ink-soft">No support tickets yet.</div>
            ) : tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setExpandedTicketId(ticket.ticket_id)}
                className="w-full rounded-lg border border-tan bg-cream p-4 text-left shadow-sm transition-colors hover:border-clay"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-semibold text-clay">{ticket.ticket_id}</span>
                  <span className="rounded-full bg-cream-deep px-2 py-1 text-xs font-semibold text-ink-soft">{supportStatusLabel(ticket.status)}</span>
                </div>
                <p className="mt-2 line-clamp-2 font-semibold text-ink">{ticket.subject}</p>
                <p className="mt-1 text-sm text-ink-soft">{supportSeverityLabel(ticket.severity)} · {supportCategoryLabel(ticket.category)} · {ticket.email}</p>
              </button>
            ))}
          </div>

          <div>
            {tickets.filter((ticket) => ticket.ticket_id === expandedTicketId).map((ticket) => (
              <article key={ticket.id} className="rounded-lg border border-tan bg-cream p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-semibold text-clay">{ticket.ticket_id}</p>
                    <h2 className="mt-2 font-display text-3xl font-semibold text-ink">{ticket.subject}</h2>
                    <p className="mt-2 text-sm text-ink-soft">{ticket.email} · {new Date(ticket.created_at).toLocaleString()}</p>
                  </div>
                  <span className="rounded-full border border-tan bg-cream-deep px-3 py-1 text-sm font-semibold text-ink-soft">{supportSeverityLabel(ticket.severity)}</span>
                </div>

                <div className="mt-6 rounded-md border border-tan bg-cream-deep/50 p-4 text-sm leading-relaxed text-ink whitespace-pre-wrap">
                  {ticket.description}
                </div>

                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <Detail label="Category" value={supportCategoryLabel(ticket.category)} />
                  <Detail label="Status" value={supportStatusLabel(ticket.status)} />
                  <Detail label="User ID" value={ticket.user_id ?? 'Public submission'} />
                  <Detail label="Related plan" value={ticket.related_plan_id ?? 'None'} />
                </dl>

                <div className="mt-6 space-y-3">
                  <label className="text-sm font-semibold text-ink">Internal resolution notes</label>
                  <Textarea
                    value={notes[ticket.ticket_id] ?? ticket.resolution_notes ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [ticket.ticket_id]: event.target.value }))}
                    rows={4}
                    placeholder="Resolution notes are admin-only."
                  />
                  <div className="flex flex-wrap gap-2">
                    {statusOptions.map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant={ticket.status === status ? 'hero' : 'outline'}
                        disabled={pendingTicketId === ticket.ticket_id}
                        onClick={() => void updateTicket(ticket, status)}
                      >
                        {pendingTicketId === ticket.ticket_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {supportStatusLabel(status)}
                      </Button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-tan bg-cream-deep/45 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-ink">{value}</dd>
    </div>
  )
}
