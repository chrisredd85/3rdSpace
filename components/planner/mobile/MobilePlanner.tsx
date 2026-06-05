'use client'

import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronRight,
  DollarSign,
  Loader2,
  Mail,
  Menu,
  MessageSquare,
  Pencil,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { mobileSpacing as spacing } from './mobileSpacing'

export type MobileSection =
  | 'planner'
  | 'approvals'
  | 'messages'
  | 'vendors'
  | 'outreach'
  | 'analytics'
  | 'ticketing'
  | 'billing'
  | 'settings'

export type MobileView =
  | 'new-plan'
  | 'planner'
  | 'brief'
  | 'venues'
  | 'venue-detail'
  | 'budget'
  | 'draft'
  | 'approval'
  | 'deposit'
  | 'sent'
  | 'reply'
  | 'vendor-detail'
  | 'outreach-thread'

type StatusTone = 'clay' | 'forest' | 'ochre' | 'muted' | 'brick'
type LoadState = 'loading' | 'ready' | 'empty' | 'unauthenticated' | 'error'

interface Plan {
  id: string
  title: string
  event_type: string | null
  status: string
  guest_count: number | null
  budget_cap_cents: number | null
  neighborhood: string | null
  date_window_start: string | null
  date_window_end: string | null
  ticketed: boolean
  ticketing_model?: string | null
  food_responsibility?: string | null
  venue_terms?: string | null
  agent_action?: string | null
  profit_goal_cents: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface PlanMessage {
  id: string
  role: string
  content: string
  message_type: string
  created_at: string
}

interface Recommendation {
  id: string
  type: 'venue' | 'vendor' | 'ticket' | 'external'
  reference_id: string | null
  external_name: string | null
  price_cents: number | null
  notes: string | null
  rank: number
  status: string
  is_best_fit: boolean
}

interface Approval {
  id: string
  action_label: string
  provider: string | null
  event_date: string | null
  price_cents: number | null
  fees_cents: number | null
  refund_terms: string | null
  cancellation_terms: string | null
  package_details: string | null
  status: string
  requested_amount_cents?: number | null
  authorized_amount_cents?: number | null
  updated_at: string
  created_at: string
}

interface ProgressItem {
  id: 'brief' | 'venues' | 'budget' | 'outreach'
  label: string
  detail: string
  status: string
  tone: StatusTone
}

interface ActivityItem {
  id: string
  kind: string
  summary: string
  detail: string | null
  occurred_at: string
}

interface MobileHome {
  plan: Plan
  pending_approvals: Approval[]
  pending_approval_count: number
  problem: ActivityItem | null
  progress: ProgressItem[]
  updates: ActivityItem[]
}

interface BudgetLine {
  id: string
  category: string
  label: string
  low_cents: number
  high_cents: number
  status: string
  source: string
}

interface BudgetSummary {
  target_cents: number | null
  buffer_target_cents: number | null
  low_total_cents: number
  high_total_cents: number
  committed_total_cents: number
  projected_delta_cents: number | null
  projected_buffer_low_cents: number | null
  projected_buffer_high_cents: number | null
  lines: BudgetLine[]
}

interface TicketingSummary {
  summary?: {
    tickets_sold?: number
    gross_revenue_cents?: number
    net_revenue_cents?: number
    average_ticket_price_cents?: number
  }
  events?: Array<{ id: string; event_name?: string | null }>
}

interface TicketingConnection {
  id: string
  platform: string
  status: string
  account_label: string | null
  last_connected_at: string | null
}

interface BillingStatus {
  builder?: Record<string, unknown>
  billing?: {
    tier?: string
    status?: string
    freeEventsRemaining?: number
    free_events_remaining?: number
    canCreateEvent?: boolean
    can_create_event?: boolean
  }
}

interface AnalyticsSummary {
  events_per_year: number
  average_margin_percent: number | null
  rebook_rate_percent: number | null
  best_format: string | null
  recommendation: string
  recent_events: Array<{
    id: string
    name: string
    event_type: string | null
    net_revenue_cents: number
    total_costs_cents: number
    profit_cents: number
    margin_percent: number | null
  }>
}

interface PlannerPayload {
  plan: Plan
  messages: PlanMessage[]
  recommendations: Recommendation[]
  approvals: Approval[]
}

interface MobileData {
  state: LoadState
  error: string | null
  activePlanId: string | null
  planPayload: PlannerPayload | null
  home: MobileHome | null
  budget: BudgetSummary | null
  activity: ActivityItem[]
  billing: BillingStatus | null
  ticketing: TicketingSummary | null
  connections: TicketingConnection[]
  analytics: AnalyticsSummary | null
}

interface AppSectionLink {
  id: MobileSection
  label: string
  href: string
}

const appSections: AppSectionLink[] = [
  { id: 'planner', label: 'Plan', href: '/planner' },
  { id: 'approvals', label: 'Review queue', href: '/planner/payments' },
  { id: 'messages', label: 'Inbox', href: '/planner/messages' },
  { id: 'vendors', label: 'Vendors', href: '/planner/vendors' },
  { id: 'outreach', label: 'Outreach', href: '/planner/outreach' },
  { id: 'analytics', label: 'Analytics', href: '/planner/analytics' },
  { id: 'ticketing', label: 'Ticketing', href: '/planner/tickets' },
  { id: 'billing', label: 'Billing', href: '/planner/billing' },
  { id: 'settings', label: 'Settings', href: '/planner/settings' },
]

const flowSteps: Array<{ id: MobileView; label: string }> = [
  { id: 'planner', label: 'Plan' },
  { id: 'brief', label: 'Brief' },
  { id: 'venues', label: 'Venues' },
  { id: 'budget', label: 'Budget' },
  { id: 'draft', label: 'Draft' },
  { id: 'approval', label: 'Approval' },
  { id: 'deposit', label: 'Deposit' },
  { id: 'sent', label: 'Sent' },
  { id: 'reply', label: 'Reply' },
]

const skippedSurfaceCopy = {
  draft: 'Outreach drafts will appear here once the Gmail integration is enabled. Currently in development.',
  reply: 'When venues reply, parsed decisions will appear here.',
  outreach: 'Outreach drafts, replies, and automation policies will appear here once the Gmail integration is enabled. Currently in development.',
  sent: 'Approved sent-message activity will appear here once the outreach pipeline is enabled.',
  policy: 'Outreach automation rules are coming with the Gmail pipeline. Until then, every outbound send requires review.',
}

const toneClass: Record<StatusTone, string> = {
  clay: 'border-clay/25 bg-clay-tint text-clay-deep',
  forest: 'border-forest/20 bg-forest-tint text-forest',
  ochre: 'border-ochre/25 bg-ochre-tint text-ink-soft',
  muted: 'border-tan bg-cream-deep text-ink-soft',
  brick: 'border-brick/25 bg-brick-tint text-brick',
}

const initialData: MobileData = {
  state: 'loading',
  error: null,
  activePlanId: null,
  planPayload: null,
  home: null,
  budget: null,
  activity: [],
  billing: null,
  ticketing: null,
  connections: [],
  analytics: null,
}

function isMobileView(value: string | null): value is MobileView {
  return (
    value === 'new-plan' ||
    value === 'planner' ||
    value === 'brief' ||
    value === 'venues' ||
    value === 'venue-detail' ||
    value === 'budget' ||
    value === 'draft' ||
    value === 'approval' ||
    value === 'deposit' ||
    value === 'sent' ||
    value === 'reply' ||
    value === 'vendor-detail' ||
    value === 'outreach-thread'
  )
}

function getInitialMobileEntry(initialView: MobileView) {
  if (typeof window === 'undefined') return { view: initialView, draft: '', skipInitialLoad: initialView === 'new-plan' }

  const params = new URLSearchParams(window.location.search)
  const requestedDraft = params.get('draft')?.trim() ?? ''
  const requestedView = params.get('view')
  const startsInNewPlan = initialView === 'new-plan' || Boolean(requestedDraft)

  return {
    view: requestedDraft ? 'new-plan' : isMobileView(requestedView) ? requestedView : initialView,
    draft: requestedDraft,
    skipInitialLoad: startsInNewPlan,
  }
}

export function MobilePlanner({
  activeSection = 'planner',
  initialView = 'planner',
}: {
  activeSection?: MobileSection
  initialView?: MobileView
}) {
  const [initialEntry] = useState(() => getInitialMobileEntry(initialView))
  const [view, setView] = useState<MobileView>(initialEntry.view)
  const [data, setData] = useState<MobileData>(initialData)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuTouchStartX, setMenuTouchStartX] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [newPlanDraft, setNewPlanDraft] = useState(initialEntry.draft)
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false)
  const [isCreatingPlan, setIsCreatingPlan] = useState(false)

  const reload = useCallback(async () => {
    setData((current) => ({ ...current, state: 'loading', error: null }))
    const nextData = await loadMobileData()
    setData(nextData)
  }, [])

  useEffect(() => {
    if (initialEntry.skipInitialLoad) {
      setData({ ...initialData, state: 'empty' })
      return
    }
    void reload()
  }, [initialEntry.skipInitialLoad, reload])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedDraft = params.get('draft')?.trim()
    const requestedView = params.get('view')
    if (requestedDraft) {
      setNewPlanDraft(requestedDraft)
      setView('new-plan')
    } else if (isMobileView(requestedView)) {
      setView(requestedView)
    }
  }, [])

  const reviewCount = data.home?.pending_approval_count ?? data.planPayload?.approvals.filter((approval) => approval.status === 'pending').length ?? 0

  function navigate(nextView: MobileView) {
    setView(nextView)
    setIsMenuOpen(false)
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  async function handleSendMessage() {
    if (!messageDraft.trim() || !data.activePlanId) return
    setIsSubmittingMessage(true)
    try {
      const response = await fetch(`/api/planner/plans/${data.activePlanId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageDraft.trim() }),
      })
      if (!response.ok) throw new Error('Unable to save instruction')
      setMessageDraft('')
      await reload()
    } catch (error) {
      setData((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to save instruction',
      }))
    } finally {
      setIsSubmittingMessage(false)
    }
  }

  async function handleStartPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newPlanDraft.trim()) return
    setIsCreatingPlan(true)
    try {
      const response = await fetch('/api/planner/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newPlanDraft.trim() }),
      })
      if (!response.ok) throw new Error('Unable to start plan')
      const payload = (await response.json()) as { plan?: Plan }
      setNewPlanDraft('')
      await reload()
      if (payload.plan?.id) {
        setView('planner')
      }
    } catch (error) {
      setData((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to start plan',
      }))
    } finally {
      setIsCreatingPlan(false)
    }
  }

  return (
    <main className="min-h-screen bg-cream text-ink">
      <div className="min-h-screen w-full bg-cream">
        <MobileHeader
          isMenuOpen={isMenuOpen}
          reviewCount={reviewCount}
          onToggleMenu={() => setIsMenuOpen((value) => !value)}
        />

        {isMenuOpen && (
          <MobileNavigationPanel
            activeSection={activeSection}
            activeView={view}
            planTitle={data.planPayload?.plan.title ?? null}
            menuTouchStartX={menuTouchStartX}
            onTouchStart={setMenuTouchStartX}
            onTouchEnd={(endX) => {
              if (menuTouchStartX === null) return
              if (menuTouchStartX - endX > 60) setIsMenuOpen(false)
              setMenuTouchStartX(null)
            }}
            onClose={() => setIsMenuOpen(false)}
            onInternalNavigate={navigate}
          />
        )}

        <div className={cn(spacing.pagePaddingX, spacing.pagePaddingTop, spacing.pagePaddingBottom)}>
          {data.error && (
            <div className={cn('mb-5 rounded-lg border border-brick/25 bg-brick-tint text-sm font-semibold text-brick', spacing.cardPaddingTight)}>
              {data.error}
            </div>
          )}
          <MobileContent
            activeSection={activeSection}
            view={view}
            data={data}
            messageDraft={messageDraft}
            newPlanDraft={newPlanDraft}
            isSubmittingMessage={isSubmittingMessage}
            isCreatingPlan={isCreatingPlan}
            onDraftChange={setMessageDraft}
            onNewPlanDraftChange={setNewPlanDraft}
            onSendMessage={handleSendMessage}
            onStartPlan={handleStartPlan}
            onNavigate={navigate}
          />
        </div>
      </div>
    </main>
  )
}

function MobileContent({
  activeSection,
  view,
  data,
  messageDraft,
  newPlanDraft,
  isSubmittingMessage,
  isCreatingPlan,
  onDraftChange,
  onNewPlanDraftChange,
  onSendMessage,
  onStartPlan,
  onNavigate,
}: {
  activeSection: MobileSection
  view: MobileView
  data: MobileData
  messageDraft: string
  newPlanDraft: string
  isSubmittingMessage: boolean
  isCreatingPlan: boolean
  onDraftChange: (value: string) => void
  onNewPlanDraftChange: (value: string) => void
  onSendMessage: () => void
  onStartPlan: (event: FormEvent<HTMLFormElement>) => void
  onNavigate: (view: MobileView) => void
}) {
  if (data.state === 'loading') return <LoadingView />
  if (data.state === 'error') return <ErrorView onRetry={() => window.location.reload()} />
  if (data.state === 'empty' || view === 'new-plan') {
    return (
      <NewPlanView
        draft={newPlanDraft}
        isCreating={isCreatingPlan}
        hasExistingPlan={Boolean(data.planPayload)}
        onDraftChange={onNewPlanDraftChange}
        onStart={onStartPlan}
        onNavigate={onNavigate}
      />
    )
  }
  if (data.state === 'unauthenticated') return <AuthRequiredView />

  if (!data.planPayload) return <EmptyState title="No active plan" description="Start a private plan to use the mobile planner." />

  if (view === 'brief') return <BriefView plan={data.planPayload.plan} onNavigate={onNavigate} />
  if (view === 'venues' || view === 'venue-detail') return <VenuesView data={data} detail={view === 'venue-detail'} onNavigate={onNavigate} />
  if (view === 'budget') return <BudgetView budget={data.budget} plan={data.planPayload.plan} onNavigate={onNavigate} />
  if (view === 'draft') return <SkippedOutreachView title="Outreach drafts" description={skippedSurfaceCopy.draft} onNavigate={onNavigate} />
  if (view === 'approval') return <ApprovalPolicyView onNavigate={onNavigate} />
  if (view === 'deposit') return <DepositApprovalView approvals={data.planPayload.approvals} onNavigate={onNavigate} />
  if (view === 'sent') return <SkippedOutreachView title="Sent outreach" description={skippedSurfaceCopy.sent} onNavigate={onNavigate} />
  if (view === 'reply') return <SkippedOutreachView title="Parsed replies" description={skippedSurfaceCopy.reply} onNavigate={onNavigate} />
  if (view === 'vendor-detail') return <VendorsSection data={data} detail onNavigate={onNavigate} />
  if (view === 'outreach-thread') return <SkippedOutreachView title="Outreach thread" description={skippedSurfaceCopy.outreach} onNavigate={onNavigate} />

  if (activeSection === 'approvals') return <ApprovalsSection approvals={data.planPayload.approvals} onNavigate={onNavigate} />
  if (activeSection === 'messages') return <MessagesSection messages={data.planPayload.messages} activity={data.activity} />
  if (activeSection === 'vendors') return <VendorsSection data={data} onNavigate={onNavigate} />
  if (activeSection === 'outreach') return <OutreachSection onNavigate={onNavigate} />
  if (activeSection === 'analytics') return <AnalyticsSection analytics={data.analytics} />
  if (activeSection === 'ticketing') return <TicketingSection ticketing={data.ticketing} connections={data.connections} onNavigate={onNavigate} />
  if (activeSection === 'billing') return <BillingSection billing={data.billing} onNavigate={onNavigate} />
  if (activeSection === 'settings') return <SettingsSection billing={data.billing} connections={data.connections} />

  return (
    <PlannerView
      data={data}
      messageDraft={messageDraft}
      isSubmittingMessage={isSubmittingMessage}
      onDraftChange={onDraftChange}
      onSendMessage={onSendMessage}
      onNavigate={onNavigate}
    />
  )
}

async function loadMobileData(): Promise<MobileData> {
  try {
    const plansResponse = await fetch('/api/planner/plans?limit=10', { cache: 'no-store' })
    if (plansResponse.status === 401 || plansResponse.status === 403) {
      return { ...initialData, state: 'unauthenticated' }
    }
    if (!plansResponse.ok) throw new Error('Unable to load plans')

    const plansPayload = (await plansResponse.json()) as { plans?: Plan[] }
    const activePlan = (plansPayload.plans ?? []).find((plan) => plan.status !== 'archived') ?? null
    if (!activePlan) return { ...initialData, state: 'empty' }

    const [
      planPayload,
      home,
      budget,
      activityPayload,
      billing,
      ticketing,
      connectionsPayload,
      analytics,
    ] = await Promise.all([
      fetchJson<PlannerPayload>(`/api/planner/plans/${activePlan.id}`),
      fetchJson<MobileHome>(`/api/planner/plans/${activePlan.id}/mobile-home`),
      fetchJson<BudgetSummary>(`/api/planner/plans/${activePlan.id}/budget`),
      fetchJson<{ activities?: ActivityItem[] }>(`/api/planner/plans/${activePlan.id}/activity`),
      fetchJson<BillingStatus>('/api/builder/billing/status'),
      fetchJson<TicketingSummary>('/api/planner/ticketing/analytics'),
      fetchJson<{ connections?: TicketingConnection[] }>('/api/integrations/ticketing/connections'),
      fetchJson<AnalyticsSummary>('/api/planner/analytics'),
    ])

    return {
      state: 'ready',
      error: null,
      activePlanId: activePlan.id,
      planPayload,
      home,
      budget,
      activity: activityPayload.activities ?? [],
      billing,
      ticketing,
      connections: connectionsPayload.connections ?? [],
      analytics,
    }
  } catch (error) {
    return {
      ...initialData,
      state: 'error',
      error: error instanceof Error ? error.message : 'Unable to load mobile planner',
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`)
  }
  return (await response.json()) as T
}

function MobileHeader({
  isMenuOpen,
  reviewCount,
  onToggleMenu,
}: {
  isMenuOpen: boolean
  reviewCount: number
  onToggleMenu: () => void
}) {
  return (
    <header className={cn('sticky top-0 z-40 border-b border-tan bg-cream/95 px-5 pt-4 backdrop-blur', spacing.headerPaddingBottom)}>
      <div className="flex items-center justify-between gap-4">
        <Link href="/planner" className="font-display text-[28px] font-semibold text-clay-deep">
          3rdPlace
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/planner/payments"
            className="inline-flex h-10 items-center rounded-full border border-tan bg-cream-deep px-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft"
          >
            {reviewCount} review
          </Link>
          <button
            type="button"
            onClick={onToggleMenu}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-tan bg-cream-deep text-ink"
            aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </header>
  )
}

function MobileNavigationPanel({
  activeSection,
  activeView,
  planTitle,
  menuTouchStartX,
  onTouchStart,
  onTouchEnd,
  onClose,
  onInternalNavigate,
}: {
  activeSection: MobileSection
  activeView: MobileView
  planTitle: string | null
  menuTouchStartX: number | null
  onTouchStart: (value: number | null) => void
  onTouchEnd: (value: number) => void
  onClose: () => void
  onInternalNavigate: (view: MobileView) => void
}) {
  return (
    <div
      className="fixed inset-0 z-30 bg-ink/20"
      onTouchStart={(event) => onTouchStart(event.touches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        const changed = event.changedTouches[0]
        if (menuTouchStartX !== null && changed) onTouchEnd(changed.clientX)
      }}
    >
      <div className="min-h-screen w-[86%] max-w-[360px] border-r border-tan bg-cream pb-8 pt-20 shadow-card">
        <div className="px-5">
          <p className="label-caps text-clay">Plan workspace</p>
          <p className="mt-2 truncate font-display text-[26px] leading-tight text-ink">{planTitle ?? 'No active plan'}</p>
        </div>
        <nav className="mt-6 border-y border-tan">
          {appSections.map((section) => (
            <PanelLink
              key={section.id}
              href={section.href}
              label={section.label}
              isActive={activeSection === section.id}
              onClick={onClose}
            />
          ))}
        </nav>
        <div className="mt-6 px-5">
          <p className="label-caps text-ink-faint">Planner drilldowns</p>
        </div>
        <nav className="mt-3 border-y border-tan">
          {flowSteps.map((step) => (
            <PanelInternalLink
              key={step.id}
              label={step.label}
              isActive={activeView === step.id}
              onClick={() => onInternalNavigate(step.id)}
            />
          ))}
        </nav>
      </div>
    </div>
  )
}

function PlannerView({
  data,
  messageDraft,
  isSubmittingMessage,
  onDraftChange,
  onSendMessage,
  onNavigate,
}: {
  data: MobileData
  messageDraft: string
  isSubmittingMessage: boolean
  onDraftChange: (value: string) => void
  onSendMessage: () => void
  onNavigate: (view: MobileView) => void
}) {
  const plan = data.planPayload?.plan
  const home = data.home
  if (!plan) return null

  const reviewCount = home?.pending_approval_count ?? 0
  const description = reviewCount > 0
    ? `${reviewCount} approval${reviewCount === 1 ? '' : 's'} waiting. Nothing sends, holds, books, or pays until you approve it.`
    : 'No approvals are waiting. Nothing sends, holds, books, or pays without your approval.'

  return (
    <section>
      <SectionIntro
        eyebrow="Today"
        title={plan.title}
        description={description}
        titleClassName="text-[27px]"
      />

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/planner/payments">
          {reviewCount > 0 ? `Review ${reviewCount} approval${reviewCount === 1 ? '' : 's'}` : 'Open review queue'}
        </PrimaryLink>
        <SecondaryButton onClick={() => onNavigate('brief')}>Open event brief</SecondaryButton>
      </div>

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Needs your review</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-[1.08] text-ink')}>
            {reviewCount > 0 ? 'Decisions ready.' : 'No decisions waiting.'}
          </h2>
        </div>
        {home?.pending_approvals.length ? (
          <div className="divide-y divide-tan">
            {home.pending_approvals.map((approval) => (
              <ReviewQueueRow
                key={approval.id}
                icon={approvalIcon(approval)}
                label={approval.action_label}
                detail={approval.provider ?? approval.package_details ?? 'Approval required'}
                status={approvalStatusLabel(approval)}
                tone={approvalTone(approval)}
                onClick={() => onNavigate(approval.price_cents && approval.price_cents > 0 ? 'deposit' : 'approval')}
              />
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Approvals will appear here after the planner creates a reviewed action." />
        )}
      </Panel>

      {home?.problem && (
        <Panel className={cn(spacing.cardGap, 'border-brick/25 bg-brick-tint')}>
          <div className="flex items-start gap-4">
            <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brick/25 bg-cream text-brick">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="label-caps text-brick">Problem</p>
              <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>{home.problem.summary}</h2>
              {home.problem.detail && <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>{home.problem.detail}</p>}
            </div>
          </div>
        </Panel>
      )}

      <Panel className={spacing.cardGap}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps text-clay">Add instruction</p>
            <h2 className={cn(spacing.labelToHeadline, 'font-display text-[24px] leading-tight text-ink')}>Tell 3rdPlace what changed.</h2>
          </div>
          <StatusPill tone="muted">Private</StatusPill>
        </div>

        <div className={spacing.bodyToAction}>
          <div className={cn('rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
            <textarea
              value={messageDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Add a constraint, preference, or correction..."
              className="min-h-[88px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[17px] leading-7 text-ink outline-none placeholder:text-ink-faint"
            />
            <div className={cn(spacing.bodyToAction, 'flex items-end justify-between gap-4')}>
              <p className="text-sm font-semibold text-ink-soft">Updates the brief. Does not send externally.</p>
              <button
                type="button"
                onClick={onSendMessage}
                disabled={isSubmittingMessage || !messageDraft.trim()}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-clay px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingMessage ? 'Saving' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <EventProgressCard progress={home?.progress ?? []} plan={plan} onNavigate={onNavigate} />
      <ActivityPanel updates={home?.updates ?? []} emptyDescription="Activity appears after plan updates, approvals, payments, or ticketing changes." />
    </section>
  )
}

function NewPlanView({
  draft,
  isCreating,
  hasExistingPlan,
  onDraftChange,
  onStart,
  onNavigate,
}: {
  draft: string
  isCreating: boolean
  hasExistingPlan: boolean
  onDraftChange: (value: string) => void
  onStart: (event: FormEvent<HTMLFormElement>) => void
  onNavigate: (view: MobileView) => void
}) {
  return (
    <section>
      {hasExistingPlan && <CompactBackButton label="Back to plan" onClick={() => onNavigate('planner')} />}
      <SectionIntro
        eyebrow="Start event"
        title="Start your next event."
        description="Creates a private plan. Nothing external happens from this step."
      />

      <form onSubmit={onStart}>
        <Panel className={cn(spacing.sectionGapTight, spacing.cardPaddingTight)}>
          <p className="label-caps text-clay">Event request</p>
          <div className={cn(spacing.labelToHeadline, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Describe the event, headcount, timing, location, and budget..."
              className="min-h-[112px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[17px] leading-7 text-ink outline-none placeholder:text-ink-faint"
            />
            <p className={cn(spacing.headlineToBody, 'text-sm font-semibold text-ink-soft')}>3rdPlace drafts privately first. No outreach sends from this step.</p>
          </div>

          <div className={spacing.bodyToAction}>
            <CompactPrimaryButton type="submit" disabled={isCreating || !draft.trim()}>
              {isCreating ? 'Starting' : 'Start private plan'}
            </CompactPrimaryButton>
          </div>
        </Panel>
      </form>

      <Panel className={cn(spacing.sectionGapTight, spacing.cardPaddingTight)}>
        <p className="label-caps text-clay">Approval default</p>
        <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>
          Every send, hold, booking, and payment requires approval. Outreach automation rules are not enabled in this mobile v1.
        </p>
      </Panel>
    </section>
  )
}

function EventProgressCard({
  progress,
  plan,
  onNavigate,
}: {
  progress: ProgressItem[]
  plan: Plan
  onNavigate: (view: MobileView) => void
}) {
  const items = progress.length > 0 ? progress : fallbackProgress(plan)

  return (
    <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
      <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="label-caps text-clay">Event status</p>
            <p className={cn(spacing.headlineToBody, 'text-sm leading-6 text-ink-soft')}>{eventSummary(plan)}</p>
          </div>
          <ShieldCheck className="h-6 w-6 text-forest" />
        </div>
      </div>
      <div className="divide-y divide-tan">
        {items.map((item) => (
          <CompactActionRow
            key={item.id}
            label={item.label}
            detail={item.detail}
            status={item.status}
            tone={item.tone}
            icon={progressIcon(item.id)}
            onClick={() => onNavigate(progressView(item.id))}
          />
        ))}
      </div>
    </Panel>
  )
}

function BriefView({ plan, onNavigate }: { plan: Plan; onNavigate: (view: MobileView) => void }) {
  const facts = [
    { icon: <Pencil className="h-5 w-5" />, label: 'Event', value: plan.title },
    { icon: <Users className="h-5 w-5" />, label: 'Guests', value: plan.guest_count ? String(plan.guest_count) : null },
    { icon: <DollarSign className="h-5 w-5" />, label: 'Budget', value: money(plan.budget_cap_cents) },
    { icon: <Building2 className="h-5 w-5" />, label: 'Location', value: plan.neighborhood },
    { icon: <CalendarDays className="h-5 w-5" />, label: 'Date', value: dateWindow(plan) },
  ]

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Event brief"
        title="Shared operating brief."
        description="This is what 3rdPlace believes about the event. Hosts correct it here before facts are used externally."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Confirmed facts</p>
        </div>
        <div className="divide-y divide-tan">
          {facts.map((fact) => (
            <BriefFactRow
              key={fact.label}
              icon={fact.icon}
              label={fact.label}
              value={fact.value ?? 'Missing'}
              status={fact.value ? 'Set' : 'Needed'}
              tone={fact.value ? 'forest' : 'ochre'}
            />
          ))}
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Notes and assumptions</p>
        {plan.notes ? (
          <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>{plan.notes}</p>
        ) : (
          <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>No notes or assumptions have been saved yet.</p>
        )}
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Used externally</p>
        <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>
          No external outreach is enabled in this mobile v1. Any future outbound message must be reviewed before it sends.
        </p>
      </Panel>
    </section>
  )
}

function VenuesView({
  data,
  detail,
  onNavigate,
}: {
  data: MobileData
  detail?: boolean
  onNavigate: (view: MobileView) => void
}) {
  const venues = useMemo(() => venueRecommendations(data.planPayload?.recommendations ?? []), [data.planPayload?.recommendations])
  const selected = venues[0]

  if (detail) {
    return (
      <section>
        <BackButton label="Back to venues" onClick={() => onNavigate('venues')} />
        <SectionIntro
          eyebrow="Venue detail"
          title={selected?.name ?? 'No venue selected'}
          description="Venue drilldowns show available plan data only. Outreach fit notes wait for the outreach pipeline."
        />
        {selected ? (
          <Panel className={spacing.sectionGap}>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Rank" value={`#${selected.rank}`} />
              <Metric label="Estimate" value={money(selected.price_cents) ?? 'Missing'} />
              <Metric label="Status" value={titleize(selected.status)} />
              <Metric label="Source" value={selected.reference_id ? 'Catalog' : 'External'} />
            </div>
          </Panel>
        ) : (
          <EmptyState title="No venue detail" description="Venue recommendations appear after the planner creates them." />
        )}
      </section>
    )
  }

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Venues"
        title={venues.length > 0 ? 'Venue options ready.' : 'No venue options yet.'}
        description="This mobile view uses planner recommendations, not a browseable marketplace."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {venues.length > 0 ? (
          <div className="divide-y divide-tan">
            {venues.map((venue) => (
              <button
                key={venue.id}
                type="button"
                onClick={() => onNavigate('venue-detail')}
                className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding)}
              >
                <IconBox><Building2 className="h-5 w-5" /></IconBox>
                <div className="min-w-0">
                  <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{venue.name}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm text-ink-soft">{money(venue.price_cents) ?? 'Estimate missing'}</p>
                    <StatusPill tone="muted">{titleize(venue.status)}</StatusPill>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-soft" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Venue recommendations appear here after the planner has enough event facts." />
        )}
      </Panel>
    </section>
  )
}

function BudgetView({ budget, plan, onNavigate }: { budget: BudgetSummary | null; plan: Plan; onNavigate: (view: MobileView) => void }) {
  const target = budget?.target_cents ?? plan.budget_cap_cents
  const highTotal = budget?.high_total_cents ?? 0
  const buffer = target == null ? null : target - highTotal

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Budget"
        title={target ? `Keep the run inside ${money(target)}.` : 'Budget target missing.'}
        description="The budget drilldown shows plan-owned budget lines and committed costs only."
      />

      <Panel className={spacing.sectionGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="Target" value={money(target) ?? 'Missing'} />
          <SimpleRow label="Low estimate" value={money(budget?.low_total_cents ?? 0) ?? '$0'} />
          <SimpleRow label="High estimate" value={money(highTotal) ?? '$0'} />
          <SimpleRow label="Projected buffer" value={money(buffer) ?? 'Missing'} />
        </div>
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        {budget?.lines.length ? (
          <div className="divide-y divide-tan">
            {budget.lines.map((line) => (
              <SimpleMetricRow
                key={line.id}
                label={line.label}
                value={`${money(line.low_cents)}-${money(line.high_cents)}`}
                tone={line.status === 'paid' || line.status === 'committed' ? 'forest' : 'muted'}
              />
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Budget lines appear here after costs are saved to the plan." />
        )}
      </Panel>
    </section>
  )
}

function ApprovalPolicyView({ onNavigate }: { onNavigate: (view: MobileView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Approval policy"
        title="Every send still needs review."
        description="This mobile v1 keeps the safest approval posture while outreach automation is still in development."
      />
      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Current rule</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Approve every outbound send.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          {skippedSurfaceCopy.policy}
        </p>
      </Panel>
      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <RuleTextRow label="Follow-ups after 24h" status="Approval required" tone="muted" />
        <RuleTextRow label="Clarifying logistics only" status="Approval required" tone="muted" />
        <RuleTextRow label="Price, date, hold, or payment changes" status="Re-approval required" tone="forest" />
      </Panel>
    </section>
  )
}

function DepositApprovalView({ approvals, onNavigate }: { approvals: Approval[]; onNavigate: (view: MobileView) => void }) {
  const moneyApproval = approvals.find((approval) => (approval.price_cents ?? approval.requested_amount_cents ?? 0) > 0)

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Deposit approval"
        title={moneyApproval ? moneyApproval.action_label : 'No money approval waiting.'}
        description="Money movement requires an explicit approval record with amount, recipient, and terms."
      />

      {moneyApproval ? (
        <>
          <Panel className={cn(spacing.sectionGap, 'border-clay/30 bg-clay-tint')}>
            <p className="label-caps text-clay">Money movement</p>
            <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>
              {money(moneyApproval.price_cents ?? moneyApproval.requested_amount_cents ?? null)} approval.
            </h2>
            <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
              Nothing has been paid from this mobile screen.
            </p>
          </Panel>
          <Panel className={spacing.cardGap}>
            <div className="divide-y divide-tan border-y border-tan">
              <SimpleRow label="Recipient" value={moneyApproval.provider ?? 'Missing'} />
              <SimpleRow label="Amount" value={money(moneyApproval.price_cents ?? moneyApproval.requested_amount_cents ?? null) ?? 'Missing'} />
              <SimpleRow label="Event date" value={formatDate(moneyApproval.event_date) ?? 'Missing'} />
              <SimpleRow label="Refund terms" value={moneyApproval.refund_terms ?? 'Missing'} />
            </div>
          </Panel>
          <Panel className={spacing.cardGap}>
            <p className="label-caps text-clay">Before approving</p>
            <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
              Re-approval is required if the amount, date, venue, vendor, or terms change.
            </p>
          </Panel>
        </>
      ) : (
        <EmptyState title="No deposit approval" description="Deposit approvals appear here only after the planner creates a money movement approval record." />
      )}
    </section>
  )
}

function ApprovalsSection({ approvals, onNavigate }: { approvals: Approval[]; onNavigate: (view: MobileView) => void }) {
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')

  return (
    <section>
      <SectionIntro
        eyebrow="Review queue"
        title="Approve the moves that need you."
        description="Each card states what 3rdPlace is prepared to do. Nothing executes from this list without an approval record."
      />

      <p className={cn(spacing.sectionGap, 'label-caps text-ink-soft')}>
        {pendingApprovals.length} pending
      </p>

      {pendingApprovals.length > 0 ? (
        <div className={cn(spacing.sectionGap, 'space-y-5')}>
          {pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              title={approval.action_label}
              target={approval.provider ?? 'Approval required'}
              detail={approval.package_details ?? approval.refund_terms ?? 'Review this action before 3rdPlace proceeds.'}
              status={approvalStatusLabel(approval)}
              tone={approvalTone(approval)}
              onClick={() => onNavigate(approval.price_cents && approval.price_cents > 0 ? 'deposit' : 'approval')}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No approvals waiting" description="Reviewed actions appear here after the planner creates approval records." />
      )}
    </section>
  )
}

function MessagesSection({ messages, activity }: { messages: PlanMessage[]; activity: ActivityItem[] }) {
  const rows = messages.slice(-8).reverse()

  return (
    <section>
      <SectionIntro
        eyebrow="Messages"
        title="Plan messages."
        description="This route shows real planner messages and activity. Parsed venue replies are hidden until the outreach pipeline lands."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {rows.length > 0 ? (
          rows.map((message, index) => (
            <ThreadRow
              key={message.id}
              name={message.role === 'user' ? 'You' : '3rdPlace'}
              detail={message.content}
              status={titleize(message.message_type)}
              tone={message.role === 'user' ? 'muted' : 'forest'}
              isLast={index === rows.length - 1}
            />
          ))
        ) : (
          <EmptyPanelMessage description="Planner messages appear here after you start a plan." />
        )}
      </Panel>

      <ActivityPanel updates={activity.slice(0, 4)} emptyDescription="No plan activity yet." />
    </section>
  )
}

function VendorsSection({
  data,
  detail,
  onNavigate,
}: {
  data: MobileData
  detail?: boolean
  onNavigate: (view: MobileView) => void
}) {
  const vendors = vendorRecommendations(data.planPayload?.recommendations ?? [])
  const selected = vendors[0]

  if (detail) {
    return (
      <section>
        <BackButton label="Back to vendors" onClick={() => onNavigate('planner')} />
        <SectionIntro
          eyebrow="Vendor detail"
          title={selected?.name ?? 'No vendor selected'}
          description="Vendor drilldowns show category, estimate, guests, and status. Reply parsing is not enabled in this mobile v1."
        />
        {selected ? (
          <Panel className={spacing.sectionGap}>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Category" value="Vendor" />
              <Metric label="Estimate" value={money(selected.price_cents) ?? 'Missing'} />
              <Metric label="Guests" value={data.planPayload?.plan.guest_count ? String(data.planPayload.plan.guest_count) : 'Missing'} />
              <Metric label="Status" value={titleize(selected.status)} />
            </div>
          </Panel>
        ) : (
          <EmptyState title="No vendor detail" description="Vendor recommendations appear after the planner creates them." />
        )}
      </section>
    )
  }

  return (
    <section>
      <SectionIntro
        eyebrow="Vendors"
        title={vendors.length > 0 ? 'Vendor options ready.' : 'No vendor options yet.'}
        description="The host sees real planner recommendations by category, not a marketplace shelf."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {vendors.length > 0 ? (
          <div className="divide-y divide-tan">
            {vendors.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                onClick={() => onNavigate('vendor-detail')}
                className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding)}
              >
                <IconBox><Users className="h-5 w-5" /></IconBox>
                <div className="min-w-0">
                  <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{vendor.name}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm text-ink-soft">{money(vendor.price_cents) ?? 'Estimate missing'}</p>
                    <StatusPill tone="muted">{titleize(vendor.status)}</StatusPill>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-soft" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Vendor recommendations appear here after the planner has enough event facts." />
        )}
      </Panel>
    </section>
  )
}

function OutreachSection({ onNavigate }: { onNavigate: (view: MobileView) => void }) {
  return <SkippedOutreachView title="Outreach" description={skippedSurfaceCopy.outreach} onNavigate={onNavigate} />
}

function SettingsSection({ billing, connections }: { billing: BillingStatus | null; connections: TicketingConnection[] }) {
  const connectionLabel = connections.length > 0
    ? connections.map((connection) => titleize(connection.platform)).join(', ')
    : 'No ticketing connection'

  return (
    <section>
      <SectionIntro
        eyebrow="Settings"
        title="3rdPlace defaults."
        description="Mobile settings make operating policy auditable without turning setup into a form."
      />

      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Workspace defaults</p>
        <div className={cn(spacing.labelToHeadline, 'divide-y divide-tan border-y border-tan')}>
          <SimpleRow label="Approval default" value="Every send, hold, booking, payment" />
          <SimpleRow label="Ticketing" value={connectionLabel} />
          <SimpleRow label="Billing state" value={billingLabel(billing)} />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Outreach automation</p>
        <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>{skippedSurfaceCopy.policy}</p>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/planner/payments">Review approvals</PrimaryLink>
        <SecondaryLink href="/planner/settings">Edit on desktop</SecondaryLink>
      </div>
    </section>
  )
}

function AnalyticsSection({ analytics }: { analytics: AnalyticsSummary | null }) {
  return (
    <section>
      <SectionIntro
        eyebrow="Analytics"
        title="Know what worked."
        description="Analytics read as event operating intelligence, using deterministic aggregates only."
      />

      <Panel className={spacing.sectionGap}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label={`${new Date().getFullYear()} events`} value={String(analytics?.events_per_year ?? 0)} />
          <Metric label="Avg margin" value={analytics?.average_margin_percent == null ? 'No data' : `${analytics.average_margin_percent}%`} />
          <Metric label="Rebook rate" value={analytics?.rebook_rate_percent == null ? 'No data' : `${analytics.rebook_rate_percent}%`} />
          <Metric label="Best format" value={analytics?.best_format ? titleize(analytics.best_format) : 'No data'} />
        </div>

        <div className={cn(spacing.bodyToAction, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <p className="label-caps text-clay">Recommendation</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            {analytics?.recommendation ?? 'Complete an event report to unlock event performance recommendations.'}
          </p>
        </div>
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        {analytics?.recent_events.length ? (
          analytics.recent_events.map((event, index) => (
            <SimpleMetricRow
              key={event.id}
              label={event.name}
              value={`${money(event.profit_cents)} net`}
              tone={event.profit_cents >= 0 ? 'forest' : 'brick'}
              isLast={index === analytics.recent_events.length - 1}
            />
          ))
        ) : (
          <EmptyPanelMessage description="Completed event performance appears here after reports or ticketing data are available." />
        )}
      </Panel>
    </section>
  )
}

function TicketingSection({
  ticketing,
  connections,
  onNavigate,
}: {
  ticketing: TicketingSummary | null
  connections: TicketingConnection[]
  onNavigate: (view: MobileView) => void
}) {
  const connected = connections.filter((connection) => connection.status !== 'disconnected')
  const summary = ticketing?.summary

  return (
    <section>
      <SectionIntro
        eyebrow="Ticketing"
        title="Live event data, not signup homework."
        description="Ticketing belongs here as event-scoped operating intelligence once the host is running a plan."
      />

      <Panel className={spacing.sectionGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="Connected" value={connected.length > 0 ? connected.map((connection) => titleize(connection.platform)).join(', ') : 'No connection'} />
          <SimpleRow label="Events loaded" value={String(ticketing?.events?.length ?? 0)} />
          <SimpleRow label="Tickets sold" value={String(summary?.tickets_sold ?? 0)} />
          <SimpleRow label="Net revenue" value={money(summary?.net_revenue_cents ?? 0) ?? '$0'} />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Planner impact</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>
          {summary?.tickets_sold ? 'Attendance signal available.' : 'No ticketing signal yet.'}
        </h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          {summary?.tickets_sold
            ? '3rdPlace can use ticket sales as operating context before the next approval.'
            : 'Connect or import ticketing data to use attendance pace in planner decisions.'}
        </p>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('planner')}>Use in planner</PrimaryButton>
        <SecondaryLink href="/planner/analytics">View event intelligence</SecondaryLink>
      </div>
    </section>
  )
}

function BillingSection({ billing, onNavigate }: { billing: BillingStatus | null; onNavigate: (view: MobileView) => void }) {
  return (
    <section>
      <SectionIntro
        eyebrow="Billing"
        title="Pay when operations move."
        description="Billing stays quiet and concrete: usage, plan, and whether 3rdPlace can keep creating events."
      />

      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Current access</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>{billingLabel(billing)}</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Billing status comes from the builder billing endpoint.
        </p>
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SimpleMetricRow label="Can create event" value={billingCanCreateEvent(billing)} tone={billing?.billing?.canCreateEvent || billing?.billing?.can_create_event ? 'forest' : 'ochre'} />
        <SimpleMetricRow label="Free events remaining" value={String(freeEventsRemaining(billing))} tone="muted" />
        <SimpleMetricRow label="Payment method" value="Managed on billing settings" tone="muted" isLast />
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('new-plan')}>Start next run</PrimaryButton>
        <SecondaryLink href="/planner/payments">Review approvals</SecondaryLink>
      </div>
    </section>
  )
}

function SkippedOutreachView({
  title,
  description,
  onNavigate,
}: {
  title: string
  description: string
  onNavigate: (view: MobileView) => void
}) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="In development"
        title={title}
        description={description}
      />
      <Panel className={cn(spacing.sectionGap, 'border-ochre/25 bg-ochre-tint')}>
        <p className="label-caps text-clay">Approval posture</p>
        <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>
          Nothing external sends from this surface. Future outreach work must still keep host approval gates explicit.
        </p>
      </Panel>
    </section>
  )
}

function LoadingView() {
  return (
    <section>
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-clay" />
          <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">Loading planner</p>
        </div>
      </div>
    </section>
  )
}

function AuthRequiredView() {
  return (
    <section>
      <SectionIntro
        eyebrow="Sign in"
        title="Open your planner."
        description="Mobile planner data is private to signed-in community builders."
      />
      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/login">Log in</PrimaryLink>
        <SecondaryLink href="/signup">Sign up</SecondaryLink>
      </div>
    </section>
  )
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <section>
      <SectionIntro
        eyebrow="Error"
        title="Planner data did not load."
        description="Try again before using this mobile route for review."
      />
      <div className={spacing.bodyToAction}>
        <PrimaryButton onClick={onRetry}>Retry</PrimaryButton>
      </div>
    </section>
  )
}

function ActivityPanel({ updates, emptyDescription }: { updates: ActivityItem[]; emptyDescription: string }) {
  return (
    <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
      <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
        <p className="label-caps text-clay">Activity</p>
      </div>
      {updates.length > 0 ? (
        updates.map((update, index) => (
          <UpdateRow
            key={update.id}
            time={relativeTime(update.occurred_at)}
            title={update.summary}
            detail={update.detail ?? ''}
            isLast={index === updates.length - 1}
          />
        ))
      ) : (
        <EmptyPanelMessage description={emptyDescription} />
      )}
    </Panel>
  )
}

function ReviewQueueRow({
  icon,
  label,
  detail,
  status,
  tone,
  onClick,
}: {
  icon: ReactNode
  label: string
  detail: string
  status: string
  tone: StatusTone
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.rowPadding)}
    >
      <IconBox>{icon}</IconBox>
      <span className="min-w-0">
        <span className="block truncate font-display text-[18px] font-semibold leading-tight text-ink">{label}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink-soft">{detail}</span>
          <StatusPill tone={tone}>{status}</StatusPill>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-ink-soft" />
    </button>
  )
}

function UpdateRow({
  time,
  title,
  detail,
  isLast = false,
}: {
  time: string
  title: string
  detail: string
  isLast?: boolean
}) {
  return (
    <div className={cn(spacing.rowPadding, !isLast && 'border-b border-tan')}>
      <p className="font-mono text-xs text-ink-faint">{time}</p>
      <p className={cn(spacing.headlineToBody, 'text-base font-bold text-ink')}>{title}</p>
      {detail && <p className="mt-1 text-sm leading-6 text-ink-soft">{detail}</p>}
    </div>
  )
}

function SectionIntro({
  eyebrow,
  title,
  description,
  titleClassName,
}: {
  eyebrow: string
  title: string
  description: string
  titleClassName?: string
}) {
  return (
    <div>
      <p className="label-caps text-clay">{eyebrow}</p>
      <h1 className={cn('mt-3 font-display text-[34px] leading-[0.98] text-ink', titleClassName)}>{title}</h1>
      <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>{description}</p>
    </div>
  )
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-tan bg-cream shadow-card', spacing.cardPadding, className)}>{children}</div>
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Panel className={cn(spacing.sectionGap, 'text-center')}>
      <p className="font-display text-[26px] leading-tight text-ink">{title}</p>
      <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>{description}</p>
    </Panel>
  )
}

function EmptyPanelMessage({ description }: { description: string }) {
  return <p className={cn(spacing.rowPadding, 'text-sm font-semibold leading-6 text-ink-soft')}>{description}</p>
}

function StatusPill({ children, tone }: { children: ReactNode; tone: StatusTone }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em]', toneClass[tone])}>
      {children}
    </span>
  )
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
      {children}
    </span>
  )
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(spacing.backButtonGap, 'inline-flex min-h-11 items-center gap-2 rounded-full border border-tan bg-cream-deep px-4 text-sm font-semibold text-ink-soft')}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function CompactBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(spacing.backButtonGapTight, 'inline-flex min-h-10 items-center gap-2 rounded-full border border-tan bg-cream-deep px-3 text-sm font-semibold text-ink-soft')}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-clay px-5 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function CompactPrimaryButton({
  children,
  type = 'button',
  disabled,
}: {
  children: ReactNode
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-clay px-5 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-tan bg-cream-deep px-5 text-center text-sm font-semibold text-ink transition-colors hover:bg-cream"
    >
      {children}
    </button>
  )
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-clay px-5 text-center text-sm font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
    >
      {children}
    </Link>
  )
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-tan bg-cream-deep px-5 text-center text-sm font-semibold text-ink transition-colors hover:bg-cream"
    >
      {children}
    </Link>
  )
}

function PanelLink({
  href,
  label,
  isActive,
  onClick,
}: {
  href: string
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex min-h-12 items-center justify-between border-l-2 px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
        isActive ? 'border-l-clay bg-clay-tint text-clay-deep' : 'border-l-transparent text-ink-soft hover:bg-cream-deep'
      )}
    >
      {label}
      <ChevronRight className="h-4 w-4" />
    </Link>
  )
}

function PanelInternalLink({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center justify-between border-l-2 px-5 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
        isActive ? 'border-l-clay bg-clay-tint text-clay-deep' : 'border-l-transparent text-ink-soft hover:bg-cream-deep'
      )}
    >
      {label}
      <ChevronRight className="h-4 w-4" />
    </button>
  )
}

function CompactActionRow({
  label,
  detail,
  status,
  tone,
  icon,
  onClick,
}: {
  label: string
  detail: string
  status: string
  tone: StatusTone
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding)}
    >
      <IconBox>{icon}</IconBox>
      <div className="min-w-0">
        <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{label}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm text-ink-soft">{detail}</p>
          <StatusPill tone={tone}>{status}</StatusPill>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-soft" />
    </button>
  )
}

function BriefFactRow({
  icon,
  label,
  value,
  status,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  status: string
  tone: StatusTone
}) {
  return (
    <div className={cn('grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3', spacing.rowPadding)}>
      <IconBox>{icon}</IconBox>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">{label}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-base text-ink-soft">{value}</p>
          <StatusPill tone={tone}>{status}</StatusPill>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream-deep p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-2 truncate font-display text-[24px] leading-tight text-ink">{value}</p>
    </div>
  )
}

function SimpleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-3">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-bold text-ink">{value}</span>
    </div>
  )
}

function RuleTextRow({ label, status, tone }: { label: string; status: string; tone: StatusTone }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-3 px-5 py-4', 'border-b border-tan last:border-b-0')}>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  )
}

function SimpleMetricRow({
  label,
  value,
  tone,
  isLast = false,
}: {
  label: string
  value: string
  tone: StatusTone
  isLast?: boolean
}) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-4 px-5 py-4', !isLast && 'border-b border-tan')}>
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{label}</span>
      <StatusPill tone={tone}>{value}</StatusPill>
    </div>
  )
}

function ApprovalCard({
  title,
  target,
  detail,
  status,
  tone,
  onClick,
}: {
  title: string
  target: string
  detail: string
  status: string
  tone: StatusTone
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-tan bg-cream p-5 text-left shadow-card transition-colors hover:bg-cream-deep"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-caps text-clay">{target}</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>{title}</h2>
        </div>
        <StatusPill tone={tone}>{status}</StatusPill>
      </div>
      <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>{detail}</p>
    </button>
  )
}

function ThreadRow({
  name,
  detail,
  status,
  tone,
  isLast = false,
  onClick,
}: {
  name: string
  detail: string
  status: string
  tone: StatusTone
  isLast?: boolean
  onClick?: () => void
}) {
  const content = (
    <>
      <IconBox><MessageSquare className="h-5 w-5" /></IconBox>
      <div className="min-w-0">
        <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{name}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm text-ink-soft">{detail}</p>
          <StatusPill tone={tone}>{status}</StatusPill>
        </div>
      </div>
      {onClick ? <ChevronRight className="h-4 w-4 text-ink-soft" /> : <span aria-hidden className="h-4 w-4" />}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding, !isLast && 'border-b border-tan')}
      >
        {content}
      </button>
    )
  }

  return <div className={cn('grid grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3', spacing.compactRowPadding, !isLast && 'border-b border-tan')}>{content}</div>
}

function venueRecommendations(recommendations: Recommendation[]) {
  return recommendations
    .filter((recommendation) => recommendation.type === 'venue')
    .map((recommendation) => ({
      id: recommendation.id,
      name: recommendation.external_name ?? 'Venue recommendation',
      price_cents: recommendation.price_cents,
      rank: recommendation.rank,
      status: recommendation.status,
      reference_id: recommendation.reference_id,
    }))
}

function vendorRecommendations(recommendations: Recommendation[]) {
  return recommendations
    .filter((recommendation) => recommendation.type === 'vendor')
    .map((recommendation) => ({
      id: recommendation.id,
      name: recommendation.external_name ?? 'Vendor recommendation',
      price_cents: recommendation.price_cents,
      rank: recommendation.rank,
      status: recommendation.status,
      reference_id: recommendation.reference_id,
    }))
}

function approvalIcon(approval: Approval) {
  if ((approval.price_cents ?? approval.requested_amount_cents ?? 0) > 0) return <DollarSign className="h-5 w-5" />
  if (approval.action_label.toLowerCase().includes('hold')) return <CalendarDays className="h-5 w-5" />
  if (approval.action_label.toLowerCase().includes('send')) return <Mail className="h-5 w-5" />
  return <ShieldCheck className="h-5 w-5" />
}

function approvalTone(approval: Approval): StatusTone {
  if ((approval.price_cents ?? approval.requested_amount_cents ?? 0) > 0) return 'clay'
  if (approval.action_label.toLowerCase().includes('hold')) return 'ochre'
  return 'forest'
}

function approvalStatusLabel(approval: Approval) {
  if ((approval.price_cents ?? approval.requested_amount_cents ?? 0) > 0) return 'Money'
  if (approval.action_label.toLowerCase().includes('hold')) return 'Hold'
  if (approval.action_label.toLowerCase().includes('send')) return 'Send'
  return titleize(approval.status)
}

function fallbackProgress(plan: Plan): ProgressItem[] {
  return [
    {
      id: 'brief',
      label: 'Brief',
      detail: plan.title ? 'Plan exists' : 'Needs event facts',
      status: plan.title ? 'Ready' : 'Draft',
      tone: plan.title ? 'forest' : 'ochre',
    },
    {
      id: 'venues',
      label: 'Venues',
      detail: 'No venue recommendations yet',
      status: 'Empty',
      tone: 'muted',
    },
    {
      id: 'budget',
      label: 'Budget',
      detail: plan.budget_cap_cents == null ? 'No budget target yet' : 'Target set on plan',
      status: plan.budget_cap_cents == null ? 'Missing' : 'Watch',
      tone: plan.budget_cap_cents == null ? 'ochre' : 'forest',
    },
    {
      id: 'outreach',
      label: 'Outreach',
      detail: 'Gmail outreach in development',
      status: 'Gated',
      tone: 'muted',
    },
  ]
}

function progressIcon(id: ProgressItem['id']) {
  if (id === 'brief') return <Pencil className="h-5 w-5" />
  if (id === 'venues') return <Building2 className="h-5 w-5" />
  if (id === 'budget') return <DollarSign className="h-5 w-5" />
  return <Mail className="h-5 w-5" />
}

function progressView(id: ProgressItem['id']): MobileView {
  if (id === 'brief') return 'brief'
  if (id === 'venues') return 'venues'
  if (id === 'budget') return 'budget'
  return 'draft'
}

function money(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}$${Math.round(absolute / 100).toLocaleString()}`
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dateWindow(plan: Plan): string | null {
  const start = formatDate(plan.date_window_start)
  const end = formatDate(plan.date_window_end)
  if (start && end && start !== end) return `${start}-${end}`
  return start ?? end
}

function eventSummary(plan: Plan) {
  return [
    titleize(plan.event_type ?? 'event'),
    plan.neighborhood,
    plan.guest_count ? `${plan.guest_count} guests` : null,
    money(plan.budget_cap_cents),
  ].filter(Boolean).join(' · ')
}

function relativeTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'RECENT'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function titleize(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function billingLabel(billing: BillingStatus | null) {
  const tier = billing?.billing?.tier
  const status = billing?.billing?.status
  if (tier && status) return `${titleize(tier)} · ${titleize(status)}`
  if (tier) return titleize(tier)
  if (status) return titleize(status)
  return 'Billing status unavailable'
}

function billingCanCreateEvent(billing: BillingStatus | null) {
  const allowed = billing?.billing?.canCreateEvent ?? billing?.billing?.can_create_event
  if (allowed === true) return 'Yes'
  if (allowed === false) return 'No'
  return 'Unknown'
}

function freeEventsRemaining(billing: BillingStatus | null) {
  return billing?.billing?.freeEventsRemaining ?? billing?.billing?.free_events_remaining ?? 0
}
