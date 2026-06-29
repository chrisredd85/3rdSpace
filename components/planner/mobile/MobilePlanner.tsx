'use client'

import type { FormEvent, ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronRight,
  DollarSign,
  ExternalLink,
  Loader2,
  Mail,
  Menu,
  MessageSquare,
  Pencil,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EntityReadinessBadge } from '@/components/planner/EntityReadinessBadge'
import { PlannerTicketingSetupGuideSection } from '@/components/planner/PlannerTicketingSetupGuideSection'
import { ReportIncorrectInfoModal, type ReportIncorrectInfoEntity } from '@/components/planner/ReportIncorrectInfoModal'
import { StaleRecommendationNotice } from '@/components/planner/StaleRecommendationNotice'
import { VendorLocationBadge, type VendorLocationBadgeProps } from '@/components/planner/VendorLocationBadge'
import {
  resolveEntityReadiness,
  type EntityReadinessIndicator,
} from '@/lib/planner/entityStripeReadiness'
import {
  hasAttendanceSignal,
  normalizePlanAttendanceSnapshot,
  type PlanAttendanceSnapshot,
} from '@/lib/planner/attendanceSummary'
import { cn } from '@/lib/utils'
import { applyMockPlanPatch, buildDeterministicDraftExchange, buildDraftMatchHandoff, buildMockMessage, buildMockPlan, tryRunPublicDraftIntake } from '../planner-page/draftMode'
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
  user_id?: string
  title: string
  event_type: string | null
  status: string
  guest_count: number | null
  budget_cap_cents: number | null
  neighborhood: string | null
  event_city?: string | null
  date_window_start: string | null
  date_window_end: string | null
  ticketed: boolean
  ticketing_model?: string | null
  food_responsibility?: string | null
  venue_terms?: string | null
  agent_action?: string | null
  profit_goal_cents: number | null
  notes: string | null
  plan_revision_count?: number
  brief_render_version?: number
  derived_state_recomputed_at?: string | null
  committed_venue_id?: string | null
  committed_venue_quoted_price_cents?: number | null
  committed_venue_quoted_deal_model?: string | null
  committed_venue_quoted_terms?: unknown
  committed_venue_at?: string | null
  committed_vendors?: unknown
  metadata?: unknown
  created_at: string
  updated_at: string
}

interface PlanMessage {
  id: string
  role: string
  content: string
  message_type: string
  metadata?: unknown
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
  plan_revision_at_creation?: number | null
  metadata?: unknown
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

type ContactStatus = 'ready_to_reach_out' | 'contact_form_available' | 'contact_pending' | 'no_contact_available' | 'inquiry_sent' | 'awaiting_claim'

interface MobilePartnerOption {
  id: string
  kind: 'venue' | 'vendor'
  discoveryId: string | null
  name: string
  price_cents: number | null
  rank: number
  status: string
  reference_id: string | null
  metadata: Record<string, unknown> | null
  contactStatus: ContactStatus | null
  contactEmail: string | null
  contactSource: string | null
  contactFormUrl: string | null
  contactFormLabel: string | null
  website: string | null
  extractionStatus: string | null
  sourceLabel: string
  capacityLabel: string | null
  readiness: EntityReadinessIndicator | null
  planRevisionAtCreation: number | null
  locationBadge: VendorLocationBadgeProps | null
}

interface MobileQuoteOption {
  kind: 'venue' | 'vendor'
  discoveryId: string
  name: string
  serviceType: string | null
  status: string
  quoteCents: number | null
  summary: string | null
  confidence: number | null
  updatedAt: string | null
}

interface CommittedVenueState {
  discoveryId: string | null
  quotedPriceCents: number | null
  quotedDealModel: string | null
  committedAt: string | null
}

interface CommittedVendorState {
  discoveryId: string | null
  serviceType: string
  quotedPackageCents: number | null
  quotedHourlyCents: number | null
  quotedMinimumCents: number | null
  committedAt: string | null
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
  { id: 'approvals', label: 'Next steps', href: '/planner/payments' },
  { id: 'messages', label: 'Inbox', href: '/planner/messages' },
  { id: 'outreach', label: 'Outreach', href: '/planner/outreach' },
  { id: 'vendors', label: 'Vendors', href: '/planner/vendors' },
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
  draft: 'Outreach drafts appear in approvals after Gmail is connected and targets are selected.',
  reply: 'When venues or vendors reply, parsed decisions and quote comparisons appear here after Gmail sync.',
  outreach: 'Use Outreach to review Gmail drafts, sync replies, and compare returned quotes. Sends remain approval-gated.',
  sent: 'Approved sent-message activity appears after Gmail sends from an approved outreach record.',
  policy: 'Default posture is approval-required. Hosts must explicitly set any autonomy policy, and price, date, hold, or payment changes always need re-approval.',
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
  const searchParams = useSearchParams()
  const requestedDraft = searchParams.get('draft')?.trim() ?? ''
  const requestedView = searchParams.get('view')
  const [initialEntry] = useState(() => getInitialMobileEntry(initialView))
  const [view, setView] = useState<MobileView>(initialEntry.view)
  const [data, setData] = useState<MobileData>(initialData)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuTouchStartX, setMenuTouchStartX] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [newPlanDraft, setNewPlanDraft] = useState(initialEntry.draft)
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false)
  const [isCreatingPlan, setIsCreatingPlan] = useState(false)
  const [contactEmailDrafts, setContactEmailDrafts] = useState<Record<string, string>>({})
  const [contactEmailFeedback, setContactEmailFeedback] = useState<Record<string, string>>({})
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null)
  const [quoteFeedback, setQuoteFeedback] = useState<Record<string, string>>({})
  const [isRefreshingRecommendations, setIsRefreshingRecommendations] = useState(false)
  const [reportIncorrectEntity, setReportIncorrectEntity] = useState<ReportIncorrectInfoEntity | null>(null)
  const hasAutoStartedInitialDraftRef = useRef(false)

  const reload = useCallback(async () => {
    setData((current) => ({ ...current, state: 'loading', error: null }))
    const nextData = await loadMobileData()
    setData(nextData)
  }, [])

  useEffect(() => {
    if (initialEntry.skipInitialLoad || requestedDraft) {
      setData({ ...initialData, state: requestedDraft ? 'loading' : 'empty' })
      return
    }
    void reload()
  }, [initialEntry.skipInitialLoad, reload, requestedDraft])

  useEffect(() => {
    if (requestedDraft) {
      setNewPlanDraft(requestedDraft)
      setView('new-plan')
    } else if (isMobileView(requestedView)) {
      setView(requestedView)
    }
  }, [requestedDraft, requestedView])

  const createLocalDraftPlan = useCallback(async (message: string) => {
    const plan = buildMockPlan(message)
    const userMessage = buildMockMessage(plan.id, 'user', message, 'text', {})
    const publicIntake = await tryRunPublicDraftIntake(message, plan)
    const deterministicExchange = publicIntake
      ? null
      : await buildDeterministicDraftExchange(message, plan, [userMessage])
    const finalPlan = publicIntake
      ? applyMockPlanPatch(plan, publicIntake.plan_patch)
      : deterministicExchange?.finalPlan ?? plan
    const agentMessages = publicIntake
      ? [
          buildMockMessage(
            finalPlan.id,
            'agent',
            publicIntake.agent_draft.content,
            publicIntake.agent_draft.message_type,
            publicIntake.agent_draft.metadata
          ),
        ]
      : deterministicExchange?.agentMessages ?? []
    const draftMatchHandoff = buildDraftMatchHandoff(finalPlan, agentMessages)
    const nextPlan = draftMatchHandoff.plan
    const nextMessages = [userMessage, ...draftMatchHandoff.agentMessages]

    setData(buildDraftMobileData(nextPlan as Plan, nextMessages as PlanMessage[]))
    setNewPlanDraft('')
    setView('planner')
  }, [])

  const startPlanFromMessage = useCallback(async (message: string) => {
    const trimmed = message.trim()
    if (!trimmed) return

    try {
      const response = await fetch('/api/planner/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const payload = await response.json().catch(() => null) as { plan?: Plan; error?: string } | null

      if (response.status === 401 || response.status === 403) {
        await createLocalDraftPlan(trimmed)
        return
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to start plan')
      }

      setNewPlanDraft('')
      await reload()
      window.history.replaceState(null, '', '/planner')
      if (payload?.plan?.id) setView('planner')
    } catch (error) {
      console.warn('[mobile.planner] Falling back to local draft mode after create failed', error)
      await createLocalDraftPlan(trimmed)
    }
  }, [createLocalDraftPlan, reload])

  useEffect(() => {
    if (!requestedDraft || hasAutoStartedInitialDraftRef.current) return

    hasAutoStartedInitialDraftRef.current = true
    setIsCreatingPlan(true)
    setData({ ...initialData, state: 'loading', error: null })

    startPlanFromMessage(requestedDraft)
      .catch((error) => {
        setData((current) => ({
          ...current,
          state: 'empty',
          error: error instanceof Error ? error.message : 'Unable to start plan',
        }))
      })
      .finally(() => setIsCreatingPlan(false))
  }, [requestedDraft, startPlanFromMessage])

  const reviewCount = data.home?.pending_approval_count ?? data.planPayload?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  const isLocalDraftPlan = Boolean(data.activePlanId?.startsWith('mock-plan-') || data.planPayload?.plan.user_id === 'mock-user')

  function navigate(nextView: MobileView) {
    setView(nextView)
    setIsMenuOpen(false)
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  async function handleSendMessage() {
    const trimmed = messageDraft.trim()
    if (!trimmed || !data.activePlanId) return
    setIsSubmittingMessage(true)
    try {
      if (isLocalDraftPlan) {
        await saveLocalDraftInstruction(trimmed, data)
        setMessageDraft('')
        return
      }

      const response = await fetch(`/api/planner/plans/${data.activePlanId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
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

  async function handleSaveContactEmail(option: MobilePartnerOption) {
    if (option.kind !== 'venue' || !option.discoveryId) return
    const email = contactEmailDrafts[option.discoveryId]?.trim()
    if (!email) {
      setContactEmailFeedback((current) => ({ ...current, [option.discoveryId!]: 'Enter an email first.' }))
      return
    }

    setContactEmailFeedback((current) => ({ ...current, [option.discoveryId!]: 'Saving contact email...' }))
    try {
      const response = await fetch(`/api/planner/discovery-venues/${encodeURIComponent(option.discoveryId)}/contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; draft_results?: Array<{ status?: string }> }
      if (!response.ok) throw new Error(payload.error ?? 'Could not save contact email')
      const createdDraft = payload.draft_results?.some((result) => result.status === 'draft_created')
      setContactEmailDrafts((current) => ({ ...current, [option.discoveryId!]: '' }))
      setContactEmailFeedback((current) => ({
        ...current,
        [option.discoveryId!]: createdDraft ? 'Contact saved. Outreach draft created for approval.' : 'Contact saved.',
      }))
      await reload()
    } catch (error) {
      setContactEmailFeedback((current) => ({
        ...current,
        [option.discoveryId!]: error instanceof Error ? error.message : 'Could not save contact email',
      }))
    }
  }

  async function handleCreateVenueOutreachApprovals(options: MobilePartnerOption[]) {
    if (!data.activePlanId) return
    const venueIds = options
      .filter((option) => option.kind === 'venue' && option.discoveryId && option.contactStatus === 'ready_to_reach_out')
      .map((option) => option.discoveryId!)
    if (venueIds.length === 0) {
      setBatchFeedback('Add at least one ready venue contact before creating an outreach batch.')
      return
    }

    setBatchFeedback('Creating outreach batch approval...')
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(data.activePlanId)}/outreach/approve-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ discovery_venue_ids: venueIds }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; created_count?: number; target_count?: number }
      if (!response.ok) throw new Error(payload.error ?? 'Could not create outreach batch')
      const approvalCount = payload.created_count ?? 1
      const targetCount = payload.target_count ?? venueIds.length
      setBatchFeedback(
        `${approvalCount} outreach approval${approvalCount === 1 ? '' : 's'} created for ${targetCount} venue${targetCount === 1 ? '' : 's'}. Review before send.`
      )
      await reload()
      setView('approval')
    } catch (error) {
      setBatchFeedback(error instanceof Error ? error.message : 'Could not create outreach batch')
    }
  }

  async function handleRefreshRecommendations() {
    if (!data.activePlanId || data.activePlanId.startsWith('mock-plan-') || isRefreshingRecommendations) return
    setIsRefreshingRecommendations(true)
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(data.activePlanId)}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ venueLimit: 3, vendorLimit: 3 }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not refresh recommendations')
      await reload()
    } catch (error) {
      setBatchFeedback(error instanceof Error ? error.message : 'Could not refresh recommendations')
    } finally {
      setIsRefreshingRecommendations(false)
    }
  }

  async function handleCommitQuote(option: MobileQuoteOption) {
    if (!data.activePlanId) return
    const key = quoteKey(option)
    setQuoteFeedback((current) => ({ ...current, [key]: 'Saving...' }))
    try {
      const response = await fetch(
        option.kind === 'venue'
          ? `/api/planner/plans/${encodeURIComponent(data.activePlanId)}/commit-venue`
          : `/api/planner/plans/${encodeURIComponent(data.activePlanId)}/commit-vendor`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(option.kind === 'venue'
            ? {
                discovery_venue_id: option.discoveryId,
                quoted_price_cents: option.quoteCents,
                quoted_deal_model: option.status,
                quoted_terms: quoteTerms(option),
              }
            : {
                discovery_vendor_id: option.discoveryId,
                service_type: option.serviceType ?? 'other',
                quoted_package_cents: option.quoteCents,
                quoted_terms: quoteTerms(option),
              }),
        }
      )
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not add quote to plan')
      setQuoteFeedback((current) => ({ ...current, [key]: 'Added to plan.' }))
      await reload()
    } catch (error) {
      setQuoteFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : 'Could not add quote to plan',
      }))
    }
  }

  async function handleCancelQuote(option: MobileQuoteOption) {
    if (!data.activePlanId) return
    const key = quoteKey(option)
    setQuoteFeedback((current) => ({ ...current, [key]: 'Cancelling...' }))
    try {
      const response = await fetch(
        option.kind === 'venue'
          ? `/api/planner/plans/${encodeURIComponent(data.activePlanId)}/commit-venue`
          : `/api/planner/plans/${encodeURIComponent(data.activePlanId)}/commit-vendor`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: option.kind === 'venue'
            ? undefined
            : JSON.stringify({ discovery_vendor_id: option.discoveryId, service_type: option.serviceType ?? 'other' }),
        }
      )
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not cancel acceptance')
      setQuoteFeedback((current) => ({ ...current, [key]: 'Acceptance cancelled.' }))
      await reload()
    } catch (error) {
      setQuoteFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : 'Could not cancel acceptance',
      }))
    }
  }

  async function saveLocalDraftInstruction(trimmed: string, currentData: MobileData) {
    const currentPlan = currentData.planPayload?.plan
    if (!currentPlan) throw new Error('Unable to save instruction')

    const currentMessages = currentData.planPayload?.messages ?? []
    const userMessage = buildMockMessage(currentPlan.id, 'user', trimmed, 'text', {})
    const publicIntake = await tryRunPublicDraftIntake(trimmed, currentPlan as Parameters<typeof tryRunPublicDraftIntake>[1])
    const deterministicExchange = publicIntake
      ? null
      : await buildDeterministicDraftExchange(
          trimmed,
          currentPlan as Parameters<typeof buildDeterministicDraftExchange>[1],
          [...currentMessages, userMessage] as Parameters<typeof buildDeterministicDraftExchange>[2]
        )
    const finalPlan = publicIntake
      ? applyMockPlanPatch(currentPlan as Parameters<typeof applyMockPlanPatch>[0], publicIntake.plan_patch)
      : deterministicExchange?.finalPlan ?? currentPlan
    const agentMessages = publicIntake
      ? [
          buildMockMessage(
            finalPlan.id,
            'agent',
            publicIntake.agent_draft.content,
            publicIntake.agent_draft.message_type,
            publicIntake.agent_draft.metadata
          ),
        ]
      : deterministicExchange?.agentMessages ?? []
    const draftMatchHandoff = buildDraftMatchHandoff(
      finalPlan as Parameters<typeof buildDraftMatchHandoff>[0],
      agentMessages,
      currentMessages as Parameters<typeof buildDraftMatchHandoff>[2]
    )
    const nextPlan = draftMatchHandoff.plan
    const nextMessages = [...currentMessages, userMessage, ...draftMatchHandoff.agentMessages]
    const nextActivity = [
      ...currentData.activity,
      buildDraftInstructionActivity(nextPlan.id, trimmed),
    ]

    setData(buildDraftMobileData(nextPlan as Plan, nextMessages as PlanMessage[], nextActivity))
  }

  async function handleStartPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newPlanDraft.trim()) return
    setIsCreatingPlan(true)
    try {
      await startPlanFromMessage(newPlanDraft)
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
              if (endX - menuTouchStartX > 60) setIsMenuOpen(false)
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
            contactEmailDrafts={contactEmailDrafts}
            contactEmailFeedback={contactEmailFeedback}
            batchFeedback={batchFeedback}
            quoteFeedback={quoteFeedback}
            onContactEmailDraftChange={(id, value) => setContactEmailDrafts((current) => ({ ...current, [id]: value }))}
            onSaveContactEmail={handleSaveContactEmail}
            onCreateVenueOutreachApprovals={handleCreateVenueOutreachApprovals}
            isRefreshingRecommendations={isRefreshingRecommendations}
            onRefreshRecommendations={handleRefreshRecommendations}
            onCommitQuote={handleCommitQuote}
            onCancelQuote={handleCancelQuote}
            onReportIncorrectInfo={setReportIncorrectEntity}
          />
          <ReportIncorrectInfoModal
            entity={reportIncorrectEntity}
            isOpen={Boolean(reportIncorrectEntity)}
            onClose={() => setReportIncorrectEntity(null)}
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
  isRefreshingRecommendations,
  onDraftChange,
  onNewPlanDraftChange,
  onSendMessage,
  onStartPlan,
  onNavigate,
  contactEmailDrafts,
  contactEmailFeedback,
  batchFeedback,
  quoteFeedback,
  onContactEmailDraftChange,
  onSaveContactEmail,
  onCreateVenueOutreachApprovals,
  onRefreshRecommendations,
  onCommitQuote,
  onCancelQuote,
  onReportIncorrectInfo,
}: {
  activeSection: MobileSection
  view: MobileView
  data: MobileData
  messageDraft: string
  newPlanDraft: string
  isSubmittingMessage: boolean
  isCreatingPlan: boolean
  isRefreshingRecommendations: boolean
  onDraftChange: (value: string) => void
  onNewPlanDraftChange: (value: string) => void
  onSendMessage: () => void
  onStartPlan: (event: FormEvent<HTMLFormElement>) => void
  onNavigate: (view: MobileView) => void
  contactEmailDrafts: Record<string, string>
  contactEmailFeedback: Record<string, string>
  batchFeedback: string | null
  quoteFeedback: Record<string, string>
  onContactEmailDraftChange: (id: string, value: string) => void
  onSaveContactEmail: (option: MobilePartnerOption) => void
  onCreateVenueOutreachApprovals: (options: MobilePartnerOption[]) => void
  onRefreshRecommendations: () => void
  onCommitQuote: (option: MobileQuoteOption) => void
  onCancelQuote: (option: MobileQuoteOption) => void
  onReportIncorrectInfo: (entity: ReportIncorrectInfoEntity) => void
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

  if (view === 'brief') return <BriefView plan={data.planPayload.plan} approvals={data.planPayload.approvals} onNavigate={onNavigate} />
  if (view === 'venues' || view === 'venue-detail') {
    return (
      <VenuesView
        data={data}
        detail={view === 'venue-detail'}
        contactEmailDrafts={contactEmailDrafts}
        contactEmailFeedback={contactEmailFeedback}
        batchFeedback={batchFeedback}
        quoteFeedback={quoteFeedback}
        onContactEmailDraftChange={onContactEmailDraftChange}
        onSaveContactEmail={onSaveContactEmail}
        onCreateVenueOutreachApprovals={onCreateVenueOutreachApprovals}
        isRefreshingRecommendations={isRefreshingRecommendations}
        onRefreshRecommendations={onRefreshRecommendations}
        onCommitQuote={onCommitQuote}
        onCancelQuote={onCancelQuote}
        onReportIncorrectInfo={onReportIncorrectInfo}
        onNavigate={onNavigate}
      />
    )
  }
  if (view === 'budget') return <BudgetView budget={data.budget} plan={data.planPayload.plan} onNavigate={onNavigate} />
  if (view === 'draft') return <ApprovalsSection approvals={data.planPayload.approvals} onNavigate={onNavigate} />
  if (view === 'approval') return <ApprovalPolicyView onNavigate={onNavigate} />
  if (view === 'deposit') return <DepositApprovalView approvals={data.planPayload.approvals} data={data} onNavigate={onNavigate} />
  if (view === 'sent' || view === 'reply' || view === 'outreach-thread') {
    return (
      <OutreachSection
        data={data}
        quoteFeedback={quoteFeedback}
        onCommitQuote={onCommitQuote}
        onCancelQuote={onCancelQuote}
        onNavigate={onNavigate}
      />
    )
  }
  if (view === 'vendor-detail') {
    return (
      <VendorsSection
        data={data}
        detail
        quoteFeedback={quoteFeedback}
        isRefreshingRecommendations={isRefreshingRecommendations}
        onRefreshRecommendations={onRefreshRecommendations}
        onCommitQuote={onCommitQuote}
        onCancelQuote={onCancelQuote}
        onReportIncorrectInfo={onReportIncorrectInfo}
        onNavigate={onNavigate}
      />
    )
  }

  if (activeSection === 'approvals') return <ApprovalsSection approvals={data.planPayload.approvals} onNavigate={onNavigate} />
  if (activeSection === 'messages') return <MessagesSection messages={data.planPayload.messages} activity={data.activity} />
  if (activeSection === 'vendors') {
    return (
      <VendorsSection
        data={data}
        quoteFeedback={quoteFeedback}
        isRefreshingRecommendations={isRefreshingRecommendations}
        onRefreshRecommendations={onRefreshRecommendations}
        onCommitQuote={onCommitQuote}
        onCancelQuote={onCancelQuote}
        onReportIncorrectInfo={onReportIncorrectInfo}
        onNavigate={onNavigate}
      />
    )
  }
  if (activeSection === 'outreach') {
    return (
      <OutreachSection
        data={data}
        quoteFeedback={quoteFeedback}
        onCommitQuote={onCommitQuote}
        onCancelQuote={onCancelQuote}
        onNavigate={onNavigate}
      />
    )
  }
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

function buildDraftMobileData(plan: Plan, messages: PlanMessage[], activity: ActivityItem[] = [buildDraftCreatedActivity(plan.id)]): MobileData {

  return {
    ...initialData,
    state: 'ready',
    error: null,
    activePlanId: plan.id,
    planPayload: {
      plan,
      messages,
      recommendations: [],
      approvals: [],
    },
    home: {
      plan,
      pending_approvals: [],
      pending_approval_count: 0,
      problem: null,
      progress: fallbackProgress(plan),
      updates: activity,
    },
    budget: null,
    activity,
  }
}

function buildDraftCreatedActivity(planId: string): ActivityItem {
  return {
    id: `draft-activity-${planId}`,
    kind: 'draft_created',
    summary: 'Draft started privately',
    detail: 'No outreach, hold, booking, or payment has been sent.',
    occurred_at: new Date().toISOString(),
  }
}

function buildDraftInstructionActivity(planId: string, instruction: string): ActivityItem {
  return {
    id: `draft-instruction-${planId}-${Date.now()}`,
    kind: 'draft_updated',
    summary: 'Instruction saved privately',
    detail: instruction,
    occurred_at: new Date().toISOString(),
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
            href={reviewCount > 0 ? '/planner/payments' : '/planner?view=approval'}
            className="inline-flex h-10 items-center rounded-full border border-tan bg-cream-deep px-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft"
          >
            {reviewCount > 0 ? `${reviewCount} review` : 'Next step'}
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
      className="fixed inset-0 z-30 overflow-hidden bg-ink/20"
      onClick={onClose}
      onTouchStart={(event) => onTouchStart(event.touches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        const changed = event.changedTouches[0]
        if (menuTouchStartX !== null && changed) onTouchEnd(changed.clientX)
      }}
    >
      <div
        className="ml-auto flex h-[100dvh] max-h-[100dvh] w-[86%] max-w-[360px] flex-col overflow-y-auto overscroll-contain border-l border-tan bg-cream pb-[calc(env(safe-area-inset-bottom)_+_2rem)] pt-20 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
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
    : 'Plan is ready for next steps. Confirm the brief and outreach message before 3rdPlace contacts anyone.'

  return (
    <section>
      <SectionIntro
        eyebrow="Today"
        title={plan.title}
        description={description}
        titleClassName="text-[27px]"
      />

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        {reviewCount > 0 ? (
          <PrimaryLink href="/planner/payments">
            {`Review ${reviewCount} approval${reviewCount === 1 ? '' : 's'}`}
          </PrimaryLink>
        ) : (
          <PrimaryButton onClick={() => onNavigate('approval')}>Review next steps</PrimaryButton>
        )}
        <SecondaryButton onClick={() => onNavigate('brief')}>Open event record</SecondaryButton>
      </div>

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Next action</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-[1.08] text-ink')}>
            {reviewCount > 0 ? 'Decisions ready.' : 'Confirm before outreach.'}
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
          <EmptyPanelMessage description="The plan can move toward venue and vendor outreach after you confirm the facts and approve the message. Nothing sends from this draft." />
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
          Every send, hold, booking, and payment requires approval. Outreach autonomy only changes after the host explicitly sets a policy.
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
            <h2 className={cn(spacing.labelToHeadline, 'font-display text-[24px] leading-tight text-ink')}>Next action steps</h2>
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

function BriefView({
  plan,
  approvals,
  onNavigate,
}: {
  plan: Plan
  approvals: Approval[]
  onNavigate: (view: MobileView) => void
}) {
  const attendance = normalizePlanAttendanceSnapshot(plan, plan.metadata)
  const planDateWindow = dateWindow(plan)
  const committedVenue = readCommittedVenue(plan)
  const committedVendors = readCommittedVendors(plan)
  const pendingOutreachApprovals = approvals.filter(isOutreachApproval)
  const facts = [
    { icon: <Pencil className="h-5 w-5" />, label: 'Event', value: plan.title, isSet: Boolean(plan.title) },
    {
      icon: <Users className="h-5 w-5" />,
      label: 'Guest target',
      value: plan.guest_count ? String(plan.guest_count) : null,
      isSet: Boolean(plan.guest_count),
    },
    {
      icon: <Ticket className="h-5 w-5" />,
      label: 'Tickets / RSVPs',
      value: formatMobileTicketsOrRsvps(attendance),
      isSet:
        hasAttendanceSignal(attendance) &&
        (attendance.ticketsSold !== null || attendance.currentAttendance !== null),
    },
    {
      icon: <ShieldCheck className="h-5 w-5" />,
      label: 'Checked in',
      value: formatMobileCheckedIn(attendance),
      isSet: attendance.checkedIn !== null,
    },
    {
      icon: <DollarSign className="h-5 w-5" />,
      label: 'Budget',
      value: money(plan.budget_cap_cents),
      isSet: plan.budget_cap_cents !== null && plan.budget_cap_cents !== undefined,
    },
    { icon: <Building2 className="h-5 w-5" />, label: 'Location', value: plan.neighborhood, isSet: Boolean(plan.neighborhood) },
    { icon: <CalendarDays className="h-5 w-5" />, label: 'Date', value: planDateWindow, isSet: Boolean(planDateWindow) },
  ]

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Event record"
        title="Shared operating context."
        description="This is what 3rdPlace believes about the event. Hosts correct it here before facts are used externally."
      />

      {!plan.id.startsWith('mock-plan-') ? (
        <Link
          href={`/planner/experiences/${plan.id}`}
          className="mb-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-tan bg-cream px-4 text-sm font-bold text-clay shadow-sm"
        >
          Open event record
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : null}

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
              status={fact.isSet ? 'Set' : 'Needed'}
              tone={fact.isSet ? 'forest' : 'ochre'}
            />
          ))}
        </div>
      </Panel>

      {(committedVenue || committedVendors.length > 0 || pendingOutreachApprovals.length > 0) && (
        <Panel className={cn(spacing.cardGap, 'border-forest/20 bg-forest-tint')}>
          <p className="label-caps text-forest">Operating loop</p>
          <div className={cn(spacing.labelToHeadline, 'space-y-3')}>
            {committedVenue ? (
              <div>
                <p className="font-display text-[22px] leading-tight text-ink">Committed: venue quote accepted</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  {money(committedVenue.quotedPriceCents) ?? 'Quote saved'}{committedVenue.quotedDealModel ? ` · ${committedVenue.quotedDealModel}` : ''}. Booking and payment still require separate approval.
                </p>
              </div>
            ) : null}
            {committedVendors.map((vendor) => (
              <div key={`${vendor.discoveryId ?? 'vendor'}-${vendor.serviceType}`}>
                <p className="font-display text-[20px] leading-tight text-ink">Committed: {titleize(vendor.serviceType)} quote</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  {money(committedVendorAmount(vendor)) ?? 'Quote saved'}. Payment or booking still requires a separate approval.
                </p>
              </div>
            ))}
            {pendingOutreachApprovals.length > 0 ? (
              <button
                type="button"
                onClick={() => onNavigate('approval')}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-forest/25 bg-cream px-4 text-sm font-bold text-forest"
              >
                {pendingOutreachApprovals.length} outreach draft{pendingOutreachApprovals.length === 1 ? '' : 's'} pending approval
              </button>
            ) : null}
          </div>
        </Panel>
      )}

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
          Outreach, holds, bookings, and payments all stay behind approval records. If dates, price, venue, vendor, or terms change, 3rdPlace requires re-approval before execution.
        </p>
      </Panel>
    </section>
  )
}

function VenuesView({
  data,
  detail,
  contactEmailDrafts,
  contactEmailFeedback,
  batchFeedback,
  quoteFeedback,
  onContactEmailDraftChange,
  onSaveContactEmail,
  onCreateVenueOutreachApprovals,
  isRefreshingRecommendations,
  onRefreshRecommendations,
  onCommitQuote,
  onCancelQuote,
  onReportIncorrectInfo,
  onNavigate,
}: {
  data: MobileData
  detail?: boolean
  contactEmailDrafts: Record<string, string>
  contactEmailFeedback: Record<string, string>
  batchFeedback: string | null
  quoteFeedback: Record<string, string>
  onContactEmailDraftChange: (id: string, value: string) => void
  onSaveContactEmail: (option: MobilePartnerOption) => void
  onCreateVenueOutreachApprovals: (options: MobilePartnerOption[]) => void
  isRefreshingRecommendations: boolean
  onRefreshRecommendations: () => void
  onCommitQuote: (option: MobileQuoteOption) => void
  onCancelQuote: (option: MobileQuoteOption) => void
  onReportIncorrectInfo: (entity: ReportIncorrectInfoEntity) => void
  onNavigate: (view: MobileView) => void
}) {
  const venues = useMemo(() => venueRecommendations(data.planPayload?.recommendations ?? []), [data.planPayload?.recommendations])
  const selected = venues[0]
  const currentPlanRevisionCount = data.planPayload?.plan.plan_revision_count ?? 0
  const quotes = mobileQuoteOptions(data.planPayload?.plan).filter((quote) => quote.kind === 'venue')
  const readyVenues = venues.filter((venue) => venue.contactStatus === 'ready_to_reach_out')

  if (detail) {
    return (
      <section>
        <BackButton label="Back to venues" onClick={() => onNavigate('venues')} />
        <SectionIntro
          eyebrow="Venue detail"
          title={selected?.name ?? 'No venue selected'}
          description="Venue drilldowns show fit, readiness, contact status, and returned quote context when Gmail replies are parsed."
        />
        {selected ? (
          <>
            <Panel className={spacing.sectionGap}>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Rank" value={`#${selected.rank}`} />
                <Metric label="Estimate" value={money(selected.price_cents) ?? 'Missing'} />
                <Metric label="Status" value={contactStatusLabel(selected)} />
                <Metric label="Source" value={selected.sourceLabel} />
              </div>
              {selected.readiness ? (
                <div className="mt-4">
                  <EntityReadinessBadge indicator={selected.readiness} />
                </div>
              ) : null}
              <StaleRecommendationNotice
                planRevisionAtCreation={selected.planRevisionAtCreation}
                currentPlanRevisionCount={currentPlanRevisionCount}
                isRefreshing={isRefreshingRecommendations}
                onRefresh={onRefreshRecommendations}
                className="mt-4"
              />
            </Panel>
            <ContactRescuePanel
              option={selected}
              value={selected.discoveryId ? contactEmailDrafts[selected.discoveryId] ?? '' : ''}
              feedback={selected.discoveryId ? contactEmailFeedback[selected.discoveryId] : null}
              onChange={onContactEmailDraftChange}
              onSave={onSaveContactEmail}
            />
            {selected.discoveryId ? (
              <MobileReportIncorrectButton
                entity={{ kind: 'venue', id: selected.discoveryId, name: selected.name }}
                onReport={onReportIncorrectInfo}
              />
            ) : null}
          </>
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
        description="Review contact readiness, create a bulk outreach approval, and compare returned quotes without switching to desktop."
      />

      {readyVenues.length > 0 ? (
        <Panel className={cn(spacing.sectionGap, 'border-forest/20 bg-forest-tint')}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="label-caps text-forest">Outreach approvals</p>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                {readyVenues.length} venue{readyVenues.length === 1 ? '' : 's'} have contact emails. Create one reviewed outreach batch; each recipient stays tracked under the approval before anything sends.
              </p>
            </div>
            <PrimaryButton onClick={() => onCreateVenueOutreachApprovals(venues)}>
              Create outreach batch
            </PrimaryButton>
            {batchFeedback ? <p className="text-sm font-semibold leading-6 text-forest">{batchFeedback}</p> : null}
          </div>
        </Panel>
      ) : batchFeedback ? (
        <Panel className={cn(spacing.sectionGap, 'border-ochre/25 bg-ochre-tint')}>
          <p className="text-sm font-semibold leading-6 text-ink-soft">{batchFeedback}</p>
        </Panel>
      ) : null}

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {venues.length > 0 ? (
          <div className="divide-y divide-tan">
            {venues.map((venue) => (
              <div
                key={venue.id}
                className={cn(spacing.compactRowPadding, 'space-y-3')}
              >
                <button
                  type="button"
                  onClick={() => onNavigate('venue-detail')}
                  className="grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left"
                >
                  <IconBox><Building2 className="h-5 w-5" /></IconBox>
                  <div className="min-w-0">
                    <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{venue.name}</p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-sm text-ink-soft">{money(venue.price_cents) ?? 'Estimate missing'}</p>
                      <StatusPill tone={contactStatusTone(venue)}>{contactStatusLabel(venue)}</StatusPill>
                      <StaleRecommendationNotice
                        planRevisionAtCreation={venue.planRevisionAtCreation}
                        currentPlanRevisionCount={currentPlanRevisionCount}
                        isRefreshing={isRefreshingRecommendations}
                        onRefresh={onRefreshRecommendations}
                        compact
                      />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-soft" />
                </button>
                {venue.readiness ? <EntityReadinessBadge indicator={venue.readiness} /> : null}
                {venue.capacityLabel ? <p className="text-xs font-semibold text-ink-faint">{venue.capacityLabel}</p> : null}
                <ContactRescuePanel
                  option={venue}
                  value={venue.discoveryId ? contactEmailDrafts[venue.discoveryId] ?? '' : ''}
                  feedback={venue.discoveryId ? contactEmailFeedback[venue.discoveryId] : null}
                  onChange={onContactEmailDraftChange}
                  onSave={onSaveContactEmail}
                />
                {venue.discoveryId ? (
                  <MobileReportIncorrectButton
                    entity={{ kind: 'venue', id: venue.discoveryId, name: venue.name }}
                    onReport={onReportIncorrectInfo}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Venue recommendations appear here after the planner has enough event facts." />
        )}
      </Panel>

      <QuoteComparisonPanel
        title="Best fit based on responses"
        quotes={quotes}
        plan={data.planPayload?.plan ?? null}
        feedback={quoteFeedback}
        onCommit={onCommitQuote}
        onCancel={onCancelQuote}
      />
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
        description="Mobile follows the same approval rules as desktop: the agent can prepare, but sends, bookings, payments, and changed terms require host approval."
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

function DepositApprovalView({
  approvals,
  data,
  onNavigate,
}: {
  approvals: Approval[]
  data: MobileData
  onNavigate: (view: MobileView) => void
}) {
  const moneyApproval = approvals.find((approval) => (approval.price_cents ?? approval.requested_amount_cents ?? 0) > 0)
  const readiness = primaryReadinessForMoneyApproval(data)
  const isBlocked = Boolean(readiness && !['stripe_ready', 'committed', 'settled'].includes(readiness.status))

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
          {readiness ? (
            <Panel className={cn(spacing.cardGap, isBlocked ? 'border-ochre/25 bg-ochre-tint' : 'border-forest/20 bg-forest-tint')}>
              <div className="flex flex-col gap-4">
                <div>
                  <p className="label-caps text-clay">{isBlocked ? 'Recipient setup required' : 'Recipient ready'}</p>
                  <div className={spacing.labelToHeadline}>
                    <EntityReadinessBadge indicator={readiness} />
                  </div>
                </div>
                <p className="text-sm leading-6 text-ink-soft">
                  {isBlocked
                    ? 'Approving from mobile is blocked until this partner finishes setup. Notify them, then retry once Stripe is ready.'
                    : 'Stripe readiness is clear. Final payment still requires the explicit approval flow.'}
                </p>
                {isBlocked ? (
                  <SecondaryLink href="/planner/payments">Notify recipient from approvals</SecondaryLink>
                ) : null}
              </div>
            </Panel>
          ) : null}
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
        description="This route shows real planner messages and activity. Parsed outreach replies and quote updates also appear in Outreach after Gmail sync reads response threads."
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
  quoteFeedback,
  isRefreshingRecommendations,
  onRefreshRecommendations,
  onCommitQuote,
  onCancelQuote,
  onReportIncorrectInfo,
  onNavigate,
}: {
  data: MobileData
  detail?: boolean
  quoteFeedback: Record<string, string>
  isRefreshingRecommendations: boolean
  onRefreshRecommendations: () => void
  onCommitQuote: (option: MobileQuoteOption) => void
  onCancelQuote: (option: MobileQuoteOption) => void
  onReportIncorrectInfo: (entity: ReportIncorrectInfoEntity) => void
  onNavigate: (view: MobileView) => void
}) {
  const vendors = vendorRecommendations(data.planPayload?.recommendations ?? [])
  const selected = vendors[0]
  const currentPlanRevisionCount = data.planPayload?.plan.plan_revision_count ?? 0
  const quotes = mobileQuoteOptions(data.planPayload?.plan).filter((quote) => quote.kind === 'vendor')

  if (detail) {
    return (
      <section>
        <BackButton label="Back to vendors" onClick={() => onNavigate('planner')} />
        <SectionIntro
          eyebrow="Vendor detail"
          title={selected?.name ?? 'No vendor selected'}
          description="Vendor drilldowns show category, estimate, distance/service-area context, status, readiness, and returned quotes when replies are parsed."
        />
        {selected ? (
          <>
            <Panel className={spacing.sectionGap}>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Category" value="Vendor" />
                <Metric label="Estimate" value={money(selected.price_cents) ?? 'Missing'} />
                <Metric label="Guests" value={data.planPayload?.plan.guest_count ? String(data.planPayload.plan.guest_count) : 'Missing'} />
                <Metric label="Status" value={contactStatusLabel(selected)} />
              </div>
              {selected.readiness ? (
                <div className="mt-4">
                  <EntityReadinessBadge indicator={selected.readiness} />
                </div>
              ) : null}
              <VendorLocationBadge
                {...(selected.locationBadge ?? {})}
                eventCity={selected.locationBadge?.eventCity ?? data.planPayload?.plan.event_city ?? data.planPayload?.plan.neighborhood}
                className="mt-3"
              />
              <StaleRecommendationNotice
                planRevisionAtCreation={selected.planRevisionAtCreation}
                currentPlanRevisionCount={currentPlanRevisionCount}
                isRefreshing={isRefreshingRecommendations}
                onRefresh={onRefreshRecommendations}
                className="mt-3"
              />
            </Panel>
            <Panel className={cn(spacing.cardGap, 'border-ochre/25 bg-ochre-tint')}>
              <p className="label-caps text-clay">Vendor outreach</p>
              <p className={cn(spacing.labelToHeadline, 'text-sm leading-6 text-ink-soft')}>
                Mobile shows vendor readiness and returned quotes. New vendor opportunity outreach starts from planner recommendations or approvals; booking and payment stay behind separate approval records.
              </p>
            </Panel>
            {selected.discoveryId ? (
              <MobileReportIncorrectButton
                entity={{ kind: 'vendor', id: selected.discoveryId, name: selected.name }}
                onReport={onReportIncorrectInfo}
              />
            ) : null}
          </>
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
        description="Review vendor readiness and returned quotes. Booking and payment still require separate approvals."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {vendors.length > 0 ? (
          <div className="divide-y divide-tan">
            {vendors.map((vendor) => (
              <div key={vendor.id} className="space-y-2">
                <button
                  type="button"
                  onClick={() => onNavigate('vendor-detail')}
                  className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding)}
                >
                  <IconBox><Users className="h-5 w-5" /></IconBox>
                  <div className="min-w-0">
                    <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{vendor.name}</p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate text-sm text-ink-soft">{money(vendor.price_cents) ?? 'Estimate missing'}</p>
                      <StatusPill tone={contactStatusTone(vendor)}>{contactStatusLabel(vendor)}</StatusPill>
                      <VendorLocationBadge
                        {...(vendor.locationBadge ?? {})}
                        eventCity={vendor.locationBadge?.eventCity ?? data.planPayload?.plan.event_city ?? data.planPayload?.plan.neighborhood}
                      />
                      <StaleRecommendationNotice
                        planRevisionAtCreation={vendor.planRevisionAtCreation}
                        currentPlanRevisionCount={currentPlanRevisionCount}
                        isRefreshing={isRefreshingRecommendations}
                        onRefresh={onRefreshRecommendations}
                        compact
                      />
                    </div>
                    {vendor.readiness ? <div className="mt-2"><EntityReadinessBadge indicator={vendor.readiness} /></div> : null}
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-soft" />
                </button>
                {vendor.discoveryId ? (
                  <div className="px-4 pb-4">
                    <MobileReportIncorrectButton
                      entity={{ kind: 'vendor', id: vendor.discoveryId, name: vendor.name }}
                      onReport={onReportIncorrectInfo}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Vendor recommendations appear here after the planner has enough event facts." />
        )}
      </Panel>

      <QuoteComparisonPanel
        title="Vendor quotes from replies"
        quotes={quotes}
        plan={data.planPayload?.plan ?? null}
        feedback={quoteFeedback}
        onCommit={onCommitQuote}
        onCancel={onCancelQuote}
      />
    </section>
  )
}

function OutreachSection({
  data,
  quoteFeedback,
  onCommitQuote,
  onCancelQuote,
  onNavigate,
}: {
  data: MobileData
  quoteFeedback: Record<string, string>
  onCommitQuote: (option: MobileQuoteOption) => void
  onCancelQuote: (option: MobileQuoteOption) => void
  onNavigate: (view: MobileView) => void
}) {
  const quotes = mobileQuoteOptions(data.planPayload?.plan)
  const pendingOutreachApprovals = data.planPayload?.approvals.filter(isOutreachApproval) ?? []
  const venues = venueRecommendations(data.planPayload?.recommendations ?? [])
  const readyVenues = venues.filter((venue) => venue.contactStatus === 'ready_to_reach_out')
  const contactRescueCount = venues.filter((venue) => venue.contactStatus && venue.contactStatus !== 'ready_to_reach_out').length
  const planSearchHref = data.activePlanId ? `/planner/outreach-search?plan=${encodeURIComponent(data.activePlanId)}` : '/planner/outreach-search'
  const trackedRows = venues.slice(0, 4)

  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Outreach"
        title="Agent-led partner outreach."
        description="The agent finds venues and vendors, prepares the batch, and waits for approval before anything sends."
      />

      <Panel className={cn(spacing.sectionGap, 'border-clay/25 bg-clay-tint')}>
        <p className="label-caps text-clay">Agent proposal</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>
          {pendingOutreachApprovals.length > 0
            ? `${pendingOutreachApprovals.length} outreach batch${pendingOutreachApprovals.length === 1 ? '' : 'es'} waiting on you.`
            : readyVenues.length > 0
              ? `${readyVenues.length} contact-ready partner${readyVenues.length === 1 ? '' : 's'} found.`
              : 'The agent is ready to find partners.'}
        </h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          {contactRescueCount > 0
            ? `${contactRescueCount} candidate${contactRescueCount === 1 ? ' still needs' : 's still need'} an email or contact form before outreach can send.`
            : 'Review the proposed batch before Gmail sends. No message sends without approval.'}
        </p>
        <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
          {pendingOutreachApprovals.length > 0 ? (
            <PrimaryButton onClick={() => onNavigate('approval')}>Review outreach batch</PrimaryButton>
          ) : (
            <PrimaryLink href={planSearchHref}>Ask agent to find partners</PrimaryLink>
          )}
          <SecondaryLink href="/planner/payments">Open approvals</SecondaryLink>
        </div>
      </Panel>

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className="grid grid-cols-2 divide-x divide-y divide-tan">
          <MobileOutreachMetric label="Ready" value={String(readyVenues.length)} />
          <MobileOutreachMetric label="Need contact" value={String(contactRescueCount)} />
          <MobileOutreachMetric label="Batches" value={String(pendingOutreachApprovals.length)} />
          <MobileOutreachMetric label="Replies" value={String(quotes.length)} />
        </div>
      </Panel>

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={spacing.panelHeaderPadding}>
          <p className="label-caps text-clay">Agent-tracked partners</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>One row per partner.</h2>
          <p className={cn(spacing.headlineToBody, 'text-sm leading-6 text-ink-soft')}>
            Venues and vendors stay together because the agent is building one event outreach plan.
          </p>
        </div>
        {trackedRows.length > 0 ? (
          <div className="divide-y divide-tan border-t border-tan">
            {trackedRows.map((option, index) => (
              <MobileOutreachPartnerRow key={option.id} option={option} index={index} />
            ))}
          </div>
        ) : (
          <EmptyPanelMessage description="Partner rows appear after discovery creates venue or vendor recommendations for this plan." />
        )}
      </Panel>

      <QuoteComparisonPanel
        title="Best next step from replies"
        quotes={quotes}
        plan={data.planPayload?.plan ?? null}
        feedback={quoteFeedback}
        onCommit={onCommitQuote}
        onCancel={onCancelQuote}
      />
      {quotes.length === 0 && pendingOutreachApprovals.length === 0 ? (
        <EmptyState title="No outreach replies yet" description="Once Gmail sync reads partner replies, quote comparison and next-step options appear here." />
      ) : null}
    </section>
  )
}

function MobileOutreachPartnerRow({ option, index }: { option: MobilePartnerOption; index: number }) {
  const status = option.contactStatus === 'ready_to_reach_out'
    ? 'Ready'
    : option.contactFormUrl
      ? 'Contact form'
      : 'Needs contact'

  return (
    <article className="px-5 py-5">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-tan bg-cream font-mono text-[13px] text-ink-soft">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="font-display text-[23px] leading-tight text-ink">{option.name}</h3>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">{option.kind}</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            {option.metadata?.summary && typeof option.metadata.summary === 'string'
              ? option.metadata.summary
              : option.capacityLabel
                ? `${option.capacityLabel}. ${option.sourceLabel}`
                : option.sourceLabel}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-tan bg-cream-deep px-3 py-1 text-xs font-semibold text-ink-soft">{status}</span>
            {option.contactEmail ? <span className="rounded-full border border-forest/25 bg-forest/10 px-3 py-1 text-xs font-semibold text-forest">Email found</span> : null}
            {option.contactFormUrl ? <span className="rounded-full border border-ochre/25 bg-ochre/10 px-3 py-1 text-xs font-semibold text-ochre">Form link</span> : null}
          </div>
        </div>
      </div>
    </article>
  )
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
          <Metric label="Repeat-ready" value={analytics?.rebook_rate_percent == null ? 'No data' : `${analytics.rebook_rate_percent}%`} />
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

      <PlannerTicketingSetupGuideSection className={cn(spacing.cardGap, 'shadow-none')} />

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
        eyebrow="Approval gated"
        title={title}
        description={description}
      />
      <Panel className={cn(spacing.sectionGap, 'border-ochre/25 bg-ochre-tint')}>
        <p className="label-caps text-clay">Approval posture</p>
        <p className={cn(spacing.labelToHeadline, 'text-base leading-7 text-ink-soft')}>
          Nothing external sends from this surface without an approval record. Outreach stays host-reviewed by default.
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

function MobileOutreachMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-[92px] px-4 py-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-3xl leading-none text-ink">{value}</p>
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
    .map((recommendation) => recommendationToPartnerOption(recommendation, 'venue'))
}

function vendorRecommendations(recommendations: Recommendation[]) {
  return recommendations
    .filter((recommendation) => recommendation.type === 'vendor')
    .map((recommendation) => recommendationToPartnerOption(recommendation, 'vendor'))
}

function recommendationToPartnerOption(recommendation: Recommendation, kind: 'venue' | 'vendor'): MobilePartnerOption {
  const metadata = asRecord(recommendation.metadata)
  const discoveryId = readString(
    metadata?.discovery_venue_id ??
    metadata?.discoveryVenueId ??
    metadata?.discovery_vendor_id ??
    metadata?.discoveryVendorId ??
    metadata?.discovery_id ??
    metadata?.discoveryId
  ) ?? (isUuidLike(recommendation.reference_id) ? recommendation.reference_id : null)
  const contactStatus = normalizeContactStatus(
    readString(metadata?.contact_status ?? metadata?.contactStatus ?? metadata?.website_extraction_status)
  )
  const contactEmail = readString(metadata?.contact_email ?? metadata?.contactEmail ?? metadata?.email)
  const extractionStatus = readString(metadata?.website_extraction_status ?? metadata?.websiteExtractionStatus)
  const capacityKnown = readBoolean(metadata?.capacity_known ?? metadata?.capacityKnown)
  const capacity = readNumber(metadata?.capacity ?? metadata?.capacity_max ?? metadata?.standing_capacity ?? metadata?.seated_capacity)
  const city = readString(metadata?.city ?? metadata?.vendor_city ?? metadata?.venue_city)
  const neighborhood = readString(metadata?.neighborhood ?? metadata?.area)
  const formattedAddress = readString(metadata?.formatted_address ?? metadata?.formattedAddress ?? metadata?.address)
  const serviceArea = readString(metadata?.service_area ?? metadata?.serviceArea)
  const specialSupply = readBoolean(metadata?.special_supply ?? metadata?.specialSupply)
  const entity = {
    name: recommendation.external_name,
    is_claimed: readBoolean(metadata?.is_claimed ?? metadata?.isClaimed),
    claim_status: readString(metadata?.claim_status ?? metadata?.claimStatus),
    stripe_connect_status: readString(metadata?.stripe_connect_status ?? metadata?.stripeConnectStatus ?? metadata?.stripe_account_status),
    invited_at: readString(metadata?.invited_at ?? metadata?.invitedAt),
  }

  return {
    id: recommendation.id,
    kind,
    discoveryId,
    name: recommendation.external_name ?? (kind === 'venue' ? 'Venue recommendation' : 'Vendor recommendation'),
    price_cents: recommendation.price_cents,
    rank: recommendation.rank,
    status: recommendation.status,
    reference_id: recommendation.reference_id,
    metadata,
    contactStatus: contactEmail ? 'ready_to_reach_out' : contactStatus,
    contactEmail,
    contactSource: readString(metadata?.contact_email_source ?? metadata?.contactEmailSource),
    contactFormUrl: readString(metadata?.contact_form_url ?? metadata?.contactFormUrl),
    contactFormLabel: readString(metadata?.contact_form_label ?? metadata?.contactFormLabel),
    website: readString(metadata?.website ?? metadata?.url),
    extractionStatus,
    sourceLabel: readString(metadata?.source_label ?? metadata?.source ?? metadata?.provider) ?? (recommendation.reference_id ? 'Catalog' : 'Discovery'),
    capacityLabel: capacityLabel(capacityKnown, capacity),
    readiness: resolveEntityReadiness({
      entityType: kind,
      entity,
      committedAmount: null,
    }),
    planRevisionAtCreation:
      readNumber(recommendation.plan_revision_at_creation) ??
      readNumber(metadata?.plan_revision_at_creation ?? metadata?.planRevisionAtCreation),
    locationBadge: {
      eventCity: readString(metadata?.event_city ?? metadata?.eventCity),
      vendorCity: city,
      neighborhood,
      formattedAddress,
      serviceArea,
      servesEventCity: readBoolean(metadata?.serves_event_city ?? metadata?.servesEventCity),
      approved: readBoolean(metadata?.out_of_city_approved ?? metadata?.outOfCityApproved),
      specialSupply,
    },
  }
}

function contactStatusLabel(option: MobilePartnerOption) {
  if (option.contactStatus === 'ready_to_reach_out') return 'Ready'
  if (option.contactStatus === 'contact_form_available') return 'Form found'
  if (option.contactStatus === 'contact_pending') return option.extractionStatus ? 'Checking website' : 'Contact pending'
  if (option.contactStatus === 'no_contact_available') return 'Add email'
  if (option.contactStatus === 'inquiry_sent') return 'Inquiry sent'
  if (option.contactStatus === 'awaiting_claim') return 'Awaiting claim'
  if (option.readiness?.status === 'invited') return 'Awaiting claim'
  return titleize(option.status)
}

function contactStatusTone(option: MobilePartnerOption): StatusTone {
  if (option.contactStatus === 'ready_to_reach_out' || option.contactStatus === 'inquiry_sent') return 'forest'
  if (option.contactStatus === 'no_contact_available' || option.contactStatus === 'contact_pending' || option.contactStatus === 'contact_form_available') return 'ochre'
  if (option.readiness?.tone === 'destructive') return 'brick'
  return 'muted'
}

function ContactRescuePanel({
  option,
  value,
  feedback,
  onChange,
  onSave,
}: {
  option: MobilePartnerOption
  value: string
  feedback?: string | null
  onChange: (id: string, value: string) => void
  onSave: (option: MobilePartnerOption) => void
}) {
  if (option.kind !== 'venue' || !option.discoveryId) return null
  if (option.contactStatus === 'ready_to_reach_out' && option.contactEmail) {
    return (
      <div className="rounded-lg border border-forest/20 bg-forest-tint p-3">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-forest">Contact on file</p>
        <p className="mt-1 truncate text-sm font-semibold text-ink">{option.contactEmail}</p>
      </div>
    )
  }

  return (
    <details className="rounded-lg border border-tan bg-cream-deep p-3">
      <summary className="cursor-pointer list-none text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
        {option.contactStatus === 'contact_form_available' ? 'Contact form found' : option.contactStatus === 'contact_pending' ? 'Website check pending' : 'Add contact email'}
      </summary>
      <div className="mt-3 space-y-3">
        {option.contactFormUrl ? (
          <Link href={option.contactFormUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-clay">
            {option.contactFormLabel ?? 'Open contact form'} <ExternalLink className="h-4 w-4" />
          </Link>
        ) : null}
        {option.website ? (
          <Link href={option.website} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-clay">
            Open website <ExternalLink className="h-4 w-4" />
          </Link>
        ) : null}
        <input
          type="email"
          value={value}
          onChange={(event) => onChange(option.discoveryId!, event.target.value)}
          placeholder="booking@example.com"
          className="min-h-12 w-full rounded-lg border border-tan bg-cream px-3 text-base text-ink outline-none focus:border-clay"
        />
        <button
          type="button"
          onClick={() => onSave(option)}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-clay px-4 text-sm font-bold text-cream"
        >
          Save and create draft
        </button>
        {feedback ? <p className="text-sm font-semibold leading-6 text-ink-soft">{feedback}</p> : null}
      </div>
    </details>
  )
}

function MobileReportIncorrectButton({
  entity,
  onReport,
}: {
  entity: ReportIncorrectInfoEntity
  onReport: (entity: ReportIncorrectInfoEntity) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onReport(entity)}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-tan bg-cream px-3 text-xs font-bold uppercase tracking-[0.06em] text-ink-soft transition-colors hover:border-clay hover:text-clay focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
    >
      Report incorrect info
    </button>
  )
}

function QuoteComparisonPanel({
  title,
  quotes,
  plan,
  feedback,
  onCommit,
  onCancel,
}: {
  title: string
  quotes: MobileQuoteOption[]
  plan: Plan | null
  feedback: Record<string, string>
  onCommit: (option: MobileQuoteOption) => void
  onCancel: (option: MobileQuoteOption) => void
}) {
  const actionable = quotes.filter((quote) => quote.quoteCents !== null || /favorable|available|quoted|reply/i.test(quote.status))
  if (actionable.length === 0) return null

  return (
    <Panel className={cn(spacing.cardGap, 'border-forest/20 bg-forest/5')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps text-forest">Reply quotes</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[24px] leading-tight text-ink')}>{title}</h2>
          <p className={cn(spacing.headlineToBody, 'text-sm leading-6 text-ink-soft')}>
            Compare verified replies before updating the brief. Booking and payment still need separate approvals.
          </p>
        </div>
        <StatusPill tone="forest">{actionable.length} option{actionable.length === 1 ? '' : 's'}</StatusPill>
      </div>
      <div className={cn(spacing.bodyToAction, 'space-y-3')}>
        {actionable.map((quote) => (
          <MobileQuoteCard
            key={quoteKey(quote)}
            quote={quote}
            isCommitted={isQuoteCommitted(plan, quote)}
            feedback={feedback[quoteKey(quote)]}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        ))}
      </div>
    </Panel>
  )
}

function MobileQuoteCard({
  quote,
  isCommitted,
  feedback,
  onCommit,
  onCancel,
}: {
  quote: MobileQuoteOption
  isCommitted: boolean
  feedback?: string
  onCommit: (option: MobileQuoteOption) => void
  onCancel: (option: MobileQuoteOption) => void
}) {
  return (
    <div className="rounded-lg border border-tan bg-cream p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-caps text-clay">{quote.kind === 'venue' ? 'Venue' : titleize(quote.serviceType ?? 'vendor')}</p>
          <h3 className="mt-1 truncate font-display text-[21px] leading-tight text-ink">{quote.name}</h3>
        </div>
        <StatusPill tone={isCommitted ? 'forest' : 'clay'}>{isCommitted ? 'In plan' : titleize(quote.status)}</StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Quote" value={money(quote.quoteCents) ?? 'Review'} />
        <Metric label="Confidence" value={quote.confidence !== null ? `${Math.round(quote.confidence * 100)}%` : 'Review'} />
      </div>
      {quote.summary ? <p className="mt-3 text-sm leading-6 text-ink-soft">{quote.summary}</p> : null}
      <div className="mt-4 grid gap-2">
        <PrimaryButton disabled={isCommitted} onClick={() => onCommit(quote)}>
          {isCommitted ? 'In plan' : `Use this ${quote.kind} quote`}
        </PrimaryButton>
        {isCommitted ? (
          <SecondaryButton onClick={() => onCancel(quote)}>Cancel acceptance</SecondaryButton>
        ) : null}
        {feedback ? <p className="text-sm font-semibold leading-6 text-ink-soft">{feedback}</p> : null}
      </div>
    </div>
  )
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

function isOutreachApproval(approval: Approval) {
  const text = `${approval.action_label} ${approval.package_details ?? ''}`.toLowerCase()
  return text.includes('outreach') || text.includes('gmail') || text.includes('send')
}

function primaryReadinessForMoneyApproval(data: MobileData) {
  const venues = venueRecommendations(data.planPayload?.recommendations ?? [])
  const vendors = vendorRecommendations(data.planPayload?.recommendations ?? [])
  return venues.find((venue) => venue.readiness)?.readiness ?? vendors.find((vendor) => vendor.readiness)?.readiness ?? null
}

function mobileQuoteOptions(plan: Plan | null | undefined): MobileQuoteOption[] {
  const metadata = asRecord(plan?.metadata)
  const summary = asRecord(metadata?.outreach_response_summary)
  return [
    ...readQuoteList(summary?.venues, 'venue'),
    ...readQuoteList(summary?.vendors, 'vendor'),
  ]
}

function readQuoteList(value: unknown, kind: 'venue' | 'vendor'): MobileQuoteOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const discoveryId = readString(
      record.discovery_venue_id ??
      record.discoveryVenueId ??
      record.discovery_vendor_id ??
      record.discoveryVendorId ??
      record.discovery_id ??
      record.discoveryId
    )
    if (!discoveryId) return []
    return [{
      kind,
      discoveryId,
      name:
        readString(record.venue_name) ??
        readString(record.vendor_name) ??
        readString(record.name) ??
        (kind === 'venue' ? 'Venue response' : 'Vendor response'),
      serviceType: readString(record.service_type ?? record.serviceType),
      status: readString(record.status) ?? 'reply_received',
      quoteCents:
        readNumber(record.quote_cents) ??
        readNumber(record.quoted_price_cents) ??
        readNumber(record.quoted_package_cents) ??
        readNumber(record.price_cents) ??
        readNumber(record.amount_cents),
      summary: readString(record.summary ?? record.notes ?? record.reply_summary),
      confidence: readNumber(record.confidence ?? record.extraction_confidence),
      updatedAt: readString(record.updated_at ?? record.created_at),
    }]
  })
}

function quoteKey(option: MobileQuoteOption) {
  return `${option.kind}:${option.discoveryId}:${option.serviceType ?? 'default'}`
}

function quoteTerms(option: MobileQuoteOption) {
  return {
    source: 'outreach_reply',
    status: option.status,
    summary: option.summary,
    confidence: option.confidence,
    updated_at: option.updatedAt,
  }
}

function isQuoteCommitted(plan: Plan | null, option: MobileQuoteOption) {
  if (!plan) return false
  if (option.kind === 'venue') {
    return readCommittedVenue(plan)?.discoveryId === option.discoveryId
  }
  return readCommittedVendors(plan).some((vendor) =>
    vendor.discoveryId === option.discoveryId ||
    vendor.serviceType === (option.serviceType ?? 'other')
  )
}

function readCommittedVenue(plan: Plan | null | undefined): CommittedVenueState | null {
  const metadata = asRecord(plan?.metadata)
  const acceptedQuoteState = asRecord(metadata?.accepted_quote_state)
  const raw = asRecord(metadata?.committed_venue) ?? asRecord(acceptedQuoteState?.venue) ?? {
    discovery_venue_id: plan?.committed_venue_id,
    quoted_price_cents: plan?.committed_venue_quoted_price_cents,
    quoted_deal_model: plan?.committed_venue_quoted_deal_model,
    committed_at: plan?.committed_venue_at,
  }
  const discoveryId = readString(raw.discovery_venue_id ?? raw.discoveryVenueId)
  const quotedPriceCents = readNumber(raw.quoted_price_cents ?? raw.quotedPriceCents)
  const committedAt = readString(raw.committed_at ?? raw.committedAt)
  if (!discoveryId && quotedPriceCents === null && !committedAt) return null
  return {
    discoveryId,
    quotedPriceCents,
    quotedDealModel: readString(raw.quoted_deal_model ?? raw.quotedDealModel),
    committedAt,
  }
}

function readCommittedVendors(plan: Plan | null | undefined): CommittedVendorState[] {
  const metadata = asRecord(plan?.metadata)
  const acceptedQuoteState = asRecord(metadata?.accepted_quote_state)
  const raw = Array.isArray(plan?.committed_vendors)
    ? plan?.committed_vendors
    : Array.isArray(metadata?.committed_vendors)
      ? metadata?.committed_vendors
      : Array.isArray(acceptedQuoteState?.vendors)
        ? acceptedQuoteState?.vendors
        : []
  return raw.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    return [{
      discoveryId: readString(record.discovery_vendor_id ?? record.discoveryVendorId ?? record.vendor_id),
      serviceType: readString(record.service_type ?? record.serviceType) ?? 'other',
      quotedPackageCents: readNumber(record.quoted_package_cents ?? record.quotedPackageCents),
      quotedHourlyCents: readNumber(record.quoted_hourly_cents ?? record.quotedHourlyCents),
      quotedMinimumCents: readNumber(record.quoted_minimum_cents ?? record.quotedMinimumCents),
      committedAt: readString(record.committed_at ?? record.committedAt),
    }]
  })
}

function committedVendorAmount(vendor: CommittedVendorState) {
  return vendor.quotedPackageCents ?? vendor.quotedMinimumCents ?? vendor.quotedHourlyCents
}

function normalizeContactStatus(value: string | null): ContactStatus | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!normalized) return null
  if (normalized.includes('ready')) return 'ready_to_reach_out'
  if (normalized.includes('contact_form') || normalized.includes('form')) return 'contact_form_available'
  if (normalized.includes('pending') || normalized.includes('extract') || normalized.includes('checking')) return 'contact_pending'
  if (normalized.includes('sent') || normalized.includes('inquiry')) return 'inquiry_sent'
  if (normalized.includes('claim')) return 'awaiting_claim'
  if (normalized.includes('no_contact') || normalized.includes('missing') || normalized.includes('unavailable')) return 'no_contact_available'
  return null
}

function capacityLabel(capacityKnown: boolean | null, capacity: number | null) {
  if (capacity !== null) return `${capacity.toLocaleString()} capacity`
  if (capacityKnown === false) return 'Capacity TBD — confirm with venue'
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function fallbackProgress(plan: Plan): ProgressItem[] {
  return [
    {
      id: 'brief',
      label: 'Confirm brief',
      detail: plan.title ? 'Update facts before they are used externally' : 'Add event facts',
      status: plan.title ? 'Ready' : 'Draft',
      tone: plan.title ? 'forest' : 'ochre',
    },
    {
      id: 'venues',
      label: 'Venue outreach',
      detail: 'Ready to prepare outreach once the message is confirmed',
      status: 'Ready',
      tone: 'forest',
    },
    {
      id: 'budget',
      label: 'Budget',
      detail: plan.budget_cap_cents == null ? 'Add budget before outreach' : 'Target set. Update if this changes',
      status: plan.budget_cap_cents == null ? 'Missing' : 'Set',
      tone: plan.budget_cap_cents == null ? 'ochre' : 'forest',
    },
    {
      id: 'outreach',
      label: 'Message approval',
      detail: 'Review the outreach message before anyone is contacted',
      status: 'Confirm',
      tone: 'ochre',
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
  return 'approval'
}

function money(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}$${Math.round(absolute / 100).toLocaleString()}`
}

function formatMobileTicketsOrRsvps(attendance: PlanAttendanceSnapshot) {
  if (attendance.ticketsSold !== null) {
    const refunds = attendance.ticketsRefunded ?? 0
    if (refunds > 0) {
      const activeTickets = Math.max(attendance.ticketsSold - refunds, 0)
      return `${activeTickets.toLocaleString()} active (${attendance.ticketsSold.toLocaleString()} sold)`
    }

    return `${attendance.ticketsSold.toLocaleString()} sold`
  }

  if (attendance.currentAttendance !== null) return `${attendance.currentAttendance.toLocaleString()} confirmed`
  return 'No signal yet'
}

function formatMobileCheckedIn(attendance: PlanAttendanceSnapshot) {
  if (attendance.checkedIn !== null) return `${attendance.checkedIn.toLocaleString()} checked in`
  return 'No check-ins yet'
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
