/**
 * Ticketing connection panel for planner RSVP and sales sync.
 *
 * This is an MVP setup surface: Eventbrite can use the existing OAuth route,
 * Luma/Posh create account-level webhook placeholders, and Partiful supports
 * event-link import until a stronger API integration exists.
 */
'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Link2, Loader2, Ticket, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TICKET_PLATFORM_OPTIONS, type TicketPlatform } from '@/lib/constants/account-setup'
import { cn } from '@/lib/utils'

type TicketingConnectionStatus = 'connected' | 'pending' | 'setup_required' | 'failed' | 'linked'

interface TicketingConnection {
  id: string
  platform: TicketPlatform
  status: TicketingConnectionStatus | string
  account_label: string | null
  external_account_id: string | null
  webhook_url: string | null
  last_connected_at: string | null
  last_error: string | null
  config?: Record<string, unknown> | null
}

interface PlannerTicketingConnectPanelProps {
  /** Compact mode is designed for the Live Plan side panel. */
  mode?: 'compact' | 'full'
  /** Whether the current plan appears to need ticketing or RSVP sync. */
  ticketed?: boolean
  /** Optional className for shell layout integration. */
  className?: string
}

interface TicketAnalyticsRollup {
  platform: string
  ticket_tier_category: string
  ticket_tier_name: string
  tickets_sold: number
  gross_revenue_cents: number
  net_revenue_cents: number
  average_ticket_price_cents: number
}

interface TicketAnalyticsPayload {
  summary: {
    tickets_sold: number
    gross_revenue_cents: number
    net_revenue_cents: number
    average_ticket_price_cents: number
  }
  rollups: TicketAnalyticsRollup[]
}

interface TicketingConnectionsQueryResult {
  connections: TicketingConnection[]
  emptyMessage: string | null
}

interface TicketAnalyticsQueryResult {
  analytics: TicketAnalyticsPayload | null
  emptyMessage: string | null
}

const platformCopy: Record<TicketPlatform, { label: string; description: string; mode: string }> = {
  eventbrite: {
    label: 'Eventbrite',
    description: 'OAuth connection for ticket sales, attendee imports, and event linking.',
    mode: 'OAuth + imports',
  },
  luma: {
    label: 'Luma',
    description: 'Webhook endpoint for RSVPs, ticket registrations, and attendance updates.',
    mode: 'Webhook sync',
  },
  posh: {
    label: 'Posh',
    description: 'Webhook endpoint for orders, refunds, attendee counts, and sales analytics.',
    mode: 'Webhook sync',
  },
  partiful: {
    label: 'Partiful',
    description: 'Paste an event link for import-only RSVP tracking until API access is available.',
    mode: 'Event link import',
  },
}

async function fetchTicketingConnections(): Promise<TicketingConnectionsQueryResult> {
  const response = await fetch('/api/integrations/ticketing/connections')
  const payload = await response.json().catch(() => ({}))

  if (response.status === 401 || response.status === 403) {
    return {
      connections: [],
      emptyMessage: 'Sign in as an event creator to save ticketing connections.',
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to load ticketing connections')
  }

  return {
    connections: (payload.connections ?? []) as TicketingConnection[],
    emptyMessage: null,
  }
}

async function fetchTicketingAnalytics(): Promise<TicketAnalyticsQueryResult> {
  const response = await fetch('/api/planner/ticketing/analytics')
  const payload = await response.json().catch(() => ({}))

  if (response.status === 401 || response.status === 403) {
    return {
      analytics: null,
      emptyMessage: 'Ticket analytics appear after sales or RSVP data is imported.',
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to load ticketing analytics')
  }

  return {
    analytics: payload as TicketAnalyticsPayload,
    emptyMessage: null,
  }
}

/**
 * Renders ticketing platform connection status and setup actions.
 */
export function PlannerTicketingConnectPanel({
  mode = 'full',
  ticketed = false,
  className,
}: PlannerTicketingConnectPanelProps) {
  const queryClient = useQueryClient()
  const [activePlatform, setActivePlatform] = useState<TicketPlatform>('luma')
  const [eventUrl, setEventUrl] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [pendingPlatform, setPendingPlatform] = useState<TicketPlatform | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const connectionsQuery = useQuery({
    queryKey: ['ticketing-connections'],
    queryFn: fetchTicketingConnections,
    retry: false,
    staleTime: 60_000,
  })
  const analyticsQuery = useQuery({
    queryKey: ['planner-ticketing-analytics'],
    queryFn: fetchTicketingAnalytics,
    retry: false,
    staleTime: 60_000,
  })

  const connections = connectionsQuery.data?.connections ?? []
  const isLoading = connectionsQuery.isLoading
  const connectionLoadMessage =
    connectionsQuery.data?.emptyMessage ??
    (connectionsQuery.isError
      ? 'Ticketing connections load after the planner is saved to an event creator account.'
      : null)
  const showConnectionsEmptyState = !connectionsQuery.isLoading && connections.length === 0 && Boolean(connectionLoadMessage)
  const analytics = analyticsQuery.data?.analytics ?? null
  const analyticsError =
    analyticsQuery.data?.emptyMessage ??
    (analyticsQuery.isError ? 'Ticket analytics appear after sales or RSVP data is imported.' : null)

  const connectedCount = useMemo(
    () => connections.filter((connection) => isConnectedStatus(connection.status)).length,
    [connections]
  )
  const selectedConnection = connections.find((connection) => connection.platform === activePlatform) ?? null

  async function handleConnect(platform: TicketPlatform) {
    setPendingPlatform(platform)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      if (platform === 'eventbrite') {
        const response = await fetch('/api/integrations/eventbrite/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const payload = await response.json()
        if (response.status === 401 || response.status === 403) {
          throw new Error('Sign in as an event creator to connect Eventbrite.')
        }
        if (!response.ok) throw new Error(payload?.error ?? 'Unable to start Eventbrite OAuth')

        if (typeof payload.authUrl === 'string') {
          window.open(payload.authUrl, '_blank', 'noopener,noreferrer')
        }

        setSuccessMessage('Eventbrite OAuth opened in a new tab.')
        return
      }

      const response = await fetch('/api/integrations/ticketing/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          accountLabel: accountLabel.trim() || platformCopy[platform].label,
          externalAccountId: eventUrl.trim() || undefined,
          eventUrl: eventUrl.trim() || undefined,
          webhookSecret: webhookSecret.trim() || undefined,
        }),
      })
      const payload = await response.json()
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sign in as an event creator to save ticketing connections.')
      }
      if (!response.ok) throw new Error(payload?.error ?? `Unable to connect ${platformCopy[platform].label}`)

      const nextConnection = payload.connection as TicketingConnection
      queryClient.setQueryData<TicketingConnectionsQueryResult>(['ticketing-connections'], (current) => ({
        emptyMessage: null,
        connections: [
          ...(current?.connections ?? connections).filter((connection) => connection.platform !== nextConnection.platform),
          nextConnection,
        ],
      }))
      setSuccessMessage(
        platform === 'partiful'
          ? 'Partiful link saved for import tracking.'
          : `${platformCopy[platform].label} webhook endpoint created.`
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save ticketing connection')
    } finally {
      setPendingPlatform(null)
    }
  }

  return (
    <div
      className={cn(
        mode === 'full'
          ? 'rounded-2xl border border-border bg-card/60 p-5 shadow-card'
          : 'space-y-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Ticketing & RSVP</p>
          <h3 className={cn('font-display font-bold text-foreground', mode === 'full' ? 'mt-1 text-xl' : 'mt-1 text-base')}>
            {connectedCount > 0 ? `${connectedCount} platform${connectedCount === 1 ? '' : 's'} connected` : 'Connect a ticketing platform'}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {ticketed
              ? 'Sync RSVPs, ticket sales, check-ins, and historical benchmarks once the plan is ready to publish.'
              : 'Optional. Add this when you want RSVP pages, sales analytics, or attendee imports.'}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {connectedCount > 0 ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections
        </div>
      ) : showConnectionsEmptyState ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-background/60 px-4 py-5 text-sm text-muted-foreground">
          {connectionLoadMessage}
        </div>
      ) : (
        <>
          <div className={cn('mt-4 grid gap-2', mode === 'full' ? 'md:grid-cols-4' : 'grid-cols-2')}>
            {TICKET_PLATFORM_OPTIONS.map((platform) => {
              const connection = connections.find((item) => item.platform === platform.id)
              const selected = activePlatform === platform.id
              return (
                <button
                  key={platform.id}
                  type="button"
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition-smooth',
                    selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setActivePlatform(platform.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{platform.label}</span>
                    {connection ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
                  </span>
                  <span className="mt-1 block text-[11px]">{connection ? formatStatus(connection.status) : platformCopy[platform.id].mode}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-bold text-foreground">{platformCopy[activePlatform].label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{platformCopy[activePlatform].description}</p>
              </div>
              {selectedConnection ? (
                <span className="shrink-0 rounded-full bg-success/10 px-2 py-1 text-[11px] font-bold text-success">
                  {formatStatus(selectedConnection.status)}
                </span>
              ) : null}
            </div>

            {activePlatform !== 'eventbrite' ? (
              <div className="mt-4 space-y-3">
                <Input
                  value={accountLabel}
                  onChange={(event) => setAccountLabel(event.target.value)}
                  placeholder={`${platformCopy[activePlatform].label} account or event label`}
                />
                <Input
                  value={eventUrl}
                  onChange={(event) => setEventUrl(event.target.value)}
                  placeholder={activePlatform === 'partiful' ? 'Paste Partiful event link' : 'Optional event URL or account id'}
                />
                {activePlatform === 'luma' || activePlatform === 'posh' ? (
                  <Input
                    value={webhookSecret}
                    onChange={(event) => setWebhookSecret(event.target.value)}
                    placeholder="Optional webhook secret"
                    type="password"
                  />
                ) : null}
              </div>
            ) : null}

            {selectedConnection?.webhook_url ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Webhook URL</p>
                <p className="mt-1 break-all">{selectedConnection.webhook_url}</p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant={activePlatform === 'eventbrite' ? 'hero' : 'glass'}
                size={mode === 'full' ? 'default' : 'sm'}
                onClick={() => handleConnect(activePlatform)}
                disabled={pendingPlatform !== null}
              >
                {pendingPlatform === activePlatform ? <Loader2 className="h-4 w-4 animate-spin" /> : activePlatform === 'eventbrite' ? <ExternalLink className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {activePlatform === 'eventbrite' ? 'Connect Eventbrite' : activePlatform === 'partiful' ? 'Save Partiful link' : `Set up ${platformCopy[activePlatform].label}`}
              </Button>
              {selectedConnection?.last_error ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
                  <WifiOff className="h-3.5 w-3.5" />
                  Needs attention
                </span>
              ) : null}
            </div>
          </div>
        </>
      )}

      {successMessage ? <p className="mt-3 text-sm font-semibold text-success">{successMessage}</p> : null}
      {connectionLoadMessage && !showConnectionsEmptyState ? (
        <p className="mt-3 text-sm font-semibold text-muted-foreground">{connectionLoadMessage}</p>
      ) : null}
      {errorMessage ? <p className="mt-3 text-sm font-semibold text-destructive">{errorMessage}</p> : null}

      {mode === 'full' ? (
        <>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-3">
            <InfoTile icon={<Ticket className="h-4 w-4" />} title="Live metrics" body="RSVPs, sales, check-ins, refunds, and attendee counts." />
            <InfoTile icon={<CheckCircle2 className="h-4 w-4" />} title="Agent context" body="Planner can use your past show-up rates and conversion benchmarks." />
            <InfoTile icon={<Link2 className="h-4 w-4" />} title="Flexible import" body="OAuth where possible, webhook setup for Luma/Posh, link import for Partiful." />
          </div>
          <TicketAnalyticsPreview analytics={analytics} error={analyticsError} />
        </>
      ) : null}
    </div>
  )
}

function TicketAnalyticsPreview({
  analytics,
  error,
}: {
  analytics: TicketAnalyticsPayload | null
  error: string | null
}) {
  const topRollups = analytics?.rollups.slice(0, 5) ?? []

  return (
    <div className="mt-5 rounded-2xl border border-border bg-background/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Ticket Sales Breakdown</p>
          <h4 className="mt-1 font-display text-lg font-bold text-foreground">Early Bird, GA, VIP, and more</h4>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          Normalized
        </span>
      </div>

      {analytics ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricTile label="Tickets sold" value={String(analytics.summary.tickets_sold)} />
            <MetricTile label="Gross" value={formatTicketCents(analytics.summary.gross_revenue_cents)} />
            <MetricTile label="Avg ticket" value={formatTicketCents(analytics.summary.average_ticket_price_cents)} />
          </div>

          {topRollups.length > 0 ? (
            <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
              {topRollups.map((rollup) => (
                <div key={`${rollup.platform}-${rollup.ticket_tier_category}-${rollup.ticket_tier_name}`} className="flex items-center justify-between gap-3 bg-card/40 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground" title={rollup.ticket_tier_name}>
                      {formatTierCategory(rollup.ticket_tier_category)} · {rollup.ticket_tier_name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {rollup.platform} · {rollup.tickets_sold} sold · avg {formatTicketCents(rollup.average_ticket_price_cents)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-foreground">{formatTicketCents(rollup.gross_revenue_cents)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No tiered sales imported yet. Connect Eventbrite, Luma, or Posh to populate Early Bird, GA, VIP, comp, and refund rollups.
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          {error ?? 'Ticket analytics load after a creator account has connected a ticketing source.'}
        </p>
      )}
    </div>
  )
}

function InfoTile({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 truncate font-display text-xl font-bold text-foreground" title={value}>{value}</p>
    </div>
  )
}

function isConnectedStatus(status: string) {
  return status === 'connected' || status === 'linked' || status === 'completed'
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ')
}

function formatTicketCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function formatTierCategory(value: string) {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
