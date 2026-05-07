'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Download, Link2, Loader2, RefreshCw, Ticket, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'

type IntegrationRecord = {
  id: string
  event_id: string
  external_event_id: string | null
  sync_status: string | null
  config?: {
    eventbrite_event?: {
      id: string
      name: string
      start?: string | null
      status?: string | null
    }
  } | null
}

type WebhookPlatform = 'posh' | 'luma'

type WebhookIntegrationState = Record<WebhookPlatform, IntegrationRecord | null>

type EventbriteEvent = {
  id: string
  name: string
  start: string | null
  end: string | null
  status: string
}

type ImportSummary = {
  imported: number
  updated: number
  checked_in: number
  message: string
}

type ImportedAttendeePreview = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  ticket_type: string | null
  checked_in: boolean | null
  check_in_time: string | null
}

/**
 * Eventbrite connect, select, and import flow shown inside the planning step.
 */
export function EventbriteImportPanel({
  eventId,
  ensureEventReady,
}: {
  eventId: string
  ensureEventReady?: () => Promise<string | null>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const [integration, setIntegration] = useState<IntegrationRecord | null>(null)
  const [webhookIntegrations, setWebhookIntegrations] = useState<WebhookIntegrationState>({
    posh: null,
    luma: null,
  })
  const [availableEvents, setAvailableEvents] = useState<EventbriteEvent[]>([])
  const [selectedEventbriteEventId, setSelectedEventbriteEventId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [attendeePreview, setAttendeePreview] = useState<ImportedAttendeePreview[]>([])

  const canUseIntegration = !!eventId && eventId !== 'new'

  /**
   * Loads saved ticketing integrations for the current event.
   */
  const loadIntegration = async () => {
    if (!canUseIntegration) {
      setIntegration(null)
      setWebhookIntegrations({ posh: null, luma: null })
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const [{ data, error }, { data: webhookData, error: webhookError }] = await Promise.all([
      supabase
        .from('external_event_integrations')
        .select('id, event_id, external_event_id, sync_status, config')
        .eq('event_id', eventId)
        .eq('platform', 'eventbrite')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('external_event_integrations')
        .select('id, event_id, external_event_id, sync_status, config, platform')
        .eq('event_id', eventId)
        .in('platform', ['posh', 'luma'])
        .order('created_at', { ascending: false }),
    ])

    if (error) {
      addToast({
        title: 'Could not load Eventbrite connection',
        description: error.message,
        variant: 'destructive',
      })
      setIsLoading(false)
      return
    }

    if (webhookError) {
      addToast({
        title: 'Could not load webhook connections',
        description: webhookError.message,
        variant: 'destructive',
      })
      setIsLoading(false)
      return
    }

    const record = (data as IntegrationRecord | null) ?? null
    const webhookRows = (webhookData as Array<IntegrationRecord & { platform: WebhookPlatform }> | null) ?? []
    const nextWebhookIntegrations: WebhookIntegrationState = { posh: null, luma: null }

    webhookRows.forEach((row) => {
      if (!nextWebhookIntegrations[row.platform]) {
        nextWebhookIntegrations[row.platform] = row
      }
    })

    setIntegration(record)
    setWebhookIntegrations(nextWebhookIntegrations)
    setSelectedEventbriteEventId(record?.external_event_id ?? '')
    setIsLoading(false)
  }

  /**
   * Loads the builder's available Eventbrite events for selection.
   */
  const loadEventbriteEvents = async (integrationId: string) => {
    const response = await fetch(`/api/integrations/eventbrite/events?integrationId=${integrationId}`, {
      credentials: 'include',
    })
    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || 'Failed to load Eventbrite events')
    }

    setAvailableEvents((result.events || []) as EventbriteEvent[])
  }

  /**
   * Loads a small preview of imported attendees for the linked integration.
   */
  const loadImportedAttendees = async (integrationId: string) => {
    const { data, error } = await supabase
      .from('imported_attendees')
      .select('id, first_name, last_name, email, ticket_type, checked_in, check_in_time')
      .eq('integration_id', integrationId)
      .order('check_in_time', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      addToast({
        title: 'Could not load attendee preview',
        description: error.message,
        variant: 'destructive',
      })
      return
    }

    setAttendeePreview((data as ImportedAttendeePreview[] | null) ?? [])
  }

  useEffect(() => {
    loadIntegration()
  }, [eventId])

  useEffect(() => {
    if (!integration?.id || !['connected', 'linked', 'completed'].includes(integration.sync_status || '')) {
      return
    }

    loadEventbriteEvents(integration.id).catch((error) => {
      addToast({
        title: 'Could not load Eventbrite events',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    })

    loadImportedAttendees(integration.id).catch(() => {})
  }, [integration?.id, integration?.sync_status])

  useEffect(() => {
    const integrationStatus = searchParams.get('integration')
    const status = searchParams.get('status')
    const message = searchParams.get('message')

    if (integrationStatus !== 'eventbrite' || !status) return

    addToast({
      title: status === 'success' ? 'Eventbrite connected' : 'Eventbrite connection issue',
      description:
        message ||
        (status === 'success'
          ? 'Choose which Eventbrite event to link, then import attendees.'
          : 'Please try the connection again.'),
      variant: status === 'success' ? 'success' : 'destructive',
    })

    loadIntegration()

    const url = new URL(window.location.href)
    url.searchParams.delete('integration')
    url.searchParams.delete('status')
    url.searchParams.delete('message')
    router.replace(url.pathname + (url.search ? url.search : ''))
  }, [addToast, router, searchParams])

  /**
   * Starts the Eventbrite OAuth handshake.
   */
  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      let resolvedEventId = eventId

      if (!canUseIntegration) {
        resolvedEventId = (await ensureEventReady?.()) || ''
        if (!resolvedEventId) {
          throw new Error('We could not create a draft event yet. Add a name, date, time, and budget first.')
        }
      }

      const response = await fetch('/api/integrations/eventbrite/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ eventId: resolvedEventId }),
      })
      const result = await response.json()

      if (!response.ok || (!result.authUrl && !result.connected)) {
        throw new Error(result.error || 'Failed to start Eventbrite connection')
      }

      if (result.connected) {
        addToast({
          title: 'Eventbrite connected',
          description: 'Your account-level Eventbrite connection is ready for this event.',
        })
        await loadIntegration()
        setIsConnecting(false)
        return
      }

      window.location.href = result.authUrl
    } catch (error) {
      addToast({
        title: 'Could not connect Eventbrite',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
      setIsConnecting(false)
    }
  }

  /**
   * Links the current 3rdPlace event to the selected Eventbrite event.
   */
  const handleLink = async () => {
    if (!integration?.id || !selectedEventbriteEventId) return

    setIsLinking(true)
    try {
      const response = await fetch('/api/integrations/eventbrite/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          integrationId: integration.id,
          eventbriteEventId: selectedEventbriteEventId,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to link Eventbrite event')
      }

      addToast({
        title: 'Eventbrite event linked',
        description: 'You can import attendance data whenever you are ready.',
      })

      await loadIntegration()
    } catch (error) {
      addToast({
        title: 'Could not link Eventbrite event',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLinking(false)
    }
  }

  /**
   * Imports attendees and check-in data from the linked Eventbrite event.
   */
  const handleImport = async () => {
    if (!integration?.id) return

    setIsImporting(true)
    try {
      const response = await fetch('/api/integrations/eventbrite/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ integrationId: integration.id }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to import attendees')
      }

      if (result.queued) {
        setImportSummary(null)
        addToast({
          title: 'Import queued',
          description: result.message || 'Attendance data will update in the background.',
        })
        await loadIntegration()
        return
      }

      setImportSummary(result as ImportSummary)
      addToast({
        title: 'Attendees imported',
        description: result.message || 'Attendance data is now available for kickback calculations.',
      })
      await loadImportedAttendees(integration.id)
      await loadIntegration()
    } catch (error) {
      addToast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }

  const linkedEventName = integration?.config?.eventbrite_event?.name
  const statusLabel = useMemo(() => {
    if (!integration?.sync_status) return 'Not connected'
    return integration.sync_status.charAt(0).toUpperCase() + integration.sync_status.slice(1)
  }, [integration?.sync_status])

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-sidebar-accent/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Ticketing & Attendance</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Ticket platform API and webhook setup now happens during builder signup. Use this event panel to link the external event and import attendance data.
          </p>
        </div>
        <div className="rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          {statusLabel}
        </div>
      </div>

      {!canUseIntegration ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-300">
          Save the event first, then return here to link the external ticketing event and import attendees.
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Eventbrite connection...
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={handleConnect} disabled={(!canUseIntegration && !ensureEventReady) || isConnecting || isImporting || isLinking}>
              {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              {integration ? 'Reconnect Eventbrite' : 'Connect Eventbrite'}
            </Button>

            {integration?.id ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => loadEventbriteEvents(integration.id)}
                disabled={isConnecting || isImporting || isLinking}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Events
              </Button>
            ) : null}
          </div>

          {integration?.sync_status === 'connected' || integration?.sync_status === 'linked' || integration?.sync_status === 'completed' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-foreground">Choose your Eventbrite event</label>
                <select
                  value={selectedEventbriteEventId}
                  onChange={(event) => setSelectedEventbriteEventId(event.target.value)}
                  className="flex h-11 w-full rounded-xl border border-border bg-card/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select an Eventbrite event</option>
                  {availableEvents.map((eventbriteEvent) => (
                    <option key={eventbriteEvent.id} value={eventbriteEvent.id}>
                      {eventbriteEvent.name} {eventbriteEvent.start ? `- ${new Date(eventbriteEvent.start).toLocaleDateString()}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLink}
                  disabled={!selectedEventbriteEventId || !integration?.id || isLinking || isImporting}
                >
                  {isLinking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Link Selected Event
                </Button>

                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={!integration?.id || !integration.external_event_id || isImporting || isLinking}
                >
                  {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Import Attendees
                </Button>
              </div>
            </div>
          ) : null}

          {linkedEventName ? (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-foreground">
              <p className="font-medium text-foreground">Linked Eventbrite event</p>
              <p className="mt-1">{linkedEventName}</p>
            </div>
          ) : null}

          {importSummary ? (
            <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Latest import</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <SummaryStat label="Imported" value={importSummary.imported} />
                <SummaryStat label="Updated" value={importSummary.updated} />
                <SummaryStat label="Checked In" value={importSummary.checked_in} />
              </div>
            </div>
          ) : null}

          {attendeePreview.length > 0 ? (
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Imported attendee preview</p>
                <p className="text-xs text-muted-foreground">Latest 10 records</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Email</th>
                      <th className="py-2 pr-4 font-medium">Ticket</th>
                      <th className="py-2 pr-4 font-medium">Check-in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {attendeePreview.map((attendee) => (
                      <tr key={attendee.id} className="text-foreground">
                        <td className="py-2 pr-4">
                          {[attendee.first_name, attendee.last_name].filter(Boolean).join(' ') || 'Guest'}
                        </td>
                        <td className="py-2 pr-4">{attendee.email || 'No email'}</td>
                        <td className="py-2 pr-4">{attendee.ticket_type || 'General admission'}</td>
                        <td className="py-2 pr-4">
                          {attendee.checked_in
                            ? attendee.check_in_time
                              ? new Date(attendee.check_in_time).toLocaleString()
                              : 'Checked in'
                            : 'Not checked in'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-foreground">Webhook activity</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Posh and Luma webhook endpoint setup lives in builder signup. Incoming activity appears here after an event is linked and a webhook is received.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <WebhookStatusCard
                label="Posh"
                integration={webhookIntegrations.posh}
              />
              <WebhookStatusCard
                label="Luma"
                integration={webhookIntegrations.luma}
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function WebhookStatusCard({
  label,
  integration,
}: {
  label: string
  integration: IntegrationRecord | null
}) {
  const statusLabel = integration?.sync_status
    ? integration.sync_status.charAt(0).toUpperCase() + integration.sync_status.slice(1)
    : 'Not connected'

  return (
    <div className="space-y-3 rounded-xl border border-border bg-sidebar-accent/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <p className="font-medium text-foreground">{label}</p>
          </div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">{statusLabel}</p>
        </div>
        {integration ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {integration
          ? `${label} is linked for this event.`
          : `${label} has no webhook activity linked to this event yet.`}
      </p>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-sidebar-accent/40 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}
