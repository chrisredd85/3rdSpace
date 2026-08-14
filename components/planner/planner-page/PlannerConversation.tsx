'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PlannerDepositExecution } from '@/components/payments/PlannerDepositExecution'
import {
  getApprovalPresentation,
  readApprovalUiState,
  type ApprovalPresentationTone,
} from '@/components/planner/approvalPresentation'
import { formatCentsToDollars, parseDollarsToCents } from '@/lib/money'
import {
  type ApprovalUiAction,
  type ApprovalUiStatus,
} from '@/lib/planner/approvalUiState'
import { readExternalCheckoutHandoffEvidence } from '@/lib/planner/execution/externalCheckout'
import type { Plan, PlanMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatMockCents } from './draftMode'
import { readNarrationChipMetadata } from './plannerState'
import type { BillingRequiredHandler, PendingConversionAction, PlannerAgentActionRequest, PlannerTab } from './types'

type ApprovalStatusChangeHandler = (
  approvalId: string,
  status: ApprovalUiStatus,
  updatedApproval?: Record<string, unknown>
) => void

interface PlannerMessageBubbleProps {
  message: PlanMessage
  isSupersededConfirmation?: boolean
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onBillingRequired?: BillingRequiredHandler
  onApprovalStatusChange: ApprovalStatusChangeHandler
  onApprovalCreated?: (message: PlanMessage) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
  onNavigateToTab?: (tab: PlannerTab, messageId?: string) => void
}

export function DraftMatchSignupCard({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="rounded-lg border border-clay/30 bg-cream-deep p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-clay-deep">
            <Sparkles className="h-4 w-4" />
            Free draft complete
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Create a planner account to save this event, access the details later, and continue into
            real venue matches, vendor picks, financial projections, and approval cards.
          </p>
        </div>
        <Button type="button" className="shrink-0 rounded-md" onClick={onContinue}>
          Sign up to continue
        </Button>
      </div>
    </div>
  )
}

/**
 * Renders a single planner message returned by the Agent Planner API.
 */
export function PlannerMessageBubble({
  message,
  isSupersededConfirmation = false,
  planId,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onApprovalStatusChange,
  onApprovalCreated,
  onToast,
  onQuestionAnswerSubmit,
  onNavigateToTab,
}: PlannerMessageBubbleProps) {
  const isUser = message.role === 'user'
  const messageTime = formatMessageTime(message.created_at)
  const hasStructuredQuestion = messageHasStructuredQuestion(message)
  const narrationChip = readNarrationChipMetadata(message)

  if (narrationChip) {
    return (
      <div className="flex w-full justify-start">
        <button
          type="button"
          onClick={() => onNavigateToTab?.(narrationChip.target_tab, narrationChip.target_msg_id)}
          disabled={!onNavigateToTab}
          className="group flex max-w-full items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-left text-xs font-semibold text-primary transition hover:border-primary hover:bg-primary/20 disabled:cursor-default disabled:opacity-70"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="truncate">{message.content}</span>
          <span aria-hidden className="ml-1 text-primary/70 transition group-hover:translate-x-0.5">→</span>
        </button>
      </div>
    )
  }

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
              onBillingRequired={onBillingRequired}
              onApprovalStatusChange={onApprovalStatusChange}
              onApprovalCreated={onApprovalCreated}
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
export function CollapsedConfirmationCard({ message, messageTime }: { message: PlanMessage; messageTime: string }) {
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
export function PlanSummaryChips({ plan }: PlanSummaryChipsProps) {
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
  onBillingRequired?: BillingRequiredHandler
  onApprovalStatusChange: ApprovalStatusChangeHandler
  onApprovalCreated?: (message: PlanMessage) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
}

/**
 * Focused non-chat card used by Plan and Recommendations tabs.
 */
export function PlannerFocusedMessageCard({
  message,
  isSupersededConfirmation = false,
  planId,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onApprovalStatusChange,
  onApprovalCreated,
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
    <article
      data-plan-message-id={message.id}
      className="min-w-0 rounded-2xl border border-border bg-background/60 p-4"
    >
      {!hasStructuredQuestion ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.content}</p>
      ) : null}
      <PlannerMessageMetadata
        message={message}
        planId={planId}
        isAuthenticated={isAuthenticated}
        onAuthRequired={onAuthRequired}
        onBillingRequired={onBillingRequired}
        onApprovalStatusChange={onApprovalStatusChange}
        onApprovalCreated={onApprovalCreated}
        onToast={onToast}
        onQuestionAnswerSubmit={onQuestionAnswerSubmit}
      />
    </article>
  )
}

/**
 * Focused approval-only card used by the Approvals tab.
 */
export function PlannerApprovalFocusedCard({
  message,
  planId,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onApprovalStatusChange,
  onToast,
}: PlannerFocusedMessageCardProps) {
  const approval = getMessageApproval(message)

  if (!approval) {
    return (
      <article
        data-plan-message-id={message.id}
        className="min-w-0 rounded-2xl border border-border bg-background/60 p-4"
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.content}</p>
      </article>
    )
  }

  return (
    <div data-plan-message-id={message.id}>
      <PlannerApprovalCard
        planId={planId}
        approvalId={typeof approval.id === 'string' ? approval.id : message.id}
        approval={buildApprovalDisplayMetadata(message.metadata, approval)}
        isAuthenticated={isAuthenticated}
        onAuthRequired={onAuthRequired}
        onBillingRequired={onBillingRequired}
        onStatusChange={onApprovalStatusChange}
        onToast={onToast}
      />
    </div>
  )
}

/**
 * Builds the reactive date chip for the active-plan header.
 */
export function getActivePlanDateChip(plan: Plan, messages: PlanMessage[]): { label: string; status: 'pending' | 'set' | 'confirmed' } {
  const parsedDate = getLatestConfirmationDate(messages)
  if (parsedDate) return { label: parsedDate, status: 'confirmed' }
  if (plan.date_window_start) return { label: formatPlanDateWindow(plan), status: 'set' }
  return { label: 'Date pending', status: 'pending' }
}

/**
 * Reads the latest human-friendly date string from confirmation card metadata.
 */
export function getLatestConfirmationDate(messages: PlanMessage[]) {
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
export function formatPlanDateWindow(plan: Plan) {
  if (!plan.date_window_start) return '—'
  if (!plan.date_window_end || plan.date_window_end === plan.date_window_start) return plan.date_window_start
  return `${plan.date_window_start} → ${plan.date_window_end}`
}

/**
 * Counts approval messages without collapsing failed, expired, or in-flight states.
 */
export function getApprovalSummary(approvalMessages: PlanMessage[]) {
  return approvalMessages.reduce(
    (summary, message) => {
      const status = getApprovalMessageStatus(message)
      summary[status] += 1

      return summary
    },
    {
      pending: 0,
      authorized: 0,
      executing: 0,
      succeeded: 0,
      failed: 0,
      expired: 0,
      reapproval_required: 0,
      rejected: 0,
      cancelled: 0,
      superseded: 0,
    } satisfies Record<ApprovalUiStatus, number>
  )
}

/**
 * Reads approval status from message metadata, defaulting to pending.
 */
export function getApprovalMessageStatus(message: PlanMessage) {
  const metadata = getMessageMetadata(message)
  const approval = getMessageApproval(message)
  return readApprovalStatus({
    ...(approval ?? {}),
    ui_status: approval?.ui_status ?? metadata?.ui_status,
    status: approval?.status ?? metadata?.status,
    action_status: approval?.action_status ?? metadata?.action_status,
    expires_at: approval?.expires_at ?? metadata?.expires_at,
  })
}

/**
 * Safely reads object metadata from a planner message.
 */
export function getMessageMetadata(message: PlanMessage): Record<string, unknown> | null {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    return null
  }

  return message.metadata as Record<string, unknown>
}

/**
 * Safely reads approval metadata from a planner message.
 */
export function getMessageApproval(message: PlanMessage): Record<string, unknown> | null {
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
export function buildApprovalDisplayMetadata(
  metadata: PlanMessage['metadata'],
  approval: Record<string, unknown>
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return approval

  return {
    ...approval,
    action_type: metadata.action_type,
    execution_mode: metadata.execution_mode,
    ui_status: approval.ui_status ?? metadata.ui_status,
    action_status: approval.action_status ?? metadata.action_status,
    action_result: approval.action_result ?? metadata.action_result,
    available_actions: approval.available_actions ?? metadata.available_actions,
    confirmation_snapshot: approval.confirmation_snapshot ?? metadata.confirmation_snapshot,
    kind: metadata.kind,
    venue_ids: metadata.venue_ids,
    vendor_ids: metadata.vendor_ids,
    projected_costs_cents: metadata.projected_costs_cents,
    requires_user_action: metadata.requires_user_action,
    summary: metadata.summary,
    response_deadline: metadata.response_deadline,
    opportunity: metadata.opportunity,
    invites: metadata.invites,
    partner_targets: metadata.partner_targets,
    comparison_goal: metadata.comparison_goal,
    invite_stats: metadata.invite_stats,
    queued_invite_count: metadata.queued_invite_count,
    queued_vendor_invite_count: metadata.queued_vendor_invite_count,
    deposit_proposals: metadata.deposit_proposals,
  }
}

/**
 * Returns true when a planner message should render as a structured question card.
 */
export function messageHasStructuredQuestion(message: PlanMessage) {
  const metadata = getMessageMetadata(message)
  return Array.isArray(metadata?.questions) && metadata.questions.length > 0
}

export function formatMessageTime(createdAt: string): string {
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
  onBillingRequired?: BillingRequiredHandler
  onApprovalStatusChange: ApprovalStatusChangeHandler
  onApprovalCreated?: (message: PlanMessage) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
  onQuestionAnswerSubmit?: (answer: string) => void
}

/**
 * Renders small structured details for confirmation and recommendation messages.
 */
export function PlannerMessageMetadata({
  message,
  planId,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onApprovalStatusChange,
  onApprovalCreated,
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
  const economicsPrompt = readRecommendationEconomicsPrompt(message.metadata)
  const economicsDetails = readRecommendationEconomicsDetails(message.metadata)
  const economicsGate = readRecommendationEconomicsGate(message.metadata)
  const byoVendors = readRecommendationByoVendors(message.metadata)

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
            <div className="space-y-3 rounded-2xl border border-border bg-background/50 p-4">
              {matchedArchetype ? (
                <span className="inline-block rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Matched: {matchedArchetype}
                </span>
              ) : null}
              {(['required', 'recommended', 'optional', 'conditional'] as const).map((tier) => {
                const tierGroups = vendorStackGroups.filter((g) => g.necessity === tier)
                if (tierGroups.length === 0) return null
                const tierLabel: Record<string, string> = {
                  required: 'Required',
                  recommended: 'Recommended',
                  optional: 'Optional',
                  conditional: 'Conditional',
                }
                const tierColor: Record<string, string> = {
                  required: 'border-destructive/40 bg-destructive/10 text-destructive',
                  recommended: 'border-success/40 bg-success/10 text-success',
                  optional: 'border-border bg-muted text-muted-foreground',
                  conditional: 'border-warning/40 bg-warning/10 text-warning',
                }
                return (
                  <div key={tier}>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{tierLabel[tier]}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tierGroups.map((group) => (
                        <span
                          key={`${group.necessity}-${group.service_type}`}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium capitalize ${tierColor[tier]}`}
                        >
                          {group.service_type.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
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
            const reasonBullets = buildRecommendationReasonBullets(
              recommendation as Record<string, unknown>,
              archetypeReasons,
              note
            )
            const priceCents = typeof recommendation.price_cents === 'number' ? recommendation.price_cents : 0
            const capacity = typeof recommendation.capacity === 'number' ? recommendation.capacity : null
            const capacityKnown = typeof recommendation.capacity_known === 'boolean' ? recommendation.capacity_known : capacity !== null
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
                <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{fit}</p>
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
                  ) : !capacityKnown ? (
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground">Capacity</span>
                      <span className="shrink-0 font-semibold text-foreground">TBD — confirm</span>
                    </div>
                  ) : null}
                  {commercialModelMatch ? (
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="text-muted-foreground">Model</span>
                      <span className="shrink-0 font-semibold text-foreground">{commercialModelMatch.replace(/_/g, ' ')}</span>
                    </div>
                  ) : null}
                </div>
                {reasonBullets.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-border bg-card/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Why this fits
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                      {reasonBullets.slice(0, 3).map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span className="min-w-0 break-words">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
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
                <PlannerRecommendationActionButton
                  planId={planId}
                  isAuthenticated={isAuthenticated}
                  onAuthRequired={onAuthRequired}
                  onBillingRequired={onBillingRequired}
                  onApprovalCreated={onApprovalCreated}
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

      {byoVendors.length > 0 ? (
        <div className="rounded-2xl border border-border bg-background/50 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Yours (BYO)</p>
            <p className="text-xs font-medium text-muted-foreground">
              Folded into your projection
            </p>
          </div>
          <ul className="mt-2 space-y-1.5">
            {byoVendors.map((vendor) => (
              <li key={`${vendor.service_type}:${vendor.name ?? ''}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {vendor.name ?? formatByoServiceType(vendor.service_type)}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    {formatByoServiceType(vendor.service_type)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-foreground">
                  {typeof vendor.cost_cents === 'number' ? formatMockCents(vendor.cost_cents) : 'Cost TBD'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {economicsGate ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-destructive">
              Pricing check — needs your call
            </p>
            <p className="text-xs font-medium text-destructive/80">
              Loss of {formatMockCents(economicsGate.projected_loss_cents)} at full sell-through
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            At your stated {formatMockCents(economicsGate.stated_price_cents)}/ticket, costs ({formatMockCents(economicsGate.total_costs_cents)}) outrun ticket revenue. Pick a path so I can re-plan against a budget that works:
          </p>
          <div className="mt-3 grid gap-2">
            {economicsGate.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  if (onQuestionAnswerSubmit) onQuestionAnswerSubmit(option.action_message)
                }}
                disabled={!onQuestionAnswerSubmit}
                className="group flex flex-col gap-1 rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-foreground">{option.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{option.sub}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {economicsPrompt ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-warning">
            {economicsPrompt.economics_placeholder ? 'Unit economics pending' : 'Improve this projection'}
          </p>
          <div className="mt-2 space-y-2 text-sm leading-relaxed text-foreground">
            {economicsPrompt.economics_placeholder ? <p>{economicsPrompt.economics_placeholder}</p> : null}
            {economicsPrompt.ticketing_platform_prompt ? <p>{economicsPrompt.ticketing_platform_prompt}</p> : null}
          </div>
        </div>
      ) : null}

      {!economicsPrompt?.economics_placeholder && economicsDetails ? (
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
          {economicsDetails.estimate_note ? (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium leading-snug text-warning">
              {economicsDetails.estimate_note}
            </p>
          ) : null}
          {economicsDetails.risk_flags.length > 0 ? (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium leading-snug text-destructive">
              {economicsDetails.risk_flags.slice(0, 2).map((flag) => (
                <p key={flag}>{flag}</p>
              ))}
            </div>
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
          onBillingRequired={onBillingRequired}
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
export function PlannerStructuredQuestionCard({
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
export function readQuestionText(question: Record<string, unknown>, key: string) {
  const value = question[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads selectable answers from structured question metadata.
 */
export function readQuestionOptions(question: Record<string, unknown>): PlannerQuestionOption[] {
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
export function formatStructuredQuestionReply(question: Record<string, unknown>, answer: string) {
  const label = readQuestionText(question, 'label') || 'Answer'
  return `${label}: ${answer}`
}

interface PlannerRecommendationActionButtonProps {
  planId: string
  isAuthenticated: boolean
  onAuthRequired: (action: PendingConversionAction) => void
  onBillingRequired?: BillingRequiredHandler
  onApprovalCreated?: (message: PlanMessage) => void
  recommendation: Record<string, unknown>
  label: string
  variant: 'hero' | 'glass'
}

type RecommendationActionKind = 'hold' | 'vendor' | 'payment' | 'external'

/**
 * Converts recommendation CTAs into approval-backed agent actions instead of placeholder links.
 */
export function PlannerRecommendationActionButton({
  planId,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onApprovalCreated,
  recommendation,
  label,
  variant,
}: PlannerRecommendationActionButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const actionKind = getRecommendationActionKind(label, recommendation)
  const isComplete = Boolean(statusMessage)
  const buttonLabel = isComplete ? 'Approval created ✓' : getCompactRecommendationActionLabel(actionKind)

  async function handleActionClick() {
    setErrorMessage(null)

    const externalUrl = readRecommendationString(recommendation, 'external_url')
    const agentActionPayload = buildRecommendationAgentActionPayload(actionKind, recommendation)

    if (actionKind === 'external' && !isRealExternalUrl(externalUrl)) {
      setErrorMessage('This checkout link is not ready yet.')
      return
    }

    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      onAuthRequired({
        type: actionKind === 'payment' ? 'authorize' : 'hold',
        payload: {
          agentAction: agentActionPayload,
          externalUrl: actionKind === 'external' && isRealExternalUrl(externalUrl) ? externalUrl : undefined,
        },
      })
      return
    }

    setIsLoading(true)

    try {
      if (!planId.startsWith('mock-plan-')) {
        const response = await fetch(`/api/planner/plans/${planId}/agent-actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentActionPayload),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({} as { error?: string; message?: string; billingRequired?: boolean }))
          if (response.status === 402) {
            onBillingRequired?.(payload.error ?? payload.message)
            return
          }
          throw new Error('Failed to create agent action')
        }

        const payload = (await response.json().catch(() => ({}))) as { approvalMessage?: PlanMessage }
        if (payload.approvalMessage) onApprovalCreated?.(payload.approvalMessage)
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
export function getCompactRecommendationActionLabel(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return 'Request hold'
  if (actionKind === 'vendor') return 'Contact vendor'
  if (actionKind === 'payment') return 'Review deposit'
  return 'Approve link'
}

/**
 * Builds the agent-action POST body for a recommendation action.
 */
export function buildRecommendationAgentActionPayload(
  actionKind: RecommendationActionKind,
  recommendation: Record<string, unknown>
): PlannerAgentActionRequest {
  const provider = readRecommendationString(recommendation, 'name') || '3rdPlace recommendation'
  const priceCents = readRecommendationPriceCents(recommendation)
  const targetId = readRecommendationString(recommendation, 'id')
  const targetType = normalizeRecommendationTargetType(actionKind, recommendation)

  if (actionKind === 'payment') {
    return {
      actionType: 'payment',
      targetType,
      targetId: isUuid(targetId) ? targetId : null,
      requestedAmountCents: priceCents,
      payloadJson: {
        action_label: `Authorize ${provider} deposit`,
        provider,
        price_cents: priceCents,
        fees_cents: readRecommendationNumber(recommendation, 'fees_cents') ?? 0,
        package_details:
          readRecommendationString(recommendation, 'package_summary') ||
          readRecommendationString(recommendation, 'note') ||
          'Partner deposit',
        refund_terms: readRecommendationString(recommendation, 'refund_terms') || null,
        cancellation_terms: readRecommendationString(recommendation, 'cancellation_terms') || null,
        execution_mode: 'controlled_payment',
        has_controlled_payment_account: true,
        payment_required: true,
      },
    }
  }

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
      kind: 'external_checkout',
      action_label: 'External booking',
      provider,
      external_url: readRecommendationString(recommendation, 'external_url'),
      price_cents: priceCents,
      fees_cents: 0,
      package_details: readRecommendationString(recommendation, 'note') || 'External booking requires approval',
    },
  }
}

/**
 * Converts a draft approval card into the agent-action payload used after signup.
 */
export function buildApprovalAgentActionPayload(
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
  const requestedActionType = readApprovalString(approval, 'action_type')
  const executionMode = readApprovalString(approval, 'execution_mode')
  const isControlledPayment =
    requestedActionType === 'payment' || executionMode === 'controlled_payment'
  const targetId =
    readApprovalString(approval, 'target_id') ||
    readApprovalString(approval, `${targetType}_id`)

  return {
    actionType: isControlledPayment
      ? 'payment'
      : targetType === 'vendor'
        ? 'vendor_contact'
        : 'hold_request',
    targetType,
    targetId: isUuid(targetId) ? targetId : null,
    requestedAmountCents: amountCents,
    payloadJson: {
      action_label: label,
      provider,
      price_cents: amountCents,
      fees_cents: 0,
      package_details: packageDetails,
      execution_mode: isControlledPayment ? 'controlled_payment' : undefined,
      has_controlled_payment_account: isControlledPayment || undefined,
      payment_required: isControlledPayment || undefined,
      source: 'planner_signup_gate',
    },
  }
}

/**
 * Classifies a recommendation action by CTA label and recommendation type.
 */
export function getRecommendationActionKind(
  label: string,
  recommendation: Record<string, unknown>
): RecommendationActionKind {
  const normalizedLabel = label.toLowerCase()
  const normalizedType = readRecommendationString(recommendation, 'type').toLowerCase()
  const explicitControlledPayment =
    readRecommendationString(recommendation, 'execution_mode') === 'controlled_payment' ||
    readRecommendationBoolean(recommendation, 'has_controlled_payment_account') === true ||
    readRecommendationBoolean(recommendation, 'payment_required') === true

  if (
    explicitControlledPayment &&
    readRecommendationPriceCents(recommendation) > 0 &&
    (normalizedType.includes('venue') || normalizedType.includes('vendor'))
  ) return 'payment'

  if (normalizedLabel.includes('hold') || normalizedType === 'venue') return 'hold'
  if (normalizedLabel.includes('vendor') || normalizedType === 'vendor') return 'vendor'
  return 'external'
}

/**
 * Converts recommendation labels into the targetType values expected by agent actions.
 */
export function normalizeRecommendationTargetType(
  actionKind: RecommendationActionKind,
  recommendation: Record<string, unknown>
) {
  const rawType = readRecommendationString(recommendation, 'type').toLowerCase()
  if (rawType.includes('venue')) return 'venue'
  if (rawType.includes('vendor')) return 'vendor'
  if (rawType.includes('ticket')) return 'ticket'
  if (actionKind === 'hold') return 'venue'
  if (actionKind === 'vendor') return 'vendor'
  if (actionKind === 'payment') {
    return readRecommendationString(recommendation, 'type').toLowerCase().includes('vendor')
      ? 'vendor'
      : 'venue'
  }
  return 'external'
}

/**
 * Returns the success copy for a recommendation action.
 */
export function getRecommendationSuccessMessage(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return '✓ Hold approval created — review before the request is sent'
  if (actionKind === 'vendor') return '✓ Vendor-contact approval created — review before outreach begins'
  if (actionKind === 'payment') return '✓ Deposit approval card created'
  return '✓ Checkout approval created — review before the link unlocks'
}

/**
 * Returns the failure copy for a recommendation action.
 */
export function getRecommendationErrorMessage(actionKind: RecommendationActionKind) {
  if (actionKind === 'hold') return 'Failed to create hold request — try again'
  if (actionKind === 'vendor') return 'Failed to add vendor request — try again'
  if (actionKind === 'payment') return 'Failed to create deposit approval — try again'
  return 'Failed to flag external booking — try again'
}

/**
 * Prevents internal ranking/context strings from leaking into user-facing cards.
 */
export function sanitizeRecommendationDisplayText(value: string, recommendation: Record<string, unknown>) {
  if (!value) return ''
  if (!/Filter by capacity|Ticketing model:|Food \+ beverage:|Food responsibility:|Vendor needs?:|Agent action:/i.test(value)) {
    return value
  }

  const type = readRecommendationString(recommendation, 'type') || 'Option'
  const name = readRecommendationString(recommendation, 'name') || 'This option'
  const capacity = readRecommendationNumber(recommendation, 'capacity')
  const capacityKnown = readRecommendationBoolean(recommendation, 'capacity_known')
  const capacityLabel = capacity
    ? ` with capacity for ${capacity}`
    : capacityKnown === false
      ? ' with capacity still to confirm'
      : ''

  if (/venue/i.test(type)) {
    return `${name} is the best current venue fit${capacityLabel}. It is matched on the stated budget, required setup, and booking terms.`
  }

  if (/vendor/i.test(type)) {
    return `${name} is the best current vendor fit. It is scoped to the stated requirements and budget before outreach.`
  }

  return `${name} is matched on the stated event requirements and budget.`
}

export function buildRecommendationReasonBullets(
  recommendation: Record<string, unknown>,
  archetypeReasons: string[],
  note: string
): string[] {
  const sourceSentences = [
    ...archetypeReasons,
    ...splitRecommendationSentences(note),
  ]
  const seen = new Set<string>()
  const bullets: string[] = []

  for (const sentence of sourceSentences) {
    const cleaned = cleanRecommendationReason(sentence, recommendation)
    if (!cleaned) continue

    const normalized = cleaned.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    bullets.push(cleaned)
    if (bullets.length >= 3) break
  }

  return bullets
}

export function splitRecommendationSentences(value: string): string[] {
  return value.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
}

export function cleanRecommendationReason(value: string, recommendation: Record<string, unknown>): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  if (/Filter by capacity|Ticketing model:|Food \+ beverage:|Food responsibility:|Vendor needs?:|Agent action:/i.test(trimmed)) {
    return sanitizeRecommendationDisplayText(trimmed, recommendation)
  }
  if (/^\d+\/100\s+(vendor|venue)?\s*fit score\.?$/i.test(trimmed)) return null

  const scoreFitMatch = trimmed.match(/^(.+?) is a \d+-score ([\w\s/-]+?) fit with (.+)$/i)
  if (scoreFitMatch) {
    const service = scoreFitMatch[2]?.trim().replace(/\s+/g, ' ')
    const reason = sentenceCase(scoreFitMatch[3]?.replace(/\.$/, '') ?? '')
    return service ? `${reason} for ${service}.` : `${reason}.`
  }

  if (/^Response time needs confirmation\.?$/i.test(trimmed)) {
    return 'Confirm response time before outreach.'
  }

  return trimmed
}

export function sentenceCase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`
}

export function readRecommendationByoVendors(metadata: unknown): Array<{
  service_type: string
  name: string | null
  cost_cents: number | null
}> {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const raw = Array.isArray(root?.byo_vendors)
    ? root?.byo_vendors
    : Array.isArray(response?.byo_vendors)
      ? response?.byo_vendors
      : []
  return raw.flatMap((item) => {
    const record = readUnknownRecord(item)
    const serviceType = typeof record?.service_type === 'string' ? record.service_type : null
    if (!serviceType) return []
    const name = typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : null
    const cost = typeof record?.cost_cents === 'number' && Number.isFinite(record.cost_cents) ? record.cost_cents : null
    return [{ service_type: serviceType, name, cost_cents: cost }]
  })
}

const BYO_SERVICE_LABEL_OVERRIDES: Record<string, string> = {
  dj: 'DJ',
  av_production: 'AV / Production',
  music_coordinator: 'Music coordinator',
  check_in: 'Check-in',
}

export function formatByoServiceType(serviceType: string): string {
  const override = BYO_SERVICE_LABEL_OVERRIDES[serviceType]
  if (override) return override
  return serviceType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function readRecommendationEconomicsGate(metadata: unknown): {
  stated_price_cents: number
  projected_loss_cents: number
  total_costs_cents: number
  break_even_price_cents: number | null
  options: Array<{ id: string; label: string; sub: string; action_message: string }>
} | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const gate = readUnknownRecord(root?.economics_gate) ?? readUnknownRecord(response?.economics_gate)
  if (!gate) return null

  const stated = typeof gate.stated_price_cents === 'number' ? gate.stated_price_cents : null
  const loss = typeof gate.projected_loss_cents === 'number' ? gate.projected_loss_cents : null
  const totalCosts = typeof gate.total_costs_cents === 'number' ? gate.total_costs_cents : null
  if (stated === null || loss === null || totalCosts === null) return null

  const breakEven = typeof gate.break_even_price_cents === 'number' ? gate.break_even_price_cents : null
  const rawOptions = Array.isArray(gate.options) ? gate.options : []
  const options = rawOptions.flatMap((item) => {
    const record = readUnknownRecord(item)
    const id = typeof record?.id === 'string' ? record.id : null
    const label = typeof record?.label === 'string' ? record.label : null
    const sub = typeof record?.sub === 'string' ? record.sub : null
    const actionMessage = typeof record?.action_message === 'string' ? record.action_message : null
    if (!id || !label || !sub || !actionMessage) return []
    return [{ id, label, sub, action_message: actionMessage }]
  })
  if (options.length === 0) return null

  return {
    stated_price_cents: stated,
    projected_loss_cents: loss,
    total_costs_cents: totalCosts,
    break_even_price_cents: breakEven,
    options,
  }
}

export function readRecommendationEconomicsPrompt(metadata: unknown): {
  economics_placeholder: string | null
  ticketing_platform_prompt: string | null
} | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const economicsPlaceholder =
    readOptionalString(root?.economics_placeholder) ?? readOptionalString(response?.economics_placeholder)
  const ticketingPlatformPrompt =
    readOptionalString(root?.ticketing_platform_prompt) ?? readOptionalString(response?.ticketing_platform_prompt)

  if (!economicsPlaceholder && !ticketingPlatformPrompt) return null

  return {
    economics_placeholder: economicsPlaceholder,
    ticketing_platform_prompt: ticketingPlatformPrompt,
  }
}

export function readRecommendationMetadataArchetype(metadata: unknown): string | null {
  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const archetype = readUnknownRecord(root?.resolved_archetype) ?? readUnknownRecord(response?.resolved_archetype)
  const displayName = archetype?.display_name
  return typeof displayName === 'string' && displayName.trim() ? displayName : null
}

export function readVendorRecommendationGroups(metadata: unknown): Array<{
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

export function readRecommendationCapacityCalibration(metadata: unknown): {
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

export function readRecommendationEconomicsDetails(metadata: unknown): {
  narrative: string
  historical_anchor: string | null
  estimate_note: string | null
  recommended_price_cents: number
  risk_flags: string[]
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
  if (readRecommendationEconomicsPrompt(metadata)?.economics_placeholder) return null

  const root = readUnknownRecord(metadata)
  const response = readUnknownRecord(root?.recommendation_response)
  const economics = readUnknownRecord(root?.economics) ?? readUnknownRecord(response?.economics)
  const profitProjection = readUnknownRecord(root?.profit_projection) ?? readUnknownRecord(response?.profit_projection)
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
    estimate_note: readProjectionEstimateNote(profitProjection),
    recommended_price_cents: typeof economics.recommended_price_cents === 'number' ? economics.recommended_price_cents : 0,
    risk_flags: readStringArray(economics.risk_flags),
    price_points: pricePoints,
    elasticity: readEconomicsElasticity(root?.elasticity ?? response?.elasticity),
  }
}

export function readProjectionEstimateNote(profitProjection: Record<string, unknown> | null): string | null {
  if (!profitProjection) return null
  const accuracy = profitProjection.accuracy
  const notes = Array.isArray(profitProjection.assumption_notes)
    ? profitProjection.assumption_notes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
    : []

  if (notes.length > 0) return notes[0]
  if (accuracy === 'estimate_until_partner_quotes_confirmed') {
    return 'Projection is an estimate until venue and vendor quotes confirm final terms.'
  }
  return null
}

export function readEconomicsElasticity(value: unknown): {
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

export function readUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

export function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/**
 * Reads a string field from recommendation metadata.
 */
export function readRecommendationString(recommendation: Record<string, unknown>, key: string) {
  const value = recommendation[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Reads a number field from recommendation metadata.
 */
export function readRecommendationNumber(recommendation: Record<string, unknown>, key: string) {
  const value = recommendation[key]
  return typeof value === 'number' ? value : null
}

/**
 * Reads a boolean field from recommendation metadata.
 */
export function readRecommendationBoolean(recommendation: Record<string, unknown>, key: string) {
  const value = recommendation[key]
  return typeof value === 'boolean' ? value : null
}

/**
 * Reads the recommendation price in cents.
 */
export function readRecommendationPriceCents(recommendation: Record<string, unknown>) {
  return readRecommendationNumber(recommendation, 'price_cents') ?? 0
}

/**
 * Allows only real HTTPS external booking links and blocks placeholders.
 */
export function isRealExternalUrl(value: string) {
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
export function isUuid(value: string | null) {
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
  onBillingRequired?: BillingRequiredHandler
  onStatusChange: (approvalId: string, status: ApprovalUiStatus, updatedApproval?: Record<string, unknown>) => void
  onToast: (toast: { title?: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | 'destructive' }) => void
}

interface PlannerBillingSummary {
  tierLabel?: string
  canCreateEvent?: boolean
  can_create_event?: boolean
  freeEventsRemaining?: number
  free_events_remaining?: number
  isOnFreeTrial?: boolean
  is_on_free_trial?: boolean
  paidEventCredits?: number
  hasProAccess?: boolean
  prices?: {
    payPerEventAmount?: number
    proMonthlyAmount?: number
  }
}

interface ApprovalCommandResponse {
  approval?: Record<string, unknown>
  currentApproval?: Record<string, unknown>
  actionStatus?: string | null
  actionResult?: unknown
  confirmationSnapshot?: Record<string, unknown> | null
  uiStatus?: ApprovalUiStatus
  availableActions?: ApprovalUiAction[]
  code?: string
  error?: string
  message?: string
  retryable?: boolean
}

interface ExternalCheckoutConfirmationResponse {
  actionStatus?: string
  actionResult?: unknown
  uiStatus?: ApprovalUiStatus
  error?: string
  message?: string
}

class ApprovalCommandError extends Error {
  readonly responseStateApplied: boolean

  constructor(message: string, responseStateApplied: boolean) {
    super(message)
    this.name = 'ApprovalCommandError'
    this.responseStateApplied = responseStateApplied
  }
}

type ApprovalCardMode = 'view' | 'edit' | 'confirm_authorize' | 'confirm_cancel' | 'confirm_execution_cancel'

/**
 * Interactive approval card for booking, hold, and payment confirmation steps.
 */
export function PlannerApprovalCard({
  planId,
  approvalId,
  approval,
  isAuthenticated,
  onAuthRequired,
  onBillingRequired,
  onStatusChange,
  onToast,
}: PlannerApprovalCardProps) {
  const initialStatus = readApprovalStatus(approval)
  const [displayApproval, setDisplayApproval] = useState(approval)
  const [currentApprovalId, setCurrentApprovalId] = useState(approvalId)
  const [status, setStatus] = useState(initialStatus)
  const [availableActions, setAvailableActions] = useState<readonly ApprovalUiAction[]>(
    readApprovalAvailableActions(approval, initialStatus)
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [mode, setMode] = useState<ApprovalCardMode>('view')
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [amount, setAmount] = useState(formatApprovalAmountInput(readApprovalAmount(approval)))
  const [authorizedAmountCents, setAuthorizedAmountCents] = useState(readAuthorizedApprovalAmount(approval))
  const [eventDate, setEventDate] = useState(readApprovalEventDate(approval))
  const [notes, setNotes] = useState(readApprovalNotes(approval))
  const [actionResultMessage, setActionResultMessage] = useState<string | null>(readApprovalActionResultMessage(approval))
  const [isConfirmingExternalCheckout, setIsConfirmingExternalCheckout] = useState(false)
  const [billingAccess, setBillingAccess] = useState<'loading' | 'allowed' | 'required' | 'unknown'>(
    isAuthenticated ? 'loading' : 'unknown'
  )
  const [billingSummary, setBillingSummary] = useState<PlannerBillingSummary | null>(null)
  const retryKeysRef = useRef(new Map<string, string>())
  const executionCancelKeysRef = useRef(new Map<string, string>())

  useEffect(() => {
    const nextStatus = readApprovalStatus(approval)
    setDisplayApproval(approval)
    setCurrentApprovalId(approvalId)
    setStatus(nextStatus)
    setAvailableActions(readApprovalAvailableActions(approval, nextStatus))
    setAmount(formatApprovalAmountInput(readApprovalAmount(approval)))
    setAuthorizedAmountCents(readAuthorizedApprovalAmount(approval))
    setEventDate(readApprovalEventDate(approval))
    setNotes(readApprovalNotes(approval))
    setActionResultMessage(readApprovalActionResultMessage(approval))
    setMode('view')
  }, [approval, approvalId])

  useEffect(() => {
    if (!isAuthenticated) {
      setBillingAccess('unknown')
      setBillingSummary(null)
      return
    }

    let isCancelled = false
    setBillingAccess('loading')

    async function loadBillingAccess() {
      try {
        const response = await fetch('/api/builder/billing/status', { credentials: 'include' })
        if (!response.ok) {
          if (!isCancelled) setBillingAccess('unknown')
          return
        }

        const payload = (await response.json()) as { billing?: PlannerBillingSummary }
        if (isCancelled) return

        const billing = payload.billing ?? null
        setBillingSummary(billing)
        setBillingAccess(billing?.canCreateEvent === false ? 'required' : 'allowed')
      } catch {
        if (!isCancelled) setBillingAccess('unknown')
      }
    }

    void loadBillingAccess()

    return () => {
      isCancelled = true
    }
  }, [isAuthenticated])

  const label = readApprovalString(displayApproval, 'label') || readApprovalString(displayApproval, 'action_label') || 'Approval required'
  const provider = readApprovalCounterparty(displayApproval)
  const deliveryEmailRaw = readApprovalString(displayApproval, 'delivery_email')
  const deliveryEmail = deliveryEmailRaw ? 'Contact info on file' : 'Needed'
  const terms = readApprovalString(displayApproval, 'terms') || readApprovalString(displayApproval, 'refund_terms') || 'Approval required before payment.'
  const amountCents = readApprovalAmount(displayApproval)
  const snapshotHash = readApprovalSnapshotHash(displayApproval)
  const partnerTargets = readApprovalPartnerTargets(displayApproval)
  const venueNames = partnerTargets.filter((target) => target.kind === 'venue').map((target) => target.name)
  const vendorNames = partnerTargets.filter((target) => target.kind === 'vendor').map((target) => target.name)
  const fallbackVenueNames = venueNames.length === 0 && vendorNames.length === 0 ? readApprovalVenueNames(displayApproval) : []
  const briefPreview = readApprovalBriefPreview(displayApproval)
  const responseDeadline = readApprovalResponseDeadline(displayApproval)
  const comparisonGoal = readApprovalString(displayApproval, 'comparison_goal')
  const approvalKind = readApprovalString(displayApproval, 'kind')
  const isGmailOutreachApproval = approvalKind === 'gmail_approved_outreach'
  const isOutreachApproval = approvalKind === 'venue_outreach' || approvalKind === 'vendor_outreach' || isGmailOutreachApproval || /outreach/i.test(label)
  const isSendToPartners = isOutreachApproval || /send to (venues|vendors|partners)/i.test(label)
  const inviteStats = readApprovalInviteStats(displayApproval)
  const sentAt = inviteStats?.last_sent_at ? formatApprovalTimestamp(inviteStats.last_sent_at) : null
  const conciergeFollowupCount = inviteStats?.concierge_followup_count ?? 0
  const isProductGateLoading = isAuthenticated && billingAccess === 'loading'
  const isProductGateRequired = isAuthenticated && billingAccess === 'required'
  const freeEventsRemaining = billingSummary?.freeEventsRemaining ?? billingSummary?.free_events_remaining ?? 0
  const shouldShowFreeEventApprovalNotice = isOutreachApproval && !isProductGateRequired && freeEventsRemaining > 0
  const isControlledPaymentApproval = isControlledPaymentApprovalMetadata(
    displayApproval,
    amountCents,
    isOutreachApproval
  )
  const presentation = getApprovalPresentation(status)
  const externalCheckoutHandoffEvidence = readExternalCheckoutHandoffEvidence(
    displayApproval.action_result ?? displayApproval.actionResult
  )
  const externalCheckoutEvidence = externalCheckoutHandoffEvidence &&
    externalCheckoutHandoffEvidence.status !== 'cancelled' &&
    externalCheckoutHandoffEvidence.approval_id === currentApprovalId &&
    externalCheckoutHandoffEvidence.snapshot_hash === snapshotHash &&
    (status === 'executing' || status === 'succeeded')
      ? externalCheckoutHandoffEvidence
      : null
  const agentActionId = readApprovalString(displayApproval, 'agent_action_id')

  function requestSignupForAuthorization(nextAuthorizedAmountCents: number) {
    onAuthRequired({
      type: 'authorize',
      payload: {
        approvalId: currentApprovalId,
        authorizedAmountCents: nextAuthorizedAmountCents,
        expectedSnapshotHash: snapshotHash || undefined,
        agentAction: buildApprovalAgentActionPayload(displayApproval, nextAuthorizedAmountCents),
      },
    })
  }

  async function patchApproval(body: Record<string, unknown>): Promise<ApprovalCommandResponse> {
    const response = await fetch(`/api/planner/plans/${planId}/approvals`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as ApprovalCommandResponse & {
        billingRequired?: boolean
      }
      const responseStateApplied = hasApprovalResponseState(payload)
      if (responseStateApplied) applyApprovalResponse(payload)
      if (response.status === 402) {
        onBillingRequired?.(payload.error ?? payload.message)
        throw new ApprovalCommandError('Choose a billing path to continue.', responseStateApplied)
      }
      if (response.status === 409) {
        throw new ApprovalCommandError(
          payload.error ?? payload.message ?? 'This approval changed. Refresh and review the latest version.',
          responseStateApplied
        )
      }
      throw new ApprovalCommandError(
        payload.error ?? payload.message ?? 'Approval update failed',
        responseStateApplied
      )
    }

    return (await response.json()) as ApprovalCommandResponse
  }

  function applyApprovalResponse(payload: ApprovalCommandResponse, previousApprovalId = currentApprovalId) {
    const nextApproval = enrichApprovalResponse(displayApproval, payload)
    const nextApprovalId = readApprovalString(nextApproval, 'id') || previousApprovalId
    const nextStatus = payload.uiStatus ?? readApprovalStatus(nextApproval)
    const nextAvailableActions = payload.availableActions ?? readApprovalAvailableActions(nextApproval, nextStatus)

    setDisplayApproval(nextApproval)
    setCurrentApprovalId(nextApprovalId)
    setStatus(nextStatus)
    setAvailableActions(nextAvailableActions)
    setAmount(formatApprovalAmountInput(readApprovalAmount(nextApproval)))
    setAuthorizedAmountCents(readAuthorizedApprovalAmount(nextApproval))
    setEventDate(readApprovalEventDate(nextApproval))
    setNotes(readApprovalNotes(nextApproval))
    setActionResultMessage(readApprovalActionResultMessage(nextApproval))
    onStatusChange(previousApprovalId, nextStatus, nextApproval)

    return { nextApproval, nextApprovalId, nextStatus }
  }

  async function handleAuthorize() {
    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      requestSignupForAuthorization(amountCents)
      return
    }
    if (isProductGateRequired) {
      onBillingRequired?.('Choose how to keep planning before approving outreach.')
      return
    }
    if (isProductGateLoading) return
    if (!snapshotHash) {
      setInlineError('This approval is missing its confirmation snapshot. Refresh before authorizing.')
      return
    }

    setIsSubmitting(true)
    setInlineError(null)

    try {
      const payload = await patchApproval({
        approvalId: currentApprovalId,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      })
      const { nextStatus } = applyApprovalResponse(payload)
      setMode('view')
      onToast({
        title: nextStatus === 'failed' ? 'Execution failed' : 'Authorization recorded',
        description: nextStatus === 'failed'
          ? 'The exact snapshot remains retryable from this approval.'
          : '3rdPlace is using the exact amount, date, notes, and counterparty you confirmed.',
        variant: nextStatus === 'failed' ? 'error' : 'success',
      })
    } catch (error) {
      if (error instanceof ApprovalCommandError && error.responseStateApplied) setMode('view')
      setInlineError(error instanceof Error ? error.message : 'Authorization failed — try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleReject() {
    setIsSubmitting(true)
    setInlineError(null)

    try {
      const payload = await patchApproval({
        approvalId: currentApprovalId,
        command: 'cancel',
      })
      applyApprovalResponse(payload)
      setMode('view')
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Cancellation failed — try again')
      setMode('view')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveChanges() {
    const nextRequestedAmountCents = parseApprovalAmountInput(amount)
    if (nextRequestedAmountCents === null || nextRequestedAmountCents < 0) {
      setInlineError('Enter a valid amount with no more than two decimal places')
      return
    }

    if (!isAuthenticated || planId.startsWith('mock-plan-')) {
      onAuthRequired({ type: 'save' })
      return
    }
    if (!snapshotHash) {
      setInlineError('This approval is missing its snapshot. Refresh before saving edits.')
      return
    }

    setIsSubmitting(true)
    setInlineError(null)

    try {
      const payload = await patchApproval({
        approvalId: currentApprovalId,
        command: 'edit',
        expectedSnapshotHash: snapshotHash,
        changes: {
          requestedAmountCents: nextRequestedAmountCents,
          eventDate: eventDate || null,
          notes: notes.trim() || null,
        },
      })
      applyApprovalResponse(payload)
      setMode('view')
      onToast({
        title: 'Changes saved for review',
        description: 'A new pending approval version replaced the prior snapshot. Nothing was authorized.',
        variant: 'info',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Could not save approval changes')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRequestReapproval() {
    setIsSubmitting(true)
    setInlineError(null)

    try {
      const payload = await patchApproval({
        approvalId: currentApprovalId,
        command: 'request_reapproval',
        expectedSnapshotHash: snapshotHash || null,
      })
      applyApprovalResponse(payload)
      setMode('view')
      onToast({
        title: 'Fresh approval requested',
        description: 'Review the new version before authorizing it.',
        variant: 'info',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Could not request re-approval')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRetry() {
    if (!snapshotHash) {
      setInlineError('This failed action is missing its authorized snapshot. Refresh before retrying.')
      return
    }
    setIsSubmitting(true)
    setInlineError(null)

    const idempotencyKey = getApprovalRetryKey(retryKeysRef.current, currentApprovalId, snapshotHash)
    try {
      const response = await fetch(
        `/api/planner/plans/${planId}/approvals/${currentApprovalId}/retry`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ expectedSnapshotHash: snapshotHash }),
        }
      )
      const payload = await response.json().catch(() => ({} as ApprovalCommandResponse)) as ApprovalCommandResponse
      if (!response.ok) {
        if (hasApprovalResponseState(payload)) applyApprovalResponse(payload)
        if (isKnownTerminalRetryFailure(payload.code)) {
          clearApprovalRetryKey(retryKeysRef.current, currentApprovalId, snapshotHash)
        }
        throw new Error(payload.error ?? payload.message ?? 'Retry failed')
      }

      const { nextStatus } = applyApprovalResponse(payload)
      onToast({
        title: nextStatus === 'succeeded' ? 'Execution succeeded' : 'Retry recorded',
        description: nextStatus === 'succeeded'
          ? 'The prior authorized snapshot completed once.'
          : 'The retry is using the same idempotency key and authorized snapshot.',
        variant: nextStatus === 'succeeded' ? 'success' : 'info',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Retry failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleConfirmExternalCheckout() {
    if (!externalCheckoutEvidence || externalCheckoutEvidence.status !== 'ready') return
    if (!agentActionId || !snapshotHash) {
      setInlineError('Checkout confirmation is missing its action or approval snapshot. Refresh and try again.')
      return
    }

    setIsConfirmingExternalCheckout(true)
    setInlineError(null)
    try {
      const response = await fetch(
        `/api/planner/plans/${planId}/agent-actions/${agentActionId}/confirm`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId: currentApprovalId,
            expectedSnapshotHash: snapshotHash,
            outcome: 'completed',
          }),
        }
      )
      const payload = await response.json().catch(() => ({})) as ExternalCheckoutConfirmationResponse
      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? 'Checkout completion could not be confirmed')
      }

      const nextStatus = payload.uiStatus ?? 'succeeded'
      const nextApproval = {
        ...displayApproval,
        action_status: payload.actionStatus ?? 'complete',
        action_result: payload.actionResult ?? displayApproval.action_result,
        ui_status: nextStatus,
      }
      setDisplayApproval(nextApproval)
      setStatus(nextStatus)
      setAvailableActions([])
      setActionResultMessage(readApprovalActionResultMessage(nextApproval))
      onStatusChange(currentApprovalId, nextStatus, nextApproval)
      onToast({
        title: 'Checkout completion confirmed',
        description: '3rdPlace recorded your confirmation without repeating the external checkout.',
        variant: 'success',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Checkout completion could not be confirmed')
    } finally {
      setIsConfirmingExternalCheckout(false)
    }
  }

  async function handleCancelExecution() {
    if (!agentActionId || !snapshotHash) {
      setInlineError('Execution cancellation is missing its action or approval snapshot. Refresh and try again.')
      return
    }

    setIsSubmitting(true)
    setInlineError(null)
    const idempotencyKey = getExecutionCancelKey(
      executionCancelKeysRef.current,
      currentApprovalId,
      snapshotHash
    )
    try {
      const response = await fetch(
        `/api/planner/plans/${planId}/agent-actions/${agentActionId}/cancel`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            approvalId: currentApprovalId,
            expectedSnapshotHash: snapshotHash,
            reason: 'Host cancelled the approved operational handoff.',
          }),
        }
      )
      const payload = await response.json().catch(() => ({})) as ApprovalCommandResponse
      if (!response.ok) {
        if (hasApprovalResponseState(payload)) applyApprovalResponse(payload)
        throw new Error(payload.error ?? payload.message ?? 'Execution could not be cancelled')
      }

      applyApprovalResponse(payload)
      setMode('view')
      onToast({
        title: 'Execution cancelled',
        description: 'Queued operational work was cancelled. The authorization remains in the audit history.',
        variant: 'info',
      })
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : 'Execution could not be cancelled')
      setMode('view')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (status === 'rejected' || status === 'cancelled' || status === 'superseded') {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-4">
        <span className={cn(
          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold',
          approvalPresentationClasses(presentation.tone).badge
        )}>
          {presentation.label}
        </span>
        <p className="mt-3 text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{presentation.description}</p>
      </div>
    )
  }

  return (
    <div className={cn(
      'min-w-0 rounded-2xl border p-4',
      approvalPresentationClasses(presentation.tone).container
    )}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {status === 'pending' ? 'Review required' : 'Approval status'}
        </p>
        <span className={cn(
          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold',
          approvalPresentationClasses(presentation.tone).badge
        )}>
          {presentation.label}
        </span>
      </div>
      <h3 className="mt-2 break-words font-display text-lg font-bold leading-tight text-foreground">{label}</h3>

      {mode === 'edit' ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-foreground">
            Proposed amount ($)
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleSaveChanges} disabled={isSubmitting}>
              Save changes
            </Button>
            <Button type="button" variant="glass" size="sm" onClick={() => setMode('view')} disabled={isSubmitting}>
              Cancel edit
            </Button>
          </div>
        </div>
      ) : mode === 'confirm_authorize' ? (
        <div className="mt-4 rounded-xl border border-primary/30 bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Confirm exact snapshot</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This is the immutable version 3rdPlace will execute. Editing it creates another pending version.
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Counterparty</dt>
              <dd className="break-words font-semibold text-foreground">{provider}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Exact amount</dt>
              <dd className="font-semibold tabular-nums text-foreground">{formatApprovalCents(amountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Event date</dt>
              <dd className="font-semibold text-foreground">{readApprovalEventDate(displayApproval) || 'Not specified'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="break-words font-semibold text-foreground">{readApprovalNotes(displayApproval) || 'None'}</dd>
            </div>
          </dl>
          {!snapshotHash ? (
            <p className="mt-3 text-sm font-semibold text-destructive">
              Snapshot hash missing. Refresh this approval before authorizing.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleAuthorize} disabled={isSubmitting || !snapshotHash}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isGmailOutreachApproval ? 'Authorize and send' : 'Authorize exact snapshot'}
            </Button>
            <Button type="button" variant="glass" size="sm" onClick={() => setMode('view')} disabled={isSubmitting}>
              Back to review
            </Button>
          </div>
          {inlineError ? <p className="mt-3 text-sm font-semibold text-destructive">{inlineError}</p> : null}
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
                {amountCents > 0 ? formatApprovalCents(amountCents) : 'No payment yet'}
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

          {isSendToPartners ? (
            <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/60 p-3 text-sm">
              {venueNames.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Venues in this batch</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {venueNames.map((venueName) => (
                      <span key={venueName} className="rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                        {venueName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {vendorNames.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Vendors in this batch</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {vendorNames.map((vendorName) => (
                      <span key={vendorName} className="rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                        {vendorName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {fallbackVenueNames.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Partner list</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {fallbackVenueNames.map((partnerName) => (
                      <span key={partnerName} className="rounded-full border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                        {partnerName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {comparisonGoal ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Comparison goal</p>
                  <p className="mt-1 break-words text-sm leading-snug text-foreground">{comparisonGoal}</p>
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

          {status !== 'pending' ? (
            <div className={cn(
              'mt-4 rounded-xl border px-3 py-3 text-sm',
              approvalPresentationClasses(presentation.tone).evidence
            )}>
              <p className="font-semibold text-foreground">{presentation.description}</p>
              {authorizedAmountCents != null ? (
                <p className="mt-1 text-muted-foreground">
                  Authorized snapshot amount: <span className="font-semibold tabular-nums text-foreground">{formatApprovalCents(authorizedAmountCents)}</span>
                </p>
              ) : null}
              {status === 'succeeded' && sentAt ? (
                <p className="mt-1 font-semibold text-success">
                  Sent at {sentAt} · {inviteStats?.viewed_count ?? 0} viewed · {inviteStats?.responded_count ?? 0} responded
                </p>
              ) : null}
              {actionResultMessage ? <p className="mt-1 text-muted-foreground">{actionResultMessage}</p> : null}
              {externalCheckoutEvidence ? (
                <div className="mt-3 rounded-xl border border-border bg-background/70 p-3">
                  <p className="font-semibold text-foreground">
                    {externalCheckoutEvidence.status === 'completed'
                      ? 'External checkout completion recorded'
                      : 'Your approved checkout link is ready'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    3rdPlace will not open or complete this checkout automatically. Review the provider page before paying.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <a
                        href={externalCheckoutEvidence.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {externalCheckoutEvidence.status === 'completed' ? 'View checkout' : 'Open checkout'}
                      </a>
                    </Button>
                    {externalCheckoutEvidence.status === 'ready' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleConfirmExternalCheckout()}
                        disabled={isConfirmingExternalCheckout}
                      >
                        {isConfirmingExternalCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Confirm completed
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {status === 'succeeded' && conciergeFollowupCount > 0 ? (
                <p className="mt-1 font-semibold text-warning">
                  {conciergeFollowupCount} venue{conciergeFollowupCount === 1 ? '' : 's'} still need operator follow-up.
                </p>
              ) : null}
              {status === 'authorized' && isControlledPaymentApproval ? (
                <PlannerDepositExecution
                  planId={planId}
                  approvalId={currentApprovalId}
                  provider={provider}
                  amountLabel={formatMockCents(authorizedAmountCents ?? amountCents)}
                  onCaptured={() => onToast({
                    title: 'Deposit captured',
                    description: 'Stripe confirmed the charge. 3rdPlace is finalizing the payment record.',
                    variant: 'success',
                  })}
                />
              ) : null}
            </div>
          ) : null}

          {mode === 'confirm_execution_cancel' ? (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-foreground">Cancel this approved operational handoff?</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pending checkout or operator work will stop. The immutable approval stays in the audit history.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" onClick={() => void handleCancelExecution()} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Cancel execution
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setMode('view')} disabled={isSubmitting}>
                  Keep running
                </Button>
              </div>
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
          ) : status === 'pending' && !isAuthenticated ? (
            <div className="mt-4 rounded-xl border border-border bg-background/60 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Create an account to approve this action</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Approval requires a planner account. Sign up to save this plan and authorize outreach or payments.
              </p>
              <div className="mt-3">
                <Button asChild size="sm" className="rounded-xl">
                  <Link href="/signup/builder">Continue to creator signup</Link>
                </Button>
              </div>
            </div>
          ) : status === 'pending' ? (
            <div className="mt-4 space-y-3">
              {isProductGateRequired ? (
                <div className="rounded-xl border border-secondary/30 bg-secondary/10 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">Activate planner access before authorization</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    {formatPlannerBillingGateMessage(billingSummary)} You can still edit or cancel this proposal.
                  </p>
                  <Button asChild size="sm" className="mt-3 rounded-xl">
                    <Link href="/planner/billing">Choose pay-per-event or Pro</Link>
                  </Button>
                </div>
              ) : null}
              {shouldShowFreeEventApprovalNotice ? (
                <div className="rounded-xl border border-tan bg-cream px-3 py-2 text-xs leading-5 text-ink-soft">
                  <span className="font-semibold text-ink">
                    {freeEventsRemaining} free event{freeEventsRemaining === 1 ? '' : 's'} remaining.
                  </span>{' '}
                  Approving outreach consumes one event. After your free events, planner sessions are $30 each or $79/mo unlimited.
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {availableActions.includes('authorize') ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setMode('confirm_authorize')}
                    disabled={isSubmitting || isProductGateLoading || isProductGateRequired}
                  >
                    {isProductGateLoading ? 'Checking access…' : 'Review authorization'}
                  </Button>
                ) : null}
                {availableActions.includes('edit') ? (
                  <Button type="button" variant="glass" size="sm" onClick={() => setMode('edit')} disabled={isSubmitting}>
                    {isOutreachApproval ? 'Edit batch' : 'Edit'}
                  </Button>
                ) : null}
                {availableActions.includes('request_reapproval') ? (
                  <Button type="button" size="sm" onClick={handleRequestReapproval} disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Request re-approval
                  </Button>
                ) : null}
                {availableActions.includes('cancel') ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setMode('confirm_cancel')} disabled={isSubmitting}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : availableActions.includes('retry') ? (
            <Button type="button" className="mt-4" size="sm" onClick={handleRetry} disabled={isSubmitting || !snapshotHash}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Retry
            </Button>
          ) : availableActions.includes('request_reapproval') ? (
            <Button type="button" className="mt-4" size="sm" onClick={handleRequestReapproval} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Request re-approval
            </Button>
          ) : availableActions.includes('cancel_execution') ? (
            <Button
              type="button"
              className="mt-4"
              variant="outline"
              size="sm"
              onClick={() => setMode('confirm_execution_cancel')}
              disabled={isSubmitting}
            >
              Cancel queued work
            </Button>
          ) : null}

          {inlineError ? <p className="mt-3 text-sm font-semibold text-destructive">{inlineError}</p> : null}
        </>
      )}
    </div>
  )
}

export function formatPlannerBillingGateMessage(billing: PlannerBillingSummary | null) {
  const tier = billing?.tierLabel ?? 'Free Trial'
  const payPerEventAmount = billing?.prices?.payPerEventAmount
  const payPerEvent = typeof payPerEventAmount === 'number' ? formatMockCents(payPerEventAmount * 100) : '$30'

  return `${tier} has no remaining event access. Add a ${payPerEvent} event credit or choose Pro before outreach, deposits, or payments can execute.`
}

/**
 * Reads a string field from approval metadata.
 */
export function readApprovalString(approval: Record<string, unknown>, key: string) {
  const value = approval[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Identifies controlled payments from their action contract. The saved payment
 * method remains a legacy fallback, but it is no longer required for the card
 * to render because organizers can bind a card from the payment UI itself.
 */
export function isControlledPaymentApprovalMetadata(
  approval: Record<string, unknown>,
  amountCents: number,
  isOutreachApproval = false
) {
  if (amountCents <= 0 || isOutreachApproval) return false

  return (
    readApprovalString(approval, 'action_type') === 'payment' ||
    readApprovalString(approval, 'execution_mode') === 'controlled_payment' ||
    Boolean(readApprovalString(approval, 'payment_method_id'))
  )
}

/**
 * Reads a cent amount from approval metadata.
 */
export function readApprovalAmount(approval: Record<string, unknown>) {
  const requested = approval.requested_amount_cents
  if (typeof requested === 'number') return requested

  const snapshot = readApprovalSnapshot(approval)
  const snapshotRequested = snapshot?.requestedAmountCents ?? snapshot?.requested_amount_cents
  if (typeof snapshotRequested === 'number') return snapshotRequested

  const amount = approval.amount_cents
  if (typeof amount === 'number') return amount

  const price = approval.price_cents
  return typeof price === 'number' ? price : 0
}

/**
 * Reads the authorized cent amount from approval metadata.
 */
export function readAuthorizedApprovalAmount(approval: Record<string, unknown>) {
  const authorized = approval.authorized_amount_cents
  return typeof authorized === 'number' ? authorized : null
}

export function readApprovalEventDate(approval: Record<string, unknown>) {
  const direct = readTrimmedString(approval.event_date ?? approval.eventDate)
  if (direct) return direct
  const snapshot = readApprovalSnapshot(approval)
  return readTrimmedString(snapshot?.event_date ?? snapshot?.eventDate) ?? ''
}

export function readApprovalNotes(approval: Record<string, unknown>) {
  const direct = readTrimmedString(approval.notes)
  if (direct) return direct
  const snapshot = readApprovalSnapshot(approval)
  return readTrimmedString(snapshot?.notes) ?? ''
}

export function readApprovalCounterparty(approval: Record<string, unknown>) {
  const direct = readTrimmedString(approval.counterparty ?? approval.provider)
  if (direct) return direct
  const snapshot = readApprovalSnapshot(approval)
  return readTrimmedString(snapshot?.counterparty ?? snapshot?.provider) ?? '3rdPlace partner'
}

export function readApprovalSnapshotHash(approval: Record<string, unknown>) {
  const direct = readTrimmedString(approval.snapshot_hash ?? approval.snapshotHash)
  if (direct) return direct
  const snapshot = readApprovalSnapshot(approval)
  return readTrimmedString(snapshot?.snapshot_hash ?? snapshot?.snapshotHash ?? snapshot?.hash) ?? ''
}

function hasAuthorizableV2Snapshot(approval: Record<string, unknown>) {
  if (!readApprovalSnapshotHash(approval)) return false

  if (Object.prototype.hasOwnProperty.call(approval, 'snapshot_schema_version')) {
    return approval.snapshot_schema_version === 2 || approval.snapshot_schema_version === '2'
  }
  if (Object.prototype.hasOwnProperty.call(approval, 'snapshotSchemaVersion')) {
    return approval.snapshotSchemaVersion === 2 || approval.snapshotSchemaVersion === '2'
  }

  const snapshot = readApprovalSnapshot(approval)
  if (!snapshot) return false
  return snapshot.schema_version === 2 || snapshot.schema_version === '2'
}

export function readApprovalAvailableActions(
  approval: Record<string, unknown>,
  status = readApprovalStatus(approval)
): readonly ApprovalUiAction[] {
  const state = readApprovalUiState({
    ...approval,
    ui_status: approval.ui_status ?? status,
  })

  if (!hasAuthorizableV2Snapshot(approval)) {
    if (state.status === 'pending') return ['request_reapproval', 'cancel']
    if (
      state.status === 'authorized' ||
      state.status === 'failed' ||
      state.status === 'expired' ||
      state.status === 'reapproval_required'
    ) {
      return ['request_reapproval']
    }
  }

  return state.availableActions
}

export function readApprovalActionResultMessage(approval: Record<string, unknown>) {
  const result = approval.action_result ?? approval.actionResult
  if (typeof result === 'string' && result.trim()) return result.trim()
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const record = result as Record<string, unknown>
  return readTrimmedString(record.message ?? record.summary ?? record.detail ?? record.error)
}

/**
 * Reads venue names attached to a Send-to-venues approval card.
 */
export function readApprovalVenueNames(approval: Record<string, unknown>) {
  return readApprovalPartnerTargets(approval)
    .filter((target) => target.kind === 'venue' || target.kind === 'partner')
    .map((target) => target.name)
}

type ApprovalPartnerTarget = {
  kind: 'venue' | 'vendor' | 'partner'
  name: string
  email?: string
}

/**
 * Reads venue and vendor names attached to an outreach batch approval card.
 */
export function readApprovalPartnerTargets(approval: Record<string, unknown>): ApprovalPartnerTarget[] {
  const explicitTargets = approval.partner_targets
  if (Array.isArray(explicitTargets)) {
    const targets = explicitTargets.flatMap((target) => {
      if (!target || typeof target !== 'object' || Array.isArray(target)) return []
      const record = target as Record<string, unknown>
      const name = readTrimmedString(record.name)
      if (!name) return []
      return [{
        kind: readPartnerKind(record.kind),
        name,
        email: readTrimmedString(record.email) ?? undefined,
      }]
    })
    if (targets.length > 0) return targets
  }

  const invites = approval.invites
  if (!Array.isArray(invites)) return []

  return invites
    .map((invite) => {
      if (!invite || typeof invite !== 'object' || Array.isArray(invite)) return null
      const inviteRecord = invite as Record<string, unknown>
      const venue = inviteRecord.venue
      if (venue && typeof venue === 'object' && !Array.isArray(venue)) {
        const venueRecord = venue as Record<string, unknown>
        const name = readTrimmedString(venueRecord.venue_name) ?? readTrimmedString(venueRecord.name)
        if (name) return { kind: 'venue' as const, name }
      }

      const vendor = inviteRecord.vendor
      if (vendor && typeof vendor === 'object' && !Array.isArray(vendor)) {
        const name = readTrimmedString((vendor as Record<string, unknown>).name)
        if (name) return { kind: 'vendor' as const, name }
      }

      const response = inviteRecord.venue_response_json ?? inviteRecord.response_payload
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        const responseRecord = response as Record<string, unknown>
        const targetName = readTrimmedString(responseRecord.target_name)
        if (targetName) {
          return {
            kind: readPartnerKind(responseRecord.target_type ?? inviteRecord.target_type),
            name: targetName,
            email: readTrimmedString(responseRecord.target_email) ?? undefined,
          }
        }
      }
      return null
    })
    .filter((target): target is ApprovalPartnerTarget => Boolean(target))
}

/**
 * Reads opportunity summary text attached to a Send-to-venues approval card.
 */
export function readApprovalBriefPreview(approval: Record<string, unknown>) {
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
export function readApprovalResponseDeadline(approval: Record<string, unknown>) {
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
export function readApprovalQueuedInviteCount(approval: Record<string, unknown>) {
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
export function readApprovalInviteStats(approval: Record<string, unknown>): ApprovalInviteStats | null {
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

export function readNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readPartnerKind(value: unknown): ApprovalPartnerTarget['kind'] {
  if (value === 'vendor') return 'vendor'
  if (value === 'venue') return 'venue'
  return 'partner'
}

export function formatApprovalTimestamp(value: string) {
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
export function readApprovalStatus(approval: Record<string, unknown>): 'pending' | ApprovalUiStatus {
  return readApprovalUiState(approval).status
}

/**
 * Converts approval cents to a human-editable dollar field.
 */
export function formatApprovalAmountInput(amountCents: number) {
  return (formatCentsToDollars(amountCents) ?? 0).toFixed(2)
}

export function formatApprovalCents(amountCents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((formatCentsToDollars(amountCents) ?? 0))
}

export function parseApprovalAmountInput(value: string) {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  return parseDollarsToCents(normalized)
}

function readApprovalSnapshot(approval: Record<string, unknown>) {
  const snapshot = approval.confirmation_snapshot ?? approval.confirmationSnapshot ?? approval.snapshot_json
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  return snapshot as Record<string, unknown>
}

function enrichApprovalResponse(
  currentApproval: Record<string, unknown>,
  payload: ApprovalCommandResponse
): Record<string, unknown> {
  return {
    ...currentApproval,
    ...(payload.currentApproval ?? payload.approval ?? {}),
    ...(payload.actionStatus !== undefined ? { action_status: payload.actionStatus } : {}),
    ...(payload.actionResult !== undefined ? { action_result: payload.actionResult } : {}),
    ...(payload.confirmationSnapshot !== undefined ? { confirmation_snapshot: payload.confirmationSnapshot } : {}),
    ...(payload.uiStatus !== undefined ? { ui_status: payload.uiStatus } : {}),
    ...(payload.availableActions !== undefined ? { available_actions: payload.availableActions } : {}),
  }
}

function hasApprovalResponseState(payload: ApprovalCommandResponse) {
  return Boolean(
    payload.approval ||
    payload.currentApproval ||
    payload.uiStatus ||
    payload.actionStatus ||
    payload.actionResult ||
    payload.confirmationSnapshot ||
    payload.availableActions
  )
}

function getApprovalRetryKey(
  keys: Map<string, string>,
  approvalId: string,
  snapshotHash: string
) {
  const key = `${approvalId}:${snapshotHash}`
  const existing = keys.get(key)
  if (existing) return existing

  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const value = `approval-retry:${approvalId}:${nonce}`
  keys.set(key, value)
  return value
}

function getExecutionCancelKey(
  keys: Map<string, string>,
  approvalId: string,
  snapshotHash: string
) {
  const key = `${approvalId}:${snapshotHash}`
  const existing = keys.get(key)
  if (existing) return existing
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const value = `execution-cancel:${approvalId}:${nonce}`
  keys.set(key, value)
  return value
}

function clearApprovalRetryKey(
  keys: Map<string, string>,
  approvalId: string,
  snapshotHash: string
) {
  keys.delete(`${approvalId}:${snapshotHash}`)
}

function isKnownTerminalRetryFailure(code: string | undefined) {
  return code === 'approval_retry_failed' || code === 'retry_prior_failure'
}

function approvalPresentationClasses(tone: ApprovalPresentationTone) {
  if (tone === 'success') {
    return {
      container: 'border-success/30 bg-success/10',
      badge: 'border-success/30 bg-background text-success',
      evidence: 'border-success/30 bg-success/10',
    }
  }
  if (tone === 'warning') {
    return {
      container: 'border-warning/30 bg-warning/10',
      badge: 'border-warning/30 bg-background text-warning',
      evidence: 'border-warning/30 bg-warning/10',
    }
  }
  if (tone === 'danger') {
    return {
      container: 'border-destructive/30 bg-destructive/10',
      badge: 'border-destructive/30 bg-background text-destructive',
      evidence: 'border-destructive/30 bg-destructive/10',
    }
  }
  if (tone === 'neutral') {
    return {
      container: 'border-border bg-muted/40',
      badge: 'border-border bg-background text-muted-foreground',
      evidence: 'border-border bg-muted/40',
    }
  }
  return {
    container: 'border-primary/40 bg-primary/10',
    badge: 'border-primary/30 bg-background text-primary',
    evidence: 'border-primary/30 bg-primary/10',
  }
}
