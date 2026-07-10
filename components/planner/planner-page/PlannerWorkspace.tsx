'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, CheckCircle2, ChevronDown, FileText, LayoutTemplate, Loader2, Mail, MessageSquare, RefreshCw, SendHorizontal, Sparkles, X } from 'lucide-react'
import { PlannerEmptyState } from '@/components/planner/PlannerEmptyState'
import { PlannerDataConnectionPanel } from '@/components/planner/PlannerDataConnectionPanel'
import { PostEventReportCard } from '@/components/planner/PostEventReportCard'
import { PlannerSignupGate } from '@/components/planner/PlannerSignupGate'
import { PlannerTimelineCountdown } from '@/components/planner/PlannerTimelineCountdown'
import { PlannerTopBar } from '@/components/planner/PlannerTopBar'
import { PlannerBillingAccessBanner } from '@/components/planner/PlannerBillingAccessBanner'
import { usePlannerBillingGate } from '@/components/planner/usePlannerBillingGate'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { hasPendingAgentResponse } from '@/lib/planner/intakeReadiness'
import { migratePlannerDraftToServer } from '@/lib/planner/migrateDraft'
import type { DerivationAgentAction } from '@/lib/planner/timelineDerivation'
import type { Plan, PlanMessage, PlannerCreatePlanResponse, PlannerPostMessageResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DraftMatchSignupCard, PlannerApprovalFocusedCard, PlannerFocusedMessageCard, PlannerMessageBubble, getActivePlanDateChip, getApprovalSummary, isUuid, readUnknownRecord } from './PlannerConversation'
import { DemoSessionBanner, PlannerTemplatesModal, ReplyAnalysisResult, isResponseAnalysisOutput, readAgentOutput } from './PlannerTemplatesModal'
import { applyMockPlanPatch, buildDeterministicDraftExchange, buildDraftMatchHandoff, buildMockMessage, buildMockPlan, hasDraftMatchGateMessage, shouldUseMockReplyPath, tryRunPublicDraftIntake } from './draftMode'
import { buildEventPlanPayload, clearStoredPlannerConversation, getPendingActionSuccessMessage, getPlannerOrganizationName, getPlannerRoleLabel, getTabCount, getVisibleMessages, hasNewerConfirmationMessage, isApprovalMessage, isNewConversationResetRequest, isPendingConversionAction, isRecommendationMessage, isTimelineOutput, loadPlannerStateFromApiCached, persistStoredPlannerConversation, publishLivePlan, readStoredPlannerConversation, shouldStartNewPlanFromReply } from './plannerState'
import { planTabs, quickActionChips, type ApprovalUiStatus, type PendingConversionAction, type PlannerAccountSummary, type PlannerAgentActionRequest, type PlannerPersistenceMode, type PlannerTab, type PlannerTemplateApplyOptions, type PlannerTemplateSummary, type ResponseAnalysisOutput, type TimelineOutput } from './types'

const gmailSkipReminderStorageKey = 'gmail_skip_reminder_dismissed'

function isDesktopPlannerViewport() {
  return typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
}

const mobilePromotedPlannerPaths = new Set([
  '/planner',
  '/planner/new-plan',
  '/planner/venues',
  '/planner/payments',
  '/planner/messages',
  '/planner/vendors',
  '/planner/analytics',
  '/planner/tickets',
  '/planner/billing',
  '/planner/settings',
])

export function PlannerWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const forceDraftMode = searchParams.get('mock') === '1'
  const isDemoSession = searchParams.get('demo') === '1'
  const shouldHardResetDemo = isDemoSession && searchParams.get('reset') === '1'
  const isRebookIntent = searchParams.get('intent') === 'rebook'
  const isNewPlanRoute = pathname === '/planner/new-plan'
  const initialDraft = searchParams.get('draft')
  const requestedPlanId = searchParams.get('plan')
  const requestedTabParam = searchParams.get('tab')
  const draftMigrationStatus = searchParams.get('draftMigration')
  const gmailSkipped = searchParams.get('gmail_skipped') === '1'
  const [activePlan, setActivePlan] = useState<Plan | null>(null)
  const [messages, setMessages] = useState<PlanMessage[]>([])
  const [activeTab, setActiveTab] = useState<PlannerTab>('chat')
  const [reply, setReply] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const hasStartedInitialDraftRef = useRef(false)
  const hasTriggeredDemoResetRef = useRef(false)
  const hasOpenedRebookIntentRef = useRef(false)
  const hasTriedDraftAutoMigrationRef = useRef(false)
  const hasPromptedDraftSignupGateRef = useRef(false)
  const hasParsedInitialTabRef = useRef(false)
  const pendingDeepLinkScrollMsgIdRef = useRef<string | null>(null)
  const autoTriggeredDraftRecommendationPlanRef = useRef<string | null>(null)
  const ignoredDraftRef = useRef<string | null>(null)
  const [persistenceMode, setPersistenceMode] = useState<PlannerPersistenceMode>('loading')
  const [hasLoadedStoredConversation, setHasLoadedStoredConversation] = useState(false)
  const [isCreatingPlan, setIsCreatingPlan] = useState(false)
  const [isStartingNewPlan, setIsStartingNewPlan] = useState(false)
  const [isStartingInitialDraft, setIsStartingInitialDraft] = useState(() => Boolean(initialDraft))
  const [isSendingReply, setIsSendingReply] = useState(false)
  const [isAwaitingRecommendations, setIsAwaitingRecommendations] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isSignupGateOpen, setIsSignupGateOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingConversionAction | null>(null)
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false)
  const [templatesModalMode, setTemplatesModalMode] = useState<'apply' | 'rebook'>('apply')
  const [plannerTemplates, setPlannerTemplates] = useState<PlannerTemplateSummary[]>([])
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isReplyAnalysisOpen, setIsReplyAnalysisOpen] = useState(false)
  const [replyAnalysisText, setReplyAnalysisText] = useState('')
  const [isAnalyzingReply, setIsAnalyzingReply] = useState(false)
  const [replyAnalysisError, setReplyAnalysisError] = useState<string | null>(null)
  const [replyAnalysisResult, setReplyAnalysisResult] = useState<ResponseAnalysisOutput | null>(null)
  const [replyAnalysisPartnerType, setReplyAnalysisPartnerType] = useState<'venue' | 'vendor'>('venue')
  const [isCreatingVendorCaptureApproval, setIsCreatingVendorCaptureApproval] = useState(false)
  const [vendorCaptureApprovalError, setVendorCaptureApprovalError] = useState<string | null>(null)
  const [vendorCaptureApprovalMessage, setVendorCaptureApprovalMessage] = useState<string | null>(null)
  const [timelineResult, setTimelineResult] = useState<TimelineOutput | null>(null)
  const [agentActions, setAgentActions] = useState<DerivationAgentAction[]>([])
  const [isTimelineLoading, setIsTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [isDemoResetting, setIsDemoResetting] = useState(false)
  const [demoResetError, setDemoResetError] = useState<string | null>(null)
  const [signupGateContext, setSignupGateContext] = useState<'default' | 'recommendations'>('default')
  const [plannerAccount, setPlannerAccount] = useState<PlannerAccountSummary | null>(null)
  const [showGmailSkipReminder, setShowGmailSkipReminder] = useState(false)
  const billingGate = usePlannerBillingGate({
    onPlanArchived: (planId) => {
      if (activePlan?.id === planId) {
        setActivePlan(null)
        setMessages([])
        publishLivePlan(null, [])
      }
    },
  })

  const loadPlanAgentActions = useCallback(async (planId: string) => {
    if (!planId || planId.startsWith('mock-plan-')) {
      setAgentActions([])
      return
    }

    try {
      const response = await fetch(`/api/planner/plans/${planId}/agent-actions?limit=50`, {
        method: 'GET',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({} as { agentActions?: DerivationAgentAction[] }))

      if (!response.ok) {
        console.warn('[planner] Unable to load agent actions for timeline', response.status)
        return
      }

      setAgentActions(Array.isArray(payload.agentActions) ? payload.agentActions : [])
    } catch (error) {
      console.warn('[planner] Unable to load agent actions for timeline', error)
    }
  }, [])

  useEffect(() => {
    setIsAuthenticated(persistenceMode === 'server')
  }, [persistenceMode])

  useEffect(() => {
    if (!gmailSkipped) return
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(gmailSkipReminderStorageKey) === '1') return

    let cancelled = false
    async function loadGmailState() {
      try {
        const response = await fetch('/api/integrations/gmail/account', {
          cache: 'no-store',
          credentials: 'include',
        })
        const payload = await response.json().catch(() => ({}))
        if (!cancelled) setShowGmailSkipReminder(!payload?.account)
      } catch {
        if (!cancelled) setShowGmailSkipReminder(true)
      }
    }

    void loadGmailState()
    return () => {
      cancelled = true
    }
  }, [gmailSkipped])

  function dismissGmailSkipReminder() {
    setShowGmailSkipReminder(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(gmailSkipReminderStorageKey, '1')
    }
  }

  // Deep-link support: on first render, if the URL carries ?tab=... (and
  // optionally ?msg=...), open the planner on that tab. The scroll-to-message
  // is deferred to a separate effect because messages load asynchronously.
  useEffect(() => {
    if (hasParsedInitialTabRef.current) return
    hasParsedInitialTabRef.current = true
    const requestedTab = searchParams.get('tab')
    const requestedMessageId = searchParams.get('msg')
    if (requestedTab === 'event_plan') {
      const targetPlanId = requestedPlanId ?? activePlan?.id
      router.replace(targetPlanId ? `/planner/experiences/${targetPlanId}` : '/planner', { scroll: false })
      return
    }
    const valid = planTabs.some((tab) => tab.id === requestedTab)
    if (!valid) return
    setActiveTab(requestedTab as PlannerTab)
    if (requestedTab === 'timeline' && !timelineResult && !isTimelineLoading) {
      void loadPlannerTimeline()
    }
    if (requestedMessageId) {
      pendingDeepLinkScrollMsgIdRef.current = requestedMessageId
    }
  }, [searchParams])

  // Once the destination tab has rendered the deep-linked message, scroll it
  // into view and clear the pending ref. Runs whenever messages or activeTab
  // change, so we catch the moment the target card mounts.
  useEffect(() => {
    const pendingId = pendingDeepLinkScrollMsgIdRef.current
    if (!pendingId) return
    const el = document.querySelector(`[data-plan-message-id="${pendingId}"]`)
    if (!(el instanceof HTMLElement)) return
    pendingDeepLinkScrollMsgIdRef.current = null
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [messages, activeTab])

  // Auto-fetch the timeline once the plan has loaded if the user landed on the
  // Timeline tab via deep link (or any other path that beat the plan-load).
  // Without this, the tab opens empty until the user clicks Refresh.
  useEffect(() => {
    if (activeTab !== 'timeline') return
    if (!activePlan) return
    if (timelineResult) return
    if (isTimelineLoading) return
    void loadPlannerTimeline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activePlan, timelineResult, isTimelineLoading])

  useEffect(() => {
    if (persistenceMode !== 'server' || !activePlan?.id) {
      setAgentActions([])
      return
    }

    void loadPlanAgentActions(activePlan.id)
  }, [activePlan?.id, persistenceMode, loadPlanAgentActions])

  useEffect(() => {
    let isCancelled = false

    async function loadPlannerAccount() {
      try {
        const response = await fetch('/api/auth/user', { credentials: 'include' })
        if (!response.ok) return

        const payload = (await response.json()) as { user?: PlannerAccountSummary }
        if (!isCancelled) setPlannerAccount(payload.user ?? null)
      } catch (error) {
        console.warn('[planner] Unable to load planner account summary', error)
      }
    }

    void loadPlannerAccount()

    return () => {
      isCancelled = true
    }
  }, [])

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
    if (persistenceMode !== 'draft') return
    if (!hasDraftMatchGateMessage(messages)) return
    if (isSignupGateOpen) return
    if (hasPromptedDraftSignupGateRef.current) return

    hasPromptedDraftSignupGateRef.current = true
    setSignupGateContext('recommendations')
    setPendingAction({ type: 'save', payload: { reason: 'recommendations' } })
    setIsSignupGateOpen(true)
  }, [isSignupGateOpen, messages, persistenceMode])

  useEffect(() => {
    if (!shouldHardResetDemo || hasTriggeredDemoResetRef.current) return

    hasTriggeredDemoResetRef.current = true
    void resetDemoSession()
  }, [shouldHardResetDemo])

  useEffect(() => {
    if (shouldHardResetDemo) return

    let isCancelled = false

    async function loadPersistedPlannerState() {
      if (isNewPlanRoute && !initialDraft) {
        clearStoredPlannerConversation()
        publishLivePlan(null, [])
        setIsStartingInitialDraft(false)
        setActivePlan(null)
        setMessages([])
        setAgentActions([])
        setActiveTab('chat')
        setPersistenceMode(forceDraftMode ? 'draft' : 'server')
        setHasLoadedStoredConversation(true)
        return
      }

      if (mobilePromotedPlannerPaths.has(pathname) && !isDesktopPlannerViewport()) {
        setIsStartingInitialDraft(false)
        setPersistenceMode('draft')
        setHasLoadedStoredConversation(true)
        return
      }

      if (initialDraft && !isRebookIntent && isDesktopPlannerViewport()) {
        setIsStartingInitialDraft(true)
        clearStoredPlannerConversation()
        hasStartedInitialDraftRef.current = false
        hasTriedDraftAutoMigrationRef.current = false
        setActivePlan(null)
        setMessages([])
        setActiveTab('chat')
        setPersistenceMode(forceDraftMode ? 'draft' : 'server')
        setHasLoadedStoredConversation(true)
        return
      }

      if (forceDraftMode) {
        setIsStartingInitialDraft(false)
        restoreDraftConversation()
        setPersistenceMode('draft')
        setHasLoadedStoredConversation(true)
        return
      }

      try {
        if (!requestedPlanId && !hasTriedDraftAutoMigrationRef.current) {
          hasTriedDraftAutoMigrationRef.current = true
          try {
            const migratedPlan = await migratePlannerDraftToServer()
            if (migratedPlan?.plan?.id) {
              if (!isCancelled) {
                setIsStartingInitialDraft(false)
                setActivePlan(migratedPlan.plan)
                setMessages(migratedPlan.messages)
                setActiveTab('chat')
                setPersistenceMode('server')
                clearStoredPlannerConversation()
                publishLivePlan(migratedPlan.plan, migratedPlan.messages)
              }
              return
            }
          } catch (error) {
            console.warn('[planner] Continuing after stored draft auto-migration failed', error)
          }
        }

        const plannerState = await loadPlannerStateFromApiCached(requestedPlanId)

        if (plannerState.status === 'unauthorized') {
          if (!isCancelled) {
            setIsStartingInitialDraft(false)
            restoreDraftConversation()
            setPersistenceMode('draft')
          }
          return
        }

        if (!isCancelled) {
          setIsStartingInitialDraft(false)
          setActivePlan(plannerState.plan)
          setMessages(plannerState.messages)
          // Preserve the deep-link tab if one was supplied; otherwise default to Chat.
          const validDeepLinkTab = planTabs.some((tab) => tab.id === requestedTabParam)
          if (!validDeepLinkTab) setActiveTab('chat')
          clearStoredPlannerConversation()
          setPersistenceMode('server')
        }
      } catch (error) {
        if (!isCancelled) {
          setIsStartingInitialDraft(false)
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
  }, [forceDraftMode, initialDraft, isNewPlanRoute, isRebookIntent, pathname, requestedPlanId, requestedTabParam, shouldHardResetDemo])

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
    if (!isDesktopPlannerViewport()) return
    if (!initialDraft || isRebookIntent || hasStartedInitialDraftRef.current || ignoredDraftRef.current === initialDraft) return

    hasStartedInitialDraftRef.current = true
    setIsStartingInitialDraft(true)
    setActivePlan(null)
    setMessages([])
    void startInitialDraftPlan(initialDraft)
  }, [hasLoadedStoredConversation, initialDraft, isRebookIntent])

  useEffect(() => {
    if (!hasLoadedStoredConversation) return
    if (!isRebookIntent) return
    if (hasOpenedRebookIntentRef.current) return
    if (!isDesktopPlannerViewport()) return

    hasOpenedRebookIntentRef.current = true
    void openTemplatesModal('rebook')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedStoredConversation, isRebookIntent])

  useEffect(() => {
    setTimelineResult(null)
    setTimelineError(null)
  }, [activePlan?.id])

  useEffect(() => {
    if (!hasLoadedStoredConversation) return
    if (persistenceMode !== 'server') return
    if (!activePlan || activePlan.status !== 'ready') return
    if (isAwaitingRecommendations) return
    if (hasPendingAgentResponse(messages)) return
    if (!hasDraftMatchGateMessage(messages) || messages.some(isRecommendationMessage)) return
    if (autoTriggeredDraftRecommendationPlanRef.current === activePlan.id) return

    autoTriggeredDraftRecommendationPlanRef.current = activePlan.id
    void triggerRecommendations(activePlan.id, messages)
  }, [activePlan, hasLoadedStoredConversation, isAwaitingRecommendations, messages, persistenceMode])

  /**
   * Starts a homepage/public-intake draft and then removes the draft query so
   * refreshes do not create duplicate plans.
   */
  async function startInitialDraftPlan(message: string) {
    setIsStartingInitialDraft(true)

    try {
      const createdMode = await handleCreatePlan(message)

      if (createdMode && window.location.search.includes('draft=')) {
        router.replace(createdMode === 'draft' ? '/planner?mock=1' : '/planner')
      }
    } finally {
      setIsStartingInitialDraft(false)
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
    hasPromptedDraftSignupGateRef.current = false
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

    setActivePlan(nextPlan)
    setMessages(nextMessages)
    setActiveTab('chat')
    publishLivePlan(nextPlan, nextMessages)
    persistStoredPlannerConversation(nextPlan, nextMessages, true)
  }

  /**
   * Creates the first planner record from the empty-state prompt.
   */
  async function handleCreatePlan(message: string): Promise<'server' | 'draft' | null> {
    if (persistenceMode === 'loading' || !hasLoadedStoredConversation) {
      setErrorMessage('Planner is still loading your workspace. Try again in a moment.')
      return null
    }

    setIsCreatingPlan(true)
    setErrorMessage(null)

    if (persistenceMode !== 'server') {
      await createDraftPlan(message)
      setIsCreatingPlan(false)
      return 'draft'
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
        return 'draft'
      }

      if (response.status === 402) {
        billingGate.handleBillingRequiredResponse(response, payload)
        setIsCreatingPlan(false)
        return null
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to create planner draft')
      }

      const data = payload as PlannerCreatePlanResponse
      setActivePlan(data.plan)
      setMessages(data.messages)
      setAgentActions([])
      setActiveTab('chat')
      publishLivePlan(data.plan, data.messages)
      if (isNewPlanRoute) {
        router.replace(`/planner?plan=${data.plan.id}`, { scroll: false })
      }
      if (data.needs_recommendations) {
        void triggerRecommendations(data.plan.id, data.messages)
      }
      return 'server'
    } catch (error) {
      console.warn('[planner] Falling back to local draft mode after create failed', error)
      setPersistenceMode('draft')
      await createDraftPlan(message)
      return 'draft'
    } finally {
      setIsCreatingPlan(false)
    }
  }

  /**
   * Calls the dedicated trigger-recommendations endpoint for a plan and appends
   * the resulting messages to state. Called after the messages route signals
   * needs_recommendations so the AI pipeline doesn't timeout the main route.
   */
  async function triggerRecommendations(planId: string, currentMessages: PlanMessage[]) {
    setIsAwaitingRecommendations(true)
    try {
      const response = await fetch(`/api/planner/plans/${planId}/trigger-recommendations`, {
        method: 'POST',
      })
      if (!response.ok) {
        console.warn('[planner] trigger-recommendations returned', response.status)
        // Insert a visible fallback so the chat isn't silently empty
        const fallback = buildMockMessage(
          planId,
          'agent',
          'I have everything I need but hit a snag pulling venue options. Reply with any changes or just say "try again" and I\'ll re-run the search.',
          'status_update',
          {}
        )
        setMessages([...currentMessages, fallback])
        return
      }
      const payload = await response.json()
      const newMessages: PlanMessage[] = payload?.messages ?? []
      if (newMessages.length > 0) {
        const merged = [...currentMessages, ...newMessages]
        setMessages(merged)
        if (activePlan) publishLivePlan(activePlan, merged)
      } else {
        // Endpoint returned 200 but empty messages array — pipeline returned no results
        const fallback = buildMockMessage(
          planId,
          'agent',
          'I have everything I need but hit a snag pulling venue options. Reply with any changes or just say "try again" and I\'ll re-run the search.',
          'status_update',
          {}
        )
        setMessages([...currentMessages, fallback])
      }
    } catch (error) {
      console.warn('[planner] trigger-recommendations failed', error)
      const fallback = buildMockMessage(
        planId,
        'agent',
        'I have everything I need but hit a snag pulling venue options. Reply with any changes or just say "try again" and I\'ll re-run the search.',
        'status_update',
        {}
      )
      setMessages([...currentMessages, fallback])
    } finally {
      setIsAwaitingRecommendations(false)
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

    if (persistenceMode === 'server' && shouldStartNewPlanFromReply(trimmed, activePlan)) {
      try {
        if (isNewConversationResetRequest(trimmed)) {
          const reset = await handleNewPlan()
          if (reset) setReply('')
        } else {
          await archiveAbandonedPlanForNewConversation(activePlan)
          const created = await handleCreatePlan(trimmed)
          if (created) setReply('')
        }
      } catch (error) {
        const description = error instanceof Error ? error.message : 'Unable to start a fresh planner chat'
        setErrorMessage(description)
        addToast({
          title: 'New plan not started',
          description,
          variant: 'destructive',
        })
      } finally {
        setIsSendingReply(false)
      }
      return
    }

    if (shouldUseMockReplyPath(persistenceMode, activePlan.id)) {
      if (!forceDraftMode && !hasTriedDraftAutoMigrationRef.current) {
        hasTriedDraftAutoMigrationRef.current = true

        try {
          const migratedPlan = await migratePlannerDraftToServer()
          if (migratedPlan?.plan?.id) {
            setPersistenceMode('server')
            setActivePlan(migratedPlan.plan)
            setMessages(migratedPlan.messages)
            clearStoredPlannerConversation()
            await sendServerReply(migratedPlan.plan, migratedPlan.messages, trimmed)
            return
          }
        } catch (error) {
          console.warn('[planner] Continuing in local draft mode after draft auto-migration failed', error)
        }
      }

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
      const draftMatchHandoff = buildDraftMatchHandoff(finalPlan, agentMessages, messages)
      const nextPlan = draftMatchHandoff.plan
      const nextMessages = [...messages, userMessage, ...draftMatchHandoff.agentMessages]

      setActivePlan(nextPlan)
      setMessages(nextMessages)
      setReply('')
      publishLivePlan(nextPlan, nextMessages)
      persistStoredPlannerConversation(nextPlan, nextMessages, true)
      setIsSendingReply(false)
      return
    }

    await sendServerReply(activePlan, messages, trimmed)
  }

  async function sendServerReply(plan: Plan, currentMessages: PlanMessage[], trimmed: string) {
    try {
      const response = await fetch(`/api/planner/plans/${plan.id}/messages`, {
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
        ...currentMessages,
        data.user_message,
        data.agent_message,
        ...(data.follow_up_messages ?? []),
      ]
      setActivePlan(data.plan)
      setMessages(nextMessages)
      setReply('')
      publishLivePlan(data.plan, nextMessages)
      if (data.needs_recommendations) {
        void triggerRecommendations(plan.id, nextMessages)
      }
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
   * Archives an unfinished server-backed planner draft before a fresh chat starts.
   * Experiences hides archived plans, so abandoned drafts disappear without
   * hard-deleting the audit trail for messages, approvals, or agent actions.
   */
  async function archiveAbandonedPlanForNewConversation(plan: Plan | null) {
    if (!plan || persistenceMode !== 'server' || !isUuid(plan.id)) return
    if (plan.status === 'complete' || plan.status === 'archived') return

    const response = await fetch(`/api/planner/plans/${plan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: 'archived' }),
    })
    const payload = await response.json().catch(() => ({} as { error?: string }))

    if (!response.ok) {
      throw new Error(payload.error ?? 'Could not archive the previous planner draft.')
    }
  }

  /**
   * Clears the active conversation and returns the planner to a fresh intake state.
   */
  async function handleNewPlan() {
    if (isStartingNewPlan) return false

    setIsStartingNewPlan(true)
    setErrorMessage(null)

    try {
      await archiveAbandonedPlanForNewConversation(activePlan)

      clearStoredPlannerConversation()
      setActivePlan(null)
      setMessages([])
      setAgentActions([])
      setReply('')
      setActiveTab('chat')
      setIsCreatingPlan(false)
      setIsSendingReply(false)
      setIsAwaitingRecommendations(false)
      setPendingAction(null)
      setIsSignupGateOpen(false)
      setIsTemplatesModalOpen(false)
      setTemplatesModalMode('apply')
      setIsReplyAnalysisOpen(false)
      setReplyAnalysisText('')
      setReplyAnalysisError(null)
      setReplyAnalysisResult(null)
      setTimelineResult(null)
      setTimelineError(null)
      setIsTimelineLoading(false)
      hasStartedInitialDraftRef.current = false
      hasTriedDraftAutoMigrationRef.current = false
      hasPromptedDraftSignupGateRef.current = false
      ignoredDraftRef.current = initialDraft
      publishLivePlan(null, [])

      if (forceDraftMode) {
        router.push('/planner/new-plan?mock=1')
      } else if (!isNewPlanRoute || window.location.search) {
        router.push('/planner/new-plan')
      }
      return true
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Unable to start a fresh planner chat'
      setErrorMessage(description)
      addToast({
        title: 'New plan not started',
        description,
        variant: 'destructive',
      })
      return false
    } finally {
      setIsStartingNewPlan(false)
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
    if (tabId === 'timeline' && activePlan?.id && persistenceMode === 'server') {
      void loadPlanAgentActions(activePlan.id)
    }
  }

  function navigateToPlannerTab(tabId: PlannerTab, messageId?: string) {
    handlePlannerTabSelect(tabId)
    // Update the URL so the navigation is shareable/back-button-friendly. Use
    // replace (not push) since the user is navigating within the same plan view.
    const next = new URLSearchParams(searchParams.toString())
    next.set('tab', tabId)
    if (messageId) next.set('msg', messageId)
    else next.delete('msg')
    router.replace(`/planner?${next.toString()}`, { scroll: false })

    if (!messageId) return
    // Defer scroll to after the destination tab renders the card.
    window.setTimeout(() => {
      const el = document.querySelector(`[data-plan-message-id="${messageId}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }, 80)
  }

  async function loadPlannerTimeline() {
    if (!activePlan) return

    const eventDate = activePlan.date_window_start ?? activePlan.date_window_end
    if (!eventDate) {
      setTimelineError('Add an event date before generating a timeline.')
      return
    }

    setIsTimelineLoading(true)
    setTimelineError(null)

    try {
      if (persistenceMode === 'server') {
        await loadPlanAgentActions(activePlan.id)
      }

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
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (billingGate.handleBillingRequiredResponse(
          response,
          payload as { error?: string; message?: string; billingRequired?: boolean }
        )) {
          throw new Error('Choose a billing path to continue.')
        }
        const serverMessage = readUnknownRecord(payload)?.error
        throw new Error(
          typeof serverMessage === 'string' && serverMessage.trim()
            ? serverMessage
            : response.status === 402
              ? 'Timeline generation is not available for this plan tier. Save the plan or upgrade to continue.'
              : 'Could not generate timeline from the current plan.'
        )
      }

      const output = readAgentOutput(payload)
      if (!isTimelineOutput(output)) {
        throw new Error('Timeline agent returned an unexpected response.')
      }

      setTimelineResult(output)
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : 'Could not generate timeline. Try again.')
    } finally {
      setIsTimelineLoading(false)
    }
  }

  async function openTemplatesModal(mode: 'apply' | 'rebook' = 'apply') {
    setTemplatesModalMode(mode)
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
        if (response.status === 401 || response.status === 403) {
          throw new Error('Sign in to use saved event templates.')
        }
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

  async function applyPlannerTemplate(templateId: string, options?: PlannerTemplateApplyOptions) {
    const shouldCreateNewPlan = options?.create_new_plan === true || templatesModalMode === 'rebook' || !activePlan

    if (!shouldCreateNewPlan && (!activePlan || persistenceMode !== 'server' || activePlan.id.startsWith('mock-plan-'))) {
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
        body: JSON.stringify(
          shouldCreateNewPlan
            ? { ...options, create_new_plan: true, rerun_recommendations: true }
            : { ...options, plan_id: activePlan?.id, rerun_recommendations: true }
        ),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to apply template')
      }

      setIsTemplatesModalOpen(false)
      if (payload?.plan && typeof payload.plan === 'object') {
        const nextPlan = payload.plan as Plan
        setActivePlan(nextPlan)
        setPersistenceMode('server')
        setActiveTab('chat')
        if (shouldCreateNewPlan && isUuid(nextPlan.id)) {
          router.replace(`/planner?plan=${nextPlan.id}`, { scroll: false })
        }
      }
      if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
        setMessages((currentMessages) => [...currentMessages, ...(payload.messages as PlanMessage[])])
      }
      addToast({
        title: shouldCreateNewPlan ? 'Rebook plan created' : 'Template applied',
        description: shouldCreateNewPlan
          ? 'Built a fresh plan from the saved event shape. Review before any outreach, booking, or payment.'
          : 'Re-checking venues, vendors, and economics for this plan.',
        variant: 'success',
      })
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Unable to apply template')
    } finally {
      setApplyingTemplateId(null)
    }
  }

  async function saveActivePlanAsTemplate() {
    if (!activePlan || persistenceMode !== 'server' || activePlan.id.startsWith('mock-plan-')) {
      addToast({
        title: 'Save the plan first',
        description: 'Templates can only be created from a saved planner plan.',
        variant: 'warning',
      })
      return
    }

    setIsSavingTemplate(true)
    setTemplateError(null)

    try {
      const response = await fetch('/api/planner/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: activePlan.id }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to save template')
      }

      const template = payload?.template as PlannerTemplateSummary | undefined
      if (template?.id) {
        setPlannerTemplates((templates) => [template, ...templates.filter((existing) => existing.id !== template.id)])
        setHasLoadedTemplates(true)
      }
      addToast({
        title: 'Template saved',
        description: 'This event shape is ready to reuse.',
        variant: 'success',
      })
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Unable to save template')
    } finally {
      setIsSavingTemplate(false)
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
            partner_type: replyAnalysisPartnerType,
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
      setVendorCaptureApprovalError(null)
      setVendorCaptureApprovalMessage(null)
    } catch (error) {
      setReplyAnalysisError(error instanceof Error ? error.message : 'Unable to analyze reply')
    } finally {
      setIsAnalyzingReply(false)
    }
  }

  async function createVendorCaptureApproval() {
    if (!activePlan || !replyAnalysisResult) return

    const rawReplyText = replyAnalysisText.trim()
    if (!rawReplyText) {
      setVendorCaptureApprovalError('Paste the vendor reply before creating an approval.')
      return
    }

    setIsCreatingVendorCaptureApproval(true)
    setVendorCaptureApprovalError(null)
    setVendorCaptureApprovalMessage(null)

    const amountCents = replyAnalysisResult.quoted_price_cents ?? replyAnalysisResult.minimum_spend_cents ?? 0

    try {
      const response = await fetch(`/api/planner/plans/${activePlan.id}/agent-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          actionType: 'vendor_contact',
          targetType: 'vendor_reply_capture',
          payloadJson: {
            kind: 'vendor_reply_capture',
            partner_type: 'vendor',
            action_label: 'Review vendor reply terms',
            provider: replyAnalysisResult.service_type ?? 'Manual vendor reply',
            package_details: replyAnalysisResult.summary,
            refund_terms: 'No vendor invite, booking, private rate, or payment is created until this approval is reviewed.',
            cancellation_terms: replyAnalysisResult.cancellation_terms ?? 'Cancellation terms not confirmed.',
            requestedAmountCents: amountCents,
            raw_reply_text: rawReplyText,
            analysis: replyAnalysisResult,
            service_type: replyAnalysisResult.service_type ?? null,
            quoted_price_cents: replyAnalysisResult.quoted_price_cents,
            minimum_spend_cents: replyAnalysisResult.minimum_spend_cents,
            deposit_required_cents: replyAnalysisResult.deposit_required_cents,
            availability_status: replyAnalysisResult.availability_status,
            availability_notes: replyAnalysisResult.availability_notes ?? null,
            notes: replyAnalysisResult.notes ?? null,
            included_services: replyAnalysisResult.included_services,
          },
          requestedAmountCents: amountCents,
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (billingGate.handleBillingRequiredResponse(
          response,
          payload as { error?: string; message?: string; billingRequired?: boolean }
        )) {
          throw new Error('Choose a billing path to continue.')
        }
        throw new Error(payload?.error ?? 'Could not create vendor capture approval.')
      }

      setVendorCaptureApprovalMessage('Approval request created. Review it before any vendor invite or private rate changes.')
      setActiveTab('approvals')
      if (activePlan.id && persistenceMode === 'server') void loadPlanAgentActions(activePlan.id)
      addToast({
        title: 'Vendor approval created',
        description: 'Review the captured vendor terms before creating or updating vendor records.',
        variant: 'success',
      })
    } catch (error) {
      setVendorCaptureApprovalError(error instanceof Error ? error.message : 'Could not create vendor capture approval.')
    } finally {
      setIsCreatingVendorCaptureApproval(false)
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
    setMessages((currentMessages) => updateApprovalMessageState(
      currentMessages,
      approvalId,
      status,
      updatedApproval
    ))
  }

  /**
   * Adds an approval request created from a recommendation action into the
   * visible planner timeline so the Approvals tab reflects the backend row
   * immediately.
   */
  function handleApprovalCreated(message: PlanMessage) {
    setMessages((currentMessages) => {
      if (currentMessages.some((currentMessage) => currentMessage.id === message.id)) {
        return currentMessages
      }

      return [...currentMessages, message]
    })
    setActiveTab('approvals')
  }

  /**
   * Opens the inline signup gate and records the attempted conversion action.
   */
  function requestSignupForAction(action: PendingConversionAction) {
    setSignupGateContext(action.payload?.reason === 'recommendations' ? 'recommendations' : 'default')
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

      const shouldRunRecommendations =
        migratedPlan.needs_recommendations === true ||
        (migratedPlan.plan.status === 'ready' && !migratedPlan.messages.some(isRecommendationMessage))
      if (shouldRunRecommendations) {
        void triggerRecommendations(migratedPlan.plan.id, migratedPlan.messages)
      }
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

    if (action.type === 'authorize' && payload.approvalId && isUuid(payload.approvalId)) {
      if (!payload.expectedSnapshotHash) {
        throw new Error('Open the approval and review its latest snapshot before authorizing.')
      }
      const response = await fetch(`/api/planner/plans/${planId}/approvals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          approvalId: payload.approvalId,
          command: 'authorize',
          expectedSnapshotHash: payload.expectedSnapshotHash,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as { error?: string; message?: string; billingRequired?: boolean }))
        if (billingGate.handleBillingRequiredResponse(response, payload)) {
          throw new Error('Choose a billing path to continue.')
        }
        throw new Error('Authorization failed — try again')
      }
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
      const payload = await response.json().catch(() => ({} as { error?: string; message?: string; billingRequired?: boolean }))
      if (billingGate.handleBillingRequiredResponse(response, payload)) {
        throw new Error('Choose a billing path to continue.')
      }
      throw new Error(action.type === 'authorize' ? 'Authorization failed — try again' : 'Failed to create hold request — try again')
    }
  }

  const organizationName = getPlannerOrganizationName(plannerAccount)
  const plannerRoleLabel = getPlannerRoleLabel(plannerAccount)
  const shouldShowInitialDraftLoading = isStartingInitialDraft && !activePlan
  const gmailSkipReminder = showGmailSkipReminder ? (
    <div className="mx-auto mb-4 max-w-5xl px-4 lg:px-6">
      <div className="flex flex-col gap-3 rounded-md border border-ochre bg-ochre-tint px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-clay-deep" />
          <p>Connect Gmail in Settings to start sending outreach.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <a href="/planner/settings/integrations">Open integrations</a>
          </Button>
          <button
            type="button"
            onClick={dismissGmailSkipReminder}
            aria-label="Dismiss Gmail reminder"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-cream hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  ) : null

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
      <div className="min-h-screen">
        <PlannerTopBar userName={organizationName} userRole={plannerRoleLabel} />
        {gmailSkipReminder}
        {persistenceMode === 'server' ? <PlannerBillingAccessBanner /> : null}
        <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
          {shouldShowInitialDraftLoading ? (
            <PlannerInitialDraftLoading />
          ) : (
            <>
              {errorMessage ? (
                <div className="mx-auto mb-4 max-w-3xl rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
              <PlannerEmptyState
                onSubmit={handleCreatePlan}
                isSubmitting={isCreatingPlan || persistenceMode === 'loading' || !hasLoadedStoredConversation}
                className="min-h-[calc(100vh-8rem)] py-8"
                title="What should we plan next?"
                description={`Describe the next event for ${organizationName}. I'll start a new plan without booking, paying, or sending anything until you approve it.`}
                showTrustSignals={false}
                onRebook={() => void openTemplatesModal('rebook')}
                isRebookDisabled={persistenceMode === 'loading' || !hasLoadedStoredConversation}
              />
              <PlannerTemplatesModal
                isOpen={isTemplatesModalOpen}
                mode={templatesModalMode}
                templates={plannerTemplates}
                isLoading={isLoadingTemplates}
                error={templateError}
                applyingTemplateId={applyingTemplateId}
                isSavingTemplate={isSavingTemplate}
                canSaveCurrentPlan={false}
                onClose={() => {
                  setIsTemplatesModalOpen(false)
                  setTemplatesModalMode('apply')
                }}
                onRefresh={() => void loadPlannerTemplates()}
                onApply={(templateId, options) => void applyPlannerTemplate(templateId, options)}
                onSaveCurrentPlan={() => void saveActivePlanAsTemplate()}
              />
            </>
          )}
        </div>
        <PlannerSignupGate
          isOpen={isSignupGateOpen}
          onClose={() => setIsSignupGateOpen(false)}
          onSignedIn={(plan) => void handlePlannerGateSignedIn(plan)}
          context={signupGateContext}
        />
        {billingGate.modal}
      </div>
    )
  }

  const recommendationMessages = messages.filter(isRecommendationMessage)
  const approvalMessages = messages.filter(isApprovalMessage)
  const visibleMessages = getVisibleMessages(messages, activeTab)
  const approvalSummary = getApprovalSummary(approvalMessages)
  const activeTabLabel = planTabs.find((tab) => tab.id === activeTab)?.label ?? 'Chat'
  const activeDateChip = getActivePlanDateChip(activePlan, messages)
  const eventRecordHref =
    persistenceMode === 'server' && activePlan.id && !activePlan.id.startsWith('mock-plan-')
      ? `/planner/experiences/${activePlan.id}`
      : null
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
      <PlannerTopBar userName={organizationName} userRole={plannerRoleLabel} />
      {gmailSkipReminder}
      {persistenceMode === 'server' ? <PlannerBillingAccessBanner /> : null}

      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-border bg-card/50 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary">{organizationName}</p>
            <h1 className="mt-1 break-words font-display text-xl font-bold leading-tight sm:text-2xl">{activePlan.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">Active planner workspace</p>
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
            {eventRecordHref ? (
              <Button type="button" variant="glass" size="sm" onClick={() => router.push(eventRecordHref)}>
                <FileText className="h-4 w-4" />
                Event record
              </Button>
            ) : null}
            <Button type="button" variant="glass" size="sm" disabled={isStartingNewPlan} onClick={() => void handleNewPlan()}>
              {isStartingNewPlan ? 'Starting...' : 'New plan'}
            </Button>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-border bg-card/40 p-1">
          {planTabs.map((tab) => {
            if (tab.id === 'timeline' && persistenceMode !== 'server') return null
            if (tab.id === 'data' && persistenceMode !== 'server') return null
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
                    onApprovalCreated={handleApprovalCreated}
                    onToast={addToast}
                    onQuestionAnswerSubmit={(answer) => void submitReply(answer)}
                    onNavigateToTab={navigateToPlannerTab}
                    onBillingRequired={billingGate.openBillingGate}
                  />
                ))}
                {isAwaitingRecommendations ? (
                  <div className="flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Matching venues and vendors…
                  </div>
                ) : null}
                {persistenceMode === 'draft' && hasDraftMatchGateMessage(messages) ? (
                  <DraftMatchSignupCard onContinue={() => requestSignupForAction({ type: 'save', payload: { reason: 'recommendations' } })} />
                ) : null}
              </>
            ) : null}

            {activeTab === 'recommendations' ? (
              <>
                {persistenceMode === 'server' ? (
                  <PostEventReportCard plan={activePlan} />
                ) : null}
                {visibleMessages.length > 0 ? (
                  visibleMessages.map((message) => (
                    <PlannerFocusedMessageCard
                      key={message.id}
                      message={message}
                      planId={activePlan.id}
                      isAuthenticated={isAuthenticated}
                      onAuthRequired={requestSignupForAction}
                      onApprovalStatusChange={handleApprovalStatusChange}
                      onApprovalCreated={handleApprovalCreated}
                      onToast={addToast}
                      onQuestionAnswerSubmit={(answer) => void submitReply(answer)}
                      onBillingRequired={billingGate.openBillingGate}
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
                  {approvalSummary.pending} pending · {approvalSummary.authorized} authorized · {approvalSummary.executing} executing · {approvalSummary.succeeded} succeeded
                  {approvalSummary.failed > 0 ? ` · ${approvalSummary.failed} failed` : ''}
                  {approvalSummary.expired > 0 ? ` · ${approvalSummary.expired} expired` : ''}
                  {approvalSummary.reapproval_required > 0 ? ` · ${approvalSummary.reapproval_required} need re-approval` : ''}
                  {approvalSummary.cancelled + approvalSummary.rejected > 0 ? ` · ${approvalSummary.cancelled + approvalSummary.rejected} closed` : ''}
                  {approvalSummary.superseded > 0 ? ` · ${approvalSummary.superseded} superseded` : ''}
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
                      onBillingRequired={billingGate.openBillingGate}
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
              <PlannerTimelineCountdown
                plan={activePlan}
                messages={messages}
                agentActions={agentActions}
                timeline={timelineResult}
                isLoading={isTimelineLoading}
                error={timelineError}
                onRefresh={() => void loadPlannerTimeline()}
                onNavigateToTab={navigateToPlannerTab}
              />
            ) : null}

            {activeTab === 'data' && persistenceMode === 'server' ? (
              <PlannerDataConnectionPanel plan={activePlan} />
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
                      onChange={(event) => {
                        setReply(event.target.value)
                        const el = event.target
                        // Baseline (~5rem) fits the placeholder cleanly even at
                        // narrow viewports where it wraps to two lines, so the
                        // textarea never changes height between empty and typed
                        // states unless the content genuinely overflows.
                        const baseline = 80
                        el.style.height = 'auto'
                        el.style.height = `${Math.max(baseline, el.scrollHeight)}px`
                      }}
                      onKeyDown={handleReplyKeyDown}
                      name="reply"
                      rows={2}
                      className="relative z-10 h-20 max-h-48 min-h-20 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 focus-visible:ring-0"
                      placeholder="Reply with details…"
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Partner type</span>
                          {(['venue', 'vendor'] as const).map((partnerType) => (
                            <button
                              key={partnerType}
                              type="button"
                              onClick={() => {
                                setReplyAnalysisPartnerType(partnerType)
                                setReplyAnalysisResult(null)
                                setVendorCaptureApprovalError(null)
                                setVendorCaptureApprovalMessage(null)
                              }}
                              className={cn(
                                'rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest transition-smooth',
                                replyAnalysisPartnerType === partnerType
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-background/70 text-muted-foreground hover:text-foreground'
                              )}
                            >
                              {partnerType}
                            </button>
                          ))}
                        </div>
                        <Textarea
                          value={replyAnalysisText}
                          onChange={(event) => {
                            setReplyAnalysisText(event.target.value)
                            setVendorCaptureApprovalError(null)
                            setVendorCaptureApprovalMessage(null)
                          }}
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
                          <ReplyAnalysisResult
                            result={replyAnalysisResult}
                            partnerType={replyAnalysisPartnerType}
                            isCreatingApproval={isCreatingVendorCaptureApproval}
                            approvalError={vendorCaptureApprovalError}
                            approvalMessage={vendorCaptureApprovalMessage}
                            onCreateApproval={replyAnalysisPartnerType === 'vendor' ? () => void createVendorCaptureApproval() : undefined}
                          />
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
        context={signupGateContext}
      />
      <PlannerTemplatesModal
        isOpen={isTemplatesModalOpen}
        mode={templatesModalMode}
        templates={plannerTemplates}
        isLoading={isLoadingTemplates}
        error={templateError}
        applyingTemplateId={applyingTemplateId}
        isSavingTemplate={isSavingTemplate}
        canSaveCurrentPlan={persistenceMode === 'server' && Boolean(activePlan) && !activePlan?.id.startsWith('mock-plan-')}
        onClose={() => {
          setIsTemplatesModalOpen(false)
          setTemplatesModalMode('apply')
        }}
        onRefresh={() => void loadPlannerTemplates()}
        onApply={(templateId, options) => void applyPlannerTemplate(templateId, options)}
        onSaveCurrentPlan={() => void saveActivePlanAsTemplate()}
      />
      {billingGate.modal}
    </div>
  )
}

/**
 * Keeps a message-backed approval pointed at its newest immutable row so the
 * next command cannot accidentally target the superseded approval id.
 */
export function updateApprovalMessageState(
  currentMessages: PlanMessage[],
  approvalId: string,
  status: ApprovalUiStatus,
  updatedApproval?: Record<string, unknown>
) {
  let didUpdate = false
  const nextMessages = currentMessages.map((message) => {
    if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
      return message
    }

    const approval = message.metadata.approval
    if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
      return message
    }

    const storedApprovalId = typeof approval.id === 'string' ? approval.id : message.id
    if (storedApprovalId !== approvalId) return message
    didUpdate = true

    const nextApprovalId = typeof updatedApproval?.id === 'string' ? updatedApproval.id : storedApprovalId
    const nextStatus = typeof updatedApproval?.status === 'string' ? updatedApproval.status : status
    const nextUiStatus = typeof updatedApproval?.ui_status === 'string' ? updatedApproval.ui_status : status

    return {
      ...message,
      metadata: {
        ...message.metadata,
        status: nextStatus,
        ui_status: nextUiStatus,
        approval: {
          ...approval,
          ...(updatedApproval ?? {}),
          id: nextApprovalId,
          status: nextStatus,
          ui_status: nextUiStatus,
        },
      } as unknown as PlanMessage['metadata'],
    }
  })

  return didUpdate ? nextMessages : currentMessages
}

function PlannerInitialDraftLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="planner-initial-draft-loading"
      className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8"
    >
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-clay text-cream shadow-card">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-clay-deep">Starting plan</p>
        <h1 className="mt-3 text-balance font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">
          Building your event plan.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-base leading-relaxed text-ink-soft">
          Using the event you just described. Nothing books, pays, or sends until you approve it.
        </p>
      </div>
    </div>
  )
}
