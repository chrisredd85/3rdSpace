/**
 * Purpose: Provides the initial Agent Planner page at `/planner`.
 * Props: None; this route creates planner records through the Agent Planner API.
 * Key behaviors: Shows a centered empty-state composer when no plan is active,
 * uses Supabase-backed planner APIs when authenticated, falls back to local
 * draft mode for public intake, and publishes active plan changes to the Live
 * Plan side panel.
 */
'use client'

import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, CheckCircle2, ChevronDown, Copy, ExternalLink, LayoutTemplate, Loader2, MessageSquare, RefreshCw, SendHorizontal, Sparkles, X } from 'lucide-react'
import { PlannerEmptyState } from '@/components/planner/PlannerEmptyState'
import { PlannerSignupGate } from '@/components/planner/PlannerSignupGate'
import { PlannerTopBar } from '@/components/planner/PlannerTopBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { plannerDraftStorageKey } from '@/lib/planner/migrateDraft'
import type {
  Plan,
  PlanMessage,
  PlannerCreatePlanResponse,
  PlannerFullPlanResponse,
  PlannerListPlansResponse,
  PlannerPostMessageResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const planTabs = [
  { id: 'chat', label: 'Chat' },
  { id: 'plan', label: 'Plan' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'timeline', label: 'Timeline' },
] as const

const quickActionChips = [
  { label: 'Add date window', template: 'Date: [June 1-5]' },
  { label: 'Set guest target', template: 'Guest target: ' },
  { label: 'Model profit window', template: 'Model profit for ' },
] as const

const activeConversationStorageKey = plannerDraftStorageKey

type PlannerTab = (typeof planTabs)[number]['id']
type ApprovalUiStatus = 'approved' | 'rejected'
type PlannerPersistenceMode = 'loading' | 'server' | 'draft'
type PendingConversionActionType = 'save' | 'hold' | 'authorize'

interface PlannerAgentActionRequest {
  actionType: string
  targetType?: string | null
  targetId?: string | null
  payloadJson?: Record<string, unknown> | null
  requestedAmountCents?: number | null
}

interface PendingConversionAction {
  type: PendingConversionActionType
  payload?: {
    agentAction?: PlannerAgentActionRequest
    approvalId?: string
    authorizedAmountCents?: number
    externalUrl?: string
  }
}

interface PlannerTemplateSummary {
  id: string
  name: string
  description: string | null
  snapshot: unknown
  created_at: string
}

interface EventPlanPayload {
  event_name: string | null
  expected_attendance: number | null
  city: string | null
  venue_type: string | null
  budget: number | null
  event_date: string | null
  monetization_model: string | null
  headcount_min: number | null
  headcount_max: number | null
  ticket_price_target: number | null
  profit_goal: number | null
}

interface ResponseAnalysisOutput {
  availability_status: 'available' | 'unavailable' | 'tentative' | 'unknown'
  quoted_price_cents: number | null
  minimum_spend_cents: number | null
  deposit_required_cents: number | null
  capacity_notes: string | null
  included_services: string[]
  exclusions: string[]
  hidden_fees: string[]
  cancellation_terms: string | null
  required_next_steps: string[]
  summary: string
  risk_flags: string[]
  extracted_questions: string[]
}

interface TimelineMilestone {
  title: string
  due_date: string
  category: string
  is_blocking: boolean
}

interface TimelineOutput {
  planning_milestones: TimelineMilestone[]
  day_of_timeline: Array<{
    time: string
    activity: string
    owner: string
    notes: string | null
  }>
  staffing_needs: string[]
  reminders: string[]
  dependency_warnings: string[]
  impossible_timeline: boolean
}

interface PublicDraftIntakeData {
  agent_draft: {
    content: string
    message_type: PlanMessage['message_type']
    metadata: Record<string, unknown>
  }
  plan_patch: Partial<Plan>
}

type PlannerStateLoadResult =
  | { status: 'unauthorized' }
  | { status: 'loaded'; plan: Plan | null; messages: PlanMessage[] }

const PLANNER_STATE_CACHE_TTL_MS = 5_000
const plannerStateRequestCache = new Map<string, {
  createdAt: number
  promise: Promise<PlannerStateLoadResult>
}>()

type TimelineMilestoneStatus = 'pending' | 'done' | 'at_risk'

/**
 * Planner route with empty-state creation and API-backed active-plan chat.
 */
export default function PlannerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PlannerPageContent />
    </Suspense>
  )
}

function PlannerPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const forceDraftMode = searchParams.get('mock') === '1'
  const isDemoSession = searchParams.get('demo') === '1'
  const shouldHardResetDemo = isDemoSession && searchParams.get('reset') === '1'
  const initialDraft = searchParams.get('draft')
  const requestedPlanId = searchParams.get('plan')
  const draftMigrationStatus = searchParams.get('draftMigration')
  const [activePlan, setActivePlan] = useState<Plan | null>(null)
  const [messages, setMessages] = useState<PlanMessage[]>([])
  const [activeTab, setActiveTab] = useState<PlannerTab>('chat')
  const [reply, setReply] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const hasStartedInitialDraftRef = useRef(false)
  const hasTriggeredDemoResetRef = useRef(false)
  const ignoredDraftRef = useRef<string | null>(null)
  const [persistenceMode, setPersistenceMode] = useState<PlannerPersistenceMode>('loading')
  const [hasLoadedStoredConversation, setHasLoadedStoredConversation] = useState(false)
  const [isCreatingPlan, setIsCreatingPlan] = useState(false)
  const [isSendingReply, setIsSendingReply] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isSignupGateOpen, setIsSignupGateOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingConversionAction | null>(null)
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false)
  const [plannerTemplates, setPlannerTemplates] = useState<PlannerTemplateSummary[]>([])
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)
  const [isReplyAnalysisOpen, setIsReplyAnalysisOpen] = useState(false)
  const [replyAnalysisText, setReplyAnalysisText] = useState('')
  const [isAnalyzingReply, setIsAnalyzingReply] = useState(false)
  const [replyAnalysisError, setReplyAnalysisError] = useState<string | null>(null)
  const [replyAnalysisResult, setReplyAnalysisResult] = useState<ResponseAnalysisOutput | null>(null)
  const [timelineResult, setTimelineResult] = useState<TimelineOutput | null>(null)
  const [isTimelineLoading, setIsTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [isDemoResetting, setIsDemoResetting] = useState(false)
  const [demoResetError, setDemoResetError] = useState<string | null>(null)
  useEffect(() => {
    setIsAuthenticated(persistenceMode === 'server')
  }, [persistenceMode])

  useEffect(() => {
    function handleExternalSignupGateRequest(event: Event) {
      const detail = (event as CustomEvent<PendingConversionAction>).detail
      if (!detail || !isPendingConversionAction(detail)) return
      requestSignupForAction(detail)
    }

    window.addEventListener('planner:signup-gate', handleExternalSignupGateRequest)
    return () => window.removeEventListener('planner:signup-gate', handleExternalSignupGateRequest)
  }, [])

  useEffect(() => {
    if (draftMigrationStatus !== 'failed') return

    addToast({
      title: 'Saved your account',
      description: 'Saved your account — re-enter your event details',
      variant: 'destructive',
    })
    router.replace(forceDraftMode ? '/planner?mock=1' : '/planner')
  }, [addToast, draftMigrationStatus, forceDraftMode, router])

  useEffect(() => {
    if (!shouldHardResetDemo || hasTriggeredDemoResetRef.current) return

    hasTriggeredDemoResetRef.current = true
    void resetDemoSession()
  }, [shouldHardResetDemo])

  useEffect(() => {
    if (shouldHardResetDemo) return

    let isCancelled = false

    async function loadPersistedPlannerState() {
      if (initialDraft) {
        clearStoredPlannerConversation()
        setPersistenceMode('draft')
        setHasLoadedStoredConversation(true)
        return
      }

      if (forceDraftMode) {
        restoreDraftConversation()
        setPersistenceMode('draft')
        setHasLoadedStoredConversation(true)
        return
      }

      try {
        const plannerState = await loadPlannerStateFromApiCached(requestedPlanId)

        if (plannerState.status === 'unauthorized') {
          if (!isCancelled) {
            restoreDraftConversation()
            setPersistenceMode('draft')
          }
          return
        }

        if (!isCancelled) {
          setActivePlan(plannerState.plan)
          setMessages(plannerState.messages)
          setActiveTab('chat')
          clearStoredPlannerConversation()
          setPersistenceMode('server')
        }
      } catch (error) {
        if (!isCancelled) {
          const didRestoreDraft = restoreDraftConversation()
          if (didRestoreDraft) {
            setPersistenceMode('draft')
            setErrorMessage(null)
          } else {
            setPersistenceMode('server')
            setErrorMessage(error instanceof Error ? error.message : 'Unable to load planner state')
          }
        }
      } finally {
        if (!isCancelled) setHasLoadedStoredConversation(true)
      }
    }

    void loadPersistedPlannerState()

    return () => {
      isCancelled = true
    }
  }, [forceDraftMode, initialDraft, requestedPlanId, shouldHardResetDemo])

  useEffect(() => {
    if (!hasLoadedStoredConversation) return

    if (activePlan) {
      publishLivePlan(activePlan, messages)
      persistStoredPlannerConversation(activePlan, messages, persistenceMode === 'draft')
      return
    }

    if (persistenceMode !== 'draft') {
      publishLivePlan(null, [])
      persistStoredPlannerConversation(null, [], false)
    }
  }, [activePlan, hasLoadedStoredConversation, messages, persistenceMode])

  useEffect(() => {
    if (!hasLoadedStoredConversation) return
    if (!initialDraft || activePlan || hasStartedInitialDraftRef.current || ignoredDraftRef.current === initialDraft) return

    hasStartedInitialDraftRef.current = true
    void startInitialDraftPlan(initialDraft)
  }, [activePlan, hasLoadedStoredConversation, initialDraft])

  useEffect(() => {
    setTimelineResult(null)
    setTimelineError(null)
  }, [activePlan?.id])

  /**
   * Starts a homepage/public-intake draft and then removes the draft query so
   * refreshes do not create duplicate plans.
   */
  async function startInitialDraftPlan(message: string) {
    const created = await handleCreatePlan(message)

    if (created && window.location.search.includes('draft=')) {
      router.replace(forceDraftMode ? '/planner?mock=1' : '/planner')
    }
  }

  /**
   * Restores the local draft buffer used only for unauthenticated/public intake.
   */
  function restoreDraftConversation() {
    const storedConversation = readStoredPlannerConversation()
    if (!storedConversation) return false

    setActivePlan(storedConversation.plan)
    setMessages(storedConversation.messages)
    setActiveTab('chat')
    return true
  }

  /**
   * Creates a local-only draft when server persistence is unavailable.
   */
  async function createDraftPlan(message: string) {
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
    const nextMessages = [userMessage, ...agentMessages]

    setActivePlan(finalPlan)
    setMessages(nextMessages)
    setActiveTab('chat')
    publishLivePlan(finalPlan, nextMessages)
    persistStoredPlannerConversation(finalPlan, nextMessages, true)
  }

  /**
   * Creates the first planner record from the empty-state prompt.
   */
  async function handleCreatePlan(message: string): Promise<boolean> {
    setIsCreatingPlan(true)
    setErrorMessage(null)

    if (persistenceMode !== 'server') {
      await createDraftPlan(message)
      setIsCreatingPlan(false)
      return true
    }

    try {
      const response = await fetch('/api/planner/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const payload = await response.json()

      if (response.status === 401 || response.status === 403) {
        setPersistenceMode('draft')
        await createDraftPlan(message)
        return true
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to create planner draft')
      }

      const data = payload as PlannerCreatePlanResponse
      setActivePlan(data.plan)
      setMessages(data.messages)
      setActiveTab('chat')
      publishLivePlan(data.plan, data.messages)
      return true
    } catch (error) {
      console.warn('[planner] Falling back to local draft mode after create failed', error)
      setPersistenceMode('draft')
      await createDraftPlan(message)
      return true
    } finally {
      setIsCreatingPlan(false)
    }
  }

  /**
   * Sends a follow-up message to the active plan conversation.
   */
  async function submitReply(value = replyRef.current?.value ?? reply) {
    const trimmed = value.trim()
    if (!trimmed || !activePlan) return

    setIsSendingReply(true)
    setErrorMessage(null)

    if (shouldUseMockReplyPath(persistenceMode, activePlan.id)) {
      const userMessage = buildMockMessage(activePlan.id, 'user', trimmed, 'text', {})
      const publicIntake = await tryRunPublicDraftIntake(trimmed, activePlan)
      const deterministicExchange = publicIntake
        ? null
        : await buildDeterministicDraftExchange(trimmed, activePlan, [...messages, userMessage])
      const finalPlan = publicIntake
        ? applyMockPlanPatch(activePlan, publicIntake.plan_patch)
        : deterministicExchange?.finalPlan ?? activePlan
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
      const nextMessages = [...messages, userMessage, ...agentMessages]

      setActivePlan(finalPlan)
      setMessages(nextMessages)
      setReply('')
      publishLivePlan(finalPlan, nextMessages)
      persistStoredPlannerConversation(finalPlan, nextMessages, true)
      setIsSendingReply(false)
      return
    }

    try {
      const response = await fetch(`/api/planner/plans/${activePlan.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to send planner reply')
      }

      const data = payload as PlannerPostMessageResponse
      const nextMessages = [
        ...messages,
        data.user_message,
        data.agent_message,
        ...(data.follow_up_messages ?? []),
      ]
      setActivePlan(data.plan)
      setMessages(nextMessages)
      setReply('')
      publishLivePlan(data.plan, nextMessages)
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Unable to send planner reply'
      setErrorMessage(description)
      addToast({
        title: 'Reply not sent',
        description,
        variant: 'destructive',
      })
    } finally {
      setIsSendingReply(false)
    }
  }

  /**
   * Handles follow-up form submission.
   */
  function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formReply = new FormData(event.currentTarget).get('reply')
    void submitReply(typeof formReply === 'string' && formReply.trim() ? formReply : replyRef.current?.value ?? reply)
  }

  /**
   * Keeps Enter as send while allowing Shift+Enter multiline replies.
   */
  function handleReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitReply()
    }
  }

  /**
   * Clears the active conversation and returns the planner to a fresh intake state.
   */
  function handleNewPlan() {
    clearStoredPlannerConversation()
    setActivePlan(null)
    setMessages([])
    setReply('')
    setActiveTab('chat')
    setErrorMessage(null)
    setIsCreatingPlan(false)
    setIsSendingReply(false)
    hasStartedInitialDraftRef.current = false
    ignoredDraftRef.current = initialDraft
    publishLivePlan(null, [])

    if (window.location.search) {
      router.replace(forceDraftMode ? '/planner?mock=1' : '/planner')
    }
  }

  async function resetDemoSession() {
    setIsDemoResetting(true)
    setDemoResetError(null)

    try {
      const response = await fetch('/api/demo/reset', {
        method: 'POST',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({} as { error?: string }))

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Demo reset failed')
      }

      clearStoredPlannerConversation()
      publishLivePlan(null, [])
      window.location.replace('/planner?demo=1')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Demo reset failed'
      setDemoResetError(message)
      addToast({
        title: 'Demo reset failed',
        description: message,
        variant: 'destructive',
      })
      setIsDemoResetting(false)
    }
  }

  /**
   * Prefills the reply composer from a quick-action chip and focuses it.
   */
  function handleQuickAction(template: string) {
    replyRef.current?.focus()
    setReply(template)
    window.setTimeout(() => {
      replyRef.current?.focus()
      replyRef.current?.setSelectionRange(template.length, template.length)
    }, 0)
  }

  function handlePlannerTabSelect(tabId: PlannerTab) {
    setActiveTab(tabId)
    if (tabId === 'timeline' && !timelineResult && !isTimelineLoading) {
      void loadPlannerTimeline()
    }
  }

  async function loadPlannerTimeline() {
    if (!activePlan) return

    const eventDate = activePlan.date_window_start ?? activePlan.date_window_end
    if (!eventDate) {
      setTimelineError('Could not generate timeline. Try again.')
      return
    }

    setIsTimelineLoading(true)
    setTimelineError(null)

    try {
      const response = await fetch('/api/ai/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: 'timeline',
          plan_id: activePlan.id,
          payload: {
            event_plan: buildEventPlanPayload(activePlan),
            event_date: eventDate,
            confirmed_venue_bookings: [],
            confirmed_vendor_bookings: [],
            venue_requirements: [],
          },
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Could not generate timeline. Try again.')
      }

      const output = readAgentOutput(payload)
      if (!isTimelineOutput(output)) {
        throw new Error('Could not generate timeline. Try again.')
      }

      setTimelineResult(output)
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : 'Could not generate timeline. Try again.')
    } finally {
      setIsTimelineLoading(false)
    }
  }

  async function openTemplatesModal() {
    setIsTemplatesModalOpen(true)
    if (!hasLoadedTemplates) {
      await loadPlannerTemplates()
    }
  }

  async function loadPlannerTemplates() {
    setIsLoadingTemplates(true)
    setTemplateError(null)

    try {
      const response = await fetch('/api/planner/templates', { method: 'GET' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to load templates')
      }

      const templatesPayload = payload as { templates?: PlannerTemplateSummary[] }
      setPlannerTemplates(Array.isArray(templatesPayload.templates) ? templatesPayload.templates : [])
      setHasLoadedTemplates(true)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Unable to load templates')
    } finally {
      setIsLoadingTemplates(false)
    }
  }

  async function applyPlannerTemplate(templateId: string) {
    if (!activePlan || persistenceMode !== 'server' || activePlan.id.startsWith('mock-plan-')) {
      addToast({
        title: 'Save the plan first',
        description: 'Templates can only be applied to a saved planner plan.',
        variant: 'warning',
      })
      return
    }

    setApplyingTemplateId(templateId)
    setTemplateError(null)

    try {
      const response = await fetch(`/api/planner/templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: activePlan.id }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to apply template')
      }

      setIsTemplatesModalOpen(false)
      addToast({
        title: 'Template applied',
        variant: 'success',
      })
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Unable to apply template')
    } finally {
      setApplyingTemplateId(null)
    }
  }

  async function analyzePartnerReply() {
    if (!activePlan) return

    const rawEmailText = replyAnalysisText.trim()
    if (!rawEmailText) {
      setReplyAnalysisError('Paste a venue or vendor reply first.')
      return
    }

    setIsAnalyzingReply(true)
    setReplyAnalysisError(null)
    setReplyAnalysisResult(null)

    try {
      const response = await fetch('/api/ai/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: 'response_analysis',
          plan_id: activePlan.id,
          payload: {
            raw_email_text: rawEmailText,
            event_plan: buildEventPlanPayload(activePlan),
            partner_type: 'venue',
          },
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to analyze reply')
      }

      const output = readAgentOutput(payload)
      if (!isResponseAnalysisOutput(output)) {
        throw new Error('Response analysis returned an unexpected shape')
      }

      setReplyAnalysisResult(output)
    } catch (error) {
      setReplyAnalysisError(error instanceof Error ? error.message : 'Unable to analyze reply')
    } finally {
      setIsAnalyzingReply(false)
    }
  }

  /**
   * Keeps approval card state synced in the local message timeline after a button action.
   */
  function handleApprovalStatusChange(
    approvalId: string,
    status: ApprovalUiStatus,
    updatedApproval?: Record<string, unknown>
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
          return message
        }

        const approval = message.metadata.approval
        if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
          return message
        }

        const storedApprovalId = typeof approval.id === 'string' ? approval.id : message.id
        if (storedApprovalId !== approvalId) {
          return message
        }

        const nextStatus = typeof updatedApproval?.status === 'string' ? updatedApproval.status : status

        return {
          ...message,
          metadata: {
            ...message.metadata,
            status: nextStatus,
            approval: {
              ...approval,
              ...(updatedApproval ?? {}),
              id: storedApprovalId,
              status: nextStatus,
            },
          } as unknown as PlanMessage['metadata'],
        }
      })
    )
  }

  /**
   * Opens the inline signup gate and records the attempted conversion action.
   */
  function requestSignupForAction(action: PendingConversionAction) {
    setPendingAction(action)
    setIsSignupGateOpen(true)
  }

  /**
   * Resumes the attempted conversion action after signup and draft migration.
   */
  async function handlePlannerGateSignedIn(migratedPlan: PlannerCreatePlanResponse | null) {
    setIsSignupGateOpen(false)
    setIsAuthenticated(true)
    setPersistenceMode('server')

    if (migratedPlan) {
      setActivePlan(migratedPlan.plan)
      setMessages(migratedPlan.messages)
      setActiveTab('chat')
      clearStoredPlannerConversation()
      publishLivePlan(migratedPlan.plan, migratedPlan.messages)
    }

    const actionToResume = pendingAction
    setPendingAction(null)

    if (!actionToResume) return

    const planId = migratedPlan?.plan.id ?? activePlan?.id
    if (!planId || planId.startsWith('mock-plan-')) {
      addToast({
        title: 'Plan saved',
        description: 'Your account was created, but the action needs a saved plan. Try it again.',
        variant: 'warning',
      })
      return
    }

    try {
      await runPendingConversionAction(planId, actionToResume)
      addToast({
        title: 'Action continued',
        description: getPendingActionSuccessMessage(actionToResume.type),
        variant: 'success',
      })
    } catch (error) {
      addToast({
        title: 'Action needs retry',
        description: error instanceof Error ? error.message : 'Your plan is saved, but the action did not complete.',
        variant: 'destructive',
      })
    }
  }

  /**
   * Executes a previously gated conversion action against the authenticated plan.
   */
  async function runPendingConversionAction(planId: string, action: PendingConversionAction) {
    if (action.type === 'save') return

    const payload = action.payload ?? {}

    if (payload.externalUrl && isRealExternalUrl(payload.externalUrl)) {
      window.open(payload.externalUrl, '_blank', 'noopener,noreferrer')
    }

    if (action.type === 'authorize' && payload.approvalId && isUuid(payload.approvalId)) {
      const response = await fetch(`/api/planner/plans/${planId}/approvals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          approvalId: payload.approvalId,
          action: 'authorize',
          authorizedAmountCents: payload.authorizedAmountCents,
        }),
      })

      if (!response.ok) throw new Error('Authorization failed — try again')
      return
    }

    if (!payload.agentAction) {
      throw new Error('Saved your plan. Try the action again to continue.')
    }

    const response = await fetch(`/api/planner/plans/${planId}/agent-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload.agentAction),
    })

    if (!response.ok) {
      throw new Error(action.type === 'authorize' ? 'Authorization failed — try again' : 'Failed to create hold request — try again')
    }
  }

  if (shouldHardResetDemo) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card/70 p-6 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
            <RefreshCw className={cn('h-5 w-5', isDemoResetting && 'animate-spin')} />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-foreground">Resetting demo session</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Clearing the previous demo plan and loading a fresh one.
          </p>
          {demoResetError ? (
            <div className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {demoResetError}
            </div>
          ) : null}
          {demoResetError ? (
            <Button type="button" variant="hero" className="mt-4" onClick={() => void resetDemoSession()}>
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (!activePlan) {
    return (
      <div>
        {errorMessage ? (
          <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
        <PlannerEmptyState onSubmit={handleCreatePlan} isSubmitting={isCreatingPlan} />
        <PlannerSignupGate
          isOpen={isSignupGateOpen}
          onClose={() => setIsSignupGateOpen(false)}
          onSignedIn={(plan) => void handlePlannerGateSignedIn(plan)}
        />
      </div>
    )
  }

  const recommendationMessages = messages.filter(isRecommendationMessage)
  const approvalMessages = messages.filter(isApprovalMessage)
  const visibleMessages = getVisibleMessages(messages, activeTab)
  const approvalSummary = getApprovalSummary(approvalMessages)
  const activeTabLabel = planTabs.find((tab) => tab.id === activeTab)?.label ?? 'Chat'
  const activeDateChip = getActivePlanDateChip(activePlan, messages)
  const demoBanner = isDemoSession ? (
    <DemoSessionBanner
      updatedAt={activePlan.updated_at}
      isResetting={isDemoResetting}
      error={demoResetError}
      onStartOver={() => void resetDemoSession()}
    />
  ) : null

  return (
    <div className="min-h-screen">
      {demoBanner}
      <PlannerTopBar onNewPlan={handleNewPlan} />

      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-border bg-card/50 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Active plan</p>
            <h1 className="mt-1 break-words font-display text-xl font-bold leading-tight sm:text-2xl">{activePlan.title}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                persistenceMode === 'draft'
                  ? 'border-secondary/30 bg-secondary/10 text-secondary'
                  : 'border-success/30 bg-success/10 text-success'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {persistenceMode === 'draft' ? 'Draft saved locally' : 'Plan syncing'}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                activeDateChip.status === 'pending'
                  ? 'border-secondary/30 bg-secondary/10 text-secondary'
                  : activeDateChip.status === 'confirmed'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-border bg-muted text-muted-foreground'
              )}
            >
              {activeDateChip.status === 'confirmed' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CalendarDays className="h-3.5 w-3.5" />
              )}
              {activeDateChip.label}
            </span>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card/40 p-1">
          {planTabs.map((tab) => {
            if (tab.id === 'timeline' && persistenceMode !== 'server') return null
            const count = getTabCount(tab.id, recommendationMessages.length, approvalMessages.length)
            return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handlePlannerTabSelect(tab.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-smooth',
                activeTab === tab.id
                  ? 'bg-secondary text-secondary-foreground shadow-card'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.label}
              {count != null ? (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
                    activeTab === tab.id ? 'bg-background/30 text-secondary-foreground' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
            )
          })}
        </div>

        <section className="overflow-hidden rounded-3xl border border-border bg-card/50 shadow-card">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-secondary" />
              <h2 className="font-display text-lg font-bold">{activeTabLabel}</h2>
            </div>
          </div>
          <div className="space-y-4 p-5">
            {activeTab === 'chat' ? (
              <>
                {visibleMessages.map((message, index) => (
                  <PlannerMessageBubble
                    key={message.id}
                    message={message}
                    isSupersededConfirmation={hasNewerConfirmationMessage(visibleMessages, index)}
                    planId={activePlan.id}
                    isAuthenticated={isAuthenticated}
                    onAuthRequired={requestSignupForAction}
                    onApprovalStatusChange={handleApprovalStatusChange}
                    onToast={addToast}
                    onQuestionAnswerSubmit={(answer) => void submitReply(answer)}
                  />
                ))}
              </>
            ) : null}

            {activeTab === 'plan' ? (
              <>
                <PlanSummaryChips plan={activePlan} />
                {visibleMessages.length > 0 ? (
                  visibleMessages.map((message, index) => (
                    <PlannerFocusedMessageCard
                      key={message.id}
                      message={message}
                      isSupersededConfirmation={hasNewerConfirmationMessage(visibleMessages, index)}
                      planId={activePlan.id}
                      isAuthenticated={isAuthenticated}
                      onAuthRequired={requestSignupForAction}
                      onApprovalStatusChange={handleApprovalStatusChange}
                      onToast={addToast}
                      onQuestionAnswerSubmit={(answer) => void submitReply(answer)}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Start a conversation to build your plan.
                  </div>
                )}
              </>
            ) : null}

            {activeTab === 'recommendations' ? (
              <>
                {visibleMessages.length > 0 ? (
                  visibleMessages.map((message) => (
                    <PlannerFocusedMessageCard
                      key={message.id}
                      message={message}
                      planId={activePlan.id}
                      isAuthenticated={isAuthenticated}
                      onAuthRequired={requestSignupForAction}
                      onApprovalStatusChange={handleApprovalStatusChange}
                      onToast={addToast}
                      onQuestionAnswerSubmit={(answer) => void submitReply(answer)}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No recommendations yet — describe your event and the agent will suggest venues and vendors.
                  </div>
                )}
              </>
            ) : null}

            {activeTab === 'approvals' ? (
              <>
                <div className="rounded-2xl border border-border bg-background/60 px-4 py-3 text-sm font-semibold text-muted-foreground">
                  {approvalSummary.pending} pending · {approvalSummary.authorized} authorized · {approvalSummary.cancelled} cancelled
                </div>
                {visibleMessages.length > 0 ? (
                  visibleMessages.map((message) => (
                    <PlannerApprovalFocusedCard
                      key={message.id}
                      message={message}
                      planId={activePlan.id}
                      isAuthenticated={isAuthenticated}
                      onAuthRequired={requestSignupForAction}
                      onApprovalStatusChange={handleApprovalStatusChange}
                      onToast={addToast}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No pending approvals — approvals appear here when the agent requests authorization.
                  </div>
                )}
              </>
            ) : null}

            {activeTab === 'timeline' && persistenceMode === 'server' ? (
              <PlannerTimelinePanel
                plan={activePlan}
                timeline={timelineResult}
                isLoading={isTimelineLoading}
                error={timelineError}
                onRefresh={() => void loadPlannerTimeline()}
              />
            ) : null}

            {errorMessage ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            {activeTab === 'chat' ? (
              <>
                <form onSubmit={handleReplySubmit} className="relative z-10 rounded-2xl border border-border bg-background/70 p-3">
                  <div className="relative z-10 flex items-end gap-2">
                    <Textarea
                      ref={replyRef}
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      onKeyDown={handleReplyKeyDown}
                      name="reply"
                      rows={1}
                      className="relative z-10 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-3 focus-visible:ring-0"
                      placeholder="Reply with dates, budget, headcount, or approval rules..."
                      aria-label="Reply to planner agent"
                      disabled={isSendingReply}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="mb-1 rounded-xl"
                      aria-label="Send planner reply"
                      disabled={isSendingReply}
                    >
                      {isSendingReply ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                    </Button>
                  </div>
                </form>

                {persistenceMode === 'server' ? (
                  <div className="rounded-2xl border border-border bg-background/60">
                    <button
                      type="button"
                      onClick={() => setIsReplyAnalysisOpen((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition-smooth hover:text-foreground"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Analyze a Reply
                      </span>
                      <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isReplyAnalysisOpen && 'rotate-180')} />
                    </button>

                    {isReplyAnalysisOpen ? (
                      <div className="space-y-3 border-t border-border p-4">
                        <Textarea
                          value={replyAnalysisText}
                          onChange={(event) => setReplyAnalysisText(event.target.value)}
                          rows={5}
                          placeholder="Paste venue or vendor reply"
                          className="min-h-32 resize-y bg-card/60"
                        />
                        <Button
                          type="button"
                          variant="hero"
                          size="sm"
                          onClick={() => void analyzePartnerReply()}
                          disabled={isAnalyzingReply}
                        >
                          {isAnalyzingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          Analyze
                        </Button>

                        {replyAnalysisError ? (
                          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {replyAnalysisError}
                          </div>
                        ) : null}

                        {replyAnalysisResult ? (
                          <ReplyAnalysisResult result={replyAnalysisResult} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="glass" size="sm" type="button" onClick={() => void openTemplatesModal()}>
                    <LayoutTemplate className="h-4 w-4" />
                    Templates
                  </Button>
                  {quickActionChips.map((chip) => (
                    <Button key={chip.label} variant="glass" size="sm" type="button" onClick={() => handleQuickAction(chip.template)}>
                      {chip.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
      <PlannerSignupGate
        isOpen={isSignupGateOpen}
        onClose={() => setIsSignupGateOpen(false)}
        onSignedIn={(plan) => void handlePlannerGateSignedIn(plan)}
      />
      <PlannerTemplatesModal
        isOpen={isTemplatesModalOpen}
        templates={plannerTemplates}
        isLoading={isLoadingTemplates}
        error={templateError}
        applyingTemplateId={applyingTemplateId}
        onClose={() => setIsTemplatesModalOpen(false)}
        onRefresh={() => void loadPlannerTemplates()}
        onApply={(templateId) => void applyPlannerTemplate(templateId)}
      />
    </div>
  )
}

function PlannerTemplatesModal(props: {
  isOpen: boolean
  templates: PlannerTemplateSummary[]
  isLoading: boolean
  error: string | null
  applyingTemplateId: string | null
  onClose: () => void
  onRefresh: () => void
  onApply: (templateId: string) => void
}) {
  if (!props.isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-md">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Planner templates</p>
            <h2 className="mt-1 font-display text-xl font-bold">Use a proven event shape</h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-xl border border-border bg-background/60 p-2 text-muted-foreground transition-smooth hover:text-foreground"
            aria-label="Close templates"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
          {props.error ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {props.error}
            </div>
          ) : null}

          {props.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-background/60 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading templates…
            </div>
          ) : null}

          {!props.isLoading && props.templates.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No saved templates yet.
            </div>
          ) : null}

          {!props.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {props.templates.map((template) => (
                <div key={template.id} className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
                      <LayoutTemplate className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="break-words font-display text-base font-bold">{template.name}</h3>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                        {template.description ?? 'Reusable planner template'}
                      </p>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                        {formatTemplateCreatedAt(template.created_at)}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="hero"
                    size="sm"
                    className="mt-4 w-full"
                    disabled={props.applyingTemplateId !== null}
                    onClick={() => props.onApply(template.id)}
                  >
                    {props.applyingTemplateId === template.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LayoutTemplate className="h-4 w-4" />
                    )}
                    Use this template
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="glass" size="sm" onClick={props.onRefresh} disabled={props.isLoading}>
            <RefreshCw className={cn('h-4 w-4', props.isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button type="button" variant="glass" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatTemplateCreatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Saved template'
  return `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function ReplyAnalysisResult({ result }: { result: ResponseAnalysisOutput }) {
  const suggestedReply = buildSuggestedReplyFromAnalysis(result)
  const actionItems = result.required_next_steps.length > 0
    ? result.required_next_steps
    : result.extracted_questions

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest', getAvailabilityBadgeClass(result.availability_status))}>
          {result.availability_status}
        </span>
        {result.quoted_price_cents !== null ? (
          <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
            Quote {formatMockCents(result.quoted_price_cents)}
          </span>
        ) : null}
        {result.minimum_spend_cents !== null ? (
          <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
            Minimum {formatMockCents(result.minimum_spend_cents)}
          </span>
        ) : null}
        {result.deposit_required_cents !== null ? (
          <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
            Deposit {formatMockCents(result.deposit_required_cents)}
          </span>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-foreground">Action items</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {actionItems.length > 0 ? actionItems.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            )) : (
              <li>No action items extracted.</li>
            )}
          </ul>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-destructive">Risk flags</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.risk_flags.length > 0 ? result.risk_flags.map((flag) => (
              <li key={flag} className="flex gap-2 text-destructive">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <span>{flag}</span>
              </li>
            )) : (
              <li>No risks flagged.</li>
            )}
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-foreground">Suggested reply</p>
          <Button
            type="button"
            variant="glass"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(suggestedReply)}
          >
            <Copy className="h-4 w-4" />
            Copy
          </Button>
        </div>
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-background/80 p-3 text-sm text-muted-foreground">
          {suggestedReply}
        </pre>
      </div>
    </div>
  )
}

function getAvailabilityBadgeClass(status: ResponseAnalysisOutput['availability_status']): string {
  if (status === 'available') return 'border-success/30 bg-success/10 text-success'
  if (status === 'unavailable') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-secondary/30 bg-secondary/10 text-secondary'
}

function buildSuggestedReplyFromAnalysis(result: ResponseAnalysisOutput): string {
  const nextSteps = result.required_next_steps.length > 0
    ? result.required_next_steps.join('\n- ')
    : 'Please confirm availability, pricing, deposit requirements, and any remaining terms.'
  const questions = result.extracted_questions.length > 0
    ? `\n\nQuestions to answer:\n- ${result.extracted_questions.join('\n- ')}`
    : ''

  return [
    'Thanks for the details. This is helpful.',
    '',
    `I have you marked as ${result.availability_status}.`,
    result.capacity_notes ? `Capacity note: ${result.capacity_notes}` : null,
    result.cancellation_terms ? `Cancellation terms noted: ${result.cancellation_terms}` : null,
    '',
    `Next steps:\n- ${nextSteps}`,
    questions,
  ].filter((part): part is string => Boolean(part)).join('\n')
}

function readAgentOutput(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const data = (payload as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return (data as Record<string, unknown>).output
}

function DemoSessionBanner({
  updatedAt,
  isResetting,
  error,
  onStartOver,
}: {
  updatedAt: string | null
  isResetting: boolean
  error: string | null
  onStartOver: () => void
}) {
  return (
    <div className="border-b border-secondary/30 bg-secondary/10 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Continuing demo session from {formatDemoSessionTime(updatedAt)}.
          </p>
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
        </div>
        <Button
          type="button"
          variant="hero"
          size="sm"
          onClick={onStartOver}
          disabled={isResetting}
          className="shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', isResetting && 'animate-spin')} />
          Start over
        </Button>
      </div>
    </div>
  )
}

function formatDemoSessionTime(value: string | null | undefined) {
  if (!value) return 'earlier'

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'earlier'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function isResponseAnalysisOutput(value: unknown): value is ResponseAnalysisOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const output = value as Record<string, unknown>
  return (
    isAvailabilityStatus(output.availability_status) &&
    typeof output.summary === 'string' &&
    Array.isArray(output.required_next_steps) &&
    Array.isArray(output.risk_flags) &&
    Array.isArray(output.extracted_questions)
  )
}

function isAvailabilityStatus(value: unknown): value is ResponseAnalysisOutput['availability_status'] {
  return value === 'available' || value === 'unavailable' || value === 'tentative' || value === 'unknown'
}

function buildEventPlanPayload(plan: Plan): EventPlanPayload {
  return {
    event_name: plan.title ?? null,
    expected_attendance: plan.guest_count,
    city: inferPlanCity(plan.neighborhood),
    venue_type: plan.event_type,
    budget: plan.budget_cap_cents,
    event_date: plan.date_window_start ?? plan.date_window_end,
    monetization_model: plan.ticketed ? 'ticketed' : plan.ticketing_model ?? 'free',
    headcount_min: plan.guest_count,
    headcount_max: plan.guest_count,
    ticket_price_target: null,
    profit_goal: plan.profit_goal_cents,
  }
}

function inferPlanCity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'sf' || normalized.includes('san francisco')) return 'San Francisco'
  if (normalized.includes('oakland')) return 'Oakland'
  if (normalized.includes('berkeley')) return 'Berkeley'
  return value ?? null
}

function PlannerTimelinePanel(props: {
  plan: Plan
  timeline: TimelineOutput | null
  isLoading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const eventDate = props.plan.date_window_start ?? props.plan.date_window_end
  const milestones = props.timeline
    ? [...props.timeline.planning_milestones].sort((first, second) => first.due_date.localeCompare(second.due_date))
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Timeline</p>
          <h3 className="mt-1 font-display text-lg font-bold">Planning milestones</h3>
        </div>
        <Button type="button" variant="glass" size="sm" onClick={props.onRefresh} disabled={props.isLoading}>
          <RefreshCw className={cn('h-4 w-4', props.isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {props.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : null}

      {!props.isLoading && props.error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not generate timeline. Try again.
        </div>
      ) : null}

      {!props.isLoading && !props.error && props.timeline ? (
        <>
          {props.timeline.impossible_timeline ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This timeline is compressed. Critical milestones may not be realistic before the event date.
            </div>
          ) : null}

          {props.timeline.dependency_warnings.length > 0 ? (
            <div className="rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm text-secondary">
              {props.timeline.dependency_warnings.join(' ')}
            </div>
          ) : null}

          <div className="relative space-y-3 pl-4">
            <div className="absolute bottom-0 left-[1.1rem] top-0 w-px bg-border" />
            {milestones.map((milestone) => {
              const status = getTimelineMilestoneStatus(milestone)
              return (
                <div key={`${milestone.due_date}:${milestone.title}`} className="relative flex gap-4 rounded-2xl border border-border bg-background/60 p-4">
                  <span className="absolute -left-[0.15rem] top-6 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                  <div className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {formatTimelineDateLabel(milestone.due_date, eventDate)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-display text-base font-bold">{milestone.title}</h4>
                      <span className="rounded-full border border-border bg-card/70 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {milestone.category}
                      </span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest', getTimelineStatusClass(status))}>
                        {status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-border bg-card/70 px-2 py-1 text-xs text-muted-foreground">
                        Owner: Event lead
                      </span>
                      {milestone.is_blocking ? (
                        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                          Blocking
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {!props.isLoading && !props.error && !props.timeline ? (
        <div className="rounded-2xl border border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
          Open this tab to generate a timeline from the current plan.
        </div>
      ) : null}
    </div>
  )
}

function isTimelineOutput(value: unknown): value is TimelineOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const output = value as Record<string, unknown>
  return (
    Array.isArray(output.planning_milestones) &&
    Array.isArray(output.day_of_timeline) &&
    Array.isArray(output.staffing_needs) &&
    Array.isArray(output.reminders) &&
    Array.isArray(output.dependency_warnings) &&
    typeof output.impossible_timeline === 'boolean'
  )
}

function formatTimelineDateLabel(dueDate: string, eventDate: string | null): string {
  if (!eventDate) return dueDate

  const due = parseDateOnly(dueDate)
  const event = parseDateOnly(eventDate)
  if (!due || !event) return dueDate

  const diffDays = Math.round((event.getTime() - due.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Event day'
  if (diffDays > 0) return `T-${diffDays} days`
  return `T+${Math.abs(diffDays)} days`
}

function getTimelineMilestoneStatus(milestone: TimelineMilestone): TimelineMilestoneStatus {
  const due = parseDateOnly(milestone.due_date)
  if (!due) return 'pending'

  const today = parseDateOnly(new Date().toISOString().slice(0, 10))
  if (today && due.getTime() < today.getTime()) return 'at_risk'
  return 'pending'
}

function getTimelineStatusClass(status: TimelineMilestoneStatus): string {
  if (status === 'done') return 'border-success/30 bg-success/10 text-success'
  if (status === 'at_risk') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted text-muted-foreground'
}

function parseDateOnly(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Returns the filtered message list for the active planner tab.
 */
function getVisibleMessages(messages: PlanMessage[], activeTab: PlannerTab) {
  if (activeTab === 'chat') return messages
  if (activeTab === 'plan') return messages.filter(isPlanArtifactMessage)
  if (activeTab === 'recommendations') return messages.filter(isRecommendationMessage)
  return messages.filter(isApprovalMessage)
}

/**
 * Guards custom signup-gate events emitted by sibling planner panels.
 */
function isPendingConversionAction(value: unknown): value is PendingConversionAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actionType = (value as Record<string, unknown>).type
  return actionType === 'save' || actionType === 'hold' || actionType === 'authorize'
}

/**
 * User-facing success copy after a gated action resumes.
 */
function getPendingActionSuccessMessage(type: PendingConversionActionType) {
  if (type === 'authorize') return 'Authorization recorded.'
  if (type === 'hold') return 'Hold request created.'
  return 'Plan saved.'
}

/**
 * Counts messages shown in badge-bearing tabs.
 */
function getTabCount(activeTab: PlannerTab, recommendationCount: number, approvalCount: number) {
  if (activeTab === 'recommendations') return recommendationCount
  if (activeTab === 'approvals') return approvalCount
  return null
}

/**
 * Matches structured plan messages, including legacy agent text responses.
 */
function isPlanArtifactMessage(message: PlanMessage) {
  const messageType = String(message.message_type)
  return (
    messageType === 'confirmation_card' ||
    messageType === 'status_update' ||
    messageType === 'agent_response' ||
    (messageType === 'text' && message.role === 'agent')
  )
}

/**
 * Matches planner recommendation messages.
 */
function isRecommendationMessage(message: PlanMessage) {
  if (String(message.message_type) !== 'recommendation') return false
  const meta = message.metadata
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false
  const recs = (meta as Record<string, unknown>).recommendations
  return Array.isArray(recs) && recs.length > 0
}

/**
 * Matches planner approval request messages.
 */
function isApprovalMessage(message: PlanMessage) {
  return String(message.message_type) === 'approval_request'
}

/**
 * Returns true when a confirmation card has been superseded by a newer one in the rendered list.
 */
function hasNewerConfirmationMessage(messages: PlanMessage[], messageIndex: number) {
  const message = messages[messageIndex]
  if (!message || String(message.message_type) !== 'confirmation_card') return false

  return messages
    .slice(messageIndex + 1)
    .some((nextMessage) => String(nextMessage.message_type) === 'confirmation_card')
}

function publishLivePlan(plan: Plan | null, messages: PlanMessage[]) {
  if (typeof window === 'undefined') return

  if (!plan) {
    window.localStorage.removeItem('planner-live-plan')
    window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: { plan: null, messages: [], planId: null } }))
    return
  }

  const snapshot = {
    title: plan.title,
    eventType: plan.event_type,
    status: plan.status,
    guestCount: plan.guest_count,
    budgetCapCents: plan.budget_cap_cents,
    neighborhood: plan.neighborhood,
    dateWindowStart: plan.date_window_start,
    dateWindowEnd: plan.date_window_end,
    ticketed: plan.ticketed,
    ticketingModel: plan.ticketing_model ?? null,
    ticketPriceTargetCents: readPlanTicketPriceTargetCents(plan),
    foodResponsibility: plan.food_responsibility ?? null,
    venueTerms: plan.venue_terms ?? null,
    actionPermission: plan.agent_action ?? null,
    notes: plan.notes ?? null,
    runOfShow: readPlanAgentCacheOutput(plan, 'timeline'),
    workspaceSummary: readPlanAgentCacheOutput(plan, 'workspace_summary'),
    updatedAt: plan.updated_at,
  }

  const payload = {
    plan: snapshot,
    messages,
    planId: plan.id,
  }

  window.localStorage.setItem('planner-live-plan', JSON.stringify(payload))
  window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: payload }))
}

function readPlanTicketPriceTargetCents(plan: Plan): number | null {
  const metadata = readRecord(plan.metadata)
  const cents = readFiniteNumber(metadata?.ticket_price_target_cents)
  if (cents !== null && cents > 0) return cents

  const value = readFiniteNumber(metadata?.ticket_price_target)
  if (value !== null && value > 0) return Math.round(value < 10000 ? value * 100 : value)

  return null
}

function readPlanAgentCacheOutput(plan: Plan, key: 'timeline' | 'workspace_summary'): Record<string, unknown> | null {
  const metadata = readRecord(plan.metadata)
  const agentCache = readRecord(metadata?.agent_cache)
  const cacheEntry = readRecord(agentCache?.[key])
  return readRecord(cacheEntry?.output)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads the active planner conversation so route changes do not reset the chat.
 */
function readStoredPlannerConversation(): { plan: Plan; messages: PlanMessage[] } | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(activeConversationStorageKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<{ plan: Plan; messages: PlanMessage[] }>
    if (!parsed.plan || typeof parsed.plan.id !== 'string') {
      clearStoredPlannerConversation()
      return null
    }

    if (isExecutedPlanStatus(parsed.plan.status)) {
      clearStoredPlannerConversation()
      return null
    }

    return {
      plan: parsed.plan,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch {
    clearStoredPlannerConversation()
    return null
  }
}

/**
 * Persists the current conversation until the user starts a new event or the plan completes.
 */
function persistStoredPlannerConversation(plan: Plan | null, messages: PlanMessage[], shouldPersistDraft: boolean) {
  if (typeof window === 'undefined') return

  if (!shouldPersistDraft || !plan || isExecutedPlanStatus(plan.status)) {
    clearStoredPlannerConversation()
    return
  }

  window.localStorage.setItem(
    activeConversationStorageKey,
    JSON.stringify({
      plan,
      messages,
      savedAt: new Date().toISOString(),
    })
  )
}

/**
 * Clears persisted planner conversation state after an explicit new-event action.
 */
function clearStoredPlannerConversation() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(activeConversationStorageKey)
}

/**
 * Returns true for terminal plan states that should not restore as an active chat.
 */
function isExecutedPlanStatus(status: Plan['status']) {
  return status === 'complete' || status === 'archived'
}

function buildMockPlan(message: string): Plan {
  const now = new Date().toISOString()
  const eventType = detectMockEventType(message)
  const title = eventType ? `${eventType.charAt(0).toUpperCase()}${eventType.slice(1)} plan` : 'Event plan'

  return {
    id: `mock-plan-${Date.now()}`,
    user_id: 'mock-user',
    title,
    event_type: eventType,
    status: 'drafting',
    guest_count: detectMockGuestCount(message),
    budget_cap_cents: detectMockBudgetCap(message),
    neighborhood: detectMockNeighborhood(message),
    date_window_start: null,
    date_window_end: null,
    ticketed: /\b(ticketed|paid|tickets?)\b/i.test(message),
    profit_goal_cents: null,
    notes: 'Mock planner mode. No Supabase writes.',
    created_at: now,
    updated_at: now,
  }
}

async function tryRunPublicDraftIntake(message: string, plan: Plan): Promise<PublicDraftIntakeData | null> {
  try {
    const response = await fetch('/api/planner/public-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: message,
        current_plan: plan,
      }),
    })
    const payload = await response.json().catch(() => null) as { data?: PublicDraftIntakeData; error?: string } | null

    if (!response.ok || !payload?.data) {
      throw new Error(payload?.error ?? 'Public intake unavailable')
    }

    return payload.data
  } catch (error) {
    console.warn('[planner.public-intake] Falling back to deterministic draft:', error)
    return null
  }
}

async function buildDeterministicDraftExchange(
  message: string,
  plan: Plan,
  conversationMessages: PlanMessage[]
): Promise<{ finalPlan: Plan; agentMessages: PlanMessage[] }> {
  const { getMockAgentResponse } = await import('@/lib/planner/mockAgentResponses')
  const mockResponse = getMockAgentResponse(conversationMessages, message, plan)
  const finalPlan = applyMockPlanPatch(plan, mockResponse.planPatch)
  const agentMessages = mockResponse.messages.map((agentMessage) =>
    buildMockMessage(
      finalPlan.id,
      agentMessage.role,
      agentMessage.content,
      agentMessage.message_type,
      agentMessage.metadata
    )
  )

  return { finalPlan, agentMessages }
}

/**
 * Applies defined mock-agent plan fields without wiping existing context.
 */
function applyMockPlanPatch(plan: Plan, patch: Partial<Plan>): Plan {
  const eventType = patch.event_type ?? plan.event_type
  return {
    ...plan,
    title: eventType ? `${eventType.charAt(0).toUpperCase()}${eventType.slice(1)} plan` : plan.title,
    event_type: eventType,
    status: patch.status ?? plan.status,
    guest_count: patch.guest_count ?? plan.guest_count,
    budget_cap_cents: patch.budget_cap_cents ?? plan.budget_cap_cents,
    neighborhood: patch.neighborhood ?? plan.neighborhood,
    date_window_start:
      patch.date_window_start === undefined ? plan.date_window_start : patch.date_window_start,
    date_window_end:
      patch.date_window_end === undefined ? plan.date_window_end : patch.date_window_end,
    ticketed: patch.ticketed ?? plan.ticketed,
    ticketing_model:
      patch.ticketing_model === undefined ? plan.ticketing_model : patch.ticketing_model,
    food_responsibility:
      patch.food_responsibility === undefined ? plan.food_responsibility : patch.food_responsibility,
    venue_terms: patch.venue_terms === undefined ? plan.venue_terms : patch.venue_terms,
    agent_action: patch.agent_action === undefined ? plan.agent_action : patch.agent_action,
    profit_goal_cents:
      patch.profit_goal_cents === undefined ? plan.profit_goal_cents : patch.profit_goal_cents,
    notes: patch.notes ?? plan.notes,
    metadata: patch.metadata === undefined
      ? plan.metadata
      : ({
          ...(readRecord(plan.metadata) ?? {}),
          ...(readRecord(patch.metadata) ?? {}),
        } as Plan['metadata']),
    updated_at: patch.updated_at ?? new Date().toISOString(),
  }
}

async function loadPlannerStateFromApiCached(requestedPlanId: string | null): Promise<PlannerStateLoadResult> {
  const cacheKey = requestedPlanId ? `plan:${requestedPlanId}` : 'active-plan'
  const cached = plannerStateRequestCache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.createdAt < PLANNER_STATE_CACHE_TTL_MS) {
    return cached.promise
  }

  const promise = loadPlannerStateFromApi(requestedPlanId)
  plannerStateRequestCache.set(cacheKey, { createdAt: now, promise })

  try {
    return await promise
  } catch (error) {
    plannerStateRequestCache.delete(cacheKey)
    throw error
  }
}

async function loadPlannerStateFromApi(requestedPlanId: string | null): Promise<PlannerStateLoadResult> {
  if (requestedPlanId) {
    return loadPlannerPlanDetail(requestedPlanId)
  }

  const response = await fetch('/api/planner/plans?limit=10', { method: 'GET' })

  if (response.status === 401 || response.status === 403) {
    return { status: 'unauthorized' }
  }

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to load planner plans')
  }

  const listData = payload as PlannerListPlansResponse
  const activeStoredPlan = listData.plans.find((plan) => plan.status !== 'archived')
  if (!activeStoredPlan) return { status: 'loaded', plan: null, messages: [] }

  return loadPlannerPlanDetail(activeStoredPlan.id)
}

async function loadPlannerPlanDetail(planId: string): Promise<PlannerStateLoadResult> {
  const detailResponse = await fetch(`/api/planner/plans/${planId}`, { method: 'GET' })

  if (detailResponse.status === 401 || detailResponse.status === 403) {
    return { status: 'unauthorized' }
  }

  const detailPayload = await detailResponse.json()
  if (!detailResponse.ok) {
    throw new Error(detailPayload?.error ?? 'Unable to load active planner plan')
  }

  const detailData = detailPayload as PlannerFullPlanResponse
  return {
    status: 'loaded',
    plan: detailData.plan,
    messages: detailData.messages,
  }
}

function shouldUseMockReplyPath(
  persistenceMode: PlannerPersistenceMode,
  planId: string
): boolean {
  const isMockPlan = planId.startsWith('mock-plan-')
  const isRealServerPlan = persistenceMode === 'server' && !isMockPlan
  if (isRealServerPlan) return false

  return persistenceMode === 'draft' || isMockPlan
}

function buildMockMessage(
  planId: string,
  role: PlanMessage['role'],
  content: string,
  messageType: PlanMessage['message_type'],
  metadata: Record<string, unknown>
): PlanMessage {
  return {
    id: `mock-message-${role}-${messageType}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    plan_id: planId,
    role,
    content,
    message_type: messageType,
    metadata: metadata as PlanMessage['metadata'],
    created_at: new Date().toISOString(),
  }
}

interface MockAgentReply {
  content: string
  messageType: PlanMessage['message_type']
  metadata: Record<string, unknown>
}

interface MockQuestion {
  label: string
  prompt: string
}

interface MockPlanGaps {
  missingFields: string[]
  questions: MockQuestion[]
}

/**
 * Returns the next deterministic draft reply without repeating prior prompts.
 */
function buildMockAgentReply(
  plan: Plan,
  userMessage: string,
  conversationText: string,
  previousMetadata?: PlanMessage['metadata']
): MockAgentReply {
  const previousState = readMockState(previousMetadata)
  const gaps = buildMockPlanGaps(plan, conversationText)

  if (gaps.questions.length > 0) {
    return {
      messageType: 'confirmation_card',
      content: buildClarifyingContent(plan, gaps, shouldShowRecommendations(userMessage)),
      metadata: buildClarifyingMetadata(plan, conversationText, gaps, previousState === 'recommending' ? 'details_requested' : 'clarifying'),
    }
  }

  if (previousState === 'recommendations_shown') {
    return {
      messageType: 'approval_request',
      content:
        'Next step: pick one option and I can prepare the booking packet. In the real product this is where I would open the booking link, request a venue hold, email the vendor, or ask for authorization before payment.',
      metadata: {
        state: 'awaiting_approval',
        approval: {
          id: `mock-approval-${plan.id}`,
          label: 'Request venue hold + vendor availability',
          amount_cents: plan.budget_cap_cents ? Math.round(plan.budget_cap_cents * 0.55) : 0,
          provider: '3rdPlace concierge',
          event_date: plan.date_window_start ?? '',
          delivery_email: 'you@example.com',
          terms: 'No payment is made in mock mode. User approval required before real booking.',
          status: 'pending',
        },
      },
    }
  }

  if (previousState === 'recommending' || shouldShowRecommendations(userMessage)) {
    return {
      messageType: 'recommendation',
      content:
        'Here are three mock venue and vendor paths. In production these would be real catalog matches, external booking links, or concierge hold requests.',
      metadata: {
        state: 'recommendations_shown',
        recommendation_type: 'venue_vendor',
        recommendations: buildMockRecommendations(plan),
        next_actions: [
          'Open venue booking link',
          'Request a 24-hour hold',
          'Email vendor package request',
          'Create approval card before payment',
        ],
      },
    }
  }

  return {
    messageType: 'recommendation',
    content:
      'I have enough to generate venue and vendor recommendations. Say "show me" and I will display three booking paths with estimated cost, fit, and next action.',
    metadata: {
      state: 'recommending',
      missing_fields: [],
      recommendation_type: 'venue',
      next_action: 'generate_recommendations',
    },
  }
}

function buildMockClarifyingReply(plan: Plan, conversationText: string): MockAgentReply {
  const gaps = buildMockPlanGaps(plan, conversationText)

  return {
    messageType: 'confirmation_card',
    content: buildClarifyingContent(plan, gaps, false),
    metadata: buildClarifyingMetadata(plan, conversationText, gaps, 'clarifying'),
  }
}

function buildClarifyingContent(plan: Plan, gaps: MockPlanGaps, userRequestedRecommendations: boolean): string {
  if (gaps.questions.length === 0) {
    return 'I have the core context. Say "show me" and I will display venue, vendor, and booking options.'
  }

  const nextQuestion = gaps.questions[0]
  const prefix = userRequestedRecommendations ? 'Before I show recommendations, I need one more planning detail:' : ''

  return prefix ? `${prefix}\n${nextQuestion.prompt}` : nextQuestion.prompt
}

function buildClarifyingMetadata(
  plan: Plan,
  conversationText: string,
  gaps: MockPlanGaps,
  state: string
): Record<string, unknown> {
  return {
    state,
    missing_fields: gaps.missingFields.slice(0, 1),
    confirmation_items: [
      { label: 'Experience', value: plan.event_type ?? 'Event', confirmed: Boolean(plan.event_type) },
      { label: 'Date + time', value: detectLegacyDateSignal(conversationText) ?? 'Need date', confirmed: hasDateSignal(conversationText) },
      { label: 'City / area', value: plan.neighborhood ?? 'Need city', confirmed: Boolean(plan.neighborhood) },
      { label: 'Headcount', value: plan.guest_count ? `${plan.guest_count} people` : 'Need headcount', confirmed: Boolean(plan.guest_count) },
      { label: 'Budget cap', value: plan.budget_cap_cents ? formatMockCents(plan.budget_cap_cents) : 'Need budget', confirmed: Boolean(plan.budget_cap_cents) },
      { label: 'Ticketing link', value: hasTicketOrRsvpSignal(conversationText) ? 'Ticket/RSVP planned' : 'Need ticket or RSVP plan', confirmed: hasTicketOrRsvpSignal(conversationText) },
    ],
    questions: gaps.questions.slice(0, 1),
  }
}

function buildMockPlanGaps(plan: Plan, conversationText: string): MockPlanGaps {
  const missingFields: string[] = []
  const questions: MockQuestion[] = []

  if (!hasDateSignal(conversationText)) {
    missingFields.push('date_time')
    questions.push({ label: 'When', prompt: 'What day and time window should I plan around?' })
  }

  if (!plan.neighborhood && !hasCitySignal(conversationText)) {
    missingFields.push('city_area')
    questions.push({ label: 'Where', prompt: 'What city or neighborhood should I search in?' })
  }

  if (!plan.guest_count) {
    missingFields.push('headcount')
    questions.push({ label: 'Headcount', prompt: 'Roughly how many people are you expecting?' })
  }

  if (!plan.budget_cap_cents) {
    missingFields.push('budget')
    questions.push({ label: 'Budget', prompt: 'What is the all-in budget cap or target spend?' })
  }

  if (!hasTicketOrRsvpSignal(conversationText)) {
    missingFields.push('ticketing')
    questions.push({ label: 'Ticketing', prompt: 'Is this ticketed, RSVP-only, free, invite-only, or do you already have a Luma/Eventbrite/Posh link?' })
  }

  const eventQuestions = getEventSpecificQuestions(plan.event_type)
  for (const question of eventQuestions) {
    if (!question.isAnswered(conversationText)) {
      missingFields.push(question.field)
      questions.push({ label: question.label, prompt: question.prompt })
    }
  }

  return {
    missingFields,
    questions: questions.slice(0, 7),
  }
}

function isMockPlanCoherent(plan: Plan, conversationText: string): boolean {
  return buildMockPlanGaps(plan, conversationText).questions.length === 0
}

interface EventSpecificQuestion {
  field: string
  label: string
  prompt: string
  isAnswered: (conversationText: string) => boolean
}

function getEventSpecificQuestions(eventType: string | null): EventSpecificQuestion[] {
  const normalized = eventType?.toLowerCase() ?? 'event'
  const shared: EventSpecificQuestion[] = [
    {
      field: 'venue_status',
      label: 'Venue status',
      prompt: 'Do you already have your own venue, or should I find one?',
      isAnswered: hasVenueStatusSignal,
    },
    {
      field: 'venue_priority',
      label: 'Venue fit',
      prompt: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
      isAnswered: (text) => /\b(vibe|neighborhood|outdoor|patio|rooftop|bar economics|capacity|privacy|private|why that place|venue fit|location|look|feel)\b/i.test(text),
    },
  ]

  const questionBank: Record<string, EventSpecificQuestion[]> = {
    dinner: [
      ...shared,
      question('cuisine', 'Cuisine', 'What cuisine or dining style do you want?', /\b(cuisine|italian|mexican|japanese|chinese|thai|mediterranean|tasting|family-style|prix fixe|steak|vegan|vegetarian|sushi|seafood)\b/i),
      question('private_room', 'Room type', 'Do you need a private room or is a semi-private table okay?', /\b(private room|semi-private|private table|buyout|chef's table|shared table)\b/i),
      question('menu_terms', 'Menu terms', 'Do you want a preset menu, minimum spend, or a la carte ordering?', /\b(preset menu|prix fixe|minimum spend|a la carte|family-style|deposit|menu)\b/i),
    ],
    mixer: [
      ...shared,
      question('audience', 'Audience', 'Who is the target audience: founders, investors, operators, members, or open community?', /\b(founders?|investors?|operators?|members?|community|students?|creators?|audience)\b/i),
      question('food_drink', 'Food + drink', 'Should this be drinks-only, light bites, full catering, or sponsor-hosted?', /\b(drinks?|bar|bites|catering|food|sponsor-hosted|sponsored)\b/i),
      question('check_in', 'Check-in', 'Do you need check-in, name tags, or sponsor capture at the door?', /\b(check-?in|name tags?|badges?|sponsor capture|door|registration)\b/i),
    ],
    'day party': [
      ...shared,
      question('dj', 'Music', 'Do you need a DJ, or are you bringing your own music?', /\b(dj|music|playlist|sound)\b/i),
      question('alcohol', 'Alcohol', 'Do you plan on bringing your own alcohol, using a bar package, or keeping it non-alcoholic?', /\b(alcohol|bar|byob|bring.*own|cocktails?|drinks?|non-alcoholic)\b/i),
      question('bar_rev_share', 'Bar economics', 'Do you want a revenue share or kickback with the bar?', /\b(revenue share|rev share|bar split|kickback|minimum spend|no rev)\b/i),
      question('exclusive_use', 'Access', 'Do you want exclusive use / buyout, or is shared space okay?', /\b(exclusive|buyout|private|shared)\b/i),
    ],
    'listening party': [
      ...shared,
      question('artist_music', 'Music focus', 'What artist, album, or release should the listening experience center on?', /\b(artist|album|release|track|music|listening|dj|label)\b/i),
      question('sound_quality', 'Sound quality', 'How important is premium sound, DJ equipment, or playback control?', /\b(sound|speakers?|dj equipment|playback|audio|av|premium)\b/i),
      question('vip_guestlist', 'Guest list', 'Do you need VIP sections, press, artist guests, or a controlled guest list?', /\b(vip|press|artist guests?|guest list|controlled|invite)\b/i),
    ],
    'launch party': [
      ...shared,
      question('brand_product', 'Launch focus', 'What brand, product, or release is being launched?', /\b(brand|product|release|launch|startup|company|app)\b/i),
      question('demo_press', 'Demo + press', 'Do you need demo stations, press moments, photography, or speaking remarks?', /\b(demo|press|photography|photo|remarks|speech|presentation)\b/i),
      question('sponsor_needs', 'Sponsors', 'Are there sponsors, partners, or brand requirements to include?', /\b(sponsor|partner|brand requirements|activation|booth)\b/i),
    ],
    birthday: [
      ...shared,
      question('birthday_vibe', 'Vibe', 'What kind of birthday is this: dinner, dancing, cocktails, day party, or private room?', /\b(dinner|dancing|cocktails?|day party|private room|vibe|theme)\b/i),
      question('music_cake', 'Music + cake', 'Do you need music, cake, decorations, or a photographer?', /\b(music|dj|cake|decor|decorations|photographer|photos)\b/i),
      question('hosted_bar', 'Food + drinks', 'Should food and drinks be hosted, cash bar, or split by guests?', /\b(hosted|cash bar|split|guests pay|open bar|food|drinks)\b/i),
    ],
    'house party': [
      question('space_type', 'Space', 'Is this at someone’s home, apartment, rooftop, or a rented space?', /\b(home|house|apartment|rooftop|rented space|venue)\b/i),
      question('private_public', 'Privacy', 'Is it private invite-only, public RSVP, or ticketed?', /\b(private|invite-only|public|rsvp|ticketed)\b/i),
      question('supplies', 'Supplies', 'Do you need supplies, catering, drinks, speakers, or cleanup?', /\b(supplies|catering|drinks|speakers|cleanup|security)\b/i),
    ],
    concert: [
      ...shared,
      question('artist_lineup', 'Artist', 'Who is the artist or lineup, and are they already confirmed?', /\b(artist|lineup|band|performer|confirmed|talent)\b/i),
      question('production', 'Production', 'Do you need stage, sound, lighting, backline, or security?', /\b(stage|sound|lighting|backline|security|production|av)\b/i),
      question('ticket_price', 'Ticket price', 'What ticket price or gross revenue target should I model?', /\b(ticket price|price|gross|revenue|ga|vip)\b/i),
    ],
    'club night': [
      ...shared,
      question('music_genre', 'Music genre', 'What genre, DJ style, or nightlife format should this be?', /\b(genre|dj|house|hip hop|dance|latin|afrobeats|nightlife|format)\b/i),
      question('door_split', 'Door economics', 'Do you want a door split, bar revenue share, flat rental, or minimum spend?', /\b(door split|bar revenue|rev share|flat rental|minimum spend|kickback)\b/i),
      question('security_promo', 'Ops + promo', 'Do you need security, promoters, VIP tables, or guest list management?', /\b(security|promoters?|vip tables?|guest list|bottle service)\b/i),
    ],
    'run club': [
      question('route', 'Route', 'Do you have a route and pace, or should I suggest one?', /\b(route|pace|miles|5k|jog|loop|start point|finish point)\b/i),
      question('post_run', 'Post-run', 'Do you want a coffee, bar, or brunch stop after?', /\b(coffee|bar|brunch|after|post-run)\b/i),
      question('waivers', 'Safety', 'Do you need waivers, captains, water, or permits?', /\b(waiver|captain|water|permit|safety)\b/i),
    ],
    'fitness class': [
      ...shared,
      question('instructor', 'Instructor', 'Do you already have an instructor, or should I source one?', /\b(instructor|teacher|coach|trainer|source one|have one)\b/i),
      question('equipment', 'Equipment', 'Do you need mats, weights, towels, sound, or other gear?', /\b(mats?|weights?|towels?|gear|equipment|sound)\b/i),
      question('rain_plan', 'Rain plan', 'Does this need to be indoor-only, outdoor, or have a rain plan?', /\b(indoor|outdoor|rain plan|weather|park|studio)\b/i),
    ],
    workshop: [
      ...shared,
      question('topic_outcome', 'Topic', 'What topic and attendee outcome should the workshop deliver?', /\b(topic|outcome|learn|takeaway|curriculum|workshop)\b/i),
      question('materials', 'Materials', 'Do you need supplies, worktables, screens, or printed materials?', /\b(supplies|materials|tables|screens?|printed|handouts)\b/i),
      question('instructor', 'Instructor', 'Who is teaching or facilitating?', /\b(instructor|teacher|facilitator|speaker|host)\b/i),
    ],
    panel: [
      ...shared,
      question('speakers', 'Speakers', 'Who are the speakers and moderator, or should I help source them?', /\b(speakers?|moderator|panelists?|source them|confirmed)\b/i),
      question('seating_av', 'Seating + AV', 'Do you need theater seating, microphones, recording, or livestream?', /\b(theater|seating|microphones?|mics?|recording|livestream|av)\b/i),
      question('qa_networking', 'Run of show', 'Should there be audience Q&A, networking, or sponsor remarks?', /\b(q&a|qa|networking|sponsor remarks|remarks|run of show)\b/i),
    ],
    conference: [
      ...shared,
      question('agenda_tracks', 'Agenda', 'What agenda, tracks, or session blocks should I plan around?', /\b(agenda|tracks?|sessions?|keynote|breakout|schedule)\b/i),
      question('sponsors', 'Sponsors', 'Do you have sponsors, booths, or partner activations?', /\b(sponsors?|booths?|partners?|activations?)\b/i),
      question('ticketing_ops', 'Ticketing + ops', 'Do you need ticket tiers, check-in, badges, meals, or livestream?', /\b(ticket tiers?|check-?in|badges?|meals?|livestream|operations)\b/i),
    ],
    hackathon: [
      ...shared,
      question('duration_overnight', 'Duration', 'Is it overnight, 12-hour, 24-hour, 36-hour, or weekend format?', /\b(overnight|12-hour|24-hour|36-hour|weekend|duration)\b/i),
      question('wifi_power', 'Infrastructure', 'Do you need high-speed wifi, power strips, rooms, showers, or overnight security?', /\b(wifi|power|rooms|showers|overnight security|security)\b/i),
      question('food_prizes', 'Food + prizes', 'Do you need meals, snacks, prizes, judges, or demo day production?', /\b(meals?|snacks?|prizes?|judges?|demo day|production)\b/i),
    ],
    'demo day': [
      ...shared,
      question('startups_investors', 'Audience', 'How many startups, investors, and general guests should I plan for?', /\b(startups?|investors?|guests?|founders?|audience)\b/i),
      question('pitch_format', 'Pitch format', 'What is the pitch format: stage demos, expo tables, judging, or awards?', /\b(stage demos?|expo|tables|judging|awards|pitch format)\b/i),
      question('recording_catering', 'Production', 'Do you need recording, livestream, catering, or investor check-in?', /\b(recording|livestream|catering|check-?in|investor)\b/i),
    ],
    'game outing': [
      question('team_game', 'Game', 'Which team/game/date should I target, and do seats need to be together?', /\b(giants|warriors|49ers|game|seats together|section|row|team)\b/i),
      question('seat_budget', 'Seats', 'What is the target seat budget per person and preferred section?', /\b(seat budget|per person|section|lower bowl|upper|club level|bleachers)\b/i),
      question('ticket_delivery', 'Ticket delivery', 'What email should receive the tickets if you approve purchase?', /@|email/i),
      question('pre_post', 'Before / after', 'Do you want food or drinks before or after the game?', /\b(before|after|dinner|drinks|pregame|postgame|bar|restaurant)\b/i),
    ],
    'watch party': [
      ...shared,
      question('screen_sound', 'Screen + sound', 'What screen size and sound setup do you need?', /\b(screen|projector|tv|sound|audio|speakers)\b/i),
      question('seating_food', 'Seating + food', 'Should this be seated, standing, bar service, or catered?', /\b(seated|standing|bar service|catered|food|drinks)\b/i),
      question('ticketing', 'Access', 'Is this free RSVP, ticketed, or private invite-only?', /\b(free|rsvp|ticketed|private|invite-only)\b/i),
    ],
    'pop-up': [
      ...shared,
      question('product', 'Product', 'What product, brand, or activation is the pop-up for?', /\b(product|brand|activation|retail|food|launch)\b/i),
      question('foot_traffic', 'Foot traffic', 'Do you want high foot traffic, appointment-only, or invite-only?', /\b(foot traffic|appointment|invite-only|walk-up|walkup|public)\b/i),
      question('permits_pos', 'Operations', 'Do you need permits, POS, staffing, storage, or load-in support?', /\b(permits?|pos|staffing|storage|load-?in|booth)\b/i),
    ],
    retreat: [
      ...shared,
      question('overnight_lodging', 'Lodging', 'Is this day-only, overnight, or multi-day with lodging?', /\b(day-only|overnight|multi-day|lodging|hotel|stay)\b/i),
      question('agenda', 'Agenda', 'What agenda should I plan: work sessions, meals, wellness, transport, or activities?', /\b(agenda|work sessions?|meals?|wellness|transport|activities|offsite)\b/i),
      question('privacy_transport', 'Logistics', 'Do you need private space, transportation, or accessibility requirements?', /\b(private space|transportation|transport|accessibility|shuttle|cars)\b/i),
    ],
  }

  if (normalized === 'afterparty') return questionBank['club night']
  if (normalized === 'gallery opening') return questionBank['launch party']
  if (normalized === 'tournament') return questionBank.conference
  if (normalized === 'party') return questionBank['day party']

  return questionBank[normalized] ?? shared
}

function question(field: string, label: string, prompt: string, pattern: RegExp): EventSpecificQuestion {
  return {
    field,
    label,
    prompt,
    isAnswered: (conversationText) => pattern.test(conversationText),
  }
}

function hasDateSignal(text: string): boolean {
  return /\b(today|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday|morning|afternoon|evening|night|am|pm|late|early|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i.test(text)
}

function detectLegacyDateSignal(text: string): string | null {
  const match = text.match(/\b(?:early|mid|late)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:today|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday)(?:\s+(?:morning|afternoon|evening|night))?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i)
  return match ? match[0].replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : null
}

function hasCitySignal(text: string): boolean {
  return /\b(sf|san francisco|oakland|berkeley|san jose|palo alto|marin|soma|mission|dogpatch|hayes valley|embarcadero|marina|fidi|castro|tenderloin|potrero|nob hill|north beach)\b/i.test(text)
}

function hasTicketOrRsvpSignal(text: string): boolean {
  return /\b(ticketed|tickets?|rsvp|invite-only|free|paid|luma|eventbrite|posh)\b/i.test(text) || /https?:\/\//i.test(text)
}

function hasVenueStatusSignal(text: string): boolean {
  return /\b(own venue|have (?:a )?venue|already have|need (?:a )?venue|find (?:a )?venue|use my venue|no venue|restaurant|bar|office|warehouse|space)\b/i.test(text)
}

function readMockState(metadata?: PlanMessage['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return typeof metadata.state === 'string' ? metadata.state : null
}

function shouldShowRecommendations(message: string): boolean {
  return /\b(show me|sounds good|okay|ok|yes|recommend|options|venues?|vendors?|book|booking|links?)\b/i.test(message)
}

function buildMockRecommendations(plan: Plan): Array<Record<string, string | number | boolean | string[]>> {
  const neighborhood = plan.neighborhood ?? 'SoMa'
  const budget = plan.budget_cap_cents ?? 1000000
  const guestCount = plan.guest_count ?? 80
  const venueTarget = Math.max(250000, Math.round(budget * 0.5))
  const vendorTarget = Math.max(150000, Math.round(budget * 0.28))

  return [
    {
      name: `${neighborhood} Social Hall`,
      type: 'Venue',
      fit: 'Best fit',
      capacity: Math.max(guestCount + 40, 120),
      price_cents: venueTarget,
      action: 'Request hold',
      hold_duration_hours: 24,
      tags: ['AV included', 'Private bar', 'Host-friendly layout'],
      note: 'Agent would request availability and hold terms.',
    },
    {
      name: 'Bay Area Event Kitchen',
      type: 'Vendor',
      fit: 'Food package',
      capacity: guestCount,
      price_cents: vendorTarget,
      action: 'Email vendor',
      package_summary: 'Food package with staffing and dietary support',
      tags: ['Passed bites', 'Dietary support', 'Staffing available'],
      note: 'Agent would send the package request and collect terms.',
    },
    {
      name: 'External option from user link',
      type: 'External',
      fit: 'Bring-your-own',
      capacity: guestCount,
      price_cents: Math.max(100000, Math.round(budget * 0.2)),
      action: 'Open booking link',
      external_url: '',
      tags: ['User-provided', 'Needs verification', 'Approval required'],
      note: 'Agent can still track this even if it is outside the catalog.',
    },
  ]
}

function detectMockEventType(message: string): string | null {
  const lower = message.toLowerCase()

  if (/\b(listening party|album party|music preview|release listen)\b/.test(lower)) return 'listening party'
  if (/\b(day party|brunch party|rooftop day|patio party|sunday party)\b/.test(lower)) return 'day party'
  if (/\b(pop-up|popup|brand pop-up|retail pop-up|food pop-up|activation)\b/.test(lower)) return 'pop-up'
  if (/\b(launch party|product launch|brand launch|release party)\b/.test(lower)) return 'launch party'
  if (/\b(birthday|milestone birthday)\b/.test(lower)) return 'birthday'
  if (/\b(afterparty|after party)\b/.test(lower)) return 'afterparty'
  if (/\b(house party|kickback|pregame)\b/.test(lower)) return 'house party'
  if (/\b(watch party|screening|sports watch|movie watch)\b/.test(lower)) return 'watch party'
  if (/\b(run club|running club|social run|5k meetup)\b/.test(lower)) return 'run club'
  if (/\b(tennis|tennis event|tennis tournament|tennis clinic|tennis social)\b/.test(lower)) return 'tennis event'
  if (lower.includes('retreat')) return 'retreat'
  if (/\b(giants|warriors|game outing|group tickets|seated together)\b/.test(lower)) return 'game outing'
  if (/\b(tournament|gaming tournament|esports tournament)\b/.test(lower)) return 'tournament'
  if (/\b(gallery opening|art opening|exhibition opening)\b/.test(lower)) return 'gallery opening'
  if (/\b(group dinner|founder dinner|private dinner|supper club|dinner)\b/.test(lower)) return 'dinner'
  if (/\b(networking mixer|founder mixer|mixer|happy hour|meetup)\b/.test(lower)) return 'mixer'
  if (/\b(panel|fireside chat|speaker panel|founder talk)\b/.test(lower)) return 'panel'
  if (/\b(workshop|class|skill session)\b/.test(lower)) return 'workshop'
  if (/\b(demo day|pitch night|showcase|graduation)\b/.test(lower)) return 'demo day'
  if (lower.includes('hackathon')) return 'hackathon'
  if (lower.includes('concert')) return 'concert'
  if (/\b(club night|nightlife event|dj night|dance party)\b/.test(lower)) return 'club night'
  if (/\b(fitness class|yoga|pilates|hiit|bootcamp)\b/.test(lower)) return 'fitness class'
  if (lower.includes('party') || lower.includes('afterparty') || lower.includes('gallery opening')) return 'party'
  if (lower.includes('conference') || lower.includes('summit') || lower.includes('tournament')) return 'conference'
  return null
}

function detectMockGuestCount(message: string): number | null {
  const hyphenated = message.match(/\b(\d{1,5})-person\b/i)
  if (hyphenated) return Number(hyphenated[1])

  const audienceNouns =
    'founders|investors|guests|attendees|people|folks|members|participants|engineers|executives|creatives|artists|developers|designers|hackers|students|volunteers|employees|staff|speakers|athletes|runners|players|vendors|builders|fans|donors|person|pax'
  const match = message.match(new RegExp(`\\b(\\d{1,5})\\s*(?:tech\\s*)?(?:${audienceNouns})\\b`, 'i'))
  return match ? Number(match[1]) : null
}

function detectMockBudgetCap(message: string): number | null {
  const money = message.match(/\$\s*(\d[\d,]*(?:\.\d+)?)(k|m)?/i)
  const shorthand = message.match(/\b(\d[\d,]*)\s*k\b/i)
  if (!money && !shorthand) return null

  const amountText = money?.[1] ?? shorthand?.[1]
  const amount = Number(amountText?.replaceAll(',', ''))
  if (!Number.isFinite(amount)) return null

  const suffix = money?.[2]?.toLowerCase() ?? (shorthand ? 'k' : '')
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const dollars = amount * multiplier
  return Number.isFinite(dollars) ? dollars * 100 : null
}

function detectMockDateWindow(message: string): string | null {
  const monthDay = message.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (!monthDay) return null

  const monthToken = monthDay[0].split(/\s+/)[0].replace('.', '').toLowerCase()
  const monthMap: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  }
  const month = monthMap[monthToken]
  const day = Number(monthDay[1])

  if (!month || Number.isNaN(day)) return null
  return `2026-${month}-${String(day).padStart(2, '0')}`
}

function detectMockTicketed(message: string, fallback: boolean): boolean {
  if (/\b(ticketed|paid|tickets?)\b/i.test(message)) return true
  if (/\b(rsvp|invite-only|free)\b/i.test(message)) return false
  return fallback
}

function detectMockNeighborhood(message: string): string | null {
  const neighborhoods = ['SoMa', 'Mission', 'Dogpatch', 'Hayes Valley', 'Embarcadero', 'Marina', 'FiDi', 'Castro', 'Tenderloin', 'Potrero']
  return neighborhoods.find((neighborhood) => message.toLowerCase().includes(neighborhood.toLowerCase())) ?? null
}

function detectMockCity(message: string): string | null {
  if (/\b(sf|san francisco)\b/i.test(message)) return 'San Francisco'
  if (/\boakland\b/i.test(message)) return 'Oakland'
  if (/\bberkeley\b/i.test(message)) return 'Berkeley'
  if (/\bsan jose\b/i.test(message)) return 'San Jose'
  if (/\bpalo alto\b/i.test(message)) return 'Palo Alto'
  if (/\bmarin\b/i.test(message)) return 'Marin'
  return null
}

function formatMockCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

interface PlannerMessageBubbleProps {
  message: PlanMessage
  isSupersededConfirmation?: boolean
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onApprovalStatusChange: (approvalId: string, status: ApprovalUiStatus) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
}

/**
 * Renders a single planner message returned by the Agent Planner API.
 */
function PlannerMessageBubble({
  message,
  isSupersededConfirmation = false,
  planId,
  isAuthenticated,
  onAuthRequired,
  onApprovalStatusChange,
  onToast,
  onQuestionAnswerSubmit,
}: PlannerMessageBubbleProps) {
  const isUser = message.role === 'user'
  const messageTime = formatMessageTime(message.created_at)
  const hasStructuredQuestion = messageHasStructuredQuestion(message)

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-full flex-col gap-1 sm:max-w-2xl', isUser ? 'items-end' : 'items-start')}>
        {!isUser ? (
          <div className="flex items-center gap-2 px-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold text-muted-foreground">3rdPlace Agent</span>
          </div>
        ) : null}

        {isSupersededConfirmation ? (
          <CollapsedConfirmationCard message={message} messageTime={messageTime} />
        ) : (
          <>
        <div
          className={cn(
            'max-w-full text-sm leading-relaxed',
            hasStructuredQuestion && !isUser
              ? 'text-foreground'
              : cn(
                  'break-words border px-4 py-3 shadow-card',
                  isUser
                    ? 'rounded-3xl rounded-br-md border-primary/20 bg-primary text-primary-foreground'
                    : 'rounded-3xl rounded-bl-md border-border bg-card text-foreground'
                )
          )}
        >
          {!hasStructuredQuestion ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          {!isUser ? (
            <PlannerMessageMetadata
              message={message}
              planId={planId}
              isAuthenticated={isAuthenticated}
              onAuthRequired={onAuthRequired}
              onApprovalStatusChange={onApprovalStatusChange}
              onToast={onToast}
              onQuestionAnswerSubmit={onQuestionAnswerSubmit}
            />
          ) : null}
        </div>

        <p className="px-2 text-[11px] text-muted-foreground">{isUser ? `You · ${messageTime}` : messageTime}</p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Collapses stale confirmation cards while allowing the user to expand them if needed.
 */
function CollapsedConfirmationCard({ message, messageTime }: { message: PlanMessage; messageTime: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (isExpanded) {
    return (
      <>
        <div className="max-w-full rounded-3xl rounded-bl-md border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground shadow-card">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          <PlannerMessageMetadata
            message={message}
            planId={message.plan_id}
            isAuthenticated={false}
            onAuthRequired={() => undefined}
            onApprovalStatusChange={() => undefined}
            onToast={() => undefined}
            onQuestionAnswerSubmit={() => undefined}
          />
        </div>
        <button
          type="button"
          className="px-2 text-[11px] text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setIsExpanded(false)}
        >
          Collapse · {messageTime}
        </button>
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        className="flex max-w-full items-center gap-2 rounded-2xl border border-border bg-card/70 px-4 py-2 text-left text-sm font-semibold leading-snug text-muted-foreground shadow-card transition-smooth hover:bg-card hover:text-foreground"
        onClick={() => setIsExpanded(true)}
      >
        <ChevronDown className="-rotate-90 h-4 w-4" />
        Event summary · updated
      </button>
      <p className="px-2 text-[11px] text-muted-foreground">{messageTime}</p>
    </>
  )
}

interface PlanSummaryChipsProps {
  plan: Plan
}

/**
 * Compact summary chips for the focused Plan tab.
 */
function PlanSummaryChips({ plan }: PlanSummaryChipsProps) {
  const chips = [
    { label: 'Guest count', value: plan.guest_count ? plan.guest_count.toLocaleString() : '—' },
    { label: 'Budget', value: plan.budget_cap_cents ? formatMockCents(plan.budget_cap_cents) : '—' },
    { label: 'Date window', value: formatPlanDateWindow(plan) },
    { label: 'Neighborhood', value: plan.neighborhood || '—' },
    { label: 'Ticketed', value: plan.ticketed ? 'Yes' : 'No' },
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {chips.map((chip) => (
        <div key={chip.label} className="min-w-0 rounded-2xl border border-border bg-background/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{chip.label}</p>
          <p className="mt-1 break-words text-sm font-bold leading-snug text-foreground">{chip.value}</p>
        </div>
      ))}
    </div>
  )
}

interface PlannerFocusedMessageCardProps {
  message: PlanMessage
  isSupersededConfirmation?: boolean
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onApprovalStatusChange: (approvalId: string, status: ApprovalUiStatus) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
}

/**
 * Focused non-chat card used by Plan and Recommendations tabs.
 */
function PlannerFocusedMessageCard({
  message,
  isSupersededConfirmation = false,
  planId,
  isAuthenticated,
  onAuthRequired,
  onApprovalStatusChange,
  onToast,
  onQuestionAnswerSubmit,
}: PlannerFocusedMessageCardProps) {
  if (isSupersededConfirmation) {
    return (
      <CollapsedConfirmationCard
        message={message}
        messageTime={formatMessageTime(message.created_at)}
      />
    )
  }

  const hasStructuredQuestion = messageHasStructuredQuestion(message)

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-background/60 p-4">
      {!hasStructuredQuestion ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.content}</p>
      ) : null}
      <PlannerMessageMetadata
        message={message}
        planId={planId}
        isAuthenticated={isAuthenticated}
        onAuthRequired={onAuthRequired}
        onApprovalStatusChange={onApprovalStatusChange}
        onToast={onToast}
        onQuestionAnswerSubmit={onQuestionAnswerSubmit}
      />
    </article>
  )
}

/**
 * Focused approval-only card used by the Approvals tab.
 */
function PlannerApprovalFocusedCard({
  message,
  planId,
  isAuthenticated,
  onAuthRequired,
  onApprovalStatusChange,
  onToast,
}: PlannerFocusedMessageCardProps) {
  const approval = getMessageApproval(message)

  if (!approval) {
    return (
      <article className="min-w-0 rounded-2xl border border-border bg-background/60 p-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.content}</p>
      </article>
    )
  }

  return (
    <PlannerApprovalCard
      planId={planId}
      approvalId={typeof approval.id === 'string' ? approval.id : message.id}
      approval={buildApprovalDisplayMetadata(message.metadata, approval)}
      isAuthenticated={isAuthenticated}
      onAuthRequired={onAuthRequired}
      onStatusChange={onApprovalStatusChange}
      onToast={onToast}
    />
  )
}

/**
 * Builds the reactive date chip for the active-plan header.
 */
function getActivePlanDateChip(plan: Plan, messages: PlanMessage[]): { label: string; status: 'pending' | 'set' | 'confirmed' } {
  const parsedDate = getLatestConfirmationDate(messages)
  if (parsedDate) return { label: parsedDate, status: 'confirmed' }
  if (plan.date_window_start) return { label: formatPlanDateWindow(plan), status: 'set' }
  return { label: 'Date pending', status: 'pending' }
}

/**
 * Reads the latest human-friendly date string from confirmation card metadata.
 */
function getLatestConfirmationDate(messages: PlanMessage[]) {
  const confirmationMessage = [...messages]
    .reverse()
    .find((message) => String(message.message_type) === 'confirmation_card')
  if (!confirmationMessage) return null

  const metadata = getMessageMetadata(confirmationMessage)
  const summary = metadata?.summary
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const date = (summary as Record<string, unknown>).date
    if (typeof date === 'string' && date.trim()) return date
  }

  const confirmationItems = metadata?.confirmation_items
  if (!Array.isArray(confirmationItems)) return null

  for (const item of confirmationItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.toLowerCase() : ''
    const value = typeof record.value === 'string' ? record.value : ''
    if (label.includes('date') && value && !/^need\b/i.test(value)) return value
  }

  return null
}

/**
 * Formats the active plan date range for the Plan tab summary row.
 */
function formatPlanDateWindow(plan: Plan) {
  if (!plan.date_window_start) return '—'
  if (!plan.date_window_end || plan.date_window_end === plan.date_window_start) return plan.date_window_start
  return `${plan.date_window_start} → ${plan.date_window_end}`
}

/**
 * Counts approval messages by pending, authorized, and cancelled status.
 */
function getApprovalSummary(approvalMessages: PlanMessage[]) {
  return approvalMessages.reduce(
    (summary, message) => {
      const status = getApprovalMessageStatus(message)
      if (status === 'approved') {
        summary.authorized += 1
      } else if (status === 'rejected') {
        summary.cancelled += 1
      } else {
        summary.pending += 1
      }

      return summary
    },
    { pending: 0, authorized: 0, cancelled: 0 }
  )
}

/**
 * Reads approval status from message metadata, defaulting to pending.
 */
function getApprovalMessageStatus(message: PlanMessage) {
  const metadata = getMessageMetadata(message)
  const metadataStatus = metadata?.status
  if (metadataStatus === 'approved' || metadataStatus === 'authorized') return 'approved'
  if (metadataStatus === 'rejected' || metadataStatus === 'cancelled') return 'rejected'

  const approval = getMessageApproval(message)
  const approvalStatus = approval?.status
  if (approvalStatus === 'approved' || approvalStatus === 'authorized') return 'approved'
  if (approvalStatus === 'rejected' || approvalStatus === 'cancelled') return 'rejected'

  return 'pending'
}

/**
 * Safely reads object metadata from a planner message.
 */
function getMessageMetadata(message: PlanMessage): Record<string, unknown> | null {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    return null
  }

  return message.metadata as Record<string, unknown>
}

/**
 * Safely reads approval metadata from a planner message.
 */
function getMessageApproval(message: PlanMessage): Record<string, unknown> | null {
  const metadata = getMessageMetadata(message)
  const approval = metadata?.approval
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    return null
  }

  return approval as Record<string, unknown>
}

/**
 * Merges sibling opportunity metadata into approval cards for display only.
 */
function buildApprovalDisplayMetadata(
  metadata: PlanMessage['metadata'],
  approval: Record<string, unknown>
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return approval

  return {
    ...approval,
    kind: metadata.kind,
    venue_ids: metadata.venue_ids,
    vendor_ids: metadata.vendor_ids,
    projected_costs_cents: metadata.projected_costs_cents,
    requires_user_action: metadata.requires_user_action,
    summary: metadata.summary,
    response_deadline: metadata.response_deadline,
    opportunity: metadata.opportunity,
    invites: metadata.invites,
    invite_stats: metadata.invite_stats,
    deposit_proposals: metadata.deposit_proposals,
  }
}

/**
 * Returns true when a planner message should render as a structured question card.
 */
function messageHasStructuredQuestion(message: PlanMessage) {
  const metadata = getMessageMetadata(message)
  return Array.isArray(metadata?.questions) && metadata.questions.length > 0
}

function formatMessageTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Now'

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

interface PlannerMessageMetadataProps {
  message: PlanMessage
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onApprovalStatusChange: (approvalId: string, status: ApprovalUiStatus) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
}

/**
 * Renders small structured details for confirmation and recommendation messages.
 */
function PlannerMessageMetadata({
  message,
  planId,
  isAuthenticated,
  onAuthRequired,
  onApprovalStatusChange,
  onToast,
  onQuestionAnswerSubmit,
}: PlannerMessageMetadataProps) {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    return null
  }

  const confirmationItems = message.metadata.confirmation_items
  const missingFields = message.metadata.missing_fields
  const questions = message.metadata.questions
  const recommendations = message.metadata.recommendations
  const nextActions = message.metadata.next_actions
  const approval = message.metadata.approval
  const hasStructuredQuestion = Array.isArray(questions) && questions.length > 0
  const matchedArchetype = readRecommendationMetadataArchetype(message.metadata)
  const vendorStackGroups = readVendorRecommendationGroups(message.metadata)
  const capacityCalibration = readRecommendationCapacityCalibration(message.metadata)
  const economicsDetails = readRecommendationEconomicsDetails(message.metadata)

  return (
    <div className={cn('space-y-3', hasStructuredQuestion ? 'mt-0' : 'mt-4')}>
      {Array.isArray(confirmationItems) && !hasStructuredQuestion ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {confirmationItems.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return null
            const label = typeof item.label === 'string' ? item.label : `Field ${index + 1}`
            const value = typeof item.value === 'string' ? item.value : 'Needs review'
            const confirmed = Boolean(item.confirmed)

            return (
              <div key={`${label}-${index}`} className="min-w-0 rounded-xl border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 break-words text-sm font-semibold leading-snug text-foreground">
                  {confirmed ? '✓ ' : ''}
                  {value}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}

      {Array.isArray(missingFields) && missingFields.length > 0 && !hasStructuredQuestion ? (
        <div className="text-xs text-muted-foreground">
          Missing: {missingFields.filter((field) => typeof field === 'string').join(', ')}
        </div>
      ) : null}

      {Array.isArray(questions) && questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((question, index) => {
            if (!question || typeof question !== 'object' || Array.isArray(question)) return null

            return (
              <PlannerStructuredQuestionCard
                key={`question-${index}`}
                question={question as Record<string, unknown>}
                fallbackIndex={index}
                onAnswerSubmit={onQuestionAnswerSubmit}
              />
            )
          })}
          </div>
      ) : null}

      {Array.isArray(recommendations) ? (
        <div className="space-y-3">
          {capacityCalibration?.calibration_signal === 'historical_higher' ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-xs leading-snug text-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-primary">Sized for historical attendance</span>
                <span
                  className="cursor-help rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                  title={`Based on ${capacityCalibration.sample_size} past event${capacityCalibration.sample_size === 1 ? '' : 's'} analyzed from connected ticketing imports.`}
                >
                  What&apos;s this?
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">
                Sized for both your stated {capacityCalibration.stated_guest_count ?? 'planned'} guests and your typical attendance
                {capacityCalibration.history_p75 ? ` (~${Math.round(capacityCalibration.history_p75)} in recent similar events)` : ''}.
                Showing venues that fit both.
              </p>
            </div>
          ) : null}
          {matchedArchetype || vendorStackGroups.length > 0 ? (
            <div className="rounded-2xl border border-border bg-background/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {matchedArchetype ? (
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Matched: {matchedArchetype}
                  </span>
                ) : null}
                {vendorStackGroups.map((group) => (
                  <span key={`${group.necessity}-${group.service_type}`} className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.necessity}: {group.service_type.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {recommendations.map((recommendation, index) => {
            if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) return null
            const name = typeof recommendation.name === 'string' ? recommendation.name : `Option ${index + 1}`
            const type = typeof recommendation.type === 'string' ? recommendation.type : 'Option'
            const commercialModelMatch = typeof recommendation.commercial_model_match === 'string'
              ? recommendation.commercial_model_match
              : null
            const archetypeReasons = Array.isArray(recommendation.archetype_reasons)
              ? recommendation.archetype_reasons.filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
              : []
            const fit = sanitizeRecommendationDisplayText(
              typeof recommendation.fit === 'string' ? recommendation.fit : 'Review',
              recommendation as Record<string, unknown>
            )
            const action = typeof recommendation.action === 'string' ? recommendation.action : 'Review'
            const note = sanitizeRecommendationDisplayText(
              typeof recommendation.note === 'string' ? recommendation.note : '',
              recommendation as Record<string, unknown>
            )
            const priceCents = typeof recommendation.price_cents === 'number' ? recommendation.price_cents : 0
            const capacity = typeof recommendation.capacity === 'number' ? recommendation.capacity : null
            const tags = Array.isArray(recommendation.tags)
              ? recommendation.tags.filter((tag): tag is string => typeof tag === 'string')
              : []

            return (
              <div
                key={`${name}-${index}`}
                className={cn(
                  'min-w-0 rounded-2xl border bg-background/60 p-4',
                  index === 0 ? 'border-primary/50 shadow-glow' : 'border-border'
                )}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {type}
                  </span>
                  {index === 0 ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      Best fit
                    </span>
                  ) : null}
                </div>
                <h3 className="break-words font-display text-base font-bold leading-tight text-foreground">{name}</h3>
                <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">{fit}</p>
                <div className="mt-4 grid gap-2 text-xs">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-muted-foreground">Estimate</span>
                    <span className="shrink-0 font-semibold text-foreground">{priceCents > 0 ? formatMockCents(priceCents) : 'TBD'}</span>
                  </div>
                  {capacity ? (
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground">Capacity</span>
                      <span className="shrink-0 font-semibold text-foreground">{capacity}</span>
                    </div>
                  ) : null}
                  {commercialModelMatch ? (
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground">Model</span>
                      <span className="shrink-0 font-semibold text-foreground">{commercialModelMatch.replace(/_/g, ' ')}</span>
                    </div>
                  ) : null}
                </div>
                {archetypeReasons.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-xs leading-snug text-muted-foreground">
                    {archetypeReasons.slice(0, 2).map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="min-w-0 break-words">{reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span key={tag} className="max-w-full rounded-full bg-muted px-2 py-1 text-[10px] font-medium leading-tight text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {note ? <p className="mt-3 break-words text-xs leading-snug text-muted-foreground">{note}</p> : null}
                <PlannerRecommendationActionButton
                  planId={planId}
                  isAuthenticated={isAuthenticated}
                  onAuthRequired={onAuthRequired}
                  recommendation={recommendation as Record<string, unknown>}
                  label={action}
                  variant={index === 0 ? 'hero' : 'glass'}
                />
              </div>
            )
          })}
          </div>
        </div>
      ) : null}

      {economicsDetails ? (
        <div className="rounded-2xl border border-border bg-background/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pricing economics</p>
              <p className="mt-1 text-sm leading-snug text-foreground">{economicsDetails.narrative}</p>
            </div>
            {economicsDetails.recommended_price_cents > 0 ? (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                Recommended {formatMockCents(economicsDetails.recommended_price_cents)}
              </span>
            ) : null}
          </div>
          {economicsDetails.historical_anchor ? (
            <p className="mt-3 border-l-2 border-primary/50 pl-3 text-xs italic leading-snug text-muted-foreground">
              {economicsDetails.historical_anchor}
            </p>
          ) : null}
          {economicsDetails.price_points.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {economicsDetails.price_points.map((point) => {
                const isRecommended = point.recommendation === 'recommended'
                const isAvoid = point.recommendation === 'avoid'

                return (
                  <div
                    key={`${point.price_cents}-${point.recommendation}`}
                    className={cn(
                      'rounded-xl border bg-card/60 p-3 text-xs',
                      isRecommended ? 'border-primary/60 shadow-glow' : 'border-border',
                      isAvoid ? 'opacity-60' : ''
                    )}
                  >
                    <div className="grid gap-2 sm:grid-cols-[0.8fr_1fr_1fr_auto] sm:items-center">
                      <span className={cn('font-semibold text-foreground', isAvoid ? 'line-through' : '')}>
                        {formatMockCents(point.price_cents)}
                      </span>
                      <span className="text-muted-foreground">
                        Net {formatMockCents(point.projected_net_cents)}
                      </span>
                      <span className="text-muted-foreground">
                        Break-even {point.break_even_tickets} tickets
                      </span>
                      <span className={cn(
                        'w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        isRecommended ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      )}>
                        {point.recommendation}
                      </span>
                    </div>
                    <p className="mt-2 leading-snug text-muted-foreground">{point.reasoning}</p>
                  </div>
                )
              })}
            </div>
          ) : null}
          {economicsDetails.elasticity ? (
            <details className="mt-4 rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">How was this priced?</summary>
              <div className="mt-3 space-y-2">
                <p>
                  {economicsDetails.elasticity.sample_size} events analyzed · pattern {economicsDetails.elasticity.tier_pattern.replace(/_/g, ' ')}
                </p>
                {economicsDetails.elasticity.velocity_vector.length > 0 ? (
                  <div className="grid gap-1">
                    {economicsDetails.elasticity.velocity_vector.map((point) => (
                      <div key={point.price_cents} className="flex flex-wrap justify-between gap-2">
                        <span>{formatMockCents(point.price_cents)}</span>
                        <span>
                          {point.avg_days_to_sellout === null ? 'No sellout' : `${point.avg_days_to_sellout} days to sell out`} · {Math.round(point.sellout_rate * 100)}% sellout rate
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {Array.isArray(nextActions) ? (
        <div className="rounded-2xl border border-border bg-background/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Agent can do next</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {nextActions.map((action, index) =>
              typeof action === 'string' ? (
                <div key={`${action}-${index}`} className="min-w-0 rounded-xl border border-border bg-card/70 px-3 py-2 text-xs font-medium leading-snug text-foreground">
                  {action}
                </div>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      {approval && typeof approval === 'object' && !Array.isArray(approval) ? (
        <PlannerApprovalCard
          planId={planId}
          approvalId={typeof approval.id === 'string' ? approval.id : message.id}
          approval={buildApprovalDisplayMetadata(message.metadata, approval as Record<string, unknown>)}
          isAuthenticated={isAuthenticated}
          onAuthRequired={onAuthRequired}
          onStatusChange={onApprovalStatusChange}
          onToast={onToast}
        />
      ) : null}
    </div>
  )
}

interface PlannerStructuredQuestionCardProps {
  question: Record<string, unknown>
  fallbackIndex: number
  onAnswerSubmit?: (answer: string) => void
}

interface PlannerQuestionOption {
  label: string
  value: string
  description: string
}

const otherQuestionValue = '__other__'

/**
 * Renders one structured follow-up question with selectable answers and an optional freeform response.
 */
function PlannerStructuredQuestionCard({
  question,
  fallbackIndex,
  onAnswerSubmit,
}: PlannerStructuredQuestionCardProps) {
  const [selectedValue, setSelectedValue] = useState<string | null>(null)
  const [otherValue, setOtherValue] = useState('')
  const [isSkipped, setIsSkipped] = useState(false)

  const label = readQuestionText(question, 'label') || `Question ${fallbackIndex + 1}`
  const prompt = readQuestionText(question, 'prompt') || 'What should I know before I keep planning?'
  const instruction = readQuestionText(question, 'instruction') || 'Select one answer'
  const otherPlaceholder = readQuestionText(question, 'other_placeholder') || 'Type your answer'
  const allowOther = question.allow_other !== false
  const options = readQuestionOptions(question)
  const selectedAnswer = selectedValue === otherQuestionValue ? otherValue.trim() : selectedValue ?? ''
  const canSubmit = Boolean(onAnswerSubmit && selectedAnswer)

  function handleNext() {
    if (!canSubmit) return
    onAnswerSubmit?.(formatStructuredQuestionReply(question, selectedAnswer))
  }

  if (isSkipped) {
    return (
      <div className="rounded-2xl border border-border bg-background/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">Skipped for now</p>
          </div>
          <Button type="button" variant="glass" size="sm" onClick={() => setIsSkipped(false)}>
            Answer
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background/60 shadow-card">
      <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
          <h3 className="mt-1 break-words font-display text-base font-bold leading-snug text-foreground">{prompt}</h3>
        </div>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{instruction}</span>
      </div>

      <div className="space-y-2 p-4">
        {options.length > 0 ? (
          options.map((option) => {
            const isSelected = selectedValue === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedValue(option.value)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-smooth',
                  isSelected
                    ? 'border-primary/60 bg-sidebar-accent text-foreground'
                    : 'border-transparent bg-card/70 text-foreground hover:border-border hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'
                  )}
                  aria-hidden="true"
                >
                  {isSelected ? <CheckCircle2 className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-bold leading-snug">{option.label}</span>
                  <span className="mt-1 block break-words text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            )
          })
        ) : (
          <div className="rounded-xl border border-border bg-card/70 px-3 py-2">
            <p className="break-words text-sm font-medium leading-snug text-foreground">{prompt}</p>
          </div>
        )}

        {allowOther ? (
          <div
            onClick={() => setSelectedValue(otherQuestionValue)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-smooth',
              selectedValue === otherQuestionValue
                ? 'border-primary/60 bg-sidebar-accent'
                : 'border-border bg-card/70 hover:bg-muted'
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                selectedValue === otherQuestionValue
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/50'
              )}
              aria-hidden="true"
            >
              {selectedValue === otherQuestionValue ? <CheckCircle2 className="h-3 w-3" /> : null}
            </span>
            <Input
              value={otherValue}
              onChange={(event) => {
                setOtherValue(event.target.value)
                setSelectedValue(otherQuestionValue)
              }}
              onFocus={() => setSelectedValue(otherQuestionValue)}
              placeholder={otherPlaceholder}
              className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsSkipped(true)}>
          Skip
        </Button>
        <Button type="button" size="sm" onClick={handleNext} disabled={!canSubmit}>
          Next
        </Button>
      </div>
    </div>
  )
}

/**
 * Reads a display string from structured question metadata.
 */
function readQuestionText(question: Record<string, unknown>, key: string) {
  const value = question[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads selectable answers from structured question metadata.
 */
function readQuestionOptions(question: Record<string, unknown>): PlannerQuestionOption[] {
  const options = question.options
  if (!Array.isArray(options)) return []

  return options.flatMap((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return []
    const record = option as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label : `Option ${index + 1}`
    const value = typeof record.value === 'string' ? record.value : label
    const description = typeof record.description === 'string' ? record.description : ''
    return [{ label, value, description }]
  })
}

/**
 * Converts a selected structured answer into a natural planner reply.
 */
function formatStructuredQuestionReply(question: Record<string, unknown>, answer: string) {
  const label = readQuestionText(question, 'label') || 'Answer'
  return `${label}: ${answer}`
}

interface PlannerRecommendationActionButtonProps {
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  recommendation: Record<string, unknown>
  label: string
  variant: 'hero' | 'glass'
}

type RecommendationActionKind = 'hold' | 'vendor' | 'external'

/**
 * Converts recommendation CTAs into approval-backed agent actions instead of placeholder links.
 */
function PlannerRecommendationActionButton({
  planId,
  isAuthenticated,
  onAuthRequired,
  recommendation,
  label,
  variant,
}: PlannerRecommendationActionButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const actionKind = getRecommendationActionKind(label, recommendation)
  const isComplete = Boolean(statusMessage)
  const buttonLabel = isComplete ? 'Sent ✓' : getCompactRecommendationActionLabel(actionKind)

  async function handleActionClick() {
    setErrorMessage(null)

    const externalUrl = readRecommendationString(recommendation, 'external_url')
    const shouldOpenExternalUrl = actionKind === 'external' && isRealExternalUrl(externalUrl)
    const agentActionPayload = buildRecommendationAgentActionPayload(actionKind, recommendation)

    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      onAuthRequired({
        type: 'hold',
        payload: {
          agentAction: agentActionPayload,
          externalUrl: shouldOpenExternalUrl ? externalUrl : undefined,
        },
      })
      return
    }

    setIsLoading(true)

    try {
      if (shouldOpenExternalUrl) {
        window.open(externalUrl, '_blank', 'noopener,noreferrer')
      }

      if (!planId.startsWith('mock-plan-')) {
        const response = await fetch(`/api/planner/plans/${planId}/agent-actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentActionPayload),
        })

        if (!response.ok) {
          throw new Error('Failed to create agent action')
        }
      }

      setStatusMessage(getRecommendationSuccessMessage(actionKind))
    } catch {
      setErrorMessage(getRecommendationErrorMessage(actionKind))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={cn(
          'min-h-11 w-full whitespace-nowrap text-center text-sm font-semibold leading-snug',
          isComplete &&
            'border border-success/30 bg-success/10 text-success shadow-none hover:bg-success/10 hover:text-success'
        )}
        onClick={handleActionClick}
        disabled={isLoading || isComplete}
      >
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {buttonLabel}
        {!isLoading && !isComplete ? <ExternalLink className="h-3.5 w-3.5" /> : null}
      </Button>
      {statusMessage ? <p className="break-words text-xs font-semibold leading-snug text-success">{statusMessage}</p> : null}
      {errorMessage ? <p className="break-words text-xs font-semibold leading-snug text-destructive">{errorMessage}</p> : null}
    </div>
  )
}

/**
 * Keeps recommendation CTA copy short enough for compact cards without shrinking text.
 */
function getCompactRecommendationActionLabel(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return 'Request hold'
  if (actionKind === 'vendor') return 'Contact vendor'
  return 'Open link'
}

/**
 * Builds the agent-action POST body for a recommendation action.
 */
function buildRecommendationAgentActionPayload(
  actionKind: RecommendationActionKind,
  recommendation: Record<string, unknown>
): PlannerAgentActionRequest {
  const provider = readRecommendationString(recommendation, 'name') || '3rdPlace recommendation'
  const priceCents = readRecommendationPriceCents(recommendation)
  const targetId = readRecommendationString(recommendation, 'id')
  const targetType = normalizeRecommendationTargetType(actionKind, recommendation)

  if (actionKind === 'hold') {
    const duration = readRecommendationNumber(recommendation, 'hold_duration_hours') || 24
    return {
      actionType: 'hold_request',
      targetType,
      targetId: isUuid(targetId) ? targetId : null,
      requestedAmountCents: priceCents,
      payloadJson: {
        action_label: 'Request venue hold',
        provider,
        price_cents: priceCents,
        fees_cents: 0,
        package_details: `Soft hold — ${duration} hours`,
      },
    }
  }

  if (actionKind === 'vendor') {
    return {
      actionType: 'vendor_contact',
      targetType,
      targetId: isUuid(targetId) ? targetId : null,
      requestedAmountCents: priceCents,
      payloadJson: {
        action_label: 'Contact vendor',
        provider,
        price_cents: priceCents,
        fees_cents: 0,
        package_details:
          readRecommendationString(recommendation, 'package_summary') ||
          readRecommendationString(recommendation, 'note') ||
          'Vendor package request',
      },
    }
  }

  return {
    actionType: 'external_checkout',
    targetType,
    targetId: isUuid(targetId) ? targetId : null,
    requestedAmountCents: priceCents,
    payloadJson: {
      action_label: 'External booking',
      provider,
      url: readRecommendationString(recommendation, 'external_url'),
      price_cents: priceCents,
      fees_cents: 0,
      package_details: readRecommendationString(recommendation, 'note') || 'External booking requires approval',
    },
  }
}

/**
 * Converts a draft approval card into the agent-action payload used after signup.
 */
function buildApprovalAgentActionPayload(
  approval: Record<string, unknown>,
  amountCents: number
): PlannerAgentActionRequest {
  const label = readApprovalString(approval, 'label') || readApprovalString(approval, 'action_label') || 'Authorize planner action'
  const provider = readApprovalString(approval, 'provider') || '3rdPlace partner'
  const packageDetails =
    readApprovalString(approval, 'package_details') ||
    readApprovalString(approval, 'terms') ||
    'Approval requested from planner conversation'
  const targetType = /vendor/i.test(label) || /vendor/i.test(provider) ? 'vendor' : 'venue'

  return {
    actionType: targetType === 'vendor' ? 'vendor_contact' : 'hold_request',
    targetType,
    targetId: null,
    requestedAmountCents: amountCents,
    payloadJson: {
      action_label: label,
      provider,
      price_cents: amountCents,
      fees_cents: 0,
      package_details: packageDetails,
      source: 'planner_signup_gate',
    },
  }
}

/**
 * Classifies a recommendation action by CTA label and recommendation type.
 */
function getRecommendationActionKind(
  label: string,
  recommendation: Record<string, unknown>
): RecommendationActionKind {
  const normalizedLabel = label.toLowerCase()
  const normalizedType = readRecommendationString(recommendation, 'type').toLowerCase()

  if (normalizedLabel.includes('hold') || normalizedType === 'venue') return 'hold'
  if (normalizedLabel.includes('vendor') || normalizedType === 'vendor') return 'vendor'
  return 'external'
}

/**
 * Converts recommendation labels into the targetType values expected by agent actions.
 */
function normalizeRecommendationTargetType(
  actionKind: RecommendationActionKind,
  recommendation: Record<string, unknown>
) {
  const rawType = readRecommendationString(recommendation, 'type').toLowerCase()
  if (rawType.includes('venue')) return 'venue'
  if (rawType.includes('vendor')) return 'vendor'
  if (rawType.includes('ticket')) return 'ticket'
  if (actionKind === 'hold') return 'venue'
  if (actionKind === 'vendor') return 'vendor'
  return 'external'
}

/**
 * Returns the success copy for a recommendation action.
 */
function getRecommendationSuccessMessage(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return '✓ Hold requested — approval card created'
  if (actionKind === 'vendor') return "✓ Added to concierge queue — we'll reach out"
  return '✓ External booking flagged for approval'
}

/**
 * Returns the failure copy for a recommendation action.
 */
function getRecommendationErrorMessage(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return 'Failed to create hold request — try again'
  if (actionKind === 'vendor') return 'Failed to add vendor request — try again'
  return 'Failed to flag external booking — try again'
}

/**
 * Prevents internal ranking/context strings from leaking into user-facing cards.
 */
function sanitizeRecommendationDisplayText(value: string, recommendation: Record<string, unknown>) {
  if (!value) return ''
  if (!/Filter by capacity|Ticketing model:|Food \+ beverage:|Food responsibility:|Vendor needs?:|Agent action:/i.test(value)) {
    return value
  }

  const type = readRecommendationString(recommendation, 'type') || 'Option'
  const name = readRecommendationString(recommendation, 'name') || 'This option'
  const capacity = readRecommendationNumber(recommendation, 'capacity')
  const capacityLabel = capacity ? ` with capacity for ${capacity}` : ''

  if (/venue/i.test(type)) {
    return `${name} is the best current venue fit${capacityLabel}. It is matched on the stated budget, required setup, and booking terms.`
  }

  if (/vendor/i.test(type)) {
    return `${name} is the best current vendor fit. It is scoped to the stated requirements and budget before outreach.`
  }

  return `${name} is matched on the stated event requirements and budget.`
}

function readRecommendationMetadataArchetype(metadata: unknown): string | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const archetype = readUnknownRecord(root?.resolved_archetype) ?? readUnknownRecord(response?.resolved_archetype)
  const displayName = archetype?.display_name
  return typeof displayName === 'string' && displayName.trim() ? displayName : null
}

function readVendorRecommendationGroups(metadata: unknown): Array<{
  service_type: string
  necessity: string
}> {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const groups = Array.isArray(root?.vendor_recommendation_groups)
    ? root?.vendor_recommendation_groups
    : Array.isArray(response?.vendor_recommendation_groups)
      ? response?.vendor_recommendation_groups
      : []

  return groups.flatMap((item) => {
    const group = readUnknownRecord(item)
    const serviceType = group?.service_type
    const necessity = group?.necessity
    if (typeof serviceType !== 'string' || typeof necessity !== 'string') return []

    return [{
      service_type: serviceType,
      necessity,
    }]
  })
}

function readRecommendationCapacityCalibration(metadata: unknown): {
  calibration_signal: string
  stated_guest_count: number | null
  projected_attendance: number | null
  history_p75: number | null
  sample_size: number
} | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const calibration = readUnknownRecord(root?.capacity_calibration) ?? readUnknownRecord(response?.capacity_calibration)
  if (!calibration) return null

  const signal = calibration.calibration_signal
  if (typeof signal !== 'string') return null

  return {
    calibration_signal: signal,
    stated_guest_count: typeof calibration.stated_guest_count === 'number' ? calibration.stated_guest_count : null,
    projected_attendance: typeof calibration.projected_attendance === 'number' ? calibration.projected_attendance : null,
    history_p75: typeof calibration.history_p75 === 'number' ? calibration.history_p75 : null,
    sample_size: typeof calibration.sample_size === 'number' ? calibration.sample_size : 0,
  }
}

function readRecommendationEconomicsDetails(metadata: unknown): {
  narrative: string
  historical_anchor: string | null
  recommended_price_cents: number
  price_points: Array<{
    price_cents: number
    projected_net_cents: number
    break_even_tickets: number
    recommendation: string
    reasoning: string
  }>
  elasticity: {
    sample_size: number
    tier_pattern: string
    velocity_vector: Array<{
      price_cents: number
      avg_days_to_sellout: number | null
      sellout_rate: number
    }>
  } | null
} | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const economics = readUnknownRecord(root?.economics) ?? readUnknownRecord(response?.economics)
  if (!economics) return null

  const narrative =
    typeof economics.narrative === 'string' && economics.narrative.trim()
      ? economics.narrative.trim()
      : typeof economics.recommendation_summary === 'string' && economics.recommendation_summary.trim()
        ? economics.recommendation_summary.trim()
        : null
  if (!narrative) return null

  const pricePoints = Array.isArray(economics.price_points)
    ? economics.price_points.flatMap((item) => {
      const point = readUnknownRecord(item)
      if (!point) return []
      const priceCents = typeof point.price_cents === 'number' ? point.price_cents : null
      const projectedNetCents = typeof point.projected_net_cents === 'number' ? point.projected_net_cents : null
      const breakEvenTickets = typeof point.break_even_tickets === 'number' ? point.break_even_tickets : null
      const recommendation = typeof point.recommendation === 'string' ? point.recommendation : null
      const reasoning = typeof point.reasoning === 'string' ? point.reasoning : null
      if (priceCents === null || projectedNetCents === null || breakEvenTickets === null || !recommendation || !reasoning) return []

      return [{
        price_cents: priceCents,
        projected_net_cents: projectedNetCents,
        break_even_tickets: breakEvenTickets,
        recommendation,
        reasoning,
      }]
    })
    : []

  return {
    narrative,
    historical_anchor: typeof economics.historical_anchor === 'string' ? economics.historical_anchor : null,
    recommended_price_cents: typeof economics.recommended_price_cents === 'number' ? economics.recommended_price_cents : 0,
    price_points: pricePoints,
    elasticity: readEconomicsElasticity(root?.elasticity ?? response?.elasticity),
  }
}

function readEconomicsElasticity(value: unknown): {
  sample_size: number
  tier_pattern: string
  velocity_vector: Array<{
    price_cents: number
    avg_days_to_sellout: number | null
    sellout_rate: number
  }>
} | null {
  const elasticity = readUnknownRecord(value)
  if (!elasticity) return null
  const sampleSize = typeof elasticity.sample_size === 'number' ? elasticity.sample_size : 0
  const tierPattern = typeof elasticity.tier_pattern === 'string' ? elasticity.tier_pattern : 'unknown'
  const velocityVector = Array.isArray(elasticity.velocity_vector)
    ? elasticity.velocity_vector.flatMap((item) => {
      const point = readUnknownRecord(item)
      if (!point || typeof point.price_cents !== 'number' || typeof point.sellout_rate !== 'number') return []
      return [{
        price_cents: point.price_cents,
        avg_days_to_sellout: typeof point.avg_days_to_sellout === 'number' ? point.avg_days_to_sellout : null,
        sellout_rate: point.sellout_rate,
      }]
    })
    : []

  return { sample_size: sampleSize, tier_pattern: tierPattern, velocity_vector: velocityVector }
}

function readUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

/**
 * Reads a string field from recommendation metadata.
 */
function readRecommendationString(recommendation: Record<string, unknown>, key: string) {
  const value = recommendation[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads a number field from recommendation metadata.
 */
function readRecommendationNumber(recommendation: Record<string, unknown>, key: string) {
  const value = recommendation[key]
  return typeof value === 'number' ? value : null
}

/**
 * Reads the recommendation price in cents.
 */
function readRecommendationPriceCents(recommendation: Record<string, unknown>) {
  return readRecommendationNumber(recommendation, 'price_cents') ?? 0
}

/**
 * Allows only real HTTPS external booking links and blocks placeholders.
 */
function isRealExternalUrl(value: string) {
  if (!value.startsWith('https://')) return false

  try {
    const url = new URL(value)
    return !url.hostname.endsWith('example.com')
  } catch {
    return false
  }
}

/**
 * Validates optional recommendation ids before using them as DB target ids.
 */
function isUuid(value: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

interface PlannerApprovalCardProps {
  planId: string
  approvalId: string
  approval: Record<string, unknown>
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onStatusChange: (approvalId: string, status: ApprovalUiStatus, updatedApproval?: Record<string, unknown>) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
}

/**
 * Interactive approval card for booking, hold, and payment confirmation steps.
 */
function PlannerApprovalCard({
  planId,
  approvalId,
  approval,
  isAuthenticated,
  onAuthRequired,
  onStatusChange,
  onToast,
}: PlannerApprovalCardProps) {
  const [status, setStatus] = useState(readApprovalStatus(approval))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm_cancel'>('view')
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [editNotice, setEditNotice] = useState<string | null>(null)
  const [amount, setAmount] = useState(formatApprovalAmountInput(readApprovalAmount(approval)))
  const [authorizedAmountCents, setAuthorizedAmountCents] = useState(readAuthorizedApprovalAmount(approval))
  const [eventDate, setEventDate] = useState(readApprovalString(approval, 'event_date'))
  const [notes, setNotes] = useState('')

  useEffect(() => {
    setStatus(readApprovalStatus(approval))
    setAuthorizedAmountCents(readAuthorizedApprovalAmount(approval))
  }, [approval])

  const label = readApprovalString(approval, 'label') || readApprovalString(approval, 'action_label') || 'Approval required'
  const provider = readApprovalString(approval, 'provider') || '3rdPlace'
  const deliveryEmail = readApprovalString(approval, 'delivery_email') || 'Needed'
  const terms = readApprovalString(approval, 'terms') || readApprovalString(approval, 'refund_terms') || 'Approval required before payment.'
  const amountCents = readApprovalAmount(approval)
  const venueNames = readApprovalVenueNames(approval)
  const briefPreview = readApprovalBriefPreview(approval)
  const responseDeadline = readApprovalResponseDeadline(approval)
  const approvalKind = readApprovalString(approval, 'kind')
  const isVenueOutreachApproval = approvalKind === 'venue_outreach' || /outreach/i.test(label)
  const isSendToVenues = isVenueOutreachApproval || /send to venues/i.test(label)
  const inviteStats = readApprovalInviteStats(approval)
  const queuedInviteCount = readApprovalQueuedInviteCount(approval) ?? venueNames.length
  const sentAt = inviteStats?.last_sent_at ? formatApprovalTimestamp(inviteStats.last_sent_at) : null
  const conciergeFollowupCount = inviteStats?.concierge_followup_count ?? 0

  function requestSignupForAuthorization(nextAuthorizedAmountCents: number) {
    onAuthRequired({
      type: 'authorize',
      payload: {
        approvalId,
        authorizedAmountCents: nextAuthorizedAmountCents,
        agentAction: buildApprovalAgentActionPayload(approval, nextAuthorizedAmountCents),
      },
    })
  }

  async function patchApproval(action: 'authorize' | 'approve' | 'cancel', nextAuthorizedAmountCents?: number) {
    if (planId.startsWith('mock-plan-') || approvalId.startsWith('mock-approval-')) {
      return {
        ...approval,
        status: action === 'authorize' || action === 'approve' ? action : 'cancelled',
        authorized_amount_cents: action === 'authorize' || action === 'approve' ? nextAuthorizedAmountCents ?? amountCents : null,
      }
    }

    const response = await fetch(`/api/planner/plans/${planId}/approvals`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvalId,
        action,
        authorizedAmountCents: action === 'authorize' || action === 'approve' ? nextAuthorizedAmountCents ?? amountCents : undefined,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as { error?: string }))
      throw new Error(payload?.error ?? 'Approval update failed')
    }

    const payload = (await response.json()) as { approval?: Record<string, unknown> }
    return payload.approval ?? null
  }

  async function handleAuthorize() {
    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      requestSignupForAuthorization(amountCents)
      return
    }

    setIsSubmitting(true)
    setInlineError(null)

    try {
      const updatedApproval = await patchApproval(isVenueOutreachApproval ? 'approve' : 'authorize', amountCents)
      setAuthorizedAmountCents(readAuthorizedApprovalAmount(updatedApproval ?? approval) ?? amountCents)
      setStatus('approved')
      onStatusChange(approvalId, 'approved', updatedApproval ?? { status: 'authorized', authorized_amount_cents: amountCents })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Authorization failed — try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleReject() {
    setIsSubmitting(true)
    setInlineError(null)

    try {
      const updatedApproval = await patchApproval('cancel')
      setStatus('rejected')
      onStatusChange(approvalId, 'rejected', updatedApproval ?? { status: 'cancelled' })
    } catch {
      setInlineError('Cancellation failed — try again')
      setMode('view')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveChanges() {
    const amountValue = Number.parseFloat(amount)
    if (!Number.isFinite(amountValue) || amountValue < 0) {
      setInlineError('Enter a valid authorized amount')
      return
    }

    const nextAuthorizedAmountCents = Math.round(amountValue * 100)

    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      requestSignupForAuthorization(nextAuthorizedAmountCents)
      return
    }

    setIsSubmitting(true)
    setInlineError(null)
    setEditNotice(null)

    try {
      const updatedApproval = await patchApproval(isVenueOutreachApproval ? 'approve' : 'authorize', nextAuthorizedAmountCents)
      setAuthorizedAmountCents(nextAuthorizedAmountCents)
      setStatus('approved')
      setMode('view')
      onStatusChange(
        approvalId,
        'approved',
        updatedApproval ?? {
          status: 'authorized',
          authorized_amount_cents: nextAuthorizedAmountCents,
        }
      )
      onToast({
        title: 'Authorized',
        description: 'Approval updated with the authorized amount.',
        variant: 'success',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Authorization failed — try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (status === 'rejected') {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-4">
        <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-bold text-muted-foreground">
          ✗ Cancelled
        </span>
        <p className="mt-3 text-sm text-muted-foreground">This approval was cancelled. No booking or payment will be executed.</p>
      </div>
    )
  }

  return (
    <div className="min-w-0 rounded-2xl border border-primary/40 bg-primary/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Is this correct?</p>
      <h3 className="mt-2 break-words font-display text-lg font-bold leading-tight text-foreground">{label}</h3>

      {mode === 'edit' ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-foreground">
            Authorized amount ($)
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1"
              inputMode="decimal"
              disabled={isSubmitting}
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Date
            <Input
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
              className="mt-1"
              type="date"
              disabled={isSubmitting}
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Notes
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 min-h-24"
              placeholder="What should change before this is approved?"
              disabled={isSubmitting}
            />
          </label>
          {editNotice ? (
            <div className="rounded-xl border border-secondary/30 bg-secondary/10 px-3 py-2 text-sm font-semibold text-secondary">
              {editNotice}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleSaveChanges} disabled={isSubmitting}>
              Save changes
            </Button>
            <Button type="button" variant="glass" size="sm" onClick={() => setMode('view')} disabled={isSubmitting}>
              Cancel edit
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Provider</p>
              <p className="break-words font-semibold leading-snug text-foreground">{provider}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimated amount</p>
              <p className="break-words font-semibold leading-snug text-foreground">
                {amountCents > 0 ? formatMockCents(amountCents) : 'No payment yet'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Delivery email</p>
              <p className="break-words font-semibold leading-snug text-foreground">{deliveryEmail}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Terms</p>
              <p className="break-words font-semibold leading-snug text-foreground">{terms}</p>
            </div>
          </div>

          {isSendToVenues ? (
            <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
              {venueNames.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Venue list</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {venueNames.map((venueName) => (
                      <span key={venueName} className="rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                        {venueName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {briefPreview ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Brief preview</p>
                  <p className="mt-1 break-words text-sm leading-snug text-foreground">{briefPreview}</p>
                </div>
              ) : null}
              {responseDeadline ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Response deadline</p>
                  <p className="mt-1 font-semibold text-foreground">{responseDeadline}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {status === 'approved' ? (
            <div className="mt-4">
              <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-bold text-success">
                ✓ Authorized
              </span>
              {isSendToVenues ? (
                <div className="mt-2 space-y-2">
                  <p className="text-sm font-semibold text-success">
                    {sentAt
                      ? `Sent at ${sentAt} · (${inviteStats?.viewed_count ?? 0} viewed, ${inviteStats?.responded_count ?? 0} responded)`
                      : `Queued — ${queuedInviteCount} invite${queuedInviteCount === 1 ? '' : 's'} ready to send`}
                  </p>
                  {conciergeFollowupCount > 0 ? (
                    <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-bold text-warning">
                      {conciergeFollowupCount} venue{conciergeFollowupCount === 1 ? '' : 's'} need concierge outreach
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm font-semibold text-success">
                  Authorization recorded
                  {authorizedAmountCents != null ? ` · ${formatMockCents(authorizedAmountCents)}` : ''} · pending execution
                </p>
              )}
            </div>
          ) : mode === 'confirm_cancel' ? (
            <div className="mt-4 rounded-xl border border-border bg-background/70 p-3">
              <p className="text-sm font-semibold text-foreground">Cancel this approval? This cannot be undone.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" onClick={handleReject} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Yes, cancel
                </Button>
                <Button type="button" variant="glass" size="sm" onClick={() => setMode('view')} disabled={isSubmitting}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={handleAuthorize} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isVenueOutreachApproval ? 'Approve and send' : 'Authorize'}
              </Button>
              <Button type="button" variant="glass" size="sm" onClick={() => setMode('edit')} disabled={isSubmitting}>
                {isVenueOutreachApproval ? 'Edit picks' : 'Edit'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode('confirm_cancel')} disabled={isSubmitting}>
                Cancel
              </Button>
            </div>
          )}

          {inlineError ? <p className="mt-3 text-sm font-semibold text-destructive">{inlineError}</p> : null}
        </>
      )}
    </div>
  )
}

/**
 * Reads a string field from approval metadata.
 */
function readApprovalString(approval: Record<string, unknown>, key: string) {
  const value = approval[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads a cent amount from approval metadata.
 */
function readApprovalAmount(approval: Record<string, unknown>) {
  const requested = approval.requested_amount_cents
  if (typeof requested === 'number') return requested

  const amount = approval.amount_cents
  if (typeof amount === 'number') return amount

  const price = approval.price_cents
  return typeof price === 'number' ? price : 0
}

/**
 * Reads the authorized cent amount from approval metadata.
 */
function readAuthorizedApprovalAmount(approval: Record<string, unknown>) {
  const authorized = approval.authorized_amount_cents
  return typeof authorized === 'number' ? authorized : null
}

/**
 * Reads venue names attached to a Send-to-venues approval card.
 */
function readApprovalVenueNames(approval: Record<string, unknown>) {
  const invites = approval.invites
  if (!Array.isArray(invites)) return []

  return invites
    .map((invite) => {
      if (!invite || typeof invite !== 'object' || Array.isArray(invite)) return null
      const venue = (invite as Record<string, unknown>).venue
      if (venue && typeof venue === 'object' && !Array.isArray(venue)) {
        const name = (venue as Record<string, unknown>).venue_name
        if (typeof name === 'string' && name.trim()) return name.trim()
      }
      const response = (invite as Record<string, unknown>).venue_response_json
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        const targetName = (response as Record<string, unknown>).target_name
        if (typeof targetName === 'string' && targetName.trim()) return targetName.trim()
      }
      return null
    })
    .filter((name): name is string => Boolean(name))
}

/**
 * Reads opportunity summary text attached to a Send-to-venues approval card.
 */
function readApprovalBriefPreview(approval: Record<string, unknown>) {
  const opportunity = approval.opportunity
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) {
    return readApprovalString(approval, 'package_details')
  }

  const record = opportunity as Record<string, unknown>
  if (typeof record.summary === 'string' && record.summary.trim()) return record.summary.trim()
  if (typeof record.title === 'string' && record.title.trim()) return record.title.trim()
  return readApprovalString(approval, 'package_details')
}

/**
 * Reads response deadline text from opportunity metadata.
 */
function readApprovalResponseDeadline(approval: Record<string, unknown>) {
  const opportunity = approval.opportunity
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) return ''

  const value = (opportunity as Record<string, unknown>).response_deadline
  if (typeof value !== 'string' || !value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * Reads queued invite count returned by authorization sync.
 */
function readApprovalQueuedInviteCount(approval: Record<string, unknown>) {
  const value = approval.queued_invite_count
  return typeof value === 'number' ? value : null
}

interface ApprovalInviteStats {
  total_count: number
  queued_count: number
  sent_count: number
  viewed_count: number
  responded_count: number
  concierge_followup_count: number
  expired_count: number
  last_sent_at: string | null
}

/**
 * Reads send/view/response counts for opportunity approval cards.
 */
function readApprovalInviteStats(approval: Record<string, unknown>): ApprovalInviteStats | null {
  const value = approval.invite_stats
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  return {
    total_count: readNumberField(record, 'total_count'),
    queued_count: readNumberField(record, 'queued_count'),
    sent_count: readNumberField(record, 'sent_count'),
    viewed_count: readNumberField(record, 'viewed_count'),
    responded_count: readNumberField(record, 'responded_count'),
    concierge_followup_count: readNumberField(record, 'concierge_followup_count'),
    expired_count: readNumberField(record, 'expired_count'),
    last_sent_at: typeof record.last_sent_at === 'string' ? record.last_sent_at : null,
  }
}

function readNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatApprovalTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * Reads approval status metadata, defaulting to pending.
 */
function readApprovalStatus(approval: Record<string, unknown>): 'pending' | ApprovalUiStatus {
  const status = approval.status
  if (status === 'approved' || status === 'authorized') return 'approved'
  if (status === 'rejected' || status === 'cancelled') return 'rejected'
  return 'pending'
}

/**
 * Converts approval cents to a human-editable dollar field.
 */
function formatApprovalAmountInput(amountCents: number) {
  if (amountCents <= 0) return ''
  return String(Math.round(amountCents / 100))
}
