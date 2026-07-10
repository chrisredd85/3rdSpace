import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { eventTaskRowSchema, getOverdueTaskTitles } from '@/lib/events/workspaceHelpers'

const bookingStatusSchema = z.string().trim().min(1).nullable()
const nullableNumberSchema = z.number().nullable()

export const workspaceVenueBookingRowSchema = z.object({
  id: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
  venue_id: z.string().trim().min(1),
  status: bookingStatusSchema,
  quoted_price: nullableNumberSchema,
})

export const workspaceVendorBookingRowSchema = z.object({
  id: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
  vendor_id: z.string().trim().min(1),
  status: bookingStatusSchema,
  quoted_price: nullableNumberSchema,
})

export const workspaceBudgetSummarySchema = z.object({
  event_id: z.string().trim().min(1),
  expected_profit: nullableNumberSchema,
  profit_margin: nullableNumberSchema.describe('Profit margin in percentage points, not a 0-1 ratio.'),
  break_even_tickets: nullableNumberSchema,
  net_revenue: nullableNumberSchema,
  total_costs: nullableNumberSchema,
})

export const workspaceAgentInputSchema = z.object({
  event_plan: eventPlanSchema,
  tasks: z.array(eventTaskRowSchema),
  venue_bookings: z.array(workspaceVenueBookingRowSchema),
  vendor_bookings: z.array(workspaceVendorBookingRowSchema),
  budget_summary: workspaceBudgetSummarySchema.nullish(),
  timeline: z.array(z.record(z.unknown())).nullish(),
  archetype_intake: z.record(z.unknown()).nullish(),
  mutation_contract: z.record(z.unknown()).nullish(),
  conversation_history: z.array(z.record(z.unknown())).optional(),
})

export const workspaceAgentOutputSchema = z.object({
  workspace_summary: z.string().trim().min(1),
  current_status: z.enum(['on_track', 'at_risk', 'blocked']),
  blockers: z.array(z.string().trim().min(1)),
  overdue_items: z.array(z.string().trim().min(1)),
  recommended_next_actions: z.array(z.string().trim().min(1)),
  approvals_needed: z.array(z.string().trim().min(1)),
})

export type WorkspaceAgentInput = z.infer<typeof workspaceAgentInputSchema>
export type WorkspaceAgentOutput = z.infer<typeof workspaceAgentOutputSchema>
export type WorkspaceAgentResult = AgentResult<WorkspaceAgentOutput>

export const workspaceAgentDefinition = {
  agentName: 'workspace',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

type WorkspaceSignals = {
  overdueItems: string[]
  blockers: string[]
  recommendedNextActions: string[]
  approvalsNeeded: string[]
  forceStatus: 'at_risk' | 'blocked' | null
}

const WORKSPACE_OUTPUT_CONTRACT = {
  workspace_summary: 'short operational summary',
  current_status: 'on_track | at_risk | blocked',
  blockers: ['string'],
  overdue_items: ['string'],
  recommended_next_actions: ['string'],
  approvals_needed: ['string'],
}

const WORKSPACE_SYSTEM_PROMPT = [
  'You are the 3rdPlace Workspace Coordination Agent.',
  'Summarize the event workspace status and identify blockers using only the provided data.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'Do not generate fake activity, fake partner responses, fake approvals, or fake bookings.',
  'Keep output short and operational.',
  'Prioritize unsigned contracts, unpaid deposits, missing venue confirmation, missing vendor quotes, and budget risk when present in deterministic_signals or the provided rows.',
  'Use archetype_intake and conversation_history to preserve user-stated operating constraints, such as setup windows, outside vendors, required AV, guest-list control, or external checkout.',
  'Honor mutation_contract when present. Treat locked_archetype as authoritative and never reclassify the event inside workspace output.',
  'Preserve deterministic_signals.overdue_items, blockers, recommended_next_actions, and approvals_needed in the output unless the same item is already represented with equivalent wording.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  `Output JSON must match this contract: ${JSON.stringify(WORKSPACE_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runWorkspaceAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<WorkspaceAgentResult> {
  const startedAt = Date.now()
  const input = workspaceAgentInputSchema.parse(payload)
  const signals = buildWorkspaceSignals(input)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: WORKSPACE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        ...input,
        deterministic_signals: {
          overdue_items: signals.overdueItems,
          blockers: signals.blockers,
          recommended_next_actions: signals.recommendedNextActions,
          approvals_needed: signals.approvalsNeeded,
          force_status: signals.forceStatus,
        },
      }),
    },
  ]

  const completion = await client.create({
    model: workspaceAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, workspaceAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('workspace returned an empty model response', metadata)
  }

  let output: WorkspaceAgentOutput
  try {
    const modelOutput = workspaceAgentOutputSchema.parse(parseJsonObject(content))
    output = finalizeWorkspaceOutput(modelOutput, signals)
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: workspaceAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

export function buildDeterministicWorkspaceOutput(payload: unknown): WorkspaceAgentOutput {
  const input = workspaceAgentInputSchema.parse(payload)
  const signals = buildWorkspaceSignals(input)
  const blockerCount = signals.blockers.length
  const overdueCount = signals.overdueItems.length
  const summaryParts = [
    blockerCount > 0 ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'} need attention` : 'No hard blockers detected',
    overdueCount > 0 ? `${overdueCount} overdue item${overdueCount === 1 ? '' : 's'}` : 'no overdue tasks',
  ]

  return workspaceAgentOutputSchema.parse({
    workspace_summary: `${summaryParts.join('; ')}.`,
    current_status: signals.forceStatus ?? 'on_track',
    blockers: signals.blockers,
    overdue_items: signals.overdueItems,
    recommended_next_actions: signals.recommendedNextActions,
    approvals_needed: signals.approvalsNeeded,
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse workspace model JSON'
}

function buildWorkspaceSignals(input: WorkspaceAgentInput): WorkspaceSignals {
  const overdueItems = getOverdueTaskTitles(input.tasks)
  const blockers: string[] = []
  const recommendedNextActions: string[] = []
  const approvalsNeeded: string[] = []

  input.tasks.forEach((task) => {
    const title = task.title.toLowerCase()
    const isOpen = !isClosedStatus(task.status)

    if (isOpen && title.includes('contract')) {
      blockers.push(`Unsigned contract task still open: ${task.title}.`)
      recommendedNextActions.push(`Resolve contract task: ${task.title}.`)
      approvalsNeeded.push(`Review and approve contract terms for: ${task.title}.`)
    }

    if (isOpen && title.includes('deposit')) {
      blockers.push(`Deposit task still open: ${task.title}.`)
      recommendedNextActions.push(`Resolve deposit task: ${task.title}.`)
      approvalsNeeded.push(`Approve deposit handling for: ${task.title}.`)
    }
  })

  input.venue_bookings.forEach((booking) => {
    if (!isConfirmedStatus(booking.status)) {
      blockers.push(`Venue booking ${booking.id} is missing venue confirmation.`)
      recommendedNextActions.push(`Follow up on venue booking ${booking.id} for confirmation and terms.`)
    }
  })

  input.vendor_bookings.forEach((booking) => {
    if (booking.quoted_price === null) {
      blockers.push(`Vendor booking ${booking.id} is missing a quoted price.`)
      recommendedNextActions.push(`Request a quote for vendor booking ${booking.id}.`)
    }

    if (!isConfirmedStatus(booking.status)) {
      recommendedNextActions.push(`Follow up on vendor booking ${booking.id} for status confirmation.`)
    } else {
      approvalsNeeded.push(`Approve confirmed vendor terms for booking ${booking.id}.`)
    }
  })

  if (input.budget_summary?.profit_margin !== null && input.budget_summary?.profit_margin !== undefined) {
    if (input.budget_summary.profit_margin < 20) {
      blockers.push('Budget risk: projected profit margin is below 20%.')
      recommendedNextActions.push('Rework pricing or costs to lift projected margin above 20%.')
    }
  }

  overdueItems.forEach((title) => {
    blockers.push(`Overdue task: ${title}.`)
    recommendedNextActions.push(`Complete overdue task: ${title}.`)
  })

  return {
    overdueItems,
    blockers: uniqueStrings(blockers),
    recommendedNextActions: uniqueStrings(recommendedNextActions),
    approvalsNeeded: uniqueStrings(approvalsNeeded),
    forceStatus: blockers.length > 0 ? 'blocked' : null,
  }
}

function finalizeWorkspaceOutput(
  modelOutput: WorkspaceAgentOutput,
  signals: WorkspaceSignals
): WorkspaceAgentOutput {
  const blockers = uniqueStrings([...signals.blockers, ...modelOutput.blockers])
  const overdueItems = uniqueStrings([...signals.overdueItems, ...modelOutput.overdue_items])
  const recommendedNextActions = uniqueStrings([
    ...signals.recommendedNextActions,
    ...modelOutput.recommended_next_actions,
  ])
  const approvalsNeeded = uniqueStrings([...signals.approvalsNeeded, ...modelOutput.approvals_needed])

  return workspaceAgentOutputSchema.parse({
    ...modelOutput,
    current_status: signals.forceStatus ?? modelOutput.current_status,
    blockers,
    overdue_items: overdueItems,
    recommended_next_actions: recommendedNextActions,
    approvals_needed: approvalsNeeded,
  })
}

function isClosedStatus(status: string | null): boolean {
  if (!status) return false
  return ['complete', 'completed', 'done', 'cancelled', 'canceled'].includes(status.trim().toLowerCase())
}

function isConfirmedStatus(status: string | null): boolean {
  if (!status) return false
  return ['confirmed', 'approved', 'booked', 'paid'].includes(status.trim().toLowerCase())
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function parseJsonObject(content: string): unknown {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model response was not a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse workspace model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse workspace model JSON')
  }
}
