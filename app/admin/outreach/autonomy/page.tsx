import type { ReactNode } from 'react'
import { Activity, Ban, History, RotateCcw, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type PolicyRow = {
  user_id: string
  version: number
  trust_level: number
  allowed_autonomous_actions: string[]
  created_at: string
}

type TrustRow = {
  user_id: string
  trust_level: number
  metrics_json: Record<string, unknown>
  computed_at: string
}

type AuditRow = {
  user_id: string
  thread_id: string | null
  action: string
  decision: string
  reason: string
  policy_version: number | null
  human_intervened: boolean
  created_at: string
}

export default async function AdminOutreachAutonomyPage() {
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
  const [{ data: policyRows }, { data: trustRows }, { data: auditRows }] = await Promise.all([
    admin
      .from('creator_outreach_policies')
      .select('user_id, version, trust_level, allowed_autonomous_actions, created_at')
      .order('user_id', { ascending: true })
      .order('version', { ascending: false }),
    admin
      .from('creator_outreach_trust_history')
      .select('user_id, trust_level, metrics_json, computed_at')
      .gte('computed_at', since)
      .order('computed_at', { ascending: false })
      .limit(50),
    admin
      .from('outreach_policy_audit_logs')
      .select('user_id, thread_id, action, decision, reason, policy_version, human_intervened, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const policies = latestPolicies((policyRows ?? []) as PolicyRow[])
  const trust = (trustRows ?? []) as TrustRow[]
  const audits = (auditRows ?? []) as AuditRow[]
  const autonomousActions = audits.filter((row) => row.decision === 'autonomous_sent' || row.decision === 'autonomous_scheduled')
  const blockedActions = audits.filter((row) => row.decision === 'blocked' || row.decision === 'pending_approval')
  const undoEvents = audits.filter((row) => row.decision === 'undone')

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Outreach Autonomy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Policy decisions, trust snapshots, blocks, and undo events from the last 30 days.</p>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="Creators with policy" value={policies.length.toLocaleString()} />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Autonomous actions" value={autonomousActions.length.toLocaleString()} />
          <StatCard icon={<Ban className="h-5 w-5" />} label="Blocked actions" value={blockedActions.length.toLocaleString()} />
          <StatCard icon={<RotateCcw className="h-5 w-5" />} label="Undo events" value={undoEvents.length.toLocaleString()} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="rounded-md">
            <CardHeader>
              <CardTitle className="text-xl">Creator Policies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {policies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No creator autonomy policies yet.</p>
              ) : (
                policies.map((policy) => (
                  <div key={policy.user_id} className="rounded-2xl border border-border bg-background/45 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{policy.user_id}</p>
                        <p className="mt-1 text-muted-foreground">v{policy.version} · trust {policy.trust_level}/100</p>
                      </div>
                      <span className="rounded-full border border-border bg-sidebar-accent px-2.5 py-1 text-xs font-bold text-muted-foreground">
                        {policy.allowed_autonomous_actions.length} actions
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {policy.allowed_autonomous_actions.length ? policy.allowed_autonomous_actions.join(', ') : 'No autonomy enabled'}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-md">
            <CardHeader>
              <CardTitle className="text-xl">Trust Trend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {trust.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trust snapshots in the last 30 days.</p>
              ) : (
                trust.slice(0, 12).map((row) => (
                  <div key={`${row.user_id}-${row.computed_at}`} className="rounded-2xl border border-border bg-background/45 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-semibold text-foreground">{row.user_id}</p>
                      <span className="font-display text-lg font-bold text-primary">{row.trust_level}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.computed_at)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="rounded-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <History className="h-5 w-5 text-primary" />
              Policy Audit Log
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {audits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No autonomy audit decisions in the last 30 days.</p>
            ) : (
              audits.map((row) => (
                <div key={`${row.user_id}-${row.created_at}-${row.action}`} className="rounded-2xl border border-border bg-background/45 p-3 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{row.action.replace(/_/g, ' ')} · {row.decision.replace(/_/g, ' ')}</p>
                      <p className="mt-1 text-muted-foreground">{row.reason}</p>
                    </div>
                    <span className="rounded-full border border-border bg-sidebar-accent px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      policy v{row.policy_version ?? 'none'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {row.user_id} · {row.thread_id ?? 'no thread'} · {formatDate(row.created_at)}
                    {row.human_intervened ? ' · human intervention' : ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function latestPolicies(rows: PolicyRow[]) {
  const map = new Map<string, PolicyRow>()
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, row)
  }
  return Array.from(map.values())
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

function isAdminEmail(email: string | null) {
  if (!email) return false
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes(email.toLowerCase())
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
