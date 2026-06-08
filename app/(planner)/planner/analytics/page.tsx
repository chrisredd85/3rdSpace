'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Repeat2,
  Ticket,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useEvents } from '@/lib/hooks/useEvents'
import { useUser } from '@/lib/hooks/useUser'
import { cn } from '@/lib/utils'

type FinancialSummary = {
  event_id?: string
  tickets_sold?: number | null
  gross_revenue?: number | null
  total_fees?: number | null
  total_refunds?: number | null
  net_revenue?: number | null
  average_ticket_price?: number | null
  current_attendance?: number | null
  projected_attendance?: number | null
  projected_revenue?: number | null
  venue_cost?: number | null
  vendor_cost?: number | null
  total_costs?: number | null
  expected_profit?: number | null
  profit_margin?: number | null
  break_even_tickets?: number | null
  venue_kickback_projection?: number | null
  venue_sales_share_projection?: number | null
  per_attendee_value?: number | null
  message?: string
}

type TicketingSummary = {
  tickets_sold: number
  tickets_refunded: number
  gross_revenue_cents: number
  fees_cents: number
  net_revenue_cents: number
  average_ticket_price_cents: number
}

type TicketTierRollup = {
  platform: string
  ticket_tier_category: string
  ticket_tier_name: string
  tickets_sold: number
  tickets_refunded: number
  gross_revenue_cents: number
  fees_cents: number
  net_revenue_cents: number
  average_ticket_price_cents: number
}

type TicketingAnalytics = {
  summary: TicketingSummary
  rollups: TicketTierRollup[]
  events: Array<{ id: string; event_name?: string | null }>
}

type PostEventSummary = {
  events_count: number
  rsvps_or_imported_attendees: number
  checked_in: number
  no_show_rate: number | null
  tickets_sold: number
  tickets_refunded: number
  gross_revenue_cents: number
  refund_amount_cents: number
  net_revenue_cents: number
  average_ticket_price_cents: number
  peak_arrival_hour: string | null
  venue_foot_traffic_proxy: number
  source_confidence: 'imported_checkins_and_sales' | 'partial' | 'no_data'
  attendance_coverage?: number | null
}

type TierVelocity = {
  tier_name: string
  ticket_price_cents: number | null
  tickets_sold: number
  tickets_refunded: number
  gross_revenue_cents: number
  first_purchase_at: string | null
  last_purchase_at: string | null
}

type PostEventReport = {
  summary: PostEventSummary
  arrival_buckets: Array<{ label: string; count: number }>
  tier_velocity: TierVelocity[]
  events: Array<{ id: string; event_name?: string | null; event_date?: string | null }>
  post_event_questions: string[]
}

type AnalyticsState = {
  financial: FinancialSummary | null
  postEvent: PostEventReport | null
  ticketing: TicketingAnalytics | null
}

type LoadState = {
  data: AnalyticsState | null
  isLoading: boolean
  error: string | null
}

const emptyTicketingSummary: TicketingSummary = {
  tickets_sold: 0,
  tickets_refunded: 0,
  gross_revenue_cents: 0,
  fees_cents: 0,
  net_revenue_cents: 0,
  average_ticket_price_cents: 0,
}

export default function PlannerAnalyticsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const userId = user?.id || null
  const { data: events = [], isLoading: isEventsLoading } = useEvents(userId)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>({
    data: null,
    isLoading: false,
    error: null,
  })

  const sortedEvents = useMemo(() => {
    return [...events].sort((first, second) => {
      const firstDate = Date.parse(first.event_date ?? '')
      const secondDate = Date.parse(second.event_date ?? '')
      return (Number.isNaN(secondDate) ? 0 : secondDate) - (Number.isNaN(firstDate) ? 0 : firstDate)
    })
  }, [events])

  useEffect(() => {
    if (selectedEventId && sortedEvents.some((event) => event.id === selectedEventId)) return
    setSelectedEventId(sortedEvents[0]?.id ?? null)
  }, [selectedEventId, sortedEvents])

  useEffect(() => {
    if (!selectedEventId) {
      setLoadState({ data: null, isLoading: false, error: null })
      return
    }

    const controller = new AbortController()
    void loadAnalytics(selectedEventId, false, controller.signal)
      .then((data) => setLoadState({ data, isLoading: false, error: null }))
      .catch((error) => {
        if (controller.signal.aborted) return
        setLoadState({
          data: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unable to load analytics',
        })
      })
    setLoadState((current) => ({ ...current, isLoading: true, error: null }))

    return () => controller.abort()
  }, [selectedEventId])

  const selectedEvent = useMemo(
    () => sortedEvents.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, sortedEvents]
  )

  const scorecard = useMemo(
    () => buildScorecard(loadState.data),
    [loadState.data]
  )

  async function refreshFinancials() {
    if (!selectedEventId) return
    setLoadState((current) => ({ ...current, isLoading: true, error: null }))
    try {
      const data = await loadAnalytics(selectedEventId, true)
      setLoadState({ data, isLoading: false, error: null })
    } catch (error) {
      setLoadState((current) => ({
        ...current,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unable to refresh financials',
      }))
    }
  }

  function exportCsv() {
    if (!scorecard || !selectedEvent) return

    const rows: Array<Array<string | number>> = [
      ['Event', selectedEvent.title],
      ['Date', formatDate(selectedEvent.event_date)],
      ['Source confidence', scorecard.sourceConfidenceLabel],
      ['Net revenue', formatMoney(scorecard.netRevenueDollars)],
      ['Total costs', formatMoney(scorecard.totalCostsDollars)],
      ['Expected profit', formatMoney(scorecard.expectedProfitDollars)],
      ['Profit per paid ticket', scorecard.profitPerPaidTicketDollars === null ? 'Needs ticket data' : formatMoney(scorecard.profitPerPaidTicketDollars)],
      ['Profit per checked-in guest', scorecard.profitPerCheckedInGuestDollars === null ? 'Needs check-in data' : formatMoney(scorecard.profitPerCheckedInGuestDollars)],
      ['Break-even tickets', scorecard.breakEvenTickets ?? 'Needs cost/ticket data'],
      ['Checked in', scorecard.checkedIn],
      [],
      ['Tier', 'Category', 'Sold', 'Refunded', 'Net revenue', 'Allocated profit'],
      ...scorecard.tiers.map((tier) => [
        tier.ticket_tier_name,
        tier.ticket_tier_category,
        tier.tickets_sold,
        tier.tickets_refunded,
        formatCents(tier.net_revenue_cents),
        tier.allocatedProfitCents === null ? 'Needs cost allocation' : formatCents(tier.allocatedProfitCents),
      ]),
    ]

    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `3rdplace-analytics-${selectedEvent.id}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (isUserLoading) {
    return <PageShell><EmptyState title="Loading analytics" body="Preparing your planner scorecard." /></PageShell>
  }

  if (userError || !user) {
    return <PageShell><EmptyState title="Please log in" body="Planner analytics are available after signing in." tone="warning" /></PageShell>
  }

  if (!isEventsLoading && sortedEvents.length === 0) {
    return (
      <PageShell>
        <EmptyState
          title="No events yet"
          body="Create or import an event before analytics can calculate revenue, attendance, costs, and tier performance."
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <header className="rounded-lg border border-tan bg-cream p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-clay/30 bg-clay-tint px-3 py-1 text-xs font-semibold text-clay">
              <BarChart3 className="h-3.5 w-3.5" />
              Post-event operating scorecard
            </div>
            <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
              Analytics that feeds the <span className="text-gradient-brand">next plan</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">
              Money, ticket tier performance, attendance, and data coverage are separated by source so the page does not invent metrics the schema cannot support yet.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:items-center">
            <label className="sr-only" htmlFor="event-select">Select event</label>
            <select
              id="event-select"
              value={selectedEventId ?? ''}
              onChange={(event) => setSelectedEventId(event.target.value || null)}
              className="min-h-11 rounded-md border border-tan bg-cream px-4 py-2 text-sm font-semibold text-ink outline-none transition-smooth hover:bg-cream focus:border-clay focus:ring-2 focus:ring-clay/20"
            >
              {sortedEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} · {formatDate(event.event_date)}
                </option>
              ))}
            </select>
            {selectedEventId ? (
              <Button type="button" variant="outline" asChild>
                <Link href={`/planner/events/${selectedEventId}/live`}>
                  <Activity className="mr-2 h-4 w-4" />
                  Live view
                </Link>
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled>
                <Activity className="mr-2 h-4 w-4" />
                Live view
              </Button>
            )}
            <Button type="button" variant="glass" onClick={() => void refreshFinancials()} disabled={!selectedEventId || loadState.isLoading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loadState.isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button type="button" variant="hero" onClick={exportCsv} disabled={!scorecard || !selectedEvent}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </header>

      {loadState.error && (
        <div className="rounded-lg border border-brick/40 bg-brick-tint p-4 text-sm text-brick">
          {loadState.error}
        </div>
      )}

      {loadState.isLoading && !scorecard ? (
        <ScorecardSkeleton />
      ) : scorecard ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<WalletCards className="h-5 w-5" />}
              label="Expected profit"
              value={formatMoney(scorecard.expectedProfitDollars)}
              detail="Net revenue minus venue/vendor costs"
              source="event_financial_summary"
              tone={scorecard.expectedProfitDollars >= 0 ? 'positive' : 'warning'}
            />
            <MetricCard
              icon={<Ticket className="h-5 w-5" />}
              label="Profit per paid ticket"
              value={scorecard.profitPerPaidTicketDollars === null ? 'Needs tickets' : formatMoney(scorecard.profitPerPaidTicketDollars)}
              detail="Derived from profit and paid ticket count"
              source="derived"
              tone={scorecard.profitPerPaidTicketDollars !== null && scorecard.profitPerPaidTicketDollars >= 0 ? 'positive' : 'neutral'}
            />
            <MetricCard
              icon={<Users className="h-5 w-5" />}
              label="Profit per checked-in guest"
              value={scorecard.profitPerCheckedInGuestDollars === null ? 'Needs check-ins' : formatMoney(scorecard.profitPerCheckedInGuestDollars)}
              detail="Only shown when check-in rows exist"
              source="imported_attendees"
              tone={scorecard.profitPerCheckedInGuestDollars !== null && scorecard.profitPerCheckedInGuestDollars >= 0 ? 'positive' : 'neutral'}
            />
            <MetricCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Break-even window"
              value={scorecard.breakEvenTickets === null ? 'Needs costs' : `${scorecard.breakEvenTickets} tickets`}
              detail={scorecard.breakEvenDelta === null ? 'Calculated after summary refresh' : `${scorecard.breakEvenDelta >= 0 ? '+' : ''}${scorecard.breakEvenDelta} tickets vs sold`}
              source="event_financial_summary"
              tone={scorecard.breakEvenDelta !== null && scorecard.breakEvenDelta >= 0 ? 'positive' : 'warning'}
            />
          </section>

          <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <Card className="min-w-0 rounded-lg">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Ticket Tier Profit Window</CardTitle>
                    <CardDescription>
                      Tier-level revenue is real; allocated profit uses a documented cost allocation assumption.
                    </CardDescription>
                  </div>
                  <SourcePill label="event_sales_data" />
                </div>
              </CardHeader>
              <CardContent>
                {scorecard.tiers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-tan text-left text-xs uppercase text-ink-soft">
                          <th className="pb-3 pr-4 font-semibold">Tier</th>
                          <th className="pb-3 pr-4 font-semibold">Sold</th>
                          <th className="pb-3 pr-4 font-semibold">Avg price</th>
                          <th className="pb-3 pr-4 font-semibold">Net revenue</th>
                          <th className="pb-3 pr-4 font-semibold">Allocated profit</th>
                          <th className="pb-3 font-semibold">Read</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scorecard.tiers.map((tier) => (
                          <tr key={`${tier.platform}-${tier.ticket_tier_category}-${tier.ticket_tier_name}`} className="border-b border-tan">
                            <td className="py-4 pr-4">
                              <div className="font-semibold text-ink">{tier.ticket_tier_name}</div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                <SourcePill label={formatTierCategory(tier.ticket_tier_category)} compact />
                                <SourcePill label={tier.platform} compact muted />
                              </div>
                            </td>
                            <td className="py-4 pr-4 text-ink">
                              {tier.tickets_sold}
                              {tier.tickets_refunded > 0 && (
                                <span className="ml-2 text-xs text-ink-soft">({tier.tickets_refunded} refunded)</span>
                              )}
                            </td>
                            <td className="py-4 pr-4 text-ink">{formatCents(tier.average_ticket_price_cents)}</td>
                            <td className="py-4 pr-4 font-semibold text-ink">{formatCents(tier.net_revenue_cents)}</td>
                            <td className="py-4 pr-4">
                              {tier.allocatedProfitCents === null ? (
                                <span className="text-ink-soft">Needs costs</span>
                              ) : (
                                <span className={cn('font-semibold', tier.allocatedProfitCents >= 0 ? 'text-forest' : 'text-brick')}>
                                  {formatCents(tier.allocatedProfitCents)}
                                </span>
                              )}
                            </td>
                            <td className="py-4 text-ink-soft">{tier.read}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyBlock
                    icon={<Ticket className="h-5 w-5" />}
                    title="No ticket tiers imported"
                    body="Connect or import ticket sales before showing Early Bird, GA, VIP, promo, comp, or donation tier performance."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-lg 2xl:min-w-[360px]">
              <CardHeader className="min-w-0">
                <CardTitle>Run Again</CardTitle>
                <CardDescription className="[overflow-wrap:normal]">
                  Deterministic recommendation from current analytics, not an invented agent claim.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 space-y-4">
                <div className="rounded-lg border border-tan bg-cream-deep/55 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="shrink-0 rounded-md border border-clay/30 bg-clay-tint p-2 text-clay">
                      <Repeat2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg font-bold leading-tight text-ink [overflow-wrap:normal] sm:text-xl">
                        {scorecard.recommendation.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-ink-soft [overflow-wrap:normal]">
                        {scorecard.recommendation.body}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {scorecard.recommendation.nextSteps.map((step) => (
                    <div key={step} className="flex min-w-0 gap-3 rounded-lg border border-tan bg-cream p-3 text-sm text-ink-soft">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                      <span className="min-w-0 flex-1 leading-6 [overflow-wrap:normal]">{step}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-3">
            <Card className="rounded-lg xl:col-span-2">
              <CardHeader>
                <CardTitle>Attendance</CardTitle>
                <CardDescription>Check-ins, no-show risk, and arrival shape from imported attendee rows.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <CompactMetric label="Imported / RSVP rows" value={String(scorecard.importedAttendees)} source="imported_attendees" />
                <CompactMetric label="Checked in" value={String(scorecard.checkedIn)} source="checked_in" />
                <CompactMetric label="No-show rate" value={scorecard.noShowRate === null ? 'Needs check-ins' : formatPercent(scorecard.noShowRate)} source={scorecard.sourceConfidenceLabel} />
                <CompactMetric label="Peak arrival" value={scorecard.peakArrivalHour ?? 'Needs check-ins'} source="check_in_time" />
                <CompactMetric label="Attendance coverage" value={scorecard.attendanceCoverage === null ? 'Needs data' : formatPercent(scorecard.attendanceCoverage)} source="derived" />
                <CompactMetric label="Foot-traffic proxy" value={String(scorecard.venueFootTrafficProxy)} source="proxy, not POS" />
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Venue Impact</CardTitle>
                <CardDescription>Useful for a venue recap, with proxy labels where exact POS data is missing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ImpactRow label="Foot traffic proxy" value={String(scorecard.venueFootTrafficProxy)} source="tickets/check-ins" />
                <ImpactRow label="Venue kickback projection" value={formatMoney(scorecard.venueKickbackProjectionDollars)} source="financial summary" />
                <ImpactRow label="Ticket sales share projection" value={formatMoney(scorecard.venueSalesShareProjectionDollars)} source="venue terms" />
                <ImpactRow label="Bar/POS spend" value="Needs venue data" source="future/manual" muted />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Sales Velocity</CardTitle>
                <CardDescription>Tier movement from purchase timestamps when providers include them.</CardDescription>
              </CardHeader>
              <CardContent>
                {scorecard.velocity.length > 0 ? (
                  <div className="space-y-3">
                    {scorecard.velocity.map((tier) => (
                      <div key={`${tier.tier_name}-${tier.ticket_price_cents ?? 'unknown'}`} className="rounded-lg border border-tan bg-cream p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">{tier.tier_name}</p>
                            <p className="text-xs text-ink-soft">{tier.ticket_price_cents === null ? 'Unknown price' : formatCents(tier.ticket_price_cents)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-ink">{tier.tickets_sold} sold</p>
                            <p className="text-xs text-ink-soft">{tier.tickets_refunded} refunded</p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
                          <span>First: {formatDateTime(tier.first_purchase_at)}</span>
                          <span>Last: {formatDateTime(tier.last_purchase_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock
                    icon={<Clock className="h-5 w-5" />}
                    title="No velocity data"
                    body="Ticket purchase timestamps are needed before tier velocity can be trusted."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Data Coverage</CardTitle>
                <CardDescription>What is factual today versus what still needs instrumentation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {scorecard.coverage.map((item) => (
                  <CoverageRow key={item.label} {...item} />
                ))}
              </CardContent>
            </Card>
          </section>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>Not Factual Yet</CardTitle>
              <CardDescription>These should stay hidden, empty, or explicitly marked as assumptions until the app captures the source data.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ['True contribution margin per tier', 'Needs per-tier variable cost or a cost allocation rule.'],
                ['Venue bar/POS spend', 'Needs manual venue report or POS integration.'],
                ['Walk-ins', 'Needs a dedicated walk-in count, not just ticket/check-in proxy.'],
                ['Satisfaction/NPS', 'Needs event-linked survey or review rows.'],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg border border-tan bg-cream-deep/55 p-4">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-ochre/30 bg-ochre-tint text-ochre">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">{body}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <ScorecardSkeleton />
      )}
    </PageShell>
  )
}

async function loadAnalytics(eventId: string, recalculate: boolean, signal?: AbortSignal): Promise<AnalyticsState> {
  const searchParams = recalculate ? '?recalculate=true' : ''
  const [financial, postEvent, ticketing] = await Promise.all([
    fetchJson<FinancialSummary>(`/api/events/${eventId}/financials${searchParams}`, signal),
    fetchJson<PostEventReport>(`/api/planner/post-event/report?eventId=${eventId}`, signal),
    fetchJson<TicketingAnalytics>(`/api/planner/ticketing/analytics?eventId=${eventId}`, signal),
  ])

  return { financial, postEvent, ticketing }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'include', signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function buildScorecard(data: AnalyticsState | null) {
  if (!data) return null

  const financial = data.financial
  const postSummary = data.postEvent?.summary
  const ticketSummary = data.ticketing?.summary ?? emptyTicketingSummary
  const paidTickets = ticketSummary.tickets_sold || financial?.tickets_sold || postSummary?.tickets_sold || 0
  const checkedIn = postSummary?.checked_in ?? 0
  const importedAttendees = postSummary?.rsvps_or_imported_attendees ?? 0
  const netRevenueDollars = readNumber(financial?.net_revenue) ?? centsToDollars(ticketSummary.net_revenue_cents)
  const totalCostsDollars = readNumber(financial?.total_costs) ?? 0
  const expectedProfitDollars = readNumber(financial?.expected_profit) ?? netRevenueDollars - totalCostsDollars
  const breakEvenTickets = readNumber(financial?.break_even_tickets)
  const breakEvenDelta = breakEvenTickets === null ? null : paidTickets - breakEvenTickets
  const totalCostsCents = dollarsToCents(totalCostsDollars)
  const costPerPaidTicketCents = paidTickets > 0 && totalCostsCents > 0 ? Math.round(totalCostsCents / paidTickets) : null
  const tiers = (data.ticketing?.rollups ?? []).map((tier) => {
    const allocatedProfitCents =
      costPerPaidTicketCents === null ? null : tier.net_revenue_cents - tier.tickets_sold * costPerPaidTicketCents
    return {
      ...tier,
      allocatedProfitCents,
      read: buildTierRead(tier, allocatedProfitCents),
    }
  })
  const bestTier = tiers.length > 0
    ? [...tiers].sort((first, second) => second.net_revenue_cents - first.net_revenue_cents)[0]
    : null
  const weakTier = tiers.filter((tier) => tier.tickets_sold > 0).length > 0
    ? [...tiers].filter((tier) => tier.tickets_sold > 0).sort((first, second) => first.average_ticket_price_cents - second.average_ticket_price_cents)[0]
    : null

  const scorecard = {
    financial,
    ticketSummary,
    paidTickets,
    checkedIn,
    importedAttendees,
    netRevenueDollars,
    totalCostsDollars,
    expectedProfitDollars,
    profitPerPaidTicketDollars: paidTickets > 0 ? expectedProfitDollars / paidTickets : null,
    profitPerCheckedInGuestDollars: checkedIn > 0 ? expectedProfitDollars / checkedIn : null,
    breakEvenTickets,
    breakEvenDelta,
    tiers,
    bestTier,
    weakTier,
    velocity: data.postEvent?.tier_velocity ?? [],
    noShowRate: postSummary?.no_show_rate ?? null,
    peakArrivalHour: postSummary?.peak_arrival_hour ?? null,
    attendanceCoverage: postSummary?.attendance_coverage ?? null,
    venueFootTrafficProxy: postSummary?.venue_foot_traffic_proxy ?? 0,
    sourceConfidenceLabel: sourceConfidenceLabel(postSummary?.source_confidence),
    venueKickbackProjectionDollars: readNumber(financial?.venue_kickback_projection) ?? 0,
    venueSalesShareProjectionDollars: readNumber(financial?.venue_sales_share_projection) ?? 0,
  }

  return {
    ...scorecard,
    recommendation: buildRecommendation(scorecard),
    coverage: buildCoverage(scorecard),
  }
}

function buildTierRead(tier: TicketTierRollup, allocatedProfitCents: number | null) {
  if (tier.tickets_sold === 0) return 'No paid movement yet'
  if (allocatedProfitCents === null) return 'Revenue after fees only'
  if (allocatedProfitCents >= 0) return 'Clears allocated cost'
  return 'Needs price or cost adjustment'
}

function buildRecommendation(scorecard: {
  paidTickets: number
  checkedIn: number
  expectedProfitDollars: number
  breakEvenTickets: number | null
  breakEvenDelta: number | null
  bestTier: (TicketTierRollup & { allocatedProfitCents: number | null }) | null
  weakTier: (TicketTierRollup & { allocatedProfitCents: number | null }) | null
  totalCostsDollars: number
}) {
  if (scorecard.paidTickets === 0 && scorecard.checkedIn === 0) {
    return {
      title: 'Needs imported event data',
      body: 'This scorecard cannot make a reliable rebook call until ticket sales or attendee/check-in rows exist.',
      nextSteps: [
        'Connect or import ticketing data for the event.',
        'Add check-in data after the event so attendance metrics are real.',
        'Refresh financials after venue and vendor costs are confirmed.',
      ],
    }
  }

  const bestTier = scorecard.bestTier?.ticket_tier_name ?? 'the strongest ticket tier'
  const weakTier = scorecard.weakTier?.ticket_tier_name ?? 'the weakest discount tier'

  if (scorecard.expectedProfitDollars >= 0 && (scorecard.breakEvenDelta ?? 0) >= 0) {
    return {
      title: 'Rebook with pricing discipline',
      body: `This event clears the current profit model. Use ${bestTier} as the next pricing anchor and keep discounted inventory constrained.`,
      nextSteps: [
        `Anchor the next ticket window around ${bestTier}.`,
        `Review whether ${weakTier} should be raised, capped, or removed.`,
        'Reuse the same event template after updating final costs and check-in data.',
      ],
    }
  }

  if (scorecard.totalCostsDollars <= 0) {
    return {
      title: 'Costs need confirmation',
      body: 'Ticket and attendance data exist, but venue/vendor costs are missing or zero, so margin and profit recommendations should stay provisional.',
      nextSteps: [
        'Confirm final venue cost from venue_bookings.',
        'Confirm final vendor cost from vendor_bookings.',
        'Refresh the financial summary before making a rebook decision.',
      ],
    }
  }

  return {
    title: 'Do not rebook unchanged',
    body: 'The current model does not clear the profit window. Rebook only if ticket price, tier mix, or venue/vendor cost changes.',
    nextSteps: [
      `Raise or cap ${weakTier} before the next run.`,
      'Renegotiate venue/vendor cost or reduce the package scope.',
      'Use the break-even ticket count as the minimum viable attendance target.',
    ],
  }
}

function buildCoverage(scorecard: {
  paidTickets: number
  checkedIn: number
  totalCostsDollars: number
  tiers: Array<TicketTierRollup & { allocatedProfitCents: number | null }>
  sourceConfidenceLabel: string
}) {
  return [
    {
      label: 'Ticket sales',
      value: scorecard.paidTickets > 0 ? `${scorecard.paidTickets} sold` : 'Needs ticketing data',
      status: scorecard.paidTickets > 0 ? 'ready' : 'missing',
      source: 'event_sales_data',
    },
    {
      label: 'Check-ins',
      value: scorecard.checkedIn > 0 ? `${scorecard.checkedIn} checked in` : 'Needs check-in data',
      status: scorecard.checkedIn > 0 ? 'ready' : 'missing',
      source: 'imported_attendees',
    },
    {
      label: 'Costs',
      value: scorecard.totalCostsDollars > 0 ? formatMoney(scorecard.totalCostsDollars) : 'Needs final costs',
      status: scorecard.totalCostsDollars > 0 ? 'ready' : 'missing',
      source: 'venue_bookings + vendor_bookings',
    },
    {
      label: 'Tier margin',
      value: scorecard.tiers.length > 0 && scorecard.totalCostsDollars > 0 ? 'Allocated estimate' : 'Needs tiers and costs',
      status: scorecard.tiers.length > 0 && scorecard.totalCostsDollars > 0 ? 'assumption' : 'missing',
      source: 'cost allocation assumption',
    },
    {
      label: 'Attendance confidence',
      value: scorecard.sourceConfidenceLabel,
      status: scorecard.sourceConfidenceLabel.includes('Ticketing and check-ins') ? 'ready' : 'assumption',
      source: 'post-event report',
    },
  ] as const
}

function PageShell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen space-y-6 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  source,
  tone = 'neutral',
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  source: string
  tone?: 'neutral' | 'positive' | 'warning'
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink-soft">{label}</p>
            <p className="mt-3 font-display text-3xl font-bold text-ink">{value}</p>
          </div>
          <div className={cn(
            'rounded-lg border p-3',
            tone === 'positive' && 'border-forest/30 bg-forest-tint text-forest',
            tone === 'warning' && 'border-ochre/30 bg-ochre-tint text-ochre',
            tone === 'neutral' && 'border-clay/30 bg-clay-tint text-clay'
          )}>
            {icon}
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-soft">{detail}</p>
        <div className="mt-4">
          <SourcePill label={source} compact />
        </div>
      </CardContent>
    </Card>
  )
}

function CompactMetric({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream p-4">
      <p className="text-xs font-semibold uppercase text-ink-soft">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
      <div className="mt-3">
        <SourcePill label={source} compact muted />
      </div>
    </div>
  )
}

function ImpactRow({ label, value, source, muted = false }: { label: string; value: string; source: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-tan bg-cream p-3">
      <div>
        <p className={cn('text-sm font-semibold', muted ? 'text-ink-soft' : 'text-ink')}>{label}</p>
        <SourcePill label={source} compact muted />
      </div>
      <p className={cn('text-right font-display text-lg font-bold', muted ? 'text-ink-soft' : 'text-ink')}>{value}</p>
    </div>
  )
}

function CoverageRow({ label, value, status, source }: { label: string; value: string; status: 'ready' | 'missing' | 'assumption'; source: string }) {
  const Icon = status === 'ready' ? CheckCircle2 : status === 'assumption' ? Activity : AlertTriangle
  return (
    <div className="flex items-start gap-3 rounded-lg border border-tan bg-cream p-4">
      <div className={cn(
        'rounded-md border p-2',
        status === 'ready' && 'border-forest/30 bg-forest-tint text-forest',
        status === 'assumption' && 'border-clay/30 bg-clay-tint text-clay',
        status === 'missing' && 'border-brick/30 bg-brick-tint text-brick'
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-ink">{label}</p>
          <span className="text-sm text-ink-soft">{value}</span>
        </div>
        <div className="mt-2">
          <SourcePill label={source} compact muted />
        </div>
      </div>
    </div>
  )
}

function SourcePill({ label, compact = false, muted = false }: { label: string; compact?: boolean; muted?: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border font-semibold',
      compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
      muted ? 'border-tan bg-cream-deep/60 text-ink-soft' : 'border-clay/30 bg-clay-tint text-clay'
    )}>
      {label}
    </span>
  )
}

function EmptyBlock({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-tan bg-cream-deep/55 p-8 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-tan bg-cream text-ink-soft">
        {icon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{body}</p>
    </div>
  )
}

function EmptyState({ title, body, tone = 'neutral' }: { title: string; body: string; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-xl rounded-lg border border-tan bg-cream p-8 text-center shadow-card">
        <div className={cn(
          'mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg border',
          tone === 'warning' ? 'border-ochre/30 bg-ochre-tint text-ochre' : 'border-clay/30 bg-clay-tint text-clay'
        )}>
          {tone === 'warning' ? <AlertTriangle className="h-6 w-6" /> : <BarChart3 className="h-6 w-6" />}
        </div>
        <h1 className="font-display text-3xl font-bold text-ink">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">{body}</p>
      </div>
    </div>
  )
}

function ScorecardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-48 animate-pulse rounded-lg border border-tan bg-cream" />
      ))}
    </div>
  )
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dollarsToCents(value: number) {
  return Math.round(value * 100)
}

function centsToDollars(value: number) {
  return value / 100
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

function formatCents(value: number | null) {
  if (value === null) return 'Unknown'
  return formatMoney(centsToDollars(value))
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(value: string | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTierCategory(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function sourceConfidenceLabel(value?: PostEventSummary['source_confidence']) {
  if (value === 'imported_checkins_and_sales') return 'Ticketing and check-ins'
  if (value === 'partial') return 'Partial data'
  return 'No source data'
}
