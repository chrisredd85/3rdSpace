import type { ReactNode } from 'react'
import { Activity, AlertTriangle, DollarSign, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { OutreachChannel } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ThreadRow = {
  channel: OutreachChannel
  state: string
  last_outbound_at: string | null
  last_inbound_at: string | null
}

type MessageRow = {
  provider_cost_cents: number | null
  sent_at: string | null
}

type ComplianceRow = {
  channel: OutreachChannel
  event_type: string
  severity: string
  created_at: string
}

const CHANNELS: OutreachChannel[] = ['email', 'instagram', 'sms', 'voice']

export default async function AdminOutreachPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isAdminEmail(user.email ?? null)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-muted-foreground">
        Admin access required.
      </div>
    )
  }

  const admin = createServiceRoleClient() as any
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: threadRows }, { data: messageRows }, { data: complianceRows }] = await Promise.all([
    admin
      .from('outreach_threads')
      .select('channel, state, last_outbound_at, last_inbound_at')
      .gte('created_at', since),
    admin
      .from('outreach_messages')
      .select('provider_cost_cents, sent_at')
      .gte('created_at', since),
    admin
      .from('outreach_compliance_events')
      .select('channel, event_type, severity, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const threads = (threadRows ?? []) as ThreadRow[]
  const messages = (messageRows ?? []) as MessageRow[]
  const compliance = (complianceRows ?? []) as ComplianceRow[]
  const channelStats = CHANNELS.map((channel) => buildChannelStats(channel, threads, messages))
  const totalCostCents = messages.reduce((sum, message) => sum + (message.provider_cost_cents ?? 0), 0)

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Outreach Channels</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last 30 days of channel performance and compliance events.</p>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard icon={<Mail className="h-5 w-5" />} label="Threads" value={threads.length.toLocaleString()} />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Replies" value={threads.filter((thread) => thread.last_inbound_at).length.toLocaleString()} />
          <StatCard icon={<DollarSign className="h-5 w-5" />} label="Provider cost" value={formatCents(totalCostCents)} />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Compliance events" value={compliance.length.toLocaleString()} />
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {channelStats.map((stat) => (
            <Card key={stat.channel} className="rounded-md">
              <CardHeader>
                <CardTitle className="text-xl capitalize">{formatChannel(stat.channel)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <InfoRow label="Threads" value={String(stat.threads)} />
                <InfoRow label="Response rate" value={`${Math.round(stat.responseRate * 100)}%`} />
                <InfoRow label="Confirmed" value={String(stat.confirmed)} />
                <InfoRow label="Cost" value={formatCents(stat.costCents)} />
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="rounded-md">
          <CardHeader>
            <CardTitle className="text-xl">Compliance Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {compliance.length === 0 ? (
              <p className="text-sm text-muted-foreground">No compliance events in the last 30 days.</p>
            ) : (
              compliance.map((event) => (
                <div key={`${event.created_at}-${event.event_type}`} className="rounded-2xl border border-border bg-background/45 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{event.event_type.replace(/_/g, ' ')}</p>
                    <span className="rounded-full border border-border bg-sidebar-accent px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      {event.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{formatChannel(event.channel)} · {formatDate(event.created_at)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="rounded-md">
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="font-display text-2xl font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

function buildChannelStats(channel: OutreachChannel, threads: ThreadRow[], messages: MessageRow[]) {
  const channelThreads = threads.filter((thread) => thread.channel === channel)
  const replied = channelThreads.filter((thread) => thread.last_inbound_at).length
  return {
    channel,
    threads: channelThreads.length,
    responseRate: channelThreads.length ? replied / channelThreads.length : 0,
    confirmed: channelThreads.filter((thread) => thread.state === 'confirmed').length,
    costCents: channel === 'email' || channel === 'instagram'
      ? 0
      : messages.reduce((sum, message) => sum + (message.provider_cost_cents ?? 0), 0),
  }
}

function isAdminEmail(email: string | null) {
  if (!email) return false
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes(email.toLowerCase())
}

function formatChannel(channel: OutreachChannel) {
  if (channel === 'sms') return 'SMS'
  if (channel === 'instagram') return 'Instagram'
  if (channel === 'voice') return 'Voice'
  return 'Email'
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value / 100)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
