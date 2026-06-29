'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  PlugZap,
  RefreshCw,
  Ticket,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EventbritePlannerImportStatus } from '@/lib/integrations/eventbrite/importState'

type EventbriteStatus = 'not_connected' | 'pending' | 'connected' | 'failed' | 'disabled'

type ConnectionState = {
  status: EventbriteStatus
  connected: boolean
  webhookUrl: string | null
  hasWebhookSecret: boolean
  lastConnectedAt: string | null
  lastEventReceivedAt: string | null
  lastWebhookEventType: string | null
  lastError: string | null
}

type ImportedAttendeePreview = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  ticketType: string | null
  checkedIn: boolean
  checkInTime: string | null
}

type ImportedEventPreview = {
  eventId: string
  integrationId: string
  syncStatus: string | null
  lastSyncAt: string | null
  ticketsSold: number
  ticketsRefunded: number
  grossRevenueCents: number
  netRevenueCents: number
  attendeesImported: number | null
  checkedIn: number | null
  attendees: ImportedAttendeePreview[]
}

type EventbriteEventOption = {
  id: string
  name: string
  start: string | null
  end: string | null
  status: string
  url: string | null
  imported: boolean
  importStatus: EventbritePlannerImportStatus
  importStatusMessage: string | null
  preview: ImportedEventPreview | null
}

type StateResponse = {
  connection: ConnectionState
  error?: string
}

type ListResponse = StateResponse & {
  events?: EventbriteEventOption[]
}

type QueueResponse = StateResponse & {
  queued?: number
  jobs?: Array<{
    id: string
    status: string
    scheduled_at: string | null
  }>
}

const connectionStatusCopy: Record<EventbriteStatus, { label: string; className: string }> = {
  not_connected: {
    label: 'Not connected',
    className: 'border-tan text-ink-soft',
  },
  pending: {
    label: 'OAuth pending',
    className: 'border-clay/30 bg-clay-tint text-clay-deep',
  },
  connected: {
    label: 'Connected',
    className: 'border-forest/30 bg-forest-tint text-forest',
  },
  failed: {
    label: 'Needs attention',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
  disabled: {
    label: 'Disabled',
    className: 'border-tan text-ink-soft',
  },
}

const importStatusCopy: Record<EventbritePlannerImportStatus, { label: string; className: string }> = {
  ready: {
    label: 'Ready',
    className: 'border-tan text-ink-soft',
  },
  queued: {
    label: 'Queued',
    className: 'border-clay/30 bg-clay-tint text-clay-deep',
  },
  running: {
    label: 'Running',
    className: 'border-clay/30 bg-clay-tint text-clay-deep',
  },
  imported: {
    label: 'Imported',
    className: 'border-forest/30 bg-forest-tint text-forest',
  },
  failed: {
    label: 'Failed',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
}

type EventbriteEventImportWizardProps = {
  className?: string
}

export function EventbriteEventImportWizard({ className }: EventbriteEventImportWizardProps) {
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [events, setEvents] = useState<EventbriteEventOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verifiedEventId, setVerifiedEventId] = useState<string | null>(null)
  const [queuedJobIds, setQueuedJobIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isListing, setIsListing] = useState(false)
  const [isQueueing, setIsQueueing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/backfill', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as StateResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load Eventbrite connection')
      setConnection(payload.connection)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load Eventbrite connection')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const listEvents = useCallback(async () => {
    setIsListing(true)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_events' }),
      })
      const payload = (await response.json().catch(() => ({}))) as ListResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to list Eventbrite events')
      setConnection(payload.connection)
      setEvents(payload.events ?? [])
      setSelectedId((current) => {
        if (!current) return null
        return (payload.events ?? []).some((event) => event.id === current) ? current : null
      })
      setVerifiedEventId(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to list Eventbrite events')
    } finally {
      setIsListing(false)
    }
  }, [])

  useEffect(() => {
    void loadState()
  }, [loadState])

  useEffect(() => {
    if (!connection?.connected || events.length > 0 || isListing) return
    void listEvents()
  }, [connection?.connected, events.length, isListing, listEvents])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const error = params.get('error')
    if (connected === '1') {
      setSuccessMessage('Eventbrite connected. Select the exact event before importing.')
      void loadState()
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    } else if (error) {
      setErrorMessage(error)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    }
  }, [loadState])

  const status = connection?.status ?? 'not_connected'
  const statusMeta = connectionStatusCopy[status] ?? connectionStatusCopy.not_connected
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId]
  )
  const verifiedEvent = verifiedEventId && selectedEvent?.id === verifiedEventId ? selectedEvent : null
  const previewEvent = selectedEvent?.preview ? selectedEvent : events.find((event) => event.preview) ?? null
  const canQueueImport = Boolean(
    verifiedEvent &&
      (verifiedEvent.importStatus === 'ready' || verifiedEvent.importStatus === 'failed')
  )

  async function connectEventbrite() {
    setIsConnecting(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/connect', { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as { authUrl?: string; error?: string }
      if (!response.ok || !payload.authUrl) throw new Error(payload.error ?? 'Unable to start Eventbrite OAuth')
      window.location.href = payload.authUrl
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start Eventbrite OAuth')
      setIsConnecting(false)
    }
  }

  function selectEvent(eventId: string) {
    setSelectedId(eventId)
    setVerifiedEventId(null)
    setQueuedJobIds([])
    setSuccessMessage(null)
  }

  function verifySelectedEvent() {
    if (!selectedEvent || selectedEvent.importStatus === 'imported') return
    setVerifiedEventId(selectedEvent.id)
    setSuccessMessage(`${selectedEvent.name} verified for Eventbrite import.`)
  }

  async function queueImport() {
    if (!verifiedEvent) return
    setIsQueueing(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventbrite_event_ids: [verifiedEvent.id] }),
      })
      const payload = (await response.json().catch(() => ({}))) as QueueResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to queue Eventbrite import')
      setConnection(payload.connection)
      setQueuedJobIds((payload.jobs ?? []).map((job) => job.id))
      setSuccessMessage(`${verifiedEvent.name} import queued for 3rdPlace analytics.`)
      setEvents((current) =>
        current.map((event) =>
          event.id === verifiedEvent.id
            ? {
                ...event,
                importStatus: 'queued',
                importStatusMessage: 'Import is queued and will run in the background.',
              }
            : event
        )
      )
      setVerifiedEventId(null)
      await listEvents()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to queue Eventbrite import')
    } finally {
      setIsQueueing(false)
    }
  }

  if (isLoading) {
    return (
      <section id="eventbrite-import" className={cn('rounded-lg border border-tan bg-cream p-5 shadow-card', className)}>
        <div className="flex min-h-36 items-center justify-center text-sm text-ink-soft">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading Eventbrite connection
        </div>
      </section>
    )
  }

  return (
    <section id="eventbrite-import" className={cn('space-y-5 rounded-lg border border-tan bg-cream p-5 shadow-card', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="label-caps text-clay">Eventbrite import</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink">Select, verify, and import</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Pull Eventbrite sales, refunds, attendees, and check-ins into 3rdPlace after you confirm the exact event. This supports planner analytics and financial forecasting only.
          </p>
        </div>
        <span className={cn('inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-medium', statusMeta.className)}>
          {status === 'connected' ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          {statusMeta.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={connectEventbrite} disabled={isConnecting || isQueueing}>
          {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
          {connection?.connected ? 'Reconnect Eventbrite' : 'Connect Eventbrite'}
        </Button>
        <Button type="button" variant="outline" onClick={listEvents} disabled={!connection?.connected || isListing || isQueueing}>
          {isListing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Refresh events
        </Button>
      </div>

      {connection?.lastConnectedAt ? (
        <p className="text-sm text-ink-soft">OAuth connected {relativeTime(connection.lastConnectedAt)}</p>
      ) : null}

      {connection?.lastError ? <StatusMessage tone="error" message={connection.lastError} /> : null}
      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}
      {successMessage ? <StatusMessage tone="success" message={successMessage} /> : null}
      {queuedJobIds.length ? (
        <StatusMessage tone="neutral" message="Import queued. 3rdPlace will update this event record when the sync finishes." />
      ) : null}

      <div className="overflow-hidden rounded-lg border border-tan bg-cream-deep/50">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tan px-4 py-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">Owned Eventbrite events</h3>
            <p className="mt-1 text-sm text-ink-soft">Choose one event, verify it, then queue import.</p>
          </div>
          <Button type="button" onClick={queueImport} disabled={!canQueueImport || isQueueing}>
            {isQueueing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Queue import
          </Button>
        </div>

        {events.length ? (
          <div className="divide-y divide-tan">
            {events.map((event) => {
              const importMeta = importStatusCopy[event.importStatus] ?? importStatusCopy.ready
              return (
                <label
                  key={event.id}
                  className={cn(
                    'grid cursor-pointer gap-3 px-4 py-4 transition-smooth sm:grid-cols-[auto_1fr_auto] sm:items-center',
                    selectedId === event.id ? 'bg-clay-tint/60' : 'hover:bg-cream'
                  )}
                >
                  <input
                    type="radio"
                    name="eventbrite-event"
                    checked={selectedId === event.id}
                    onChange={() => selectEvent(event.id)}
                    disabled={event.importStatus === 'imported' && !event.preview}
                    className="mt-1 h-4 w-4 border-tan text-clay focus:ring-clay sm:mt-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{event.name}</span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {formatDate(event.start)} · {event.status} · {event.id}
                    </span>
                    {event.importStatusMessage ? (
                      <span className="mt-1 block text-xs font-medium text-ink-soft">{event.importStatusMessage}</span>
                    ) : null}
                  </span>
                  <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold', importMeta.className)}>
                    {importMeta.label}
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-ink-soft">
            {connection?.connected ? 'No Eventbrite events loaded yet.' : 'Connect Eventbrite to load owned events.'}
          </div>
        )}
      </div>

      {selectedEvent ? (
        <div className="rounded-lg border border-tan bg-cream-deep/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="label-caps text-ink-faint">Verify selection</p>
              <h3 className="mt-1 truncate font-display text-xl font-semibold text-ink">{selectedEvent.name}</h3>
              <p className="mt-2 text-sm text-ink-soft">
                {formatDate(selectedEvent.start)} · {selectedEvent.status} · Eventbrite ID {selectedEvent.id}
              </p>
              {selectedEvent.url ? (
                <a
                  href={selectedEvent.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-clay underline-offset-4 hover:underline"
                >
                  Open Eventbrite event
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <span className={cn(
              'inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-medium',
              verifiedEvent
                ? 'border-forest/30 bg-forest-tint text-forest'
                : 'border-clay/30 bg-clay-tint text-clay-deep'
            )}>
              {verifiedEvent ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {verifiedEvent ? 'Verified' : 'Needs host verification'}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={verifySelectedEvent}
              disabled={selectedEvent.importStatus === 'imported' || Boolean(verifiedEvent)}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Verify this Eventbrite event
            </Button>
            {selectedEvent.importStatus === 'imported' ? (
              <p className="self-center text-sm font-medium text-ink-soft">Imported data is already available below.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {previewEvent?.preview ? (
        <ImportedEventPreviewCard eventName={previewEvent.name} preview={previewEvent.preview} />
      ) : null}
    </section>
  )
}

function ImportedEventPreviewCard({
  eventName,
  preview,
}: {
  eventName: string
  preview: ImportedEventPreview
}) {
  return (
    <div className="rounded-lg border border-tan bg-cream-deep/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps text-forest">Imported preview</p>
          <h3 className="mt-1 font-display text-xl font-semibold text-ink">{eventName}</h3>
          {preview.lastSyncAt ? <p className="mt-1 text-sm text-ink-soft">Last import {relativeTime(preview.lastSyncAt)}</p> : null}
        </div>
        <span className="inline-flex items-center rounded-full border border-forest/30 bg-forest-tint px-3 py-1 text-sm font-medium text-forest">
          {preview.syncStatus ?? 'imported'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PreviewMetric icon={<Ticket className="h-4 w-4" />} label="Tickets sold" value={String(preview.ticketsSold)} />
        <PreviewMetric icon={<BarChart3 className="h-4 w-4" />} label="Gross" value={formatCents(preview.grossRevenueCents)} />
        <PreviewMetric icon={<BarChart3 className="h-4 w-4" />} label="Net" value={formatCents(preview.netRevenueCents)} />
        <PreviewMetric icon={<Users className="h-4 w-4" />} label="Checked in" value={preview.checkedIn === null ? 'Pending' : String(preview.checkedIn)} />
      </div>

      {preview.attendees.length ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-tan bg-cream">
          <table className="min-w-full divide-y divide-tan text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Check-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tan">
              {preview.attendees.map((attendee) => (
                <tr key={attendee.id} className="text-ink">
                  <td className="px-3 py-2">{[attendee.firstName, attendee.lastName].filter(Boolean).join(' ') || 'Guest'}</td>
                  <td className="px-3 py-2">{attendee.email || 'No email'}</td>
                  <td className="px-3 py-2">{attendee.ticketType || 'General admission'}</td>
                  <td className="px-3 py-2">{attendee.checkedIn ? formatDateTime(attendee.checkInTime) : 'Not checked in'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-tan px-3 py-4 text-sm text-ink-soft">
          Attendee preview appears after imported attendee rows are available.
        </p>
      )}
    </div>
  )
}

function PreviewMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-display text-xl font-semibold text-ink">{value}</p>
    </div>
  )
}

function StatusMessage({ tone, message }: { tone: 'success' | 'error' | 'neutral'; message: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm font-medium',
        tone === 'success' && 'border-forest/30 bg-forest-tint text-forest',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'neutral' && 'border-tan bg-cream-deep text-ink-soft'
      )}
    >
      {message}
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDateTime(value: string | null) {
  if (!value) return 'Checked in'
  return formatDate(value)
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const absSeconds = Math.abs(seconds)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (absSeconds >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(seconds, 'second')
}
