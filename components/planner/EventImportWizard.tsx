'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ImagePlus, Loader2, PlugZap, RefreshCw, Ticket, UploadCloud } from 'lucide-react'
import { CsvColumnMapper } from '@/components/planner/CsvColumnMapper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ImportSource = 'posh' | 'eventbrite' | 'luma' | 'partiful' | 'other'
type CsvKind = 'attendees' | 'sales'

type Connection = {
  platform: ImportSource
  status: string
  webhook_url?: string | null
}

type ImportEventShell = {
  event_name: string
  event_date: string
  start_time: string
  end_time: string
  expected_attendance: number | null
  description: string | null
  venue_name?: string | null
  cover_image_url?: string | null
}

type MappingState = {
  kind: CsvKind
  headers: string[]
  mapping: {
    mapping: Record<string, string>
    candidates?: Record<string, string[]>
    missingRequired?: string[]
    ambiguousFields?: string[]
    needsMapping?: boolean
  }
}

type ScreenshotExtraction = {
  tickets_sold: number | null
  gross_revenue_cents: number | null
  refunds_cents: number | null
  checked_in_count: number | null
  notes: string | null
}

const sources: Array<{ id: ImportSource; label: string; mode: string }> = [
  { id: 'posh', label: 'Posh', mode: 'Webhook or CSV' },
  { id: 'eventbrite', label: 'Eventbrite', mode: 'OAuth or CSV' },
  { id: 'luma', label: 'Luma', mode: 'Guest list CSV' },
  { id: 'partiful', label: 'Partiful', mode: 'Event link or CSV' },
  { id: 'other', label: 'Other', mode: 'Manual import' },
]

const sourceIds = new Set<ImportSource>(sources.map((source) => source.id))

function normalizeImportSource(value: string | null): ImportSource | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  return sourceIds.has(normalized as ImportSource) ? (normalized as ImportSource) : null
}

export function EventImportWizard() {
  const searchParams = useSearchParams()
  const requestedSource = normalizeImportSource(searchParams.get('source'))
  const [connections, setConnections] = useState<Connection[]>([])
  const [source, setSource] = useState<ImportSource>(requestedSource ?? 'luma')
  const [eventUrl, setEventUrl] = useState('')
  const [eventShell, setEventShell] = useState<ImportEventShell>({
    event_name: '',
    event_date: '',
    start_time: '18:00:00',
    end_time: '21:00:00',
    expected_attendance: null,
    description: '',
  })
  const [importId, setImportId] = useState<string | null>(null)
  const [eventId, setEventId] = useState<string | null>(null)
  const [mappingState, setMappingState] = useState<MappingState | null>(null)
  const [attendeeCount, setAttendeeCount] = useState(0)
  const [salesCount, setSalesCount] = useState(0)
  const [screenshotExtraction, setScreenshotExtraction] = useState<ScreenshotExtraction | null>(null)
  const [gapFill, setGapFill] = useState({
    tickets_sold: '',
    gross_revenue: '',
    refunds: '',
    checked_in_count: '',
  })
  const [isStarting, setIsStarting] = useState(false)
  const [uploadingKind, setUploadingKind] = useState<CsvKind | 'screenshots' | null>(null)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    void loadConnections()
  }, [])

  useEffect(() => {
    if (requestedSource) setSource(requestedSource)
  }, [requestedSource])

  const connectedSource = connections.find((connection) => connection.platform === source && isConnected(connection.status))
  const missingFields = useMemo(() => {
    const missing: string[] = []
    if (!eventShell.event_name.trim()) missing.push('event_name')
    if (!eventShell.event_date.trim()) missing.push('event_date')
    if (!eventShell.expected_attendance) missing.push('expected_attendance')
    if (attendeeCount === 0 && !screenshotExtraction?.checked_in_count && !gapFill.checked_in_count) missing.push('checked_in_count')
    if (salesCount === 0 && !screenshotExtraction?.tickets_sold && !gapFill.tickets_sold) missing.push('tickets_sold')
    if (salesCount === 0 && !screenshotExtraction?.gross_revenue_cents && !gapFill.gross_revenue) missing.push('gross_revenue')
    return missing
  }, [attendeeCount, eventShell, gapFill, salesCount, screenshotExtraction])

  async function loadConnections() {
    try {
      const response = await fetch('/api/integrations/ticketing/connections', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) setConnections((payload.connections ?? []) as Connection[])
    } catch {
      setConnections([])
    }
  }

  async function startImport() {
    setIsStarting(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/planner/events/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          event_url: eventUrl.trim() || '',
          event: {
            event_name: eventShell.event_name.trim() || undefined,
            event_date: eventShell.event_date.trim() || undefined,
            start_time: eventShell.start_time,
            end_time: eventShell.end_time,
            expected_attendance: eventShell.expected_attendance,
            description: eventShell.description?.trim() || undefined,
            venue_name: eventShell.venue_name?.trim() || undefined,
          },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Unable to start import')
      setImportId(payload.importId)
      setEventId(payload.eventId)
      setEventShell((current) => ({ ...current, ...(payload.event ?? {}) }))
      setSuccessMessage('Draft event created. Add CSVs, screenshots, or gap-fill values.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start import')
    } finally {
      setIsStarting(false)
    }
  }

  const handleCsvResponse = useCallback((kind: CsvKind, payload: any) => {
    if (payload.mapping?.needsMapping) {
      setMappingState({
        kind,
        headers: payload.headers ?? [],
        mapping: payload.mapping,
      })
      setSuccessMessage('Review the CSV mapping before importing.')
      return
    }

    setMappingState(null)
    if (typeof payload.counts?.attendees === 'number') setAttendeeCount(payload.counts.attendees)
    if (typeof payload.counts?.sales === 'number') setSalesCount(payload.counts.sales)
    setSuccessMessage(`${kind === 'attendees' ? 'Attendee' : 'Sales'} CSV staged.`)
  }, [])

  const uploadCsv = useCallback(async (kind: CsvKind, file: File) => {
    if (!importId) return
    setUploadingKind(kind)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const formData = new FormData()
      formData.set('kind', kind)
      formData.set('file', file)
      const response = await fetch(`/api/planner/events/import/${importId}/csv`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'CSV upload failed')
      handleCsvResponse(kind, payload)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'CSV upload failed')
    } finally {
      setUploadingKind(null)
    }
  }, [handleCsvResponse, importId])

  async function applyMapping(mapping: Record<string, string>) {
    if (!importId || !mappingState) return
    setUploadingKind(mappingState.kind)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/import/${importId}/csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: mappingState.kind,
          mapping,
          use_existing: true,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Unable to apply mapping')
      handleCsvResponse(mappingState.kind, payload)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to apply mapping')
    } finally {
      setUploadingKind(null)
    }
  }

  async function uploadScreenshots(files: FileList | null) {
    if (!importId || !files?.length) return
    setUploadingKind('screenshots')
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const formData = new FormData()
      Array.from(files).slice(0, 5).forEach((file) => formData.append('screenshots', file))
      const response = await fetch(`/api/planner/events/import/${importId}/screenshot`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Screenshot extraction failed')
      setScreenshotExtraction(payload.extraction)
      setSuccessMessage('Screenshot metrics staged.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Screenshot extraction failed')
    } finally {
      setUploadingKind(null)
    }
  }

  async function finalizeImport() {
    if (!importId) return
    setIsFinalizing(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch(`/api/planner/events/import/${importId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: {
            event_name: eventShell.event_name,
            event_date: eventShell.event_date,
            start_time: eventShell.start_time,
            end_time: eventShell.end_time,
            expected_attendance: eventShell.expected_attendance,
            description: eventShell.description,
          },
          gap_fill: {
            tickets_sold: numberOrNull(gapFill.tickets_sold),
            gross_revenue_cents: dollarsToCents(gapFill.gross_revenue),
            refunds_cents: dollarsToCents(gapFill.refunds),
            checked_in_count: numberOrNull(gapFill.checked_in_count),
          },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Unable to finalize import')
      window.location.href = payload.redirectUrl ?? `/planner/events/${payload.eventId}/report`
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to finalize import')
    } finally {
      setIsFinalizing(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Source</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick the platform this event data came from.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadConnections()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh connections
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {sources.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={source === item.id}
              onClick={() => setSource(item.id)}
              className={cn(
                'rounded-md border px-4 py-3 text-left transition-smooth',
                source === item.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{item.label}</span>
                {connections.some((connection) => connection.platform === item.id && isConnected(connection.status)) ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                ) : null}
              </span>
              <span className="mt-1 block text-xs">{item.mode}</span>
            </button>
          ))}
        </div>

        {connectedSource && (source === 'posh' || source === 'eventbrite') ? (
          <div className="mt-4 rounded-md border border-emerald-700/30 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {source === 'eventbrite' ? 'Eventbrite OAuth is connected.' : 'Posh webhooks are connected.'}
              </span>
              <a
                href={source === 'eventbrite' ? '/planner/integrations/eventbrite' : '/planner/integrations/posh'}
                className="font-semibold underline underline-offset-4"
              >
                Use connected import
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-md border border-border bg-card p-5">
          <h2 className="font-display text-2xl font-semibold text-foreground">Event shell</h2>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-url">Event URL</Label>
              <Input id="event-url" value={eventUrl} onChange={(event) => setEventUrl(event.target.value)} placeholder="https://..." disabled={Boolean(importId)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Event name" value={eventShell.event_name} onChange={(value) => setEventShell((current) => ({ ...current, event_name: value }))} />
              <TextInput label="Date" type="date" value={eventShell.event_date} onChange={(value) => setEventShell((current) => ({ ...current, event_date: value }))} />
              <TextInput label="Start" type="time" value={eventShell.start_time.slice(0, 5)} onChange={(value) => setEventShell((current) => ({ ...current, start_time: `${value}:00` }))} />
              <TextInput label="End" type="time" value={eventShell.end_time.slice(0, 5)} onChange={(value) => setEventShell((current) => ({ ...current, end_time: `${value}:00` }))} />
              <TextInput label="Expected attendance" type="number" value={eventShell.expected_attendance?.toString() ?? ''} onChange={(value) => setEventShell((current) => ({ ...current, expected_attendance: value ? Number(value) : null }))} />
              <TextInput label="Venue name" value={eventShell.venue_name ?? ''} onChange={(value) => setEventShell((current) => ({ ...current, venue_name: value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-description">Description</Label>
              <Textarea id="event-description" value={eventShell.description ?? ''} onChange={(event) => setEventShell((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <Button type="button" onClick={startImport} disabled={isStarting || Boolean(importId)}>
              {isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="mr-2 h-4 w-4" aria-hidden="true" />}
              {importId ? 'Draft created' : 'Create draft event'}
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-5">
          <h2 className="font-display text-2xl font-semibold text-foreground">Uploads</h2>
          <div className="mt-4 grid gap-3">
            <UploadZone
              icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
              title="Attendee CSV"
              detail={`${attendeeCount} attendee rows staged`}
              disabled={!importId || uploadingKind !== null}
              loading={uploadingKind === 'attendees'}
              accept=".csv,text/csv"
              onFile={(file) => void uploadCsv('attendees', file)}
            />
            <UploadZone
              icon={<Ticket className="h-5 w-5" aria-hidden="true" />}
              title="Sales CSV"
              detail={`${salesCount} sales rows staged`}
              disabled={!importId || uploadingKind !== null}
              loading={uploadingKind === 'sales'}
              accept=".csv,text/csv"
              onFile={(file) => void uploadCsv('sales', file)}
            />
            <UploadZone
              icon={<ImagePlus className="h-5 w-5" aria-hidden="true" />}
              title="Screenshots"
              detail={screenshotExtraction ? formatScreenshotSummary(screenshotExtraction) : 'Up to 5 images'}
              disabled={!importId || uploadingKind !== null}
              loading={uploadingKind === 'screenshots'}
              accept="image/png,image/jpeg,image/webp"
              multiple
              onFiles={(files) => void uploadScreenshots(files)}
            />
          </div>
        </div>
      </section>

      {mappingState ? (
        <CsvColumnMapper
          kind={mappingState.kind}
          headers={mappingState.headers}
          mapping={mappingState.mapping}
          isSubmitting={uploadingKind === mappingState.kind}
          onSubmit={(mapping) => void applyMapping(mapping)}
        />
      ) : null}

      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Gap-fill</h2>
            <p className="mt-1 text-sm text-muted-foreground">Fill only what the import did not provide.</p>
          </div>
          <span className={cn(
            'rounded-full border px-3 py-1 text-sm font-medium',
            missingFields.length ? 'border-amber-600/30 bg-amber-50 text-amber-900' : 'border-emerald-700/30 bg-emerald-50 text-emerald-900'
          )}>
            {missingFields.length ? `${missingFields.length} gaps` : 'Ready'}
          </span>
        </div>
        {missingFields.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {missingFields.map((field) => (
              <span key={field} className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                {field.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="Tickets sold" type="number" value={gapFill.tickets_sold} onChange={(value) => setGapFill((current) => ({ ...current, tickets_sold: value }))} />
          <TextInput label="Gross revenue" type="number" value={gapFill.gross_revenue} onChange={(value) => setGapFill((current) => ({ ...current, gross_revenue: value }))} />
          <TextInput label="Refunds" type="number" value={gapFill.refunds} onChange={(value) => setGapFill((current) => ({ ...current, refunds: value }))} />
          <TextInput label="Checked in" type="number" value={gapFill.checked_in_count} onChange={(value) => setGapFill((current) => ({ ...current, checked_in_count: value }))} />
        </div>
      </section>

      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}
      {successMessage ? <StatusMessage tone="success" message={successMessage} /> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={finalizeImport} disabled={!importId || isFinalizing}>
          {isFinalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />}
          Finalize import
        </Button>
      </div>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function UploadZone({
  icon,
  title,
  detail,
  disabled,
  loading,
  accept,
  multiple = false,
  onFile,
  onFiles,
}: {
  icon: ReactNode
  title: string
  detail: string
  disabled: boolean
  loading: boolean
  accept: string
  multiple?: boolean
  onFile?: (file: File) => void
  onFiles?: (files: FileList | null) => void
}) {
  return (
    <label className={cn(
      'flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background/60 p-4 transition-smooth',
      disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-primary/5'
    )}>
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{detail}</span>
      </span>
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          if (multiple) {
            onFiles?.(event.target.files)
          } else {
            const file = event.target.files?.[0]
            if (file) onFile?.(file)
          }
          event.target.value = ''
        }}
      />
    </label>
  )
}

function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-4 py-3 text-sm',
      tone === 'error'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-emerald-700/30 bg-emerald-50 text-emerald-900'
    )}>
      {tone === 'error' ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      {message}
    </div>
  )
}

function isConnected(status: string) {
  return ['connected', 'linked', 'completed'].includes(status)
}

function numberOrNull(value: string) {
  return value.trim() && Number.isFinite(Number(value)) ? Number(value) : null
}

function dollarsToCents(value: string) {
  return value.trim() && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null
}

function formatScreenshotSummary(extraction: ScreenshotExtraction) {
  const parts = [
    extraction.tickets_sold != null ? `${extraction.tickets_sold} tickets` : null,
    extraction.checked_in_count != null ? `${extraction.checked_in_count} checked in` : null,
    extraction.gross_revenue_cents != null ? formatCents(extraction.gross_revenue_cents) : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : extraction.notes ?? 'Partial metrics staged'
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
