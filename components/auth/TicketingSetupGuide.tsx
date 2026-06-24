'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, Film, Link2, Loader2, Ticket, Upload, Webhook } from 'lucide-react'
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
    icon: Webhook,
    videoLabel: 'Posh webhook how-to video',
  },
  luma: {
    title: 'Luma webhook',
    eyebrow: 'Registration activity',
    description: 'Use this endpoint when Luma asks where to send ticket registration updates.',
    urlLabel: 'Webhook endpoint',
    getUrl: (origin) => `${origin}/api/webhooks/luma`,
    steps: [
      'Paste the endpoint into Luma webhook settings.',
      'Keep the Luma event id available; you will use it when linking a 3rdPlace event.',
      'Send a test webhook after your event is linked.',
    ],
    icon: Webhook,
    videoLabel: 'Luma webhook how-to video',
  },
  partiful: {
    title: 'Partiful event link',
    eyebrow: 'Event link import',
    description: 'Paste a Partiful event link from Tickets when the event page exists. 3rdPlace uses it for RSVP context and manual import checks.',
    urlLabel: 'Event link',
    steps: [
      'Create your 3rdPlace account first so the ticketing preference is saved.',
      'Paste the Partiful event link from Tickets after the event page is live.',
      'Import or confirm RSVP totals so the planner can compare attendance and sales history.',
    ],
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
                      <p className="text-sm font-semibold text-foreground">Saved from Tickets later</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Partiful uses an event link import path today. After signup, paste the live Partiful URL in Tickets so 3rdPlace can keep the event brief aligned with RSVP activity.
                      </p>
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
