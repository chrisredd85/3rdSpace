import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Repeat2,
  Store,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type PlanRow = {
  id: string
  title: string
  status: string
  event_type: string | null
  date_window_start: string | null
  date_window_end: string | null
  guest_count: number | null
  budget_cap_cents: number | null
  profit_goal_cents: number | null
  ticketed: boolean
  ticketing_model: string | null
  updated_at: string
  created_at: string
}

type EventRow = {
  id: string
  event_name: string
  event_type: string
  event_date: string
  status: string | null
  expected_attendance: number | null
  expected_attendance_min: number | null
  expected_attendance_max: number | null
  budget: number | null
  total_budget: number | null
  venue_confirmed: boolean | null
  is_recurring: boolean | null
  recurring_frequency: string | null
  eventbrite_event_id: string | null
  posh_event_id: string | null
  updated_at: string | null
  created_at: string | null
}

type FinancialRow = {
  event_id: string
  tickets_sold: number | string | null
  net_revenue: number | string | null
  total_costs: number | string | null
  expected_profit: number | string | null
  profit_margin: number | string | null
  updated_at: string | null
}

type BookingRow = {
  id: string
  event_id: string
  status: string | null
  payment_status: string | null
  paid_at: string | null
  deposit_paid?: boolean | null
}

type SalesRow = {
  id: string
  event_id: string
}

type TicketingConnectionRow = {
  id: string
  platform: string
  status: string
  last_connected_at: string | null
  last_webhook_received_at: string | null
}

type ExperienceRecord = {
  id: string
  kind: 'event' | 'plan'
  title: string
  href: string
  dateLabel: string
  statusLabel: string
  sourceLabel: string
  detail: string
  partnerCount: number
  hasTicketing: boolean
  hasFinancials: boolean
  profitLabel: string
  marginLabel: string
  nextAction: string
}

type LoadIssue = {
  area: string
  message: string
}

type ExperiencesData = {
  isAuthenticated: boolean
  plans: PlanRow[]
  events: EventRow[]
  records: ExperienceRecord[]
  metrics: Array<{ label: string; value: string; detail: string }>
  coverage: Array<{
    title: string
    icon: typeof ClipboardList
    value: string
    body: string
    tone: 'ready' | 'partial' | 'empty'
  }>
  issues: LoadIssue[]
}

/**
 * Data-backed operating-record route for recurring hosts.
 */
export default async function ExperiencesPage() {
  const data = await loadExperiencesData()
  const hasRecords = data.records.length > 0

  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Experiences</h1>
        <p className="mt-1 text-sm text-ink-soft">Real event records, planner drafts, partner progress, ticketing coverage, and profitability signals.</p>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {data.issues.length > 0 ? (
          <section className="rounded-lg border border-ochre/30 bg-ochre-tint p-4 text-sm text-ink">
            <p className="font-semibold">Some operating data could not be loaded.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
              {data.issues.map((issue) => (
                <li key={issue.area}>{issue.area}: {issue.message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Experience OS</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">Every event becomes an operating record</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                This page reads from saved planner drafts, created/imported events, bookings, ticketing rows, and financial summaries. Empty means no matching record exists yet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/planner/events/import">
                  Import event
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/planner">
                  Create event
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.metrics.map((metric) => (
              <div key={metric.label} className="rounded-md border border-tan bg-cream-deep/60 p-4">
                <p className="text-xs font-semibold text-ink-soft">{metric.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-ink">{metric.value}</p>
                <p className="mt-1 text-xs leading-snug text-ink-soft">{metric.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-lg border border-tan bg-cream shadow-card">
            <div className="border-b border-tan p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-clay">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">Event Pipeline</h2>
                  <p className="text-sm text-ink-soft">Saved planner drafts and event records ordered by date or recent activity.</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              {!data.isAuthenticated ? (
                <EmptyState
                  title="Sign in to view event records"
                  body="Experiences reads your planner drafts, imported events, bookings, ticketing data, and profitability summaries after authentication."
                  actionHref="/login"
                  actionLabel="Sign in"
                />
              ) : hasRecords ? (
                <div className="space-y-3">
                  {data.records.map((record) => (
                    <Link
                      key={`${record.kind}-${record.id}`}
                      href={record.href}
                      className="group block rounded-md border border-tan bg-cream-deep/55 p-4 transition-smooth hover:border-clay/45 hover:bg-cream-deep"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(
                              'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-none tracking-normal',
                              record.kind === 'event'
                                ? 'border-forest/25 bg-forest-tint text-forest'
                                : 'border-clay/25 bg-clay-tint text-clay-deep'
                            )}>
                              {record.sourceLabel}
                            </span>
                            <span className="text-xs font-semibold text-ink-soft">{record.statusLabel}</span>
                          </div>
                          <h3 className="mt-3 truncate font-display text-lg font-bold text-ink">{record.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-ink-soft">{record.detail}</p>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="text-sm font-semibold text-ink">{record.dateLabel}</p>
                          <p className="mt-1 text-xs text-ink-soft">{record.nextAction}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <RecordSignal icon={<Building2 className="h-4 w-4" />} label="Partners" value={record.partnerCount > 0 ? String(record.partnerCount) : 'None yet'} ready={record.partnerCount > 0} />
                        <RecordSignal icon={<Ticket className="h-4 w-4" />} label="Ticketing" value={record.hasTicketing ? 'Attached' : 'No data'} ready={record.hasTicketing} />
                        <RecordSignal icon={<TrendingUp className="h-4 w-4" />} label="Profit" value={record.profitLabel} ready={record.hasFinancials} />
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-clay-deep">
                        <span>{record.marginLabel}</span>
                        <span className="inline-flex items-center">
                          Open record
                          <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No event records yet"
                  body="Saved planner drafts, imported ticketing events, confirmed bookings, and completed event reports will appear here once they exist."
                  actionHref="/planner"
                  actionLabel="Start in planner"
                />
              )}
            </div>
          </section>

          <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-clay">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Operating Coverage</h2>
                <p className="text-sm text-ink-soft">What is currently backed by real records.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {data.coverage.map((section) => {
                const Icon = section.icon

                return (
                  <div
                    key={section.title}
                    className={cn(
                      'rounded-md border p-4',
                      section.tone === 'ready' && 'border-forest/25 bg-forest-tint/60',
                      section.tone === 'partial' && 'border-ochre/25 bg-ochre-tint/70',
                      section.tone === 'empty' && 'border-tan bg-cream-deep/55'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={cn(
                        'mt-0.5 h-4 w-4',
                        section.tone === 'ready' && 'text-forest',
                        section.tone === 'partial' && 'text-ochre',
                        section.tone === 'empty' && 'text-clay'
                      )} />
                      <div>
                        <div className="font-semibold text-ink">{section.title}</div>
                        <p className="mt-1 font-display text-2xl font-bold text-ink">{section.value}</p>
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{section.body}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

async function loadExperiencesData(): Promise<ExperiencesData> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return buildExperiencesData({
      isAuthenticated: false,
      plans: [],
      events: [],
      financials: [],
      venueBookings: [],
      vendorBookings: [],
      salesRows: [],
      ticketingConnections: [],
      issues: [],
    })
  }

  const issues: LoadIssue[] = []
  const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
  if (builderProfileError || !builderProfileId) {
    issues.push({ area: 'Builder profile', message: 'No builder profile was found for this account.' })
  }

  const [plansResult, eventsResult, ticketingResult] = await Promise.all([
    supabase
      .from('plans')
      .select('id, title, status, event_type, date_window_start, date_window_end, guest_count, budget_cap_cents, profit_goal_cents, ticketed, ticketing_model, updated_at, created_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50),
    builderProfileId
      ? supabase
          .from('events')
          .select('id, event_name, event_type, event_date, status, expected_attendance, expected_attendance_min, expected_attendance_max, budget, total_budget, venue_confirmed, is_recurring, recurring_frequency, eventbrite_event_id, posh_event_id, updated_at, created_at')
          .eq('builder_id', builderProfileId)
          .order('event_date', { ascending: false })
          .limit(75)
      : Promise.resolve({ data: [], error: null }),
    builderProfileId
      ? supabase
          .from('builder_ticketing_connections')
          .select('id, platform, status, last_connected_at, last_webhook_received_at')
          .eq('builder_id', builderProfileId)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (plansResult.error) issues.push({ area: 'Planner drafts', message: plansResult.error.message })
  if (eventsResult.error) issues.push({ area: 'Event records', message: eventsResult.error.message })
  if (ticketingResult.error) issues.push({ area: 'Ticketing connections', message: ticketingResult.error.message })

  const plans = ((plansResult.data ?? []) as PlanRow[])
  const events = ((eventsResult.data ?? []) as EventRow[])
  const ticketingConnections = ((ticketingResult.data ?? []) as TicketingConnectionRow[])
  const eventIds = events.map((event) => event.id)

  let financials: FinancialRow[] = []
  let venueBookings: BookingRow[] = []
  let vendorBookings: BookingRow[] = []
  let salesRows: SalesRow[] = []

  if (eventIds.length > 0) {
    const [financialsResult, venueBookingsResult, vendorBookingsResult, salesResult] = await Promise.all([
      supabase
        .from('event_financial_summary')
        .select('event_id, tickets_sold, net_revenue, total_costs, expected_profit, profit_margin, updated_at')
        .in('event_id', eventIds),
      supabase
        .from('venue_bookings')
        .select('id, event_id, status, payment_status, paid_at')
        .in('event_id', eventIds),
      supabase
        .from('vendor_bookings')
        .select('id, event_id, status, payment_status, paid_at, deposit_paid')
        .in('event_id', eventIds),
      supabase
        .from('event_sales_data')
        .select('id, event_id')
        .in('event_id', eventIds)
        .limit(1000),
    ])

    if (financialsResult.error) issues.push({ area: 'Financial summaries', message: financialsResult.error.message })
    if (venueBookingsResult.error) issues.push({ area: 'Venue bookings', message: venueBookingsResult.error.message })
    if (vendorBookingsResult.error) issues.push({ area: 'Vendor bookings', message: vendorBookingsResult.error.message })
    if (salesResult.error) issues.push({ area: 'Ticket sales rows', message: salesResult.error.message })

    financials = ((financialsResult.data ?? []) as FinancialRow[])
    venueBookings = ((venueBookingsResult.data ?? []) as BookingRow[])
    vendorBookings = ((vendorBookingsResult.data ?? []) as BookingRow[])
    salesRows = ((salesResult.data ?? []) as SalesRow[])
  }

  return buildExperiencesData({
    isAuthenticated: true,
    plans,
    events,
    financials,
    venueBookings,
    vendorBookings,
    salesRows,
    ticketingConnections,
    issues,
  })
}

function buildExperiencesData({
  isAuthenticated,
  plans,
  events,
  financials,
  venueBookings,
  vendorBookings,
  salesRows,
  ticketingConnections,
  issues,
}: {
  isAuthenticated: boolean
  plans: PlanRow[]
  events: EventRow[]
  financials: FinancialRow[]
  venueBookings: BookingRow[]
  vendorBookings: BookingRow[]
  salesRows: SalesRow[]
  ticketingConnections: TicketingConnectionRow[]
  issues: LoadIssue[]
}): ExperiencesData {
  const financialsByEvent = new Map(financials.map((row) => [row.event_id, row]))
  const salesEventIds = new Set(salesRows.map((row) => row.event_id))
  const venueBookingsByEvent = groupBookingsByEvent(venueBookings)
  const vendorBookingsByEvent = groupBookingsByEvent(vendorBookings)
  const eventRecords = events.map((event) => buildEventRecord({
    event,
    financial: financialsByEvent.get(event.id) ?? null,
    venueBookings: venueBookingsByEvent.get(event.id) ?? [],
    vendorBookings: vendorBookingsByEvent.get(event.id) ?? [],
    hasSalesRows: salesEventIds.has(event.id),
  }))
  const planRecords = plans.map(buildPlanRecord)
  const records = [...eventRecords, ...planRecords]
    .sort((first, second) => getRecordSortValue(second) - getRecordSortValue(first))
    .slice(0, 20)

  const activeStatuses = new Set(['draft', 'planning', 'venue_pending', 'confirmed', 'live'])
  const activeEvents = events.filter((event) => activeStatuses.has((event.status ?? '').toLowerCase()))
  const activePlans = plans.filter((plan) => !['complete', 'archived'].includes(plan.status))
  const connectedTicketingCount = ticketingConnections.filter((connection) => isConnectedTicketingStatus(connection.status) || Boolean(connection.last_webhook_received_at)).length
  const eventsWithTicketing = events.filter((event) => {
    const financial = financialsByEvent.get(event.id)
    return Boolean(event.eventbrite_event_id || event.posh_event_id || salesEventIds.has(event.id) || (toNumber(financial?.tickets_sold) ?? 0) > 0)
  })
  const bookedPartnerCount = [...venueBookings, ...vendorBookings].filter(isBookedPartner).length
  const profitabilityRows = financials.filter((row) => hasFinancialSignal(row))
  const recurringEvents = events.filter((event) => Boolean(event.is_recurring || event.recurring_frequency))
  const completedEvents = events.filter((event) => (event.status ?? '').toLowerCase() === 'completed')
  const averageMargin = average(profitabilityRows.map((row) => toNumber(row.profit_margin)).filter((value) => value !== null))

  const metrics = [
    {
      label: 'Operating records',
      value: String(events.length + plans.length),
      detail: `${events.length} event${events.length === 1 ? '' : 's'} and ${plans.length} planner draft${plans.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Active pipeline',
      value: String(activeEvents.length + activePlans.length),
      detail: 'Draft, ready, approved, executing, or upcoming records',
    },
    {
      label: 'Ticketing data',
      value: String(eventsWithTicketing.length),
      detail: connectedTicketingCount > 0 ? `${connectedTicketingCount} account connection${connectedTicketingCount === 1 ? '' : 's'} with usable status` : 'Events with imported sales or platform ids',
    },
    {
      label: 'Booked partners',
      value: String(bookedPartnerCount),
      detail: 'Confirmed or approved venue/vendor booking rows',
    },
  ]

  const coverage = [
    {
      title: 'Plan artifacts',
      icon: ClipboardList,
      value: String(plans.length),
      body: plans.length > 0
        ? 'Planner conversations have saved drafts with event type, date window, guest target, budget, and profitability goals where available.'
        : 'No saved planner drafts yet. A draft appears here only after the planner persists a real plan.',
      tone: plans.length > 0 ? 'ready' as const : 'empty' as const,
    },
    {
      title: 'Venue + vendor stack',
      icon: Building2,
      value: String(bookedPartnerCount),
      body: bookedPartnerCount > 0
        ? 'Booked partner progress is coming from venue and vendor booking tables, not placeholder counts.'
        : 'No approved or confirmed partner bookings are attached to these events yet.',
      tone: bookedPartnerCount > 0 ? 'ready' as const : 'empty' as const,
    },
    {
      title: 'Ticketing performance',
      icon: Ticket,
      value: String(eventsWithTicketing.length),
      body: eventsWithTicketing.length > 0
        ? 'Ticketing coverage is based on platform ids, imported sales rows, or calculated tickets sold.'
        : 'No event has imported ticketing rows yet. Connect or import a specific event before this fills in.',
      tone: eventsWithTicketing.length > 0 ? 'ready' as const : connectedTicketingCount > 0 ? 'partial' as const : 'empty' as const,
    },
    {
      title: 'Profitability optimization',
      icon: TrendingUp,
      value: averageMargin === null ? `${profitabilityRows.length}` : `${Math.round(averageMargin)}% avg`,
      body: profitabilityRows.length > 0
        ? `${profitabilityRows.length} event${profitabilityRows.length === 1 ? '' : 's'} have revenue, cost, profit, or margin summaries.`
        : 'No financial summaries are attached yet. Profitability appears after ticketing, costs, or event financial recomputation runs.',
      tone: profitabilityRows.length > 0 ? 'ready' as const : 'empty' as const,
    },
    {
      title: 'Repeat-event memory',
      icon: Repeat2,
      value: String(recurringEvents.length + completedEvents.length),
      body: recurringEvents.length + completedEvents.length > 0
        ? 'Recurring or completed events are available for review, template decisions, and rebook planning.'
        : 'No recurring or completed event history is present yet, so there is no rebook signal to optimize.',
      tone: recurringEvents.length + completedEvents.length > 0 ? 'ready' as const : 'empty' as const,
    },
    {
      title: 'Guest operations',
      icon: Users,
      value: String(events.reduce((sum, event) => sum + (event.expected_attendance ?? event.expected_attendance_max ?? event.expected_attendance_min ?? 0), 0)),
      body: events.length > 0
        ? 'Guest targets are read from event records. Check-in quality depends on imported attendee or ticketing data.'
        : 'Guest operations will stay empty until an event exists with expected attendance or imported attendees.',
      tone: events.length > 0 ? 'partial' as const : 'empty' as const,
    },
  ]

  return {
    isAuthenticated,
    plans,
    events,
    records,
    metrics,
    coverage,
    issues,
  }
}

function buildEventRecord({
  event,
  financial,
  venueBookings,
  vendorBookings,
  hasSalesRows,
}: {
  event: EventRow
  financial: FinancialRow | null
  venueBookings: BookingRow[]
  vendorBookings: BookingRow[]
  hasSalesRows: boolean
}): ExperienceRecord {
  const partnerCount = [...venueBookings, ...vendorBookings].filter(isBookedPartner).length
  const ticketsSold = toNumber(financial?.tickets_sold)
  const hasTicketing = Boolean(event.eventbrite_event_id || event.posh_event_id || hasSalesRows || (ticketsSold ?? 0) > 0)
  const hasFinancials = Boolean(financial && hasFinancialSignal(financial))
  const expectedProfit = toNumber(financial?.expected_profit)
  const margin = toNumber(financial?.profit_margin)

  return {
    id: event.id,
    kind: 'event',
    title: event.event_name || 'Untitled event',
    href: `/planner/events/${event.id}/live`,
    dateLabel: formatDate(event.event_date),
    statusLabel: titleize(event.status ?? 'draft'),
    sourceLabel: event.is_recurring || event.recurring_frequency ? 'Recurring event' : 'Event record',
    detail: [
      titleize(event.event_type),
      formatGuestCount(event.expected_attendance ?? event.expected_attendance_max ?? event.expected_attendance_min),
      event.budget ?? event.total_budget ? `Budget ${formatMoneyDollars(event.budget ?? event.total_budget ?? 0)}` : null,
    ].filter(Boolean).join(' · '),
    partnerCount,
    hasTicketing,
    hasFinancials,
    profitLabel: hasFinancials && expectedProfit !== null ? formatMoneyDollars(expectedProfit) : 'No summary',
    marginLabel: margin === null ? 'No margin summary yet' : `${Math.round(margin)}% margin`,
    nextAction: getEventNextAction(event, partnerCount, hasTicketing, hasFinancials),
  }
}

function buildPlanRecord(plan: PlanRow): ExperienceRecord {
  const detail = [
    plan.event_type ? titleize(plan.event_type) : null,
    formatGuestCount(plan.guest_count),
    plan.budget_cap_cents ? `Budget cap ${formatMoneyCents(plan.budget_cap_cents)}` : null,
    plan.profit_goal_cents ? `Profit goal ${formatMoneyCents(plan.profit_goal_cents)}` : null,
  ].filter(Boolean).join(' · ')

  return {
    id: plan.id,
    kind: 'plan',
    title: plan.title || 'Untitled planner draft',
    href: `/planner?plan=${plan.id}`,
    dateLabel: formatDateWindow(plan.date_window_start, plan.date_window_end),
    statusLabel: titleize(plan.status),
    sourceLabel: 'Planner draft',
    detail: detail || 'Planner artifact saved from an event conversation.',
    partnerCount: 0,
    hasTicketing: Boolean(plan.ticketed || plan.ticketing_model),
    hasFinancials: Boolean(plan.budget_cap_cents || plan.profit_goal_cents),
    profitLabel: plan.profit_goal_cents ? formatMoneyCents(plan.profit_goal_cents) : 'Planning',
    marginLabel: plan.ticketing_model ? `${titleize(plan.ticketing_model)} model` : 'No ticketing model yet',
    nextAction: getPlanNextAction(plan),
  }
}

function RecordSignal({ icon, label, value, ready }: { icon: React.ReactNode; label: string; value: string; ready: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
      ready ? 'border-forest/25 bg-forest-tint text-forest' : 'border-tan bg-cream text-ink-soft'
    )}>
      {icon}
      <span className="font-semibold text-ink">{label}</span>
      <span className="ml-auto truncate">{value}</span>
    </div>
  )
}

function EmptyState({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string
  body: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <div className="rounded-md border border-dashed border-tan bg-cream-deep/55 p-8 text-center">
      <CalendarDays className="mx-auto h-8 w-8 text-ink-soft" />
      <h3 className="mt-3 font-display text-lg font-bold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{body}</p>
      <Button className="mt-5" size="sm" asChild>
        <Link href={actionHref}>{actionLabel}</Link>
      </Button>
    </div>
  )
}

function groupBookingsByEvent(bookings: BookingRow[]) {
  return bookings.reduce((map, booking) => {
    const rows = map.get(booking.event_id) ?? []
    rows.push(booking)
    map.set(booking.event_id, rows)
    return map
  }, new Map<string, BookingRow[]>())
}

function isBookedPartner(booking: BookingRow) {
  const status = (booking.status ?? '').toLowerCase()
  return ['approved', 'confirmed', 'accepted', 'booked', 'complete', 'completed'].includes(status)
}

function isConnectedTicketingStatus(status: string) {
  return ['connected', 'linked', 'completed'].includes(status)
}

function hasFinancialSignal(row: FinancialRow) {
  return (
    toNumber(row.tickets_sold) !== null ||
    toNumber(row.net_revenue) !== null ||
    toNumber(row.total_costs) !== null ||
    toNumber(row.expected_profit) !== null ||
    toNumber(row.profit_margin) !== null
  )
}

function getEventNextAction(event: EventRow, partnerCount: number, hasTicketing: boolean, hasFinancials: boolean) {
  const status = (event.status ?? '').toLowerCase()
  if (status === 'completed') return hasFinancials ? 'Review profitability' : 'Add post-event data'
  if (partnerCount === 0) return 'Attach venue/vendor terms'
  if (!hasTicketing) return 'Connect ticketing data'
  return 'Track live readiness'
}

function getPlanNextAction(plan: PlanRow) {
  if (plan.status === 'drafting') return 'Clarify plan'
  if (plan.status === 'ready') return 'Review approvals'
  if (plan.status === 'approved') return 'Prepare execution'
  if (plan.status === 'executing') return 'Track execution'
  if (plan.status === 'complete') return 'Save or rebook'
  return 'Review record'
}

function getRecordSortValue(record: ExperienceRecord) {
  if (record.dateLabel === 'Date TBD') return 0
  const parsed = Date.parse(record.dateLabel)
  return Number.isNaN(parsed) ? 0 : parsed
}

function formatDate(value: string | null) {
  if (!value) return 'Date TBD'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return 'Date TBD'
  if (start && end && start !== end) return `${formatDate(start)} - ${formatDate(end)}`
  return formatDate(start ?? end)
}

function formatGuestCount(value: number | null) {
  if (!value) return null
  return `${value.toLocaleString()} guests`
}

function formatMoneyDollars(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMoneyCents(value: number) {
  return formatMoneyDollars(value / 100)
}

function titleize(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
