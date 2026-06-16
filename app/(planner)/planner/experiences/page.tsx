import Link from 'next/link'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Repeat2,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlannerMobileRouteHeader } from '@/components/planner/PlannerMobileRouteHeader'
import { hasImportedGuestAttendanceLabel } from '@/lib/planner/experienceGuestStatus'
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
  break_even_tickets: number | string | null
  current_attendance: number | string | null
  gross_revenue: number | string | null
  tickets_sold: number | string | null
  net_revenue: number | string | null
  per_attendee_value: number | string | null
  projected_revenue: number | string | null
  total_costs: number | string | null
  total_fees: number | string | null
  total_refunds: number | string | null
  expected_profit: number | string | null
  profit_margin: number | string | null
  vendor_cost: number | string | null
  venue_cost: number | string | null
  updated_at: string | null
}

type RecordTone = 'settled' | 'action' | 'watch' | 'empty'

type BaseBookingRow = {
  id: string
  event_id: string
  status: string | null
  payment_status: string | null
  paid_at: string | null
}

type VenueBookingRow = BaseBookingRow & {
  approval_source?: string | null
  approved_at?: string | null
  booking_date?: string | null
  end_time?: string | null
  final_price?: number | null
  guest_count_max?: number | null
  guest_count_min?: number | null
  quoted_price?: number | null
  services_needed?: unknown
  special_requests?: string | null
  start_time?: string | null
  subtotal?: number | null
  total_amount?: number | null
  venue_id?: string | null
  venues?: {
    venue_name?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
  } | null
}

type VendorBookingRow = BaseBookingRow & {
  booking_date?: string | null
  confirmed_date?: string | null
  confirmed_end_time?: string | null
  confirmed_start_time?: string | null
  deposit_amount?: number | null
  deposit_paid?: boolean | null
  final_price?: number | null
  guest_count?: number | null
  notes?: string | null
  quantity?: number | null
  quoted_price?: number | null
  requested_date?: string | null
  requested_end_time?: string | null
  requested_start_time?: string | null
  setup_time?: string | null
  subtotal?: number | null
  total_amount?: number | null
  vendor_id?: string | null
  vendor_profiles?: {
    name?: string | null
    service_type?: string | null
  } | null
  vendor_offerings?: {
    offering_name?: string | null
    service_category?: string | null
    duration_hours?: number | null
  } | null
  vendor_packages?: {
    package_name?: string | null
    duration_hours?: number | null
  } | null
}

type ExperienceBookingItem = {
  id: string
  kind: 'venue' | 'vendor'
  category: string
  partnerName: string
  detail: string
  costAmount: number | null
  costLabel: string
  scheduleLabel: string
  status: string
  paymentStatus: string
  tone: RecordTone
  terms: Array<{ label: string; value: string }>
  approvalCopy: string
  targetHref: string
  targetLabel: string
}

type SalesRow = {
  id: string
  event_id: string
  ticket_quantity: number | string | null
  is_refund: boolean | null
  purchase_timestamp: string | null
  received_at: string | null
  submitted_at: string | null
  created_at: string | null
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
  metroLabel: string
  timingLabel: string
  statusLabel: string
  sourceLabel: string
  detail: string
  headerChips: string[]
  attentionLabel: string
  attentionTone: RecordTone
  partnerCount: number
  hasTicketing: boolean
  hasFinancials: boolean
  profitLabel: string
  marginLabel: string
  nextAction: string
  banner: NeedsYouBannerRecord
  bookingItems: ExperienceBookingItem[]
  money: MoneyRecord | null
  guests: GuestRecord
}

type NeedsYouBannerRecord = {
  tone: 'action' | 'watch' | 'settled'
  eyebrow: string
  title: string
  body: string
  primaryHref: string
  primaryLabel: string
  secondaryHref: string
  secondaryLabel: string
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

type OperatingSection = {
  number: string
  title: string
  summary: string
  status: string
  tone: RecordTone
  defaultOpen: boolean
  details?: Array<{ label: string; value: string }>
  bookingItems?: ExperienceBookingItem[]
  money?: MoneyRecord | null
  guests?: GuestRecord
  actionHref: string
  actionLabel: string
  note?: string
}

type MoneyRecord = {
  projectedProfitLabel: string
  confidenceLabel: string
  totalIncomeLabel: string
  totalCostLabel: string
  marginLabel: string
  breakEvenLabel: string
  perAttendeeLabel: string
  incomeLines: Array<{ label: string; value: string }>
  costLines: Array<{ label: string; value: string }>
  watchTitle: string
  watchBody: string
}

type GuestRecord = {
  targetLabel: string
  confirmedLabel: string
  remainingLabel: string
  ticketingLabel: string
  movementLabel: string
  movementDetail: string
  readinessCopy: string
}

/**
 * Data-backed operating-record route for recurring hosts.
 */
export default async function ExperiencesPage({
  searchParams,
}: {
  searchParams?: { record?: string }
}) {
  const data = await loadExperiencesData()
  const hasRecords = data.records.length > 0
  const primaryRecord = getSelectedRecord(data.records, searchParams?.record)

  return (
    <div className="min-h-full bg-cream text-ink">
      <PlannerMobileRouteHeader
        actionHref="/planner/experiences"
        actionLabel="Records"
        activeHref="/planner/experiences"
      />
      {primaryRecord ? <RecordTopBar record={primaryRecord} /> : <ExperiencesEmptyHeader />}

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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

        {!data.isAuthenticated ? (
          <EmptyState
            title="Sign in to view event records"
            body="Experiences reads your planner drafts, imported events, bookings, ticketing data, and profitability summaries after authentication."
            actionHref="/login"
            actionLabel="Sign in"
          />
        ) : hasRecords && primaryRecord ? (
          <>
            <RecordRail records={data.records} primaryRecord={primaryRecord} />

            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <h2 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">{primaryRecord.title}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">{primaryRecord.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {primaryRecord.headerChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-tan bg-cream px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                    {chip}
                  </span>
                ))}
              </div>
            </section>

            <section
              className={cn(
                'rounded-lg border p-5 sm:p-6',
                primaryRecord.banner.tone === 'settled' && 'border-forest/20 bg-forest-tint/45',
                primaryRecord.banner.tone === 'watch' && 'border-ochre/25 bg-ochre-tint/45',
                primaryRecord.banner.tone === 'action' && 'border-clay/25 bg-clay-tint/45'
              )}
              aria-label="What needs you"
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <p className={cn(
                    'text-xs font-bold uppercase tracking-[0.18em]',
                    primaryRecord.banner.tone === 'settled' && 'text-forest',
                    primaryRecord.banner.tone === 'watch' && 'text-ochre',
                    primaryRecord.banner.tone === 'action' && 'text-clay-deep'
                  )}>
                    What needs you
                  </p>
                  <h3 className="mt-3 max-w-4xl font-display text-xl font-bold leading-tight text-ink sm:text-2xl">
                    {primaryRecord.banner.eyebrow}
                  </h3>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-soft sm:text-base">
                    {primaryRecord.banner.title}
                  </p>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-faint sm:text-base">
                    {primaryRecord.banner.body}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-stretch">
                  <Button asChild>
                    <Link href={primaryRecord.banner.primaryHref}>
                      {primaryRecord.banner.primaryLabel}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href={primaryRecord.banner.secondaryHref}>{primaryRecord.banner.secondaryLabel}</Link>
                  </Button>
                  <p className="max-w-[18rem] text-xs leading-5 text-ink-faint">
                    The agent prepares the next move, but the host approves before any message, booking, or payment executes.
                  </p>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-tan bg-cream shadow-card" aria-label="Event operating record">
              {buildOperatingSections(primaryRecord).map((section) => (
                <OperatingRecordRow key={section.title} section={section} />
              ))}
            </section>
          </>
        ) : (
          <EmptyState
            title="No event records yet"
            body="Saved planner drafts, imported ticketing events, confirmed bookings, and completed event reports will appear here once they exist."
            actionHref="/planner"
            actionLabel="Start in planner"
          />
        )}
      </div>
    </div>
  )
}

function RecordTopBar({ record }: { record: ExperienceRecord }) {
  return (
    <div className="border-b border-tan bg-cream/95 px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
          {record.title} / {record.dateLabel} / <span className="text-clay">{record.kind === 'plan' ? 'Planning' : 'Record'}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <RecordKindPill record={record} />
          <span className="rounded-full border border-tan bg-cream px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
            {record.statusLabel}
          </span>
        </div>
      </div>
    </div>
  )
}

function ExperiencesEmptyHeader() {
  return (
    <div className="border-b border-tan bg-cream/95 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Experiences</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Operating files for every event
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
            Each saved plan becomes a live record for partner progress, ticketing coverage, guest targets, and profitability signals.
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
  let venueBookings: VenueBookingRow[] = []
  let vendorBookings: VendorBookingRow[] = []
  let salesRows: SalesRow[] = []

  if (eventIds.length > 0) {
    const [financialsResult, venueBookingsResult, vendorBookingsResult, salesResult] = await Promise.all([
      supabase
        .from('event_financial_summary')
        .select('event_id, break_even_tickets, current_attendance, gross_revenue, tickets_sold, net_revenue, per_attendee_value, projected_revenue, total_costs, total_fees, total_refunds, expected_profit, profit_margin, vendor_cost, venue_cost, updated_at')
        .in('event_id', eventIds),
      supabase
        .from('venue_bookings')
        .select(`
          id,
          event_id,
          status,
          payment_status,
          paid_at,
          approval_source,
          approved_at,
          booking_date,
          start_time,
          end_time,
          final_price,
          quoted_price,
          total_amount,
          venue_id,
          subtotal,
          guest_count_min,
          guest_count_max,
          services_needed,
          special_requests,
          venues (
            venue_name,
            address,
            city,
            state
          )
        `)
        .in('event_id', eventIds),
      supabase
        .from('vendor_bookings')
        .select(`
          id,
          event_id,
          status,
          payment_status,
          paid_at,
          booking_date,
          requested_date,
          requested_start_time,
          requested_end_time,
          confirmed_date,
          confirmed_start_time,
          confirmed_end_time,
          final_price,
          quoted_price,
          total_amount,
          vendor_id,
          subtotal,
          deposit_amount,
          deposit_paid,
          quantity,
          guest_count,
          notes,
          setup_time,
          vendor_profiles (
            name,
            service_type
          ),
          vendor_offerings (
            offering_name,
            service_category,
            duration_hours
          ),
          vendor_packages (
            package_name,
            duration_hours
          )
        `)
        .in('event_id', eventIds),
      supabase
        .from('event_sales_data')
        .select('id, event_id, ticket_quantity, is_refund, purchase_timestamp, received_at, submitted_at, created_at')
        .in('event_id', eventIds)
        .limit(1000),
    ])

    if (financialsResult.error) issues.push({ area: 'Financial summaries', message: financialsResult.error.message })
    if (venueBookingsResult.error) issues.push({ area: 'Venue bookings', message: venueBookingsResult.error.message })
    if (vendorBookingsResult.error) issues.push({ area: 'Vendor bookings', message: vendorBookingsResult.error.message })
    if (salesResult.error) issues.push({ area: 'Ticket sales rows', message: salesResult.error.message })

    financials = ((financialsResult.data ?? []) as FinancialRow[])
    venueBookings = ((venueBookingsResult.data ?? []) as VenueBookingRow[])
    vendorBookings = ((vendorBookingsResult.data ?? []) as VendorBookingRow[])
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
  venueBookings: VenueBookingRow[]
  vendorBookings: VendorBookingRow[]
  salesRows: SalesRow[]
  ticketingConnections: TicketingConnectionRow[]
  issues: LoadIssue[]
}): ExperiencesData {
  const financialsByEvent = new Map(financials.map((row) => [row.event_id, row]))
  const salesRowsByEvent = groupSalesRowsByEvent(salesRows)
  const salesEventIds = new Set(salesRows.map((row) => row.event_id))
  const venueBookingsByEvent = groupBookingsByEvent(venueBookings)
  const vendorBookingsByEvent = groupBookingsByEvent(vendorBookings)
  const eventRecords = events.map((event) => buildEventRecord({
    event,
    financial: financialsByEvent.get(event.id) ?? null,
    venueBookings: venueBookingsByEvent.get(event.id) ?? [],
    vendorBookings: vendorBookingsByEvent.get(event.id) ?? [],
    salesRows: salesRowsByEvent.get(event.id) ?? [],
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
  salesRows,
}: {
  event: EventRow
  financial: FinancialRow | null
  venueBookings: VenueBookingRow[]
  vendorBookings: VendorBookingRow[]
  salesRows: SalesRow[]
}): ExperienceRecord {
  const bookingItems = [
    ...venueBookings.map(buildVenueBookingItem),
    ...vendorBookings.map(buildVendorBookingItem),
  ]
  const partnerCount = bookingItems.filter((item) => item.tone === 'settled').length
  const ticketsSold = toNumber(financial?.tickets_sold)
  const hasTicketing = Boolean(event.eventbrite_event_id || event.posh_event_id || salesRows.length > 0 || (ticketsSold ?? 0) > 0)
  const hasFinancials = Boolean(financial && hasFinancialSignal(financial))
  const expectedProfit = toNumber(financial?.expected_profit)
  const margin = toNumber(financial?.profit_margin)
  const guests = buildGuestRecord(event, financial, salesRows, hasTicketing)
  const nextAction = getEventNextAction(event, bookingItems.length, hasTicketing, hasFinancials)
  const attention = getRecordAttention(nextAction)
  const statusLabel = titleize(event.status ?? 'draft')
  const metroLabel = deriveEventMetro(event, venueBookings)
  const guestChip = formatGuestCount(event.expected_attendance ?? event.expected_attendance_max ?? event.expected_attendance_min) ?? 'Guest target TBD'
  const ticketingChip = hasTicketing ? getTicketingLabel(event) : 'Ticketing not connected'
  const eventHref = `/planner/events/${event.id}/live`

  return {
    id: event.id,
    kind: 'event',
    title: event.event_name || 'Untitled event',
    href: eventHref,
    dateLabel: formatDate(event.event_date),
    metroLabel,
    timingLabel: formatTimingLabel(event.event_date),
    statusLabel,
    sourceLabel: event.is_recurring || event.recurring_frequency ? 'Recurring event' : 'Event record',
    detail: [
      formatDate(event.event_date),
      titleize(event.event_type),
      guestChip,
      event.budget ?? event.total_budget ? `Budget ${formatMoneyDollars(event.budget ?? event.total_budget ?? 0)}` : null,
    ].filter(Boolean).join(' · '),
    headerChips: [metroLabel, guestChip, ticketingChip],
    attentionLabel: attention.label,
    attentionTone: attention.tone,
    partnerCount,
    hasTicketing,
    hasFinancials,
    profitLabel: hasFinancials && expectedProfit !== null ? formatMoneyDollars(expectedProfit) : 'No summary',
    marginLabel: margin === null ? 'No margin summary yet' : `${Math.round(margin)}% margin`,
    nextAction,
    banner: buildNeedsYouBanner({
      nextAction,
      recordHref: eventHref,
      hasTicketing,
      hasFinancials,
      isCompleted: (event.status ?? '').toLowerCase() === 'completed',
    }),
    bookingItems,
    money: buildMoneyRecord(financial, bookingItems, guests),
    guests,
  }
}

function buildPlanRecord(plan: PlanRow): ExperienceRecord {
  const dateLabel = formatDateWindow(plan.date_window_start, plan.date_window_end)
  const guestChip = formatGuestCount(plan.guest_count) ?? 'Guest target TBD'
  const ticketingChip = plan.ticketed || plan.ticketing_model ? titleize(plan.ticketing_model ?? 'Ticketed') : 'Ticketing not connected'
  const nextAction = getPlanNextAction(plan)
  const attention = getRecordAttention(nextAction)
  const planHref = `/planner?plan=${plan.id}`
  const detail = [
    dateLabel,
    plan.event_type ? titleize(plan.event_type) : null,
    guestChip,
    plan.budget_cap_cents ? `Budget cap ${formatMoneyCents(plan.budget_cap_cents)}` : null,
    plan.profit_goal_cents ? `Profit goal ${formatMoneyCents(plan.profit_goal_cents)}` : null,
  ].filter(Boolean).join(' · ')

  return {
    id: plan.id,
    kind: 'plan',
    title: plan.title || 'Untitled planner draft',
    href: planHref,
    dateLabel,
    metroLabel: 'Bay Area',
    timingLabel: formatTimingLabel(plan.date_window_start),
    statusLabel: titleize(plan.status),
    sourceLabel: 'Planner draft',
    detail: detail || 'Planner artifact saved from an event conversation.',
    headerChips: ['Bay Area', guestChip, ticketingChip],
    attentionLabel: attention.label,
    attentionTone: attention.tone,
    partnerCount: 0,
    hasTicketing: Boolean(plan.ticketed || plan.ticketing_model),
    hasFinancials: Boolean(plan.budget_cap_cents || plan.profit_goal_cents),
    profitLabel: plan.profit_goal_cents ? formatMoneyCents(plan.profit_goal_cents) : 'Planning',
    marginLabel: plan.ticketing_model ? `${titleize(plan.ticketing_model)} model` : 'No ticketing model yet',
    nextAction,
    banner: buildNeedsYouBanner({
      nextAction,
      recordHref: planHref,
      hasTicketing: Boolean(plan.ticketed || plan.ticketing_model),
      hasFinancials: Boolean(plan.budget_cap_cents || plan.profit_goal_cents),
      isCompleted: plan.status === 'complete',
    }),
    bookingItems: [],
    money: null,
    guests: {
      targetLabel: formatGuestCount(plan.guest_count) ?? 'Guest target not set yet',
      confirmedLabel: 'No imported attendance yet',
      remainingLabel: 'Capacity opens once ticketing or RSVP rows are imported',
      ticketingLabel: plan.ticketed || plan.ticketing_model ? titleize(plan.ticketing_model ?? 'ticketed') : 'No ticketing model yet',
      movementLabel: 'No imported guest increase yet',
      movementDetail: 'When ticketing or RSVP rows increase, this count updates automatically from the event record.',
      readinessCopy: 'Planner drafts become guest operations once the event has imported attendees, ticketing rows, or expected attendance.',
    },
  }
}

function RecordRail({ records, primaryRecord }: { records: ExperienceRecord[]; primaryRecord: ExperienceRecord }) {
  return (
    <section aria-label="Experience record selector" className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="flex min-w-max snap-x gap-3 lg:min-w-0 lg:grid lg:grid-cols-4">
        {records.slice(0, 4).map((record) => {
          const isSelected = record.kind === primaryRecord.kind && record.id === primaryRecord.id

          return (
            <Link
              key={`${record.kind}-${record.id}`}
              href={getExperienceRecordRoute(record)}
              className={cn(
                'group flex min-h-[13.75rem] w-[17rem] snap-start flex-col rounded-lg border bg-cream-deep/45 p-4 transition-smooth lg:w-auto',
                isSelected
                  ? 'border-clay bg-cream shadow-card'
                  : 'border-tan hover:border-clay/45 hover:bg-cream'
              )}
              aria-current={isSelected ? 'page' : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">{record.dateLabel}</p>
                <span className={cn('mt-1 h-2.5 w-2.5 rounded-full', dotClass(record.attentionTone))} />
              </div>
              <h2 className="mt-4 line-clamp-2 min-h-[3.5rem] font-display text-xl font-bold leading-tight text-ink">{record.title}</h2>
              <p className="mt-2 line-clamp-2 min-h-[3rem] text-sm leading-6 text-ink-soft">{record.nextAction}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <RecordKindPill record={record} />
                <span className={cn('text-xs font-bold uppercase tracking-[0.1em] opacity-0 transition-opacity group-hover:opacity-100', attentionTextClass(record.attentionTone))}>
                  Open
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function RecordKindPill({ record }: { record: ExperienceRecord }) {
  return (
    <span className={cn(
      'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase leading-none tracking-normal',
      record.kind === 'event'
        ? 'border-forest/25 bg-forest-tint text-forest'
        : 'border-clay/25 bg-clay-tint text-clay-deep'
    )}>
      {record.sourceLabel}
    </span>
  )
}

function buildOperatingSections(record: ExperienceRecord): OperatingSection[] {
  const hasBookings = record.bookingItems.length > 0
  const hasMoney = record.hasFinancials
  const hasGuestTarget = record.guests.targetLabel !== 'Guest target not set yet'
  const hasConfirmedGuests = hasImportedGuestAttendanceLabel(record.guests.confirmedLabel)
  const defaultOpenTitle = getDefaultOperatingSection(record, hasBookings, hasMoney)

  return [
    {
      number: '01',
      title: 'Plan',
      summary: record.kind === 'plan' ? record.detail : `${record.sourceLabel}. ${record.detail}`,
      status: record.statusLabel,
      tone: record.statusLabel.toLowerCase().includes('draft') ? 'watch' : 'settled',
      defaultOpen: defaultOpenTitle === 'Plan',
      details: [
        { label: 'Record type', value: record.sourceLabel },
        { label: 'Timing', value: record.dateLabel },
        { label: 'Source', value: record.kind === 'plan' ? 'Planner conversation' : 'Event record' },
        { label: 'Approval model', value: 'Host approves before execution' },
      ],
      actionHref: record.href,
      actionLabel: record.kind === 'plan' ? 'Open planner draft' : 'Open event live view',
    },
    {
      number: '02',
      title: 'Bookings',
      summary: hasBookings
        ? `${record.partnerCount} approved or confirmed partner booking${record.partnerCount === 1 ? '' : 's'} attached.`
        : 'No approved or confirmed partner bookings are attached yet.',
      status: hasBookings ? 'On track' : 'Action required',
      tone: hasBookings ? 'settled' : 'action',
      defaultOpen: defaultOpenTitle === 'Bookings',
      details: [
        { label: 'Attached rows', value: String(record.bookingItems.length) },
        { label: 'Confirmed partners', value: String(record.partnerCount) },
        { label: 'Next step', value: hasBookings ? 'Track execution' : 'Attach venue/vendor terms' },
      ],
      bookingItems: record.bookingItems,
      actionHref: record.kind === 'plan' ? record.href : hasBookings ? record.href : '/planner/venues',
      actionLabel: hasBookings ? 'Review event bookings' : 'Find venue/vendor terms',
      note: hasBookings
        ? 'Booking rows are read from venue_bookings and vendor_bookings. Approval actions here are review surfaces only until wired to an approval route.'
        : 'Partner terms will appear here after the planner creates or links a real venue/vendor booking row.',
    },
    {
      number: '03',
      title: 'Money',
      summary: hasMoney
        ? `${record.profitLabel}. ${record.marginLabel}.`
        : 'No financial summary is attached yet. Profitability appears after ticketing, costs, or event financial recomputation runs.',
      status: hasMoney ? 'On track' : 'Needs data',
      tone: hasMoney ? 'settled' : 'watch',
      defaultOpen: defaultOpenTitle === 'Money',
      details: [
        { label: 'Profit signal', value: record.profitLabel },
        { label: 'Margin signal', value: record.marginLabel },
      ],
      money: record.money,
      actionHref: record.kind === 'event' ? `/planner/events/${record.id}/costs` : record.href,
      actionLabel: hasMoney ? 'Open event costs' : 'Add costs and revenue',
      note: hasMoney ? 'The agent should keep checking whether new costs change the event economics.' : 'Money fills from event_financial_summary, ticketing rows, and attached booking costs.',
    },
    {
      number: '04',
      title: 'Guests',
      summary: hasGuestTarget ? `${record.guests.targetLabel}. ${record.guests.confirmedLabel}.` : 'Guest target not set yet.',
      status: hasConfirmedGuests ? 'On track' : hasGuestTarget ? 'Needs data' : 'Needs target',
      tone: hasConfirmedGuests ? 'settled' : hasGuestTarget ? 'watch' : 'empty',
      defaultOpen: defaultOpenTitle === 'Guests',
      details: [
        { label: 'Guest target', value: record.guests.targetLabel },
        { label: 'Confirmed', value: record.guests.confirmedLabel },
        { label: 'Movement', value: record.guests.movementLabel },
        { label: 'Remaining', value: record.guests.remainingLabel },
      ],
      guests: record.guests,
      actionHref: record.hasTicketing ? '/planner/tickets' : '/planner/integrations/eventbrite',
      actionLabel: record.hasTicketing ? 'Open ticketing' : 'Connect ticketing data',
    },
  ]
}

function OperatingRecordRow({ section }: { section: OperatingSection }) {
  return (
    <details className="group border-b border-tan last:border-b-0" open={section.defaultOpen}>
      <summary className="grid cursor-pointer list-none grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-4 px-4 py-6 transition-smooth hover:bg-cream-deep/40 sm:grid-cols-[3rem_1fr_auto] sm:items-center sm:px-8 sm:py-8 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">{section.number}</span>
        <span className="min-w-0">
          <span className="block font-display text-xl font-bold leading-tight text-ink sm:text-2xl">{section.title}</span>
          <span className="mt-1 block max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">{section.summary}</span>
        </span>
        <span className="flex items-center justify-end gap-3">
          <span className="hidden sm:inline-flex">
            <StatusPill tone={section.tone}>{section.status}</StatusPill>
          </span>
          <ChevronRight className="h-5 w-5 text-ink-faint transition-transform group-open:rotate-90" />
        </span>
        <span className="col-start-2 sm:hidden">
          <StatusPill tone={section.tone}>{section.status}</StatusPill>
        </span>
      </summary>

      <div className="border-t border-tan bg-cream-deep/25 px-4 py-4 sm:px-8 sm:py-5">
        {section.details?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {section.details.map((detail) => (
              <div key={`${section.number}-${detail.label}`} className="rounded-md border border-tan bg-cream/85 p-4">
                <p className="text-xs text-ink-faint">{detail.label}</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">{detail.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={section.actionHref}>
              {section.actionLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {section.title === 'Bookings' && section.bookingItems?.length === 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/planner/venues">Check venues</Link>
            </Button>
          ) : null}
          {section.title === 'Bookings' && section.bookingItems?.length === 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/planner/vendors">Check vendors</Link>
            </Button>
          ) : null}
        </div>
        {section.title === 'Bookings' ? <BookingsDrilldown items={section.bookingItems ?? []} actionHref={section.actionHref} actionLabel={section.actionLabel} /> : null}
        {section.title === 'Money' ? <MoneyDrilldown money={section.money ?? null} /> : null}
        {section.title === 'Guests' && section.guests ? <GuestsDrilldown guests={section.guests} /> : null}
        {section.note ? <p className="mt-4 text-sm leading-6 text-ink-soft">{section.note}</p> : null}
      </div>
    </details>
  )
}

function BookingsDrilldown({
  items,
  actionHref,
  actionLabel,
}: {
  items: ExperienceBookingItem[]
  actionHref: string
  actionLabel: string
}) {
  if (items.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-tan bg-cream/80 p-5">
        <p className="font-display text-xl font-bold text-ink">No venue or vendor terms attached yet.</p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          The agent can draft recommendations in the planner, but a real booking row only appears after the host approves the terms to track.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={actionHref}>
              {actionLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/planner/venues">Check venue options</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/planner/vendors">Check vendor options</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-tan bg-cream">
      {items.map((item, index) => (
        <details key={item.id} className="group border-b border-tan last:border-b-0" open={index === 0}>
          <summary className="grid cursor-pointer list-none gap-3 px-4 py-5 text-left transition-smooth hover:bg-cream-deep/45 sm:grid-cols-[1rem_minmax(0,1.3fr)_auto_auto_auto] sm:items-center sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className={cn('mt-2 h-2.5 w-2.5 rounded-full sm:mt-0', dotClass(item.tone))} />
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-6 text-ink">
                {item.category} <span className="ml-2 font-normal text-ink-soft">{item.partnerName}</span>
              </span>
              <span className="mt-1 block text-sm text-ink-faint">{item.detail}</span>
            </span>
            <span className="font-mono text-sm font-semibold text-ink sm:text-base">{item.costLabel}</span>
            <StatusPill tone={item.tone}>{item.status}</StatusPill>
            <ChevronDown className="h-5 w-5 text-ink-faint transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-tan bg-cream-deep/35 px-4 py-4 sm:px-6 sm:py-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div>
                <p className="font-display text-xl font-bold text-ink">{item.partnerName}</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">{item.scheduleLabel}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {item.terms.map((term) => (
                    <div key={`${item.id}-${term.label}`} className="rounded-lg border border-tan bg-cream/85 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">{term.label}</p>
                      <p className="mt-2 text-sm leading-6 text-ink">{term.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-clay/25 bg-clay-tint/45 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-clay-deep">
                  {item.tone === 'action' ? 'Approval required' : 'Approval-gated'}
                </p>
                <p className="mt-3 text-sm leading-6 text-ink-soft">{item.approvalCopy}</p>
                <div className="mt-5 flex flex-col gap-2">
                  <Button asChild variant="outline" className="justify-between border-tan bg-cream">
                    <Link href={item.targetHref}>
                      {item.targetLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" className="justify-start px-0 text-clay-deep hover:bg-transparent hover:text-clay">
                    <Link href="/planner">
                      Review in planner
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <p className="text-xs leading-5 text-ink-faint">
                    Booking execution still requires a host approval record before any message, booking, or payment goes out.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

function MoneyDrilldown({ money }: { money: MoneyRecord | null }) {
  if (!money) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-tan bg-cream/80 p-5">
        <p className="font-display text-xl font-bold text-ink">No profitability record yet.</p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Money fills after ticketing imports, venue/vendor costs, or event financial recomputation produce an event_financial_summary row.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-lg border border-tan bg-cream p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">Projected profit</p>
            <p className="mt-2 font-display text-3xl font-bold text-forest sm:text-4xl">{money.projectedProfitLabel}</p>
          </div>
          <span className="rounded-full border border-forest/20 bg-forest-tint px-3 py-1.5 text-xs font-semibold text-forest">
            {money.confidenceLabel}
          </span>
        </div>
        <div className="mt-6 space-y-5">
          <MoneyLineGroup title="Income" lines={money.incomeLines} />
          <MoneyLineGroup title="Costs" lines={money.costLines} />
          <div className="border-t border-tan pt-4">
            <MoneyDisplayRow label="Total income" value={money.totalIncomeLabel} />
            <MoneyDisplayRow label="Total cost" value={money.totalCostLabel} />
            <MoneyDisplayRow label="Projected profit" value={money.projectedProfitLabel} isStrong />
          </div>
        </div>
      </div>

      <aside className="rounded-lg border border-ochre/25 bg-ochre-tint/45 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">Money watch</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DetailStat label="Break-even" value={money.breakEvenLabel} />
          <DetailStat label="Margin" value={money.marginLabel} />
          <DetailStat label="Per attendee" value={money.perAttendeeLabel} />
          <DetailStat label="Confidence" value={money.confidenceLabel} />
        </div>
        <p className="mt-5 text-sm font-semibold text-ink">{money.watchTitle}</p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{money.watchBody}</p>
      </aside>
    </div>
  )
}

function GuestsDrilldown({ guests }: { guests: GuestRecord }) {
  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-lg border border-tan bg-cream p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">Current guest count</p>
        <p className="mt-2 font-display text-2xl font-bold text-ink">{guests.confirmedLabel}</p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{guests.movementLabel}</p>
        <p className="mt-1 text-sm leading-6 text-ink-faint">{guests.movementDetail}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <DetailStat label="Target" value={guests.targetLabel} />
          <DetailStat label="Remaining" value={guests.remainingLabel} />
          <DetailStat label="Ticketing" value={guests.ticketingLabel} />
        </div>
      </div>
      <aside className="rounded-lg border border-tan bg-cream p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">Guest operations</p>
        <p className="mt-4 text-sm leading-6 text-ink-soft">{guests.readinessCopy}</p>
        <Button asChild variant="outline" className="mt-5 w-full border-tan bg-cream">
          <Link href="/planner/tickets">
            Open ticketing
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </aside>
    </div>
  )
}

function MoneyLineGroup({ title, lines }: { title: string; lines: Array<{ label: string; value: string }> }) {
  if (lines.length === 0) {
    return (
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
        <p className="text-sm text-ink-faint">No {title.toLowerCase()} rows yet.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
      <div className="space-y-1">
        {lines.map((line) => (
          <MoneyDisplayRow key={line.label} label={line.label} value={line.value} />
        ))}
      </div>
    </div>
  )
}

function MoneyDisplayRow({ label, value, isStrong = false }: { label: string; value: string; isStrong?: boolean }) {
  return (
    <div className={cn('grid gap-2 py-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]', isStrong && 'text-base font-semibold text-ink')}>
      <span className="min-w-0 text-ink-soft">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-ink">{value}</span>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream/80 p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: OperatingSection['tone']; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]',
        tone === 'settled' && 'border-forest/20 bg-forest-tint text-forest',
        tone === 'action' && 'border-clay/20 bg-clay-tint text-clay-deep',
        tone === 'watch' && 'border-ochre/25 bg-ochre-tint text-ochre',
        tone === 'empty' && 'border-tan bg-cream-deep text-ink-soft'
      )}
    >
      {children}
    </span>
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

function getSelectedRecord(records: ExperienceRecord[], recordKey?: string | null) {
  if (!recordKey) return records[0] ?? null
  const selected = records.find((record) => `${record.kind}:${record.id}` === recordKey)
  return selected ?? records[0] ?? null
}

function getExperienceRecordRoute(record: ExperienceRecord) {
  return `/planner/experiences?record=${encodeURIComponent(`${record.kind}:${record.id}`)}`
}

function getDefaultOperatingSection(record: ExperienceRecord, hasBookings: boolean, hasMoney: boolean): string {
  const action = record.nextAction.toLowerCase()
  if (action.includes('attach') || action.includes('booking') || action.includes('terms')) return 'Bookings'
  if (action.includes('ticket') || action.includes('guest')) return 'Guests'
  if (action.includes('profit') || action.includes('money') || !hasMoney) return 'Money'
  if (!hasBookings) return 'Bookings'
  return 'Money'
}

function buildVenueBookingItem(booking: VenueBookingRow): ExperienceBookingItem {
  const costAmount = firstNumber(booking.final_price, booking.quoted_price, booking.total_amount, booking.subtotal)
  const venueName = booking.venues?.venue_name ?? 'Venue terms pending'
  const location = [booking.venues?.city, booking.venues?.state].filter(Boolean).join(', ')
  const schedule = [formatDate(booking.booking_date ?? null), formatTimeRange(booking.start_time, booking.end_time)]
    .filter(Boolean)
    .join(' · ')
  const tone = bookingTone(booking.status)

  return {
    id: `venue-${booking.id}`,
    kind: 'venue',
    category: 'Venue',
    partnerName: venueName,
    detail: [schedule, location || null, booking.special_requests].filter(Boolean).join(' · ') || 'Venue booking row attached.',
    costAmount,
    costLabel: costAmount === null ? 'Price not set' : formatMoneyDollars(costAmount),
    scheduleLabel: schedule || 'Schedule not set yet',
    status: titleize(booking.status ?? 'pending'),
    paymentStatus: titleize(booking.payment_status ?? 'unpaid'),
    tone,
    terms: [
      { label: 'Offer', value: schedule || 'No date or time attached' },
      { label: 'Guest range', value: formatGuestRange(booking.guest_count_min, booking.guest_count_max) },
      { label: 'Payment', value: titleize(booking.payment_status ?? 'unpaid') },
      { label: 'Approval source', value: titleize(booking.approval_source ?? 'manual review') },
    ],
    approvalCopy:
      tone === 'action'
        ? 'A host approval record should be created before any hold, message, or payment executes.'
        : 'This row is tracked as an operating record. Any changed price, date, or term still requires re-approval.',
    targetHref: booking.venue_id ? `/planner/venues/${booking.venue_id}` : '/planner/venues',
    targetLabel: booking.venue_id ? 'Open venue profile' : 'Find venues',
  }
}

function buildVendorBookingItem(booking: VendorBookingRow): ExperienceBookingItem {
  const costAmount = firstNumber(booking.final_price, booking.quoted_price, booking.total_amount, booking.subtotal)
  const service = booking.vendor_profiles?.service_type ?? booking.vendor_offerings?.service_category ?? 'Vendor'
  const partnerName =
    booking.vendor_profiles?.name ??
    booking.vendor_offerings?.offering_name ??
    booking.vendor_packages?.package_name ??
    'Vendor terms pending'
  const date = booking.confirmed_date ?? booking.requested_date ?? booking.booking_date ?? null
  const start = booking.confirmed_start_time ?? booking.requested_start_time
  const end = booking.confirmed_end_time ?? booking.requested_end_time
  const schedule = [formatDate(date), formatTimeRange(start, end)].filter(Boolean).join(' · ')
  const tone = bookingTone(booking.status)

  return {
    id: `vendor-${booking.id}`,
    kind: 'vendor',
    category: titleize(service),
    partnerName,
    detail: [booking.vendor_offerings?.offering_name ?? booking.vendor_packages?.package_name, schedule, booking.notes]
      .filter(Boolean)
      .join(' · ') || 'Vendor booking row attached.',
    costAmount,
    costLabel: costAmount === null ? 'Quote not set' : formatMoneyDollars(costAmount),
    scheduleLabel: schedule || 'Schedule not set yet',
    status: titleize(booking.status ?? 'pending'),
    paymentStatus: titleize(booking.payment_status ?? 'unpaid'),
    tone,
    terms: [
      { label: 'Service', value: titleize(service) },
      { label: 'Deposit', value: booking.deposit_amount ? formatMoneyDollars(booking.deposit_amount) : 'No deposit recorded' },
      { label: 'Payment', value: booking.deposit_paid ? 'Deposit paid' : titleize(booking.payment_status ?? 'unpaid') },
      { label: 'Quantity', value: booking.quantity ? String(booking.quantity) : booking.guest_count ? `${booking.guest_count} guests` : 'Not set' },
    ],
    approvalCopy:
      tone === 'action'
        ? 'A host approval record should be created before any vendor message, booking, or payment executes.'
        : 'This vendor row is tracked for readiness. Any changed price, timing, or scope still requires re-approval.',
    targetHref: booking.vendor_id ? `/planner/vendors/${booking.vendor_id}` : '/planner/vendors',
    targetLabel: booking.vendor_id ? 'Open vendor profile' : 'Find vendors',
  }
}

function buildMoneyRecord(
  financial: FinancialRow | null,
  bookingItems: ExperienceBookingItem[],
  guests: GuestRecord
): MoneyRecord | null {
  const hasFinancial = financial ? hasFinancialSignal(financial) : false
  const bookedCosts = bookingItems.filter((item) => item.costAmount !== null)

  if (!hasFinancial && bookedCosts.length === 0) return null

  const expectedProfit = financial ? toNumber(financial.expected_profit) : null
  const grossRevenue = financial ? toNumber(financial.gross_revenue) : null
  const projectedRevenue = financial ? toNumber(financial.projected_revenue) : null
  const netRevenue = financial ? toNumber(financial.net_revenue) : null
  const totalCosts = financial ? toNumber(financial.total_costs) : null
  const venueCost = financial ? toNumber(financial.venue_cost) : null
  const vendorCost = financial ? toNumber(financial.vendor_cost) : null
  const totalFees = financial ? toNumber(financial.total_fees) : null
  const totalRefunds = financial ? toNumber(financial.total_refunds) : null
  const margin = financial ? toNumber(financial.profit_margin) : null
  const breakEven = financial ? toNumber(financial.break_even_tickets) : null
  const perAttendee = financial ? toNumber(financial.per_attendee_value) : null

  const incomeLines = [
    moneyLine('Gross revenue', grossRevenue),
    moneyLine('Projected revenue', projectedRevenue),
    moneyLine('Net revenue', netRevenue),
  ].filter(Boolean) as Array<{ label: string; value: string }>

  const costLines = [
    moneyLine('Venue cost', venueCost),
    moneyLine('Vendor cost', vendorCost),
    moneyLine('Platform/payment fees', totalFees),
    moneyLine('Refunds', totalRefunds),
    moneyLine('Total costs', totalCosts),
    ...bookedCosts.map((item) => ({ label: `${item.category} · ${item.partnerName}`, value: item.costLabel })),
  ].filter(Boolean) as Array<{ label: string; value: string }>

  return {
    projectedProfitLabel: expectedProfit === null ? 'Not calculated' : formatMoneyDollars(expectedProfit),
    confidenceLabel: hasFinancial ? 'Live summary' : 'Costs only',
    totalIncomeLabel: formatNullableMoney(netRevenue ?? projectedRevenue ?? grossRevenue),
    totalCostLabel: formatNullableMoney(totalCosts ?? sumNumbers(bookedCosts.map((item) => item.costAmount))),
    marginLabel: margin === null ? 'No margin' : `${Math.round(margin)}%`,
    breakEvenLabel: breakEven === null ? 'Not calculated' : `${Math.round(breakEven)} tickets`,
    perAttendeeLabel: perAttendee === null ? guests.targetLabel : formatMoneyDollars(perAttendee),
    incomeLines,
    costLines,
    watchTitle: hasFinancial ? 'One thing the agent is watching' : 'Money data still needs a source',
    watchBody: hasFinancial
      ? 'This section should update when ticketing imports, partner costs, or event financial recomputation change the margin.'
      : 'Attached partner costs are visible, but profitability needs ticketing revenue or an event_financial_summary row before the agent can call the event on track.',
  }
}

function buildGuestRecord(event: EventRow, financial: FinancialRow | null, salesRows: SalesRow[], hasTicketing: boolean): GuestRecord {
  const target = event.expected_attendance ?? event.expected_attendance_max ?? event.expected_attendance_min ?? null
  const importedTicketCount = sumSalesTicketQuantity(salesRows)
  const confirmed = toNumber(financial?.current_attendance) ?? toNumber(financial?.tickets_sold) ?? importedTicketCount
  const remaining = target !== null && confirmed !== null ? Math.max(target - confirmed, 0) : null
  const overTarget = target !== null && confirmed !== null ? Math.max(confirmed - target, 0) : 0
  const latestMovementAt = latestSalesTimestamp(salesRows)
  const hasImportedMovement = importedTicketCount !== null && importedTicketCount > 0

  return {
    targetLabel: target === null ? 'Guest target not set yet' : `${target.toLocaleString()} guests`,
    confirmedLabel: confirmed === null ? 'No confirmed attendance imported yet' : `${confirmed.toLocaleString()} confirmed`,
    remainingLabel: overTarget > 0
      ? `${overTarget.toLocaleString()} over target`
      : remaining === null
        ? 'Remaining capacity depends on imported ticketing or RSVP rows'
        : `${remaining.toLocaleString()} capacity remaining`,
    ticketingLabel: hasTicketing ? getTicketingLabel(event) : 'No ticketing rows attached',
    movementLabel: buildGuestMovementLabel({ confirmed, importedTicketCount, target, overTarget, hasImportedMovement }),
    movementDetail: latestMovementAt
      ? `Latest imported guest movement: ${formatDateTime(latestMovementAt)}. This count recalculates from event_sales_data ticket quantities and event_financial_summary.`
      : 'This count updates as ticketing, RSVP, or attendance rows are imported for the event.',
    readinessCopy: hasTicketing
      ? 'Guest operations are tied to this event record. Imported ticketing or attendee rows can drive reminders, check-in readiness, and post-event review.'
      : 'Guest operations will stay empty until this event has imported attendees, ticketing rows, or expected attendance.',
  }
}

function buildGuestMovementLabel({
  confirmed,
  importedTicketCount,
  target,
  overTarget,
  hasImportedMovement,
}: {
  confirmed: number | null
  importedTicketCount: number | null
  target: number | null
  overTarget: number
  hasImportedMovement: boolean
}) {
  if (confirmed === null) return 'No imported guest increase yet'
  if (overTarget > 0) {
    return `Guest count increased to ${confirmed.toLocaleString()}, ${overTarget.toLocaleString()} over target.`
  }
  if (hasImportedMovement && importedTicketCount !== null) {
    return `Guest count increased to ${confirmed.toLocaleString()} from ${importedTicketCount.toLocaleString()} imported ticket/RSVP ${importedTicketCount === 1 ? 'row' : 'rows'}.`
  }
  if (target !== null) return `${confirmed.toLocaleString()} confirmed against a ${target.toLocaleString()} guest target.`
  return `${confirmed.toLocaleString()} confirmed guests.`
}

function groupSalesRowsByEvent(rows: SalesRow[]) {
  return rows.reduce((map, row) => {
    const eventRows = map.get(row.event_id) ?? []
    eventRows.push(row)
    map.set(row.event_id, eventRows)
    return map
  }, new Map<string, SalesRow[]>())
}

function groupBookingsByEvent<T extends BaseBookingRow>(bookings: T[]) {
  return bookings.reduce((map, booking) => {
    const rows = map.get(booking.event_id) ?? []
    rows.push(booking)
    map.set(booking.event_id, rows)
    return map
  }, new Map<string, T[]>())
}

function isBookedPartner(booking: BaseBookingRow) {
  const status = (booking.status ?? '').toLowerCase()
  return ['approved', 'confirmed', 'accepted', 'booked', 'complete', 'completed'].includes(status)
}

function isConnectedTicketingStatus(status: string) {
  return ['connected', 'linked', 'completed'].includes(status)
}

function bookingTone(status: string | null): RecordTone {
  const normalized = (status ?? '').toLowerCase()
  if (['approved', 'confirmed', 'accepted', 'booked', 'complete', 'completed'].includes(normalized)) return 'settled'
  if (['pending', 'requested', 'hold', 'needs_approval', 'approval_required'].includes(normalized)) return 'action'
  if (['cancelled', 'canceled', 'declined', 'rejected'].includes(normalized)) return 'empty'
  return 'watch'
}

function dotClass(tone: RecordTone) {
  if (tone === 'settled') return 'bg-forest'
  if (tone === 'action') return 'bg-clay'
  if (tone === 'watch') return 'bg-ochre'
  return 'bg-ink-faint'
}

function attentionTextClass(tone: RecordTone) {
  if (tone === 'settled') return 'text-forest'
  if (tone === 'action') return 'text-clay-deep'
  if (tone === 'watch') return 'text-ochre'
  return 'text-ink-faint'
}

function deriveEventMetro(event: EventRow, venueBookings: VenueBookingRow[]) {
  const venueCity = venueBookings.find((booking) => booking.venues?.city)?.venues?.city
  const venueState = venueBookings.find((booking) => booking.venues?.state)?.venues?.state
  return compactMetroLabel(venueCity ?? venueState ?? 'Bay Area')
}

function compactMetroLabel(value: string) {
  const normalized = value.trim()
  if (!normalized) return 'Bay Area'
  const lower = normalized.toLowerCase()
  if (lower === 'san francisco') return 'SF'
  if (lower === 'oakland') return 'Oakland'
  if (lower.includes('peninsula')) return 'Peninsula'
  if (lower === 'bay_area' || lower === 'bay area') return 'Bay Area'
  return titleize(normalized)
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

function getRecordAttention(nextAction: string): { label: string; tone: RecordTone } {
  const action = nextAction.toLowerCase()
  if (action.includes('attach')) return { label: 'Needs terms', tone: 'action' }
  if (action.includes('connect')) return { label: 'Needs data', tone: 'action' }
  if (action.includes('add post')) return { label: 'Post-event', tone: 'action' }
  if (action.includes('review approvals')) return { label: 'For review', tone: 'action' }
  if (action.includes('clarify')) return { label: 'Drafting', tone: 'watch' }
  if (action.includes('profitability')) return { label: 'Review', tone: 'watch' }
  if (action.includes('prepare')) return { label: 'Executing', tone: 'watch' }
  if (action.includes('save') || action.includes('rebook')) return { label: 'Memory', tone: 'watch' }
  return { label: 'On track', tone: 'settled' }
}

function buildNeedsYouBanner({
  nextAction,
  recordHref,
  hasTicketing,
  hasFinancials,
  isCompleted,
}: {
  nextAction: string
  recordHref: string
  hasTicketing: boolean
  hasFinancials: boolean
  isCompleted: boolean
}): NeedsYouBannerRecord {
  const action = nextAction.toLowerCase()

  if (action.includes('attach')) {
    return {
      tone: 'action',
      eyebrow: 'Attach venue or vendor terms.',
      title: 'No approved or confirmed partner bookings are attached to this event yet.',
      body: 'Use the planner to review venue/vendor options and create an approval record before any outreach, booking, or payment moves.',
      primaryHref: '/planner/venues',
      primaryLabel: 'Find venue terms',
      secondaryHref: '/planner/vendors',
      secondaryLabel: 'Find vendor terms',
    }
  }

  if (action.includes('connect') || !hasTicketing) {
    return {
      tone: 'action',
      eyebrow: 'Connect ticketing data.',
      title: 'Guest progress and revenue need a ticketing source before this record can be fully live.',
      body: 'Connect or import Eventbrite, Posh, or another ticketing source. The guest and money sections update after imported rows land.',
      primaryHref: '/planner/integrations/eventbrite',
      primaryLabel: 'Connect Eventbrite',
      secondaryHref: '/planner/tickets',
      secondaryLabel: 'Open tickets',
    }
  }

  if (isCompleted && !hasFinancials) {
    return {
      tone: 'action',
      eyebrow: 'Add post-event data.',
      title: 'This completed event still needs financials before 3rdPlace can calculate profitability.',
      body: 'Add ticketing, cost, refund, or post-event data so this record becomes useful for templates, rebooks, and future forecasts.',
      primaryHref: recordHref,
      primaryLabel: 'Open event record',
      secondaryHref: '/planner/events/import',
      secondaryLabel: 'Import event data',
    }
  }

  if (action.includes('review approvals')) {
    return {
      tone: 'action',
      eyebrow: 'One or more approvals need review.',
      title: 'Review the proposed next step before any message, booking, or payment executes.',
      body: '3rdPlace keeps execution gated. The agent can prepare terms and outreach, but the host decision is the trigger.',
      primaryHref: recordHref,
      primaryLabel: 'Review approval',
      secondaryHref: '/planner/payments',
      secondaryLabel: 'Open approvals',
    }
  }

  if (action.includes('profitability')) {
    return {
      tone: 'watch',
      eyebrow: 'Review profitability.',
      title: 'This event has enough data for a money review.',
      body: 'Check margin, break-even, and cost movement before you use this event as a template or rebook reference.',
      primaryHref: recordHref,
      primaryLabel: 'Open event record',
      secondaryHref: '/planner/analytics',
      secondaryLabel: 'Open analytics',
    }
  }

  if (action.includes('clarify')) {
    return {
      tone: 'watch',
      eyebrow: 'Clarify the plan.',
      title: 'This draft needs more event detail before the operating record can fill in.',
      body: 'Add date, guest target, venue/vendor needs, budget, and profitability goals in the planner chat.',
      primaryHref: recordHref,
      primaryLabel: 'Open planner draft',
      secondaryHref: '/planner/templates',
      secondaryLabel: 'Use template',
    }
  }

  return {
    tone: 'settled',
    eyebrow: 'Nothing waiting on you right now.',
    title: 'The agent is watching bookings, ticketing movement, and money risk for this event.',
    body: 'If price, date, seats, vendor, or terms change, 3rdPlace should ask for approval again before execution.',
    primaryHref: recordHref,
    primaryLabel: 'Open record',
    secondaryHref: '/planner',
    secondaryLabel: 'Use planner',
  }
}

function getRecordSortValue(record: ExperienceRecord) {
  if (record.dateLabel === 'Date TBD') return 0
  const parsed = Date.parse(record.dateLabel)
  return Number.isNaN(parsed) ? 0 : parsed
}

function firstNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function sumNumbers(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (usable.length === 0) return null
  return usable.reduce((sum, value) => sum + value, 0)
}

function sumSalesTicketQuantity(rows: SalesRow[]) {
  if (rows.length === 0) return null
  return rows.reduce((sum, row) => {
    const quantity = toNumber(row.ticket_quantity) ?? 0
    return sum + (row.is_refund ? -Math.abs(quantity) : Math.max(quantity, 0))
  }, 0)
}

function latestSalesTimestamp(rows: SalesRow[]) {
  const timestamps = rows
    .map((row) => row.purchase_timestamp ?? row.received_at ?? row.submitted_at ?? row.created_at)
    .filter((value): value is string => Boolean(value))
    .sort()

  return timestamps[timestamps.length - 1] ?? null
}

function moneyLine(label: string, value: number | null) {
  if (value === null) return null
  return { label, value: formatMoneyDollars(value) }
}

function formatNullableMoney(value: number | null) {
  return value === null ? 'Not calculated' : formatMoneyDollars(value)
}

function getTicketingLabel(event: EventRow) {
  if (event.posh_event_id) return 'Ticketed via Posh'
  if (event.eventbrite_event_id) return 'Ticketed via Eventbrite'
  return 'Ticketing attached'
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

function formatTimingLabel(value: string | null) {
  if (!value) return 'TBD'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'TBD'
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfEventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime()
  const dayDifference = Math.round((startOfEventDay - startOfToday) / (24 * 60 * 60 * 1000))
  if (dayDifference === 0) return 'Today'
  if (dayDifference > 0) return `T-${dayDifference} days`
  return `T+${Math.abs(dayDifference)} days`
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return null
  if (start && end) return `${formatClock(start)}-${formatClock(end)}`
  return formatClock(start ?? end ?? '')
}

function formatClock(value: string) {
  if (!value) return ''
  const [hourPart, minutePart = '00'] = value.split(':')
  const hour = Number(hourPart)
  if (!Number.isFinite(hour)) return value
  const minute = Number(minutePart)
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${String(Number.isFinite(minute) ? minute : 0).padStart(2, '0')} ${period}`
}

function formatGuestRange(min: number | null | undefined, max: number | null | undefined) {
  if (min && max && min !== max) return `${min.toLocaleString()}-${max.toLocaleString()} guests`
  if (max) return `Up to ${max.toLocaleString()} guests`
  if (min) return `${min.toLocaleString()} guests`
  return 'Not set'
}

function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return 'Date TBD'
  if (start && end && start !== end) return `${formatDate(start)} - ${formatDate(end)}`
  return formatDate(start ?? end)
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function formatGuestCount(value: number | null) {
  if (!value) return null
  return `${value.toLocaleString()} guests`
}

function getGuestSummary(record: ExperienceRecord) {
  const match = record.detail.match(/[\d,]+ guests/)
  return match?.[0] ?? 'Guest target not set yet.'
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
