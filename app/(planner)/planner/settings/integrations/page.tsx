'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, Loader2, Mail, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

        <Card className="border-border/70 bg-card shadow-sm">
          <CardHeader className="border-b border-border">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl">Gmail</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Creator sender for approved venue and vendor outreach.
                  </p>
                </div>
              </div>
              {account ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            {isLoading ? (
              <div className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading Gmail connection
              </div>
            ) : account ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{account.email_address}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connected {formatDate(account.created_at)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild>
                    <Link href="/planner/outreach">
                      <Mail className="h-4 w-4" />
                      Review outreach approvals
                    </Link>
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnect} disabled={isDisconnecting}>
                    {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-sm text-muted-foreground">
                  Connect Gmail before sending approved outreach drafts or reading partner replies.
                </p>
                <Button asChild>
                  <Link href="/api/integrations/gmail/connect?returnTo=/planner/outreach">
                    <ExternalLink className="h-4 w-4" />
                    Connect Gmail
                  </Link>
                </Button>
              </div>
            )}
            {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
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
