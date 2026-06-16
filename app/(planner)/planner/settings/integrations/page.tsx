'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, Loader2, Mail, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'

type GmailAccount = {
  id: string
  provider: 'gmail'
  email_address: string
  token_expires_at: string | null
  created_at: string
}

export default function PlannerIntegrationsPage() {
  const [account, setAccount] = useState<GmailAccount | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAccount = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/integrations/gmail/account', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load integrations')
      setAccount(payload.account ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load integrations')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccount()
  }, [loadAccount])

  async function disconnect() {
    setIsDisconnecting(true)
    setError(null)

    try {
      const response = await fetch('/api/integrations/gmail/account', { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to disconnect Gmail')
      setAccount(null)
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect Gmail')
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Settings</p>
          <h1 className="font-display text-3xl font-semibold text-foreground">Integrations</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect tools that let 3rdPlace send approved outreach and read partner replies from your creator account.
          </p>
        </div>

        <section className="rounded-md border border-tan bg-cream p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-[22px] font-semibold leading-tight text-ink">Gmail</h2>
                  {account ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-forest/20 bg-forest/10 px-2.5 py-1 text-xs font-semibold text-forest">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected
                    </span>
                  ) : (
                    <span className="rounded-full border border-tan bg-cream-deep px-2.5 py-1 text-xs font-semibold text-ink-soft">
                      Not connected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  Used to send approved outreach and read replies into your event plan. We never read your general inbox.
                </p>
                {account ? (
                  <p className="mt-2 text-sm font-semibold text-ink">{account.email_address}</p>
                ) : null}
              </div>
            </div>

            <div className="sm:pt-1">
              {isLoading ? (
                <div className="flex min-h-10 items-center gap-3 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading
                </div>
              ) : account ? (
                <Button type="button" variant="outline" onClick={disconnect} disabled={isDisconnecting}>
                  {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                  Disconnect
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/api/integrations/gmail/connect?returnTo=/planner/settings/integrations">
                    <ExternalLink className="h-4 w-4" />
                    Connect
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {isLoading ? null : account ? (
            <p className="mt-3 text-xs text-ink-faint">Connected {formatDate(account.created_at)}</p>
          ) : null}

          {error ? <p className="mt-4 text-sm font-semibold text-destructive">{error}</p> : null}
        </section>
      </div>
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
