'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Ticket, UploadCloud, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EventbriteEventImportWizard } from '@/components/planner/EventbriteEventImportWizard'
import { cn } from '@/lib/utils'

type EventbriteStatus = 'not_connected' | 'pending' | 'connected' | 'failed' | 'disabled'

type EventbriteConnectionState = {
  status: EventbriteStatus
  connected: boolean
  webhookUrl: string | null
  hasWebhookSecret: boolean
  lastConnectedAt: string | null
  lastEventReceivedAt: string | null
  lastWebhookEventType: string | null
  lastError: string | null
}

type EventbriteStateResponse = {
  connection?: EventbriteConnectionState
  error?: string
}

type PlannerTicketingImportSectionProps = {
  className?: string
}

const defaultConnection: EventbriteConnectionState = {
  status: 'not_connected',
  connected: false,
  webhookUrl: null,
  hasWebhookSecret: false,
  lastConnectedAt: null,
  lastEventReceivedAt: null,
  lastWebhookEventType: null,
  lastError: null,
}

/**
 * Shows Eventbrite's event-level import workflow only after OAuth is connected.
 * Disconnected organizers get ticket-source setup instructions instead of an
 * unusable list/import panel.
 */
export function PlannerTicketingImportSection({ className }: PlannerTicketingImportSectionProps) {
  const [connection, setConnection] = useState<EventbriteConnectionState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadConnection = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/integrations/eventbrite/backfill', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as EventbriteStateResponse

      if (response.status === 401 || response.status === 403) {
        setConnection(defaultConnection)
        setErrorMessage('Sign in as an event creator to connect ticketing sources.')
        return
      }

      if (!response.ok) throw new Error(payload.error ?? 'Unable to load Eventbrite connection')

      setConnection(payload.connection ?? defaultConnection)
    } catch (error) {
      setConnection(defaultConnection)
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load Eventbrite connection')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConnection()
  }, [loadConnection])

  if (isLoading) {
    return (
      <section className={cn('rounded-lg border border-tan bg-cream p-5 shadow-card', className)}>
        <div className="flex min-h-36 items-center justify-center text-sm text-ink-soft">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Checking ticketing sources
        </div>
      </section>
    )
  }

  if (connection?.connected) {
    return <EventbriteEventImportWizard className={className} />
  }

  return (
    <section id="ticketing-import-setup" className={cn('space-y-5 rounded-lg border border-tan bg-cream p-5 shadow-card', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="label-caps text-clay">Ticket data import</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink">Connect a source before importing</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Eventbrite event selection appears here after OAuth is connected. Until then, connect Eventbrite, set up Posh webhooks, or import CSV data from your ticketing platform.
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-tan px-3 py-1 text-sm font-medium text-ink-soft">
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Eventbrite not connected
        </span>
      </div>

      {connection?.lastError ? <StatusMessage tone="error" message={connection.lastError} /> : null}
      {errorMessage ? <StatusMessage tone="neutral" message={errorMessage} /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <SetupPath
          icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
          eyebrow="Eventbrite"
          title="Connect with OAuth"
          body="Use this when you own the event in Eventbrite. After connecting, return to Tickets to select the exact event, verify it, and queue the import."
          href="/planner/integrations/eventbrite"
          action="Connect Eventbrite"
        />
        <SetupPath
          icon={<Webhook className="h-4 w-4" aria-hidden="true" />}
          eyebrow="Posh"
          title="Set up webhook sync"
          body="Open Posh settings, paste the 3rdPlace webhook URL, save the Posh-Secret, send a test webhook, then link incoming events."
          href="/planner/integrations/posh"
          action="Open Posh setup"
        />
        <SetupPath
          icon={<UploadCloud className="h-4 w-4" aria-hidden="true" />}
          eyebrow="CSV or manual"
          title="Import files directly"
          body="Use attendee and sales CSVs from Posh, Luma, Eventbrite, Partiful, or another ticketing source when an API connection is not ready."
          href="/planner/events/import"
          action="Import CSV data"
        />
      </div>
    </section>
  )
}

function SetupPath({
  icon,
  eyebrow,
  title,
  body,
  href,
  action,
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  body: string
  href: string
  action: string
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-tan bg-cream-deep/60 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-clay">
        {icon}
        {eyebrow}
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-soft">{body}</p>
      <Button asChild variant="outline" className="mt-4 w-full">
        <Link href={href}>
          {action}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  )
}

function StatusMessage({ tone, message }: { tone: 'error' | 'neutral'; message: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm font-medium',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'neutral' && 'border-tan bg-cream-deep text-ink-soft'
      )}
    >
      {message}
    </div>
  )
}
