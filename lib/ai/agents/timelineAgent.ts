import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import {
  generateMilestoneTemplate,
  milestoneTemplateInputSchema,
  milestoneTemplateOutputSchema,
  type DayOfTimelineItem,
  type MilestoneTemplateOutput,
  type PlanningMilestone,
} from '@/lib/events/milestoneTemplates'

export const timelineAgentInputSchema = milestoneTemplateInputSchema.extend({
  archetype_intake: z.record(z.unknown()).nullish(),
  mutation_contract: z.record(z.unknown()).nullish(),
  conversation_history: z.array(z.record(z.unknown())).optional(),
})
export const timelineAgentOutputSchema = milestoneTemplateOutputSchema

export type TimelineAgentInput = z.infer<typeof timelineAgentInputSchema>
export type TimelineAgentOutput = z.infer<typeof timelineAgentOutputSchema>
export type TimelineAgentResult = AgentResult<TimelineAgentOutput>

export const timelineAgentDefinition = {
  agentName: 'timeline',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const TIMELINE_OUTPUT_CONTRACT = {
  planning_milestones: [
    {
      title: 'string',
      due_date: 'YYYY-MM-DD',
      category: 'string',
      is_blocking: true,
    },
  ],
  day_of_timeline: [
    {
      time: 'HH:mm or clear time label',
      activity: 'string',
      owner: 'string',
      notes: 'string or null',
    },
  ],
  staffing_needs: ['string'],
  reminders: ['string'],
  dependency_warnings: ['string'],
  impossible_timeline: false,
}

const TIMELINE_SYSTEM_PROMPT = [
  'You are the 3rdPlace Timeline Agent.',
  'Refine a deterministic event planning timeline into concise operational wording and catch missing dependencies.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The application has already generated required planning milestones deterministically. Preserve them unless only rewording the title for clarity.',
  'Always keep milestones for venue confirmation, deposit payment, vendor booking, ticket launch, promo push, final headcount, day-before check, setup, doors, programming, and teardown.',
  'Use only venue_bookings and vendor_bookings data provided in the request. Do not reference the legacy bookings table.',
  'Use archetype_intake and conversation_history to preserve user-stated timing constraints, especially setup, load-in, sound check, doors, programming, breakdown, vendor arrival, and external checkout dependencies.',
  'Honor mutation_contract when present. Treat locked_archetype as authoritative and never reclassify the event inside timeline output.',
  'Do not invent confirmed bookings, staffing, deposits, payments, venue rules, or vendor timing.',
  'Keep the output operational and short.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  `Output JSON must match this contract: ${JSON.stringify(TIMELINE_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runTimelineAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<TimelineAgentResult> {
  const startedAt = Date.now()
  const input = timelineAgentInputSchema.parse(payload)
  const deterministicTimeline = generateMilestoneTemplate(input)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: TIMELINE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        ...input,
        deterministic_timeline: deterministicTimeline,
      }),
    },
  ]

  const completion = await client.create({
    model: timelineAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, timelineAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('timeline returned an empty model response', metadata)
  }

  let output: TimelineAgentOutput
  try {
    const modelOutput = timelineAgentOutputSchema.parse(parseJsonObject(content))
    output = finalizeTimelineOutput(deterministicTimeline, modelOutput)
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: timelineAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse timeline model JSON'
}

function finalizeTimelineOutput(
  deterministicTimeline: MilestoneTemplateOutput,
  modelOutput: MilestoneTemplateOutput
): MilestoneTemplateOutput {
  return timelineAgentOutputSchema.parse({
    planning_milestones: mergeMilestones(
      deterministicTimeline.planning_milestones,
      modelOutput.planning_milestones
    ),
    day_of_timeline: mergeDayOfTimeline(
      deterministicTimeline.day_of_timeline,
      modelOutput.day_of_timeline
    ),
    staffing_needs: uniqueStrings([...deterministicTimeline.staffing_needs, ...modelOutput.staffing_needs]),
    reminders: uniqueStrings([...deterministicTimeline.reminders, ...modelOutput.reminders]),
    dependency_warnings: uniqueStrings([
      ...deterministicTimeline.dependency_warnings,
      ...modelOutput.dependency_warnings,
    ]),
    impossible_timeline: deterministicTimeline.impossible_timeline || modelOutput.impossible_timeline,
  })
}

function mergeMilestones(
  deterministicMilestones: PlanningMilestone[],
  modelMilestones: PlanningMilestone[]
): PlanningMilestone[] {
  const byKey = new Map<string, PlanningMilestone>()

  deterministicMilestones.forEach((milestone) => {
    byKey.set(normalizeMilestoneTitle(milestone.title), milestone)
  })
  modelMilestones.forEach((milestone) => {
    const key = normalizeMilestoneTitle(milestone.title)
    if (!byKey.has(key)) byKey.set(key, milestone)
  })

  return Array.from(byKey.values()).sort((first, second) => {
    if (first.due_date !== second.due_date) return first.due_date.localeCompare(second.due_date)
    return first.title.localeCompare(second.title)
  })
}

function mergeDayOfTimeline(
  deterministicItems: DayOfTimelineItem[],
  modelItems: DayOfTimelineItem[]
): DayOfTimelineItem[] {
  const byKey = new Map<string, DayOfTimelineItem>()

  deterministicItems.forEach((item) => {
    byKey.set(`${item.time}:${normalizeMilestoneTitle(item.activity)}`, item)
  })
  modelItems.forEach((item) => {
    const key = `${item.time}:${normalizeMilestoneTitle(item.activity)}`
    if (!byKey.has(key)) byKey.set(key, item)
  })

  return Array.from(byKey.values())
}

function normalizeMilestoneTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
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
      throw new Error(`Failed to parse timeline model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse timeline model JSON')
  }
}
