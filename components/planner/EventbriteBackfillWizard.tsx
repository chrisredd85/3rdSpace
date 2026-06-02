'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, Download, ExternalLink, Loader2, PlugZap, RefreshCw, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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

type BackfillEvent = {
  id: string
  name: string
  start: string | null
  end: string | null
  status: string
  url: string | null
  imported: boolean
}

type BackfillResult = {
  eventId: string
  externalEventId: string
  ordersImported: number
  attendeesImported: number
  salesImported: number
  feeCommitmentsImported: number
}

type StateResponse = {
  connection: ConnectionState
  error?: string
}

type ListResponse = StateResponse & {
  events?: BackfillEvent[]
}

type ImportResponse = StateResponse & {
  imported?: number
  results?: BackfillResult[]
}

const statusCopy: Record<EventbriteStatus, { label: string; className: string }> = {
  not_connected: {
    label: 'Not connected',
    className: 'border-border text-muted-foreground',
  },
  pending: {
    label: 'OAuth pending',
    className: 'border-amber-600/30 bg-amber-50 text-amber-900',
  },
  connected: {
    label: 'Connected',
    className: 'border-emerald-700/30 bg-emerald-50 text-emerald-900',
  },
  failed: {
    label: 'Needs attention',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
  disabled: {
    label: 'Disabled',
    className: 'border-border text-muted-foreground',
  },
}

export function EventbriteBackfillWizard() {
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [events, setEvents] = useState<BackfillEvent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [verifiedEventId, setVerifiedEventId] = useState<string | null>(null)
  const [importResults, setImportResults] = useState<BackfillResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isListing, setIsListing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [copied, setCopied] = useState(false)
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
      setSelectedId(null)
      setVerifiedEventId(null)
      setImportResults([])
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
    if (params.get('connected') === '1') {
      setSuccessMessage('Eventbrite connected. Choose recent events to import.')
    }
  }, [])

  const status = connection?.status ?? 'not_connected'
  const statusMeta = statusCopy[status] ?? statusCopy.not_connected
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId]
  )
  const verifiedEvent = verifiedEventId && selectedEvent?.id === verifiedEventId ? selectedEvent : null
  const lastSeenLabel = useMemo(
    () => connection?.lastEventReceivedAt ? relativeTime(connection.lastEventReceivedAt) : null,
    [connection?.lastEventReceivedAt]
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

  async function copyWebhookUrl() {
    if (!connection?.webhookUrl) return
    await navigator.clipboard.writeText(connection.webhookUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function selectEvent(eventId: string) {
    setSelectedId(eventId)
    setVerifiedEventId(null)
    setImportResults([])
    setSuccessMessage(null)
  }

  function verifySelectedEvent() {
    if (!selectedEvent || selectedEvent.imported) return
    setVerifiedEventId(selectedEvent.id)
    setSuccessMessage(`${selectedEvent.name} verified for Eventbrite import.`)
  }

  async function importSelected() {
    if (!verifiedEvent) return
    setIsImporting(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventbrite_event_ids: [verifiedEvent.id] }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImportResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to import Eventbrite events')
      setConnection(payload.connection)
      setImportResults(payload.results ?? [])
      setSuccessMessage(`${verifiedEvent.name} imported into 3rdPlace.`)
      setSelectedId(null)
      setVerifiedEventId(null)
      await listEvents()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to import Eventbrite events')
    } finally {
      setIsImporting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-card/50 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading Eventbrite connection
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold text-foreground">Connect Eventbrite</h2>
              <p className="text-sm text-muted-foreground">Organizer OAuth for event selection, sales imports, attendee imports, and check-in webhooks.</p>
            </div>
            <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium', statusMeta.className)}>
              {status === 'connected' ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {statusMeta.label}
            </span>
          </div>

          {connection?.lastConnectedAt ? (
            <p className="mt-4 text-sm text-muted-foreground">
              OAuth connected {relativeTime(connection.lastConnectedAt)}
            </p>
          ) : null}
          {lastSeenLabel ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Last webhook received {lastSeenLabel}
              {connection?.lastWebhookEventType ? ` · ${connection.lastWebhookEventType}` : ''}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={connectEventbrite} disabled={isConnecting}>
              {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />}
              {connection?.connected ? 'Reconnect OAuth' : 'Connect OAuth'}
            </Button>
            <Button type="button" variant="outline" onClick={listEvents} disabled={!connection?.connected || isListing}>
              {isListing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
              Refresh events
            </Button>
          </div>

          {connection?.webhookUrl ? (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-foreground">Webhook URL</p>
              <div className="flex gap-2">
                <Input value={connection.webhookUrl} readOnly />
                <Button type="button" variant="outline" onClick={copyWebhookUrl}>
                  <Clipboard className="mr-2 h-4 w-4" aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold text-foreground">Setup</h2>
          <ol className="mt-4 space-y-4">
            <InstructionStep index={1} title="Authorize Eventbrite" detail="Grant read access for events, orders, and attendees." />
            <InstructionStep index={2} title="Select and verify" detail="Choose the exact Eventbrite event before importing attendee, order, or check-in data." />
            <InstructionStep index={3} title="Enable webhooks" detail="Use the copied endpoint for order placed, order updated, order refunded, and attendee check-in updates." />
          </ol>
        </section>
      </div>

      {connection?.lastError ? <StatusMessage tone="error" message={connection.lastError} /> : null}
      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}
      {successMessage ? <StatusMessage tone="success" message={successMessage} /> : null}

      <section className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Select Eventbrite event</h2>
            <p className="text-sm text-muted-foreground">Pick one event, verify the match, then import sales, fees, attendees, and field confidence labels.</p>
          </div>
          <Button type="button" onClick={importSelected} disabled={!verifiedEvent || isImporting}>
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
            Import verified event
          </Button>
        </div>

        {events.length ? (
          <div className="divide-y divide-border">
            {events.map((event) => (
              <label key={event.id} className={cn(
                'grid cursor-pointer gap-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center',
                selectedId === event.id && 'bg-primary/5'
              )}>
                <input
                  type="radio"
                  name="eventbrite-event"
                  checked={selectedId === event.id}
                  onChange={() => selectEvent(event.id)}
                  disabled={event.imported}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary sm:mt-0"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{event.name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {formatDate(event.start)} · {event.status} · {event.id}
                  </span>
                </span>
                <span className={cn(
                  'inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
                  event.imported ? 'border-emerald-700/30 bg-emerald-50 text-emerald-900' : 'border-border text-muted-foreground'
                )}>
                  {event.imported ? 'Imported' : 'Ready'}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            {connection?.connected ? 'No Eventbrite events loaded yet.' : 'Connect Eventbrite to load recent events.'}
          </div>
        )}
      </section>

      {selectedEvent ? (
        <section className="rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Verify selection
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-foreground">
                {selectedEvent.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatDate(selectedEvent.start)} · {selectedEvent.status} · Eventbrite ID {selectedEvent.id}
              </p>
              {selectedEvent.url ? (
                <a
                  href={selectedEvent.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Open Eventbrite event
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <span className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium',
              verifiedEvent
                ? 'border-emerald-700/30 bg-emerald-50 text-emerald-900'
                : 'border-amber-600/30 bg-amber-50 text-amber-900'
            )}>
              {verifiedEvent ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {verifiedEvent ? 'Verified' : 'Needs host verification'}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" onClick={verifySelectedEvent} disabled={selectedEvent.imported || Boolean(verifiedEvent)}>
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Verify this Eventbrite event
            </Button>
            {selectedEvent.imported ? (
              <p className="self-center text-sm font-medium text-muted-foreground">
                This Eventbrite event is already imported.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {importResults.length ? (
        <section className="rounded-md border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-display text-xl font-semibold text-foreground">Last import</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {importResults.map((result) => (
              <div key={result.externalEventId} className="rounded-md border border-border bg-background/60 p-4">
                <p className="truncate font-medium text-foreground">{result.externalEventId}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {result.ordersImported} orders · {result.attendeesImported} attendees · {result.feeCommitmentsImported} fee commitments
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function InstructionStep({
  index,
  title,
  detail,
}: {
  index: number
  title: string
  detail: string
}) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground">
        {index}
      </span>
      <span>
        <span className="block font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}

function StatusMessage({
  tone,
  message,
}: {
  tone: 'error' | 'success'
  message: string
}) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-4 py-3 text-sm',
      tone === 'error'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-emerald-700/30 bg-emerald-50 text-emerald-900'
    )}>
      {tone === 'error'
        ? <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      {message}
    </div>
  )
}

function relativeTime(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'recently'
  const seconds = Math.max(1, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function formatDate(value: string | null) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
