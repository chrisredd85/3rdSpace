'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, FileSpreadsheet, Film, Link2, Loader2, Ticket, Upload, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type TicketingPlatform = 'eventbrite' | 'posh' | 'luma' | 'partiful'

const platformAliases: Record<string, TicketingPlatform> = {
  eventbrite: 'eventbrite',
  posh: 'posh',
  luma: 'luma',
  partiful: 'partiful',
}

const setupCards: Record<
  TicketingPlatform,
  {
    title: string
    eyebrow: string
    description: string
    urlLabel?: string
    getUrl?: (origin: string) => string
    steps: string[]
    csvInstructions: string[]
    csvNote?: string
    uploadSource: TicketingPlatform
    icon: typeof Ticket
    videoLabel: string
  }
> = {
  eventbrite: {
    title: 'Eventbrite account',
    eyebrow: 'OAuth connection',
    description: 'Connect your Eventbrite account once. You will choose the matching Eventbrite event later from each 3rdPlace event.',
    steps: [
      'Create your 3rdPlace account first so the Eventbrite connection can be saved securely.',
      'Authorize Eventbrite when prompted.',
      'Choose the matching Eventbrite event before importing attendees.',
    ],
    csvInstructions: [
      'Open the Eventbrite event dashboard.',
      'Go to Manage attendees or Orders and exports.',
      'Export attendees or orders as CSV for historical sales, refunds, and check-ins.',
    ],
    csvNote: 'Use CSV when OAuth is not connected yet or when importing older Eventbrite events.',
    uploadSource: 'eventbrite',
    icon: Ticket,
    videoLabel: 'Eventbrite how-to video',
  },
  posh: {
    title: 'Posh webhook',
    eyebrow: 'Sales + refund activity',
    description: 'Use this endpoint when Posh asks where to send order and ticket activity.',
    urlLabel: 'Webhook endpoint',
    getUrl: (origin) => `${origin}/api/webhooks/posh`,
    steps: [
      'Paste the endpoint into Posh webhook settings.',
      'Keep the Posh event id available; you will use it when linking a 3rdPlace event.',
      'Send a test webhook after your event is linked.',
    ],
    csvInstructions: [
      'Open the Posh event dashboard.',
      'Use the ticket or reporting export for attendee and order CSV files.',
      'Upload the CSV to backfill sales, refunds, and attendance if webhook history is incomplete.',
    ],
    csvNote: 'Webhook sync handles new activity; CSV fills older or missing event history.',
    uploadSource: 'posh',
    icon: Webhook,
    videoLabel: 'Posh webhook how-to video',
  },
  luma: {
    title: 'Luma webhook + API refresh',
    eyebrow: 'Registration + RSVP activity',
    description: 'Use the webhook for live registrations. 3rdPlace can also refresh RSVP counts through the Luma API when a linked event id is available.',
    urlLabel: 'Webhook endpoint',
    getUrl: (origin) => `${origin}/api/webhooks/luma`,
    steps: [
      'Paste the endpoint into Luma webhook settings.',
      'Keep the Luma event API id available; it lets 3rdPlace refresh RSVP counts when needed.',
      'Send a test webhook or import a guest list after your event is linked.',
    ],
    csvInstructions: [
      'Open the Luma event guest list.',
      'Export guests or registrations as CSV.',
      'Upload the guest list to backfill RSVPs, ticket tiers, and attendance snapshots.',
    ],
    csvNote: 'Luma supports live webhook intake in 3rdPlace, and the event report can poll Luma for RSVP counts when API credentials are configured.',
    uploadSource: 'luma',
    icon: Webhook,
    videoLabel: 'Luma webhook how-to video',
  },
  partiful: {
    title: 'Partiful CSV / event link',
    eyebrow: 'CSV-first RSVP import',
    description: 'Partiful setup is CSV and event-link first. 3rdPlace has an advanced webhook endpoint, but most hosts should import the guest list CSV from Partiful.',
    urlLabel: 'Advanced webhook endpoint',
    getUrl: (origin) => `${origin}/api/webhooks/partiful`,
    steps: [
      'Create your 3rdPlace account first so the ticketing preference is saved.',
      'Paste the Partiful event link from Tickets after the event page is live.',
      'Export the Partiful guest list CSV and upload it so the planner can compare RSVP history.',
    ],
    csvInstructions: [
      'Open the Partiful event and go to the Guest List.',
      'Use Export CSV, then choose the RSVP types you want included.',
      'Upload the CSV to 3rdPlace for historical RSVPs, names, and check-in context.',
    ],
    csvNote: 'Only use the webhook endpoint if Partiful exposes webhook settings for your account. CSV import remains the default path.',
    uploadSource: 'partiful',
    icon: Link2,
    videoLabel: 'Partiful import how-to video',
  },
}

function normalizePlatforms(selectedPlatforms: string[]) {
  const normalized = selectedPlatforms
    .map((platform) => platformAliases[platform.toLowerCase()])
    .filter((platform): platform is TicketingPlatform => Boolean(platform))

  return Array.from(new Set(normalized))
}

export function TicketingSetupGuide({
  selectedPlatforms,
  className,
  persistConnections = false,
  compact = false,
}: {
  selectedPlatforms: string[]
  className?: string
  persistConnections?: boolean
  compact?: boolean
}) {
  const { addToast } = useToast()
  const [origin, setOrigin] = useState('')
  const [connectionUrls, setConnectionUrls] = useState<Partial<Record<TicketingPlatform, string>>>({})
  const [isConnectingEventbrite, setIsConnectingEventbrite] = useState(false)
  const platforms = useMemo(() => normalizePlatforms(selectedPlatforms), [selectedPlatforms])

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!persistConnections || platforms.length === 0) return

    let isCurrent = true

    async function saveConnections() {
      const results = await Promise.all(
        platforms.map(async (platform) => {
          const response = await fetch('/api/integrations/ticketing/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ platform }),
          })

          if (response.status === 401 || response.status === 403) return null
          const result = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(result?.error || 'Failed to save ticketing setup')
          }

          return {
            platform,
            webhookUrl: typeof result?.webhookUrl === 'string' ? result.webhookUrl : null,
          }
        })
      )

      if (!isCurrent) return

      setConnectionUrls((current) => {
        const next = { ...current }
        results.forEach((result) => {
          if (result?.webhookUrl) {
            next[result.platform] = result.webhookUrl
          }
        })
        return next
      })
    }

    saveConnections().catch((error) => {
      addToast({
        title: 'Could not save ticketing setup',
        description: error instanceof Error ? error.message : 'Please try again later.',
        variant: 'destructive',
      })
    })

    return () => {
      isCurrent = false
    }
  }, [addToast, persistConnections, platforms])

  if (platforms.length === 0) return null

  async function copySetupUrl(platform: TicketingPlatform) {
    const setup = setupCards[platform]
    const setupUrl = connectionUrls[platform] || setup.getUrl?.(origin)
    if (!setupUrl) return

    try {
      await navigator.clipboard.writeText(setupUrl)
      addToast({
        title: 'Setup URL copied',
        description: `${setupCards[platform].title} setup URL is ready to paste.`,
      })
    } catch {
      addToast({
        title: 'Could not copy URL',
        description: 'Select the URL and copy it manually.',
        variant: 'destructive',
      })
    }
  }

  async function connectEventbrite() {
    setIsConnectingEventbrite(true)
    try {
      const response = await fetch('/api/integrations/eventbrite/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const result = await response.json().catch(() => null)

      if (response.status === 401 || response.status === 403) {
        addToast({
          title: 'Create your account first',
          description: 'Eventbrite connects after your builder account exists so the OAuth tokens can be saved securely.',
        })
        return
      }

      if (!response.ok || !result?.authUrl) {
        throw new Error(result?.error || 'Could not start Eventbrite connection')
      }

      window.location.href = result.authUrl
    } catch (error) {
      addToast({
        title: 'Could not connect Eventbrite',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsConnectingEventbrite(false)
    }
  }

  return (
    <div className={cn('space-y-3 rounded-2xl border border-primary/20 bg-primary/10 p-3 sm:p-4', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow sm:h-10 sm:w-10">
          <Ticket className="h-4 w-4 text-primary-foreground sm:h-5 sm:w-5" />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-foreground">Ticket platform setup</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Configure the selected platforms now. Event-specific linking and imports happen later from each event.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {platforms.map((platform) => {
          const setup = setupCards[platform]
          const Icon = setup.icon
          const setupUrl = persistConnections
            ? connectionUrls[platform] || (origin && setup.getUrl ? setup.getUrl(origin) : '')
            : ''

          return (
            <div key={platform} className="rounded-xl border border-border bg-card/40 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent/40 text-primary sm:h-10 sm:w-10">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">{setup.eyebrow}</p>
                    <p className="font-semibold text-foreground">{setup.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{setup.description}</p>
                  </div>
                </div>
                <CheckCircle2 className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
              </div>

              {platform === 'eventbrite' ? (
                <div className="mt-4 rounded-lg border border-primary/20 bg-primary/10 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Account connection</p>
                      <p className="mt-1 text-xs leading-relaxed text-foreground sm:text-sm">
                        Use OAuth to connect Eventbrite directly. No webhook URL is needed for Eventbrite.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="hero"
                      size="sm"
                      onClick={connectEventbrite}
                      disabled={isConnectingEventbrite || !persistConnections}
                    >
                      {isConnectingEventbrite ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                      {persistConnections ? 'Connect Eventbrite' : 'Connect after signup'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">{setup.urlLabel}</p>
                  {platform === 'partiful' ? (
                    <div className="rounded-lg border border-border bg-background/70 px-3 py-3">
                      <p className="text-sm font-semibold text-foreground">Event link and CSV are the default</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Paste the live Partiful URL in Tickets, then upload the Partiful guest list CSV. Use the advanced webhook endpoint only if Partiful exposes webhook settings for your account.
                      </p>
                      {persistConnections && setupUrl ? (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <p className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-foreground">
                            {setupUrl}
                          </p>
                          <Button type="button" variant="outline" size="sm" onClick={() => copySetupUrl(platform)} disabled={!origin || !setupUrl}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : !persistConnections ? (
                    <div className="rounded-lg border border-border bg-background/70 px-3 py-3">
                      <p className="text-sm font-semibold text-foreground">Generated after account creation</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        We create a private {setup.title} endpoint after signup so incoming data is tied to your creator account.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <p className="min-w-0 flex-1 break-all rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-foreground">
                        {setupUrl || 'Loading setup URL...'}
                      </p>
                      <Button type="button" variant="outline" size="sm" onClick={() => copySetupUrl(platform)} disabled={!origin || !setupUrl}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <ul className={cn('mt-4 space-y-2 text-sm text-muted-foreground', compact && 'hidden sm:block')}>
                {setup.steps.map((step) => (
                  <li key={step} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>

              <div className={cn('mt-4 rounded-lg border border-border bg-background/60 p-3', compact && 'hidden sm:block')}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <FileSpreadsheet className="h-4 w-4 text-primary" />
                      Download attendee CSV
                    </div>
                    <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {setup.csvInstructions.map((instruction) => (
                        <li key={instruction} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{instruction}</span>
                        </li>
                      ))}
                    </ul>
                    {setup.csvNote ? (
                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{setup.csvNote}</p>
                    ) : null}
                  </div>
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link href={`/planner/events/import?source=${setup.uploadSource}`}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload historical data via CSV
                    </Link>
                  </Button>
                </div>
              </div>

              <div className={cn('mt-4 rounded-lg border border-dashed border-border bg-background/40 p-3', compact && 'hidden sm:block')}>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Film className="h-4 w-4 text-primary" />
                  {setup.videoLabel}
                </div>
                <div className="mt-3 flex min-h-[88px] items-center justify-center rounded-lg border border-border bg-card/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  <div>
                    <Upload className="mx-auto mb-2 h-5 w-5 text-primary" />
                    Add a tutorial video file here later.
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
