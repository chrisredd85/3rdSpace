'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, Link2, Loader2, PlugZap, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type PoshStatus = 'not_connected' | 'awaiting_test' | 'connected'

type PoshState = {
  orgId: string
  status: PoshStatus
  webhookUrl: string
  lastEventReceivedAt: string | null
  lastWebhookEventType: string | null
  unlinkedEvents: Array<{
    id: string
    external_event_id: string
    webhook_type: string | null
    received_at: string
    linked_event_id: string | null
    payload_preview: Record<string, unknown>
  }>
  events: Array<{
    id: string
    event_name: string
    event_date: string | null
    posh_event_id: string | null
  }>
}

type ApiResponse = PoshState & {
  success?: boolean
  state?: PoshState
  error?: string
}

const statusCopy: Record<PoshStatus, { label: string; className: string }> = {
  not_connected: {
    label: 'Not connected',
    className: 'border-border text-muted-foreground',
  },
  awaiting_test: {
    label: 'Awaiting test',
    className: 'border-amber-600/30 bg-amber-50 text-amber-900',
  },
  connected: {
    label: 'Connected',
    className: 'border-emerald-700/30 bg-emerald-50 text-emerald-900',
  },
}

export function PoshConnectWizard() {
  const [state, setState] = useState<PoshState | null>(null)
  const [secret, setSecret] = useState('')
  const [selectedEventByPoshId, setSelectedEventByPoshId] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [linkingPoshId, setLinkingPoshId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/planner/integrations/posh', { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load Posh connection')
      setState(payload)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load Posh connection')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const status = state?.status ?? 'not_connected'
  const statusMeta = statusCopy[status]
  const lastSeenLabel = useMemo(
    () => state?.lastEventReceivedAt ? relativeTime(state.lastEventReceivedAt) : null,
    [state?.lastEventReceivedAt]
  )

  async function saveSecret() {
    setIsSaving(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/planner/integrations/posh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      const payload = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save Posh secret')
      setState(payload.state ?? payload)
      setSecret('')
      setSuccessMessage('Saved. Send a test webhook from Posh to finish the connection.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save Posh secret')
    } finally {
      setIsSaving(false)
    }
  }

  async function disconnect() {
    setIsDisconnecting(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/planner/integrations/posh', { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to disconnect Posh')
      setState(payload.state ?? payload)
      setSuccessMessage('Posh disconnected.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to disconnect Posh')
    } finally {
      setIsDisconnecting(false)
    }
  }

  async function copyWebhookUrl() {
    if (!state?.webhookUrl) return
    await navigator.clipboard.writeText(state.webhookUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function linkEvent(poshEventId: string) {
    const eventId = selectedEventByPoshId[poshEventId]
    if (!eventId) {
      setErrorMessage('Choose a 3rdPlace event to link.')
      return
    }

    setLinkingPoshId(poshEventId)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const response = await fetch('/api/planner/integrations/posh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link_event',
          event_id: eventId,
          posh_event_id: poshEventId,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as ApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to link Posh event')
      setState(payload.state ?? payload)
      setSuccessMessage('Posh event linked.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to link Posh event')
    } finally {
      setLinkingPoshId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-card/50 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading Posh connection
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-md border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold text-foreground">Connect Posh</h2>
              <p className="text-sm text-muted-foreground">Org-level webhook for orders, fees, and attendance signals.</p>
            </div>
            <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium', statusMeta.className)}>
              {status === 'connected' ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {statusMeta.label}
            </span>
          </div>

          {lastSeenLabel ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Last event received {lastSeenLabel}
              {state?.lastWebhookEventType ? ` · ${state.lastWebhookEventType}` : ''}
            </p>
          ) : null}

          <div className="mt-5 space-y-2">
            <Label htmlFor="posh-webhook-url">Webhook URL</Label>
            <div className="flex gap-2">
              <Input id="posh-webhook-url" value={state?.webhookUrl ?? ''} readOnly />
              <Button type="button" variant="outline" onClick={copyWebhookUrl}>
                <Clipboard className="mr-2 h-4 w-4" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="posh-secret">Posh-Secret</Label>
            <Input
              id="posh-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste from Posh Organization Settings"
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={saveSecret} disabled={isSaving || secret.trim().length < 8}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="mr-2 h-4 w-4" aria-hidden="true" />}
              Save secret
            </Button>
            <Button type="button" variant="outline" onClick={disconnect} disabled={isDisconnecting || status === 'not_connected'}>
              {isDisconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />}
              Disconnect
            </Button>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="font-display text-xl font-semibold text-foreground">Setup</h2>
          <ol className="mt-4 space-y-4">
            <InstructionStep index={1} title="Webhook Endpoint" detail="Paste the copied URL into Posh's webhook endpoint field." />
            <InstructionStep index={2} title="Enable Webhook" detail="Turn on the org webhook so Posh sends order events to 3rdPlace." />
            <InstructionStep index={3} title="Posh-Secret" detail="Paste the secret from Posh here, save, then send a test webhook." />
          </ol>
        </section>
      </div>

      {errorMessage ? (
        <StatusMessage tone="error" message={errorMessage} />
      ) : null}
      {successMessage ? (
        <StatusMessage tone="success" message={successMessage} />
      ) : null}

      <section className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Link these to events</h2>
            <p className="text-sm text-muted-foreground">Verified Posh webhooks land here until their event id is assigned.</p>
          </div>
        </div>

        {state?.unlinkedEvents.length ? (
          <div className="divide-y divide-border">
            {state.unlinkedEvents.map((unlinked) => (
              <div key={unlinked.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
                <div>
                  <p className="font-medium text-foreground">{unlinked.external_event_id}</p>
                  <p className="text-sm text-muted-foreground">
                    {unlinked.webhook_type ?? 'Webhook'} · received {relativeTime(unlinked.received_at)}
                  </p>
                </div>
                <select
                  value={selectedEventByPoshId[unlinked.external_event_id] ?? ''}
                  onChange={(event) => setSelectedEventByPoshId((current) => ({
                    ...current,
                    [unlinked.external_event_id]: event.target.value,
                  }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Choose 3rdPlace event</option>
                  {(state?.events ?? []).map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.event_name}{event.event_date ? ` · ${event.event_date}` : ''}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => linkEvent(unlinked.external_event_id)}
                  disabled={linkingPoshId === unlinked.external_event_id}
                >
                  {linkingPoshId === unlinked.external_event_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Link
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            No unlinked Posh events.
          </div>
        )}
      </section>
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
