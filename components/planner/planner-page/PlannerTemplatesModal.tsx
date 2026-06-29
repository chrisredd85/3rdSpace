'use client'

import { useState } from 'react'
import { Copy, LayoutTemplate, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { PlannerTemplateApplyOptions, PlannerTemplateSummary, ResponseAnalysisOutput } from './types'
import { formatMockCents } from './draftMode'

type PlannerTemplatesModalMode = 'apply' | 'rebook'

type TemplateRebookDraft = {
  date: string
  guestCount: string
  budgetDollars: string
  neighborhood: string
  useSameVenue: boolean
  useSameVendors: boolean
}

export function PlannerTemplatesModal(props: {
  isOpen: boolean
  mode?: PlannerTemplatesModalMode
  templates: PlannerTemplateSummary[]
  isLoading: boolean
  error: string | null
  applyingTemplateId: string | null
  isSavingTemplate: boolean
  canSaveCurrentPlan: boolean
  onClose: () => void
  onRefresh: () => void
  onApply: (templateId: string, options?: PlannerTemplateApplyOptions) => void
  onSaveCurrentPlan: () => void
}) {
  const mode = props.mode ?? 'apply'
  const isRebookMode = mode === 'rebook'
  const [rebookDrafts, setRebookDrafts] = useState<Record<string, TemplateRebookDraft>>({})

  if (!props.isOpen) return null

  function readDraft(templateId: string): TemplateRebookDraft {
    return rebookDrafts[templateId] ?? {
      date: '',
      guestCount: '',
      budgetDollars: '',
      neighborhood: '',
      useSameVenue: true,
      useSameVendors: false,
    }
  }

  function updateDraft(templateId: string, patch: Partial<TemplateRebookDraft>) {
    const defaultDraft: TemplateRebookDraft = {
      date: '',
      guestCount: '',
      budgetDollars: '',
      neighborhood: '',
      useSameVenue: true,
      useSameVendors: false,
    }

    setRebookDrafts((current) => ({
      ...current,
      [templateId]: {
        ...(current[templateId] ?? defaultDraft),
        ...patch,
      },
    }))
  }

  function buildRebookOptions(templateId: string): PlannerTemplateApplyOptions {
    const draft = readDraft(templateId)
    const guestCount = Number.parseInt(draft.guestCount, 10)
    const budgetCapCents = draft.budgetDollars.trim() ? dollarsToCents(draft.budgetDollars) : null
    const date = draft.date.trim()
    const neighborhood = draft.neighborhood.trim()

    return {
      create_new_plan: true,
      date_window_start: date || null,
      date_window_end: date || null,
      guest_count: Number.isFinite(guestCount) && guestCount > 0 ? guestCount : null,
      budget_cap_cents: budgetCapCents && budgetCapCents > 0 ? budgetCapCents : null,
      neighborhood: neighborhood || null,
      use_same_venue: draft.useSameVenue,
      use_same_vendors: draft.useSameVendors,
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-md">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Planner templates</p>
            <h2 className="mt-1 font-display text-xl font-bold">
              {isRebookMode ? 'Repeat a past event' : 'Use a proven event shape'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isRebookMode
                ? 'Pick a saved event, change the numbers, and 3rdPlace will rebuild the plan before any outreach, booking, or payment.'
                : 'Save this plan once the event shape works, then reuse it with fresh dates and headcount.'}
            </p>
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

          {!props.error && !props.isLoading && props.templates.length === 0 ? (
            <div className="rounded-2xl border border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
              <p>No saved templates yet.</p>
              {props.canSaveCurrentPlan ? (
                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  className="mt-4"
                  onClick={props.onSaveCurrentPlan}
                  disabled={props.isSavingTemplate}
                >
                  {props.isSavingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
                  Save this plan as template
                </Button>
              ) : null}
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
                  {isRebookMode ? (
                    <div className="mt-4 space-y-3 rounded-2xl border border-border bg-card/60 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          New date
                          <input
                            type="date"
                            value={readDraft(template.id).date}
                            onChange={(event) => updateDraft(template.id, { date: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Guests
                          <input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            value={readDraft(template.id).guestCount}
                            onChange={(event) => updateDraft(template.id, { guestCount: event.target.value })}
                            placeholder="Updated count"
                            className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Budget
                          <input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={readDraft(template.id).budgetDollars}
                            onChange={(event) => updateDraft(template.id, { budgetDollars: event.target.value })}
                            placeholder="Optional dollars"
                            className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Area
                          <input
                            type="text"
                            value={readDraft(template.id).neighborhood}
                            onChange={(event) => updateDraft(template.id, { neighborhood: event.target.value })}
                            placeholder="Mission, SoMa..."
                            className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={readDraft(template.id).useSameVenue}
                            onChange={(event) => updateDraft(template.id, { useSameVenue: event.target.checked })}
                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                          />
                          Prefer same venue
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={readDraft(template.id).useSameVendors}
                            onChange={(event) => updateDraft(template.id, { useSameVendors: event.target.checked })}
                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                          />
                          Prefer same vendors
                        </label>
                      </div>
                      <p className="rounded-xl border border-border bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                        3rdPlace creates a fresh plan and approval queue for the new run. Nothing sends, books, or pays until you approve.
                      </p>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="hero"
                    size="sm"
                    className="mt-4 w-full"
                    disabled={props.applyingTemplateId !== null}
                    onClick={() => props.onApply(template.id, isRebookMode ? buildRebookOptions(template.id) : undefined)}
                  >
                    {props.applyingTemplateId === template.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LayoutTemplate className="h-4 w-4" />
                    )}
                    {isRebookMode ? 'Create rebook plan' : 'Use this template'}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          {props.canSaveCurrentPlan ? (
            <Button type="button" variant="hero" size="sm" onClick={props.onSaveCurrentPlan} disabled={props.isSavingTemplate}>
              {props.isSavingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
              Save this plan as template
            </Button>
          ) : null}
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

export function formatTemplateCreatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Saved template'
  return `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export function ReplyAnalysisResult({
  result,
  partnerType = 'venue',
  isCreatingApproval = false,
  approvalError = null,
  approvalMessage = null,
  onCreateApproval,
}: {
  result: ResponseAnalysisOutput
  partnerType?: 'venue' | 'vendor'
  isCreatingApproval?: boolean
  approvalError?: string | null
  approvalMessage?: string | null
  onCreateApproval?: () => void
}) {
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
        {result.service_type ? (
          <span className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
            {result.service_type}
          </span>
        ) : null}
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
      {result.availability_notes || result.notes ? (
        <div className="rounded-xl border border-border bg-background/70 p-3 text-sm text-muted-foreground">
          {result.availability_notes ? <p><span className="font-semibold text-foreground">Availability:</span> {result.availability_notes}</p> : null}
          {result.notes ? <p className={result.availability_notes ? 'mt-2' : undefined}><span className="font-semibold text-foreground">Notes:</span> {result.notes}</p> : null}
        </div>
      ) : null}

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

      {partnerType === 'vendor' && onCreateApproval ? (
        <div className="space-y-2 rounded-xl border border-border bg-background/70 p-3">
          <p className="text-sm text-muted-foreground">
            Create an organizer approval before any vendor invite or private rate agreement is created or updated.
          </p>
          <Button type="button" size="sm" onClick={onCreateApproval} disabled={isCreatingApproval}>
            {isCreatingApproval ? 'Creating approval...' : 'Create vendor capture approval'}
          </Button>
          {approvalMessage ? <p className="text-sm font-semibold text-success">{approvalMessage}</p> : null}
          {approvalError ? <p className="text-sm text-destructive">{approvalError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export function getAvailabilityBadgeClass(status: ResponseAnalysisOutput['availability_status']): string {
  if (status === 'available') return 'border-success/30 bg-success/10 text-success'
  if (status === 'unavailable') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-secondary/30 bg-secondary/10 text-secondary'
}

export function buildSuggestedReplyFromAnalysis(result: ResponseAnalysisOutput): string {
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

export function readAgentOutput(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const data = (payload as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return (data as Record<string, unknown>).output
}

export function DemoSessionBanner({
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

export function formatDemoSessionTime(value: string | null | undefined) {
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

export function isResponseAnalysisOutput(value: unknown): value is ResponseAnalysisOutput {
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

export function isAvailabilityStatus(value: unknown): value is ResponseAnalysisOutput['availability_status'] {
  return value === 'available' || value === 'unavailable' || value === 'tentative' || value === 'unknown'
}
