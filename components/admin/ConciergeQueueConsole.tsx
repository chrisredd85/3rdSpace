'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, PhoneCall, RefreshCw, Search, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { AdminConciergeData, ConciergeQueueRow } from '@/lib/server/admin-concierge'

function formatDate(value: string | null) {
  if (!value) return 'No deadline'
  return new Date(value).toLocaleString()
}

function formatAge(hours: number) {
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function statusTone(status: string) {
  if (status === 'concierge_followup') return 'border-warning/30 bg-warning/10 text-warning'
  if (status === 'sent') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'accepted') return 'border-success/30 bg-success/10 text-success'
  if (status === 'declined' || status === 'expired') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-background text-muted-foreground'
}

function buildReminderScript(row: ConciergeQueueRow) {
  return [
    `Hi ${row.venue.name}, this is 3rdPlace following up on a hosting opportunity for ${row.plan.title}.`,
    `Host: ${row.host.name}`,
    `Brief: ${row.brief.summary}`,
    `Deadline: ${formatDate(row.deadline)}`,
    'Can you confirm if this is a fit, decline, or counter with terms?',
  ].join('\n')
}

/**
 * Admin concierge queue for opportunity invites that need manual handling.
 */
export function ConciergeQueueConsole({ initialData }: { initialData: AdminConciergeData }) {
  const [data] = useState(initialData)
  const [planFilter, setPlanFilter] = useState('')
  const [venueFilter, setVenueFilter] = useState('')
  const [ageFilter, setAgeFilter] = useState<'all' | '24' | '72'>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notesByInvite, setNotesByInvite] = useState<Record<string, string>>({})
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const filteredRows = useMemo(() => {
    const plan = planFilter.trim().toLowerCase()
    const venue = venueFilter.trim().toLowerCase()
    return data.rows.filter((row) => {
      const planMatches = !plan || row.plan.title.toLowerCase().includes(plan) || row.host.name.toLowerCase().includes(plan)
      const venueMatches = !venue || row.venue.name.toLowerCase().includes(venue)
      const ageMatches = ageFilter === 'all' || row.ageHours >= Number(ageFilter)
      return planMatches && venueMatches && ageMatches
    })
  }, [ageFilter, data.rows, planFilter, venueFilter])

  async function refresh() {
    window.location.reload()
  }

  async function logAction(row: ConciergeQueueRow, actionType: 'outreach_attempt' | 'response_logged', fallbackNotes: string) {
    setBusyInviteId(row.id)
    setMessage(null)
    try {
      const notes = notesByInvite[row.id]?.trim() || fallbackNotes
      const response = await fetch('/api/admin/concierge/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inviteId: row.id,
          actionType,
          notes,
          outcomePayload: {
            planTitle: row.plan.title,
            venueName: row.venue.name,
          },
        }),
      })
      if (!response.ok) throw new Error('Failed to log concierge action')
      setMessage('Action logged.')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setBusyInviteId(null)
    }
  }

  async function overrideStatus(row: ConciergeQueueRow, status: 'accepted' | 'declined') {
    setBusyInviteId(row.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/concierge/invites/${row.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status,
          notes: notesByInvite[row.id]?.trim() || `Marked ${status} on host's behalf.`,
          outcomePayload: {
            source: 'admin_concierge',
            planTitle: row.plan.title,
            venueName: row.venue.name,
          },
        }),
      })
      if (!response.ok) throw new Error('Failed to override invite status')
      setMessage(`Invite marked ${status}.`)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Override failed.')
    } finally {
      setBusyInviteId(null)
    }
  }

  async function reassign(row: ConciergeQueueRow) {
    const venueId = window.prompt('Paste the replacement venue id')
    if (!venueId) return

    setBusyInviteId(row.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/concierge/invites/${row.id}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: 'queued',
          reassignedVenueId: venueId.trim(),
          notes: notesByInvite[row.id]?.trim() || `Reassigned from ${row.venue.name}.`,
          outcomePayload: {
            previousVenueId: row.venue.id,
            previousVenueName: row.venue.name,
          },
        }),
      })
      if (!response.ok) throw new Error('Failed to reassign invite')
      setMessage('Invite reassigned.')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reassignment failed.')
    } finally {
      setBusyInviteId(null)
    }
  }

  async function copyReminderTemplate() {
    const selectedRows = filteredRows.filter((row) => selectedIds.includes(row.id))
    const rows = selectedRows.length > 0 ? selectedRows : filteredRows
    const script = rows.map(buildReminderScript).join('\n\n---\n\n')
    await navigator.clipboard.writeText(script || 'No concierge invites selected.')
    setMessage(`Copied ${rows.length} reminder template${rows.length === 1 ? '' : 's'}.`)
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="font-display text-4xl font-bold">Concierge queue</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Manual follow-up for venue opportunities that could not auto-send or are near deadline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copyReminderTemplate}>
              <Clipboard className="mr-2 h-4 w-4" />
              Send manual reminder template
            </Button>
            <Button type="button" variant="hero" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {message ? (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">{message}</div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card/70 p-4 shadow-card">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px]">
            <label className="text-sm font-semibold text-foreground">
              Filter by plan or host
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="pl-9" />
              </div>
            </label>
            <label className="text-sm font-semibold text-foreground">
              Filter by venue
              <Input value={venueFilter} onChange={(event) => setVenueFilter(event.target.value)} className="mt-1" />
            </label>
            <label className="text-sm font-semibold text-foreground">
              Age
              <select
                value={ageFilter}
                onChange={(event) => setAgeFilter(event.target.value as 'all' | '24' | '72')}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All ages</option>
                <option value="24">&gt; 24h</option>
                <option value="72">&gt; 72h</option>
              </select>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card/70 shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-3" />
                  <th className="px-4 py-3">Plan + host</th>
                  <th className="px-4 py-3">Venue + contact</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Brief</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      No concierge invites match these filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.id} className={row.isSlaRed ? 'bg-destructive/5' : undefined}>
                      <td className="px-4 py-4 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          aria-label={`Select ${row.venue.name}`}
                        />
                      </td>
                      <td className="max-w-xs px-4 py-4 align-top">
                        <p className="font-semibold text-foreground">{row.plan.title}</p>
                        <p className="mt-1 text-muted-foreground">{row.host.name}</p>
                        {row.isSlaRed ? (
                          <span className="mt-2 inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            SLA risk
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-xs px-4 py-4 align-top">
                        <p className="font-semibold text-foreground">{row.venue.name}</p>
                        <div className="mt-1 space-y-0.5 text-muted-foreground">
                          {row.venue.contactInfo.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                          {row.status}
                        </span>
                        <p className="mt-2 text-muted-foreground">Age {formatAge(row.ageHours)}</p>
                        <p className="mt-1 text-muted-foreground">Deadline {formatDate(row.deadline)}</p>
                        {row.lastAction ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Last: {row.lastAction.action_type} · {formatDate(row.lastAction.created_at)}
                          </p>
                        ) : null}
                      </td>
                      <td className="max-w-sm px-4 py-4 align-top">
                        <details>
                          <summary className="cursor-pointer font-semibold text-foreground">Brief summary</summary>
                          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{row.brief.summary}</p>
                          <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
                            {JSON.stringify(row.brief.requirements, null, 2)}
                          </pre>
                        </details>
                      </td>
                      <td className="min-w-[320px] px-4 py-4 align-top">
                        <Textarea
                          value={notesByInvite[row.id] ?? ''}
                          onChange={(event) => setNotesByInvite((current) => ({ ...current, [row.id]: event.target.value }))}
                          placeholder="Notes: left voicemail, found web form, venue declined..."
                          className="min-h-20"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyInviteId === row.id}
                            onClick={() => logAction(row, 'outreach_attempt', 'Marked contacted.')}
                          >
                            <PhoneCall className="mr-1 h-4 w-4" />
                            Mark contacted
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyInviteId === row.id}
                            onClick={() => logAction(row, 'response_logged', 'Logged call/email.')}
                          >
                            Log call/email
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyInviteId === row.id}
                            onClick={() => overrideStatus(row, 'accepted')}
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Mark accepted on host&apos;s behalf
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busyInviteId === row.id}
                            onClick={() => overrideStatus(row, 'declined')}
                          >
                            <XCircle className="mr-1 h-4 w-4" />
                            Mark declined
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busyInviteId === row.id}
                            onClick={() => reassign(row)}
                          >
                            Reassign
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">Last refreshed {formatDate(data.generatedAt)}</p>
      </div>
    </div>
  )
}
