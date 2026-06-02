import Link from 'next/link'
import { ArrowRight, Mail, Send, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OutreachAutonomyControls } from '@/components/planner/OutreachAutonomyControls'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import type { OutreachThread, Plan } from '@/lib/types'

const THREAD_SELECT = `
  id,
  plan_id,
  user_id,
  target_type,
  target_id,
  target_name,
  target_email,
  target_phone,
  target_instagram_handle,
  channel,
  target_source,
  discovery_venue_id,
  channel_strategy,
  state,
  source_agent_action_id,
  needs_attention,
  follow_up_count,
  last_event_at,
  last_outbound_at,
  last_inbound_at,
  next_action_at,
  created_at,
  updated_at
`

export default async function PlannerOutreachPage() {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-muted-foreground">
        Sign in to view outreach.
      </div>
    )
  }

  const [{ data: threadRows }, { data: policyRows }, { data: notificationRows }] = await Promise.all([
    db
      .from('outreach_threads')
      .select(THREAD_SELECT)
      .eq('user_id', user.id)
      .order('last_event_at', { ascending: false }),
    db
      .from('creator_outreach_policies')
      .select('version, trust_level, allowed_autonomous_actions')
      .eq('user_id', user.id)
      .order('version', { ascending: false })
      .limit(1),
    db
      .from('outreach_notifications')
      .select('id, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const threads = (threadRows ?? []) as OutreachThread[]
  const latestPolicy = Array.isArray(policyRows) ? policyRows[0] as { version?: number; trust_level?: number; allowed_autonomous_actions?: string[] } | undefined : undefined
  const unreadNotifications = ((notificationRows ?? []) as Array<{ read_at: string | null }>).filter((row) => !row.read_at).length
  const planIds = Array.from(new Set(threads.map((thread) => thread.plan_id)))
  const { data: planRows } = planIds.length
    ? await db
        .from('plans')
        .select('id, title, date_window_start, date_window_end, status')
        .in('id', planIds)
    : { data: [] }
  const plans = new Map(((planRows ?? []) as Plan[]).map((plan) => [plan.id, plan]))
  const grouped = planIds.map((planId) => ({
    plan: plans.get(planId) ?? null,
    threads: threads.filter((thread) => thread.plan_id === planId),
  }))

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Agent outreach</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Outreach</h1>
          </div>
          <Button asChild variant="outline">
            <Link href="/planner/settings/integrations">
              <Mail className="h-4 w-4" />
              Gmail settings
            </Link>
          </Button>
        </div>

        <OutreachAutonomyControls
          policyVersion={latestPolicy?.version ?? 0}
          trustLevel={latestPolicy?.trust_level ?? 0}
          allowedActions={latestPolicy?.allowed_autonomous_actions ?? []}
          unreadNotifications={unreadNotifications}
        />

        {threads.length === 0 ? (
          <Card className="rounded-md">
            <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <p className="font-display text-xl font-bold text-foreground">No outreach threads yet</p>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Approved outreach drafts will appear here before any Gmail send.
                </p>
              </div>
              <Button asChild variant="default">
                <Link href="/planner">
                  Open planner
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          grouped.map((group) => (
            <section key={group.plan?.id ?? group.threads[0]?.plan_id} className="space-y-3">
              <div>
                <h2 className="font-display text-xl font-bold text-foreground">
                  {group.plan?.title ?? 'Untitled plan'}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPlanDate(group.plan)}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.threads.map((thread) => (
                  <Link key={thread.id} href={`/planner/outreach/${thread.id}`} className="group block">
                    <Card className="h-full rounded-md transition-smooth group-hover:-translate-y-0.5 group-hover:border-primary/50">
                      <CardHeader className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate text-lg">{thread.target_name}</CardTitle>
                            <p className="mt-1 truncate text-sm text-muted-foreground">{thread.target_email ?? thread.target_phone ?? thread.target_instagram_handle ?? 'No contact'}</p>
                          </div>
                          <StateBadge state={thread.state} needsAttention={thread.needs_attention} />
                        </div>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between gap-4">
                        <div className="text-sm text-muted-foreground">
                          <p>{formatThreadChannel(thread.channel)} · {thread.target_type === 'venue' ? 'Venue' : 'Vendor'}</p>
                          <p>{formatRelative(thread.last_event_at)}</p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sidebar-accent text-primary">
                          {thread.state === 'draft' ? <Send className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function formatThreadChannel(value: string) {
  if (value === 'sms') return 'SMS'
  if (value === 'instagram') return 'Instagram'
  if (value === 'voice') return 'Voice'
  return 'Email'
}

function StateBadge({ state, needsAttention }: { state: string; needsAttention: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold capitalize',
        needsAttention
          ? 'border-secondary/50 bg-secondary/15 text-secondary'
          : state === 'awaiting_reply'
            ? 'border-primary/40 bg-primary/10 text-primary'
            : state === 'confirmed'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border bg-sidebar-accent text-muted-foreground'
      )}
    >
      {needsAttention ? 'Needs review' : state.replace(/_/g, ' ')}
    </span>
  )
}

function formatPlanDate(plan: Plan | null) {
  const value = plan?.date_window_start ?? plan?.date_window_end
  if (!value) return 'Date TBD'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function formatRelative(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No activity yet'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
