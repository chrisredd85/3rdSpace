'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Bot, CheckCircle2, ClipboardList, Loader2, Link2, RefreshCw, ShieldCheck, Ticket } from 'lucide-react'
import { PlannerTicketingConnectPanel } from '@/components/planner/PlannerTicketingConnectPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TICKET_PLATFORM_OPTIONS, type TicketPlatform } from '@/lib/constants/account-setup'
import type { Plan } from '@/lib/types'
import { cn } from '@/lib/utils'

type SetupStatus = 'ready_to_collect' | 'needs_connection' | 'needs_event_link' | 'needs_platform_choice'

interface DataConnectionSetup {
  summary: string
  recommended_platform: TicketPlatform | null
  setup_status: SetupStatus
  setup_steps: Array<{
    title: string
    detail: string
    action_type: 'oauth' | 'webhook' | 'event_link' | 'manual_question' | 'verify'
  }>
  data_sources: Array<{
    source: string
    metrics: string[]
    collection_method: 'api' | 'webhook' | 'event_link' | 'manual'
  }>
  post_event_questions: string[]
  cost_note: string
  guardrails: string[]
}

interface PostEventReport {
  summary: {
    events_count: number
    rsvps_or_imported_attendees: number
    checked_in: number
    no_show_rate: number | null
    tickets_sold: number
    tickets_refunded: number
    gross_revenue_cents: number
    average_ticket_price_cents: number
    peak_arrival_hour: string | null
    source_confidence: 'no_data' | 'partial' | 'imported_checkins_and_sales'
    attendance_coverage?: number | null
  }
  arrival_buckets: Array<{ label: string; count: number }>
  events: Array<{ id: string; event_name?: string | null; event_date?: string | null }>
  post_event_questions: string[]
}

interface PlannerDataConnectionPanelProps {
  plan: Plan | null
  className?: string
}

const setupStatusCopy: Record<SetupStatus, string> = {
  ready_to_collect: 'Ready to collect',
  needs_connection: 'Needs connection',
  needs_event_link: 'Needs event link',
  needs_platform_choice: 'Choose platform',
}

export function PlannerDataConnectionPanel({ plan, className }: PlannerDataConnectionPanelProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<TicketPlatform>('eventbrite')
  const [externalEventUrl, setExternalEventUrl] = useState('')
  const [setup, setSetup] = useState<DataConnectionSetup | null>(null)
  const [setupMode, setSetupMode] = useState<'openai' | 'deterministic' | null>(null)
  const [isLoadingSetup, setIsLoadingSetup] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [report, setReport] = useState<PostEventReport | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    setIsLoadingReport(true)
    setReportError(null)

    try {
      const response = await fetch('/api/planner/post-event/report')
      const payload = await response.json().catch(() => ({}))
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sign in as an event creator to load post-event data.')
      }
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load post-event report')
      setReport(payload as PostEventReport)
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Unable to load post-event report')
    } finally {
      setIsLoadingReport(false)
    }
  }, [])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const headlineMetric = useMemo(() => {
    if (!report) return 'No check-in data yet'
    if (report.summary.checked_in > 0) return `${report.summary.checked_in} checked in`
    if (report.summary.tickets_sold > 0) return `${report.summary.tickets_sold} tickets sold`
    return 'No check-in data yet'
  }, [report])

  async function handleSetupGuide() {
    setIsLoadingSetup(true)
    setSetupError(null)

    try {
      const response = await fetch('/api/planner/data-connections/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan?.id ?? null,
          platform: selectedPlatform,
          external_event_url: externalEventUrl.trim() || null,
          data_goal: 'Set up webhook/API data so 3rdPlace can measure RSVPs, tickets, refunds, check-ins, walk-ins, and venue foot traffic after the event.',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sign in as an event creator to generate a data setup guide.')
      }
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to generate setup guide')

      setSetup(payload.setup as DataConnectionSetup)
      setSetupMode(payload.agent_mode === 'openai' ? 'openai' : 'deterministic')
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Unable to generate setup guide')
    } finally {
      setIsLoadingSetup(false)
    }
  }

  return (
    <div className={cn('space-y-5', className)}>
      <section className="rounded-3xl border border-border bg-card/60 p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Data Connection Agent</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-foreground">
              Set up real RSVP, ticket, and check-in data
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              AI only guides setup. Actual attendance, sales, refunds, and check-ins come from webhook/API rows and post-event venue reports.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-bold text-success">
            <ShieldCheck className="h-3.5 w-3.5" />
            Metrics stay deterministic
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-background/50 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Setup target</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {TICKET_PLATFORM_OPTIONS.map((platform) => (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => setSelectedPlatform(platform.id)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-smooth',
                    selectedPlatform === platform.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card/40 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {platform.label}
                </button>
              ))}
            </div>
            <Input
              className="mt-3"
              value={externalEventUrl}
              onChange={(event) => setExternalEventUrl(event.target.value)}
              placeholder="Optional event URL"
            />
            <Button type="button" variant="hero" className="mt-3 w-full" onClick={handleSetupGuide} disabled={isLoadingSetup}>
              {isLoadingSetup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Generate setup guide
            </Button>
            {setupError ? <p className="mt-3 text-sm font-semibold text-destructive">{setupError}</p> : null}
          </div>

          <div className="rounded-2xl border border-border bg-background/50 p-4">
            {setup ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">
                    {setupStatusCopy[setup.setup_status]}
                  </span>
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                    {setupMode === 'openai' ? 'OpenAI setup guide' : 'Deterministic fallback'}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground">{setup.summary}</p>
                <div className="mt-4 space-y-3">
                  {setup.setup_steps.map((step, index) => (
                    <div key={`${step.title}-${index}`} className="rounded-xl border border-border bg-card/40 p-3">
                      <p className="text-sm font-bold text-foreground">{index + 1}. {step.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  {setup.cost_note}
                </p>
              </>
            ) : (
              <div className="flex min-h-64 flex-col justify-center rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                <Bot className="mx-auto h-8 w-8 text-primary" />
                <h4 className="mt-3 font-display text-lg font-bold text-foreground">No setup guide generated yet</h4>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Pick the platform the organizer uses. The agent returns the exact setup path and the post-event facts still needed from the venue.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-3xl border border-border bg-card/60 p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Actual event data</p>
              <h3 className="mt-1 font-display text-xl font-bold text-foreground">{headlineMetric}</h3>
            </div>
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => void loadReport()}
              disabled={isLoadingReport}
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingReport && 'animate-spin')} />
              Refresh
            </Button>
          </div>

          {isLoadingReport ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading deterministic report
            </div>
          ) : report ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard icon={<Ticket className="h-4 w-4" />} label="Tickets sold" value={String(report.summary.tickets_sold)} />
                <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="Checked in" value={String(report.summary.checked_in)} />
                <MetricCard icon={<BarChart3 className="h-4 w-4" />} label="Gross sales" value={formatCents(report.summary.gross_revenue_cents)} />
                <MetricCard icon={<ClipboardList className="h-4 w-4" />} label="No-show rate" value={report.summary.no_show_rate == null ? 'No data' : `${Math.round(report.summary.no_show_rate * 100)}%`} />
              </div>

              <div className="mt-5 rounded-2xl border border-border bg-background/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-foreground">Arrival curve</p>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Peak: {report.summary.peak_arrival_hour ?? 'No check-ins yet'}
                  </span>
                </div>
                {report.arrival_buckets.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {report.arrival_buckets.slice(0, 8).map((bucket) => (
                      <div key={bucket.label} className="grid grid-cols-[4rem_1fr_2rem] items-center gap-3 text-sm">
                        <span className="font-semibold text-muted-foreground">{bucket.label}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-gradient-brand"
                            style={{ width: `${Math.max(8, Math.min(100, bucket.count * 12))}%` }}
                          />
                        </span>
                        <span className="text-right font-bold text-foreground">{bucket.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No check-in timestamps yet. Connect a source or import attendees after the event.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {reportError ?? 'Post-event report loads after a creator account connects data sources.'}
            </p>
          )}
        </div>

        <div className="space-y-5">
          <PlannerTicketingConnectPanel mode="compact" ticketed={plan?.ticketed ?? false} />
          <div className="rounded-3xl border border-border bg-card/60 p-5 shadow-card">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Post-event questions</p>
            <h3 className="mt-1 font-display text-lg font-bold text-foreground">Ask only what APIs cannot know</h3>
            <div className="mt-4 space-y-2">
              {(setup?.post_event_questions ?? report?.post_event_questions ?? []).slice(0, 5).map((question) => (
                <div key={question} className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-muted-foreground">
                  {question}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-3 truncate font-display text-2xl font-bold text-foreground" title={value}>{value}</p>
    </div>
  )
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
