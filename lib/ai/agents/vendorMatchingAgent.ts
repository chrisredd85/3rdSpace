import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { eventArchetypeConfigSchema } from '@/lib/planner/archetypes/types'

const rankedVendorForAgentSchema = z.object({
  vendor_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  service_type: z.string().trim().min(1),
  necessity: z.enum(['required', 'recommended', 'optional']),
  service_note: z.string().trim().min(1).nullable(),
  base_rate_cents: z.number().int().nonnegative(),
  total_score: z.number().int().min(0).max(100),
  user_facing_intro: z.string().trim().min(1),
  score_breakdown: z.record(z.unknown()),
  response_p50_minutes: z.number().int().nonnegative().nullable(),
  prior_events_with_builder: z.number().int().nonnegative(),
})

export const vendorMatchingAgentInputSchema = z.object({
  archetype: eventArchetypeConfigSchema,
  plan: z.record(z.unknown()),
  chosen_venue: z.record(z.unknown()).nullable(),
  ranked_vendors_by_service_type: z.record(z.array(rankedVendorForAgentSchema).max(10)),
  skipped_stack_items: z.array(z.object({
    service_type: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })).default([]),
  conversation_history: z.array(z.record(z.unknown())).default([]),
})

const surfacedVendorSchema = z.object({
  vendor_id: z.string().trim().min(1),
  position: z.number().int().min(1),
  demotion_reason: z.string().trim().min(1).nullable(),
  user_facing_intro: z.string().trim().min(1),
})

export const vendorMatchingAgentOutputSchema = z.object({
  surfaced_by_service_type: z.record(z.array(surfacedVendorSchema).max(3)),
  overall_summary: z.string().trim().min(1),
  flags_for_user: z.array(z.string().trim().min(1)),
})

export type VendorMatchingAgentInput = z.infer<typeof vendorMatchingAgentInputSchema>
export type VendorMatchingAgentOutput = z.infer<typeof vendorMatchingAgentOutputSchema>
export type VendorMatchingAgentResult = Omit<AgentResult<VendorMatchingAgentOutput>, 'agent_name'> & {
  agent_name: typeof vendorMatchingAgentDefinition.agentName
}

export const vendorMatchingAgentDefinition = {
  agentName: 'vendor_matching',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const VENDOR_MATCHING_OUTPUT_CONTRACT = {
  surfaced_by_service_type: {
    photographer: [
      {
        vendor_id: 'string from ranked_vendors_by_service_type',
        position: 'integer starting at 1',
        demotion_reason: 'string or null',
        user_facing_intro: 'one sentence with archetype-specific reason',
      },
    ],
  },
  overall_summary: 'string',
  flags_for_user: ['string'],
}

const VENDOR_MATCHING_SYSTEM_PROMPT = [
  'You are the 3rdSpace Vendor Matching Agent.',
  'You will receive pre-ranked vendors for each service_type in the archetype vendor_stack.',
  'You may reorder, drop, or limit each list based on conversational signals.',
  'You may not invent vendors, alter scores, or add anyone not in the input.',
  'For each vendor you surface, write a one-sentence user_facing_intro that references at least one archetype-specific reason.',
  'If skipped_stack_items is non-empty, include each one in flags_for_user with a clear explanation.',
  'Return JSON only. Do not include markdown or prose outside JSON.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  `Output JSON must match this contract: ${JSON.stringify(VENDOR_MATCHING_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runVendorMatchingAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<VendorMatchingAgentResult> {
  const startedAt = Date.now()
  const input = vendorMatchingAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: VENDOR_MATCHING_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: vendorMatchingAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, vendorMatchingAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('vendor_matching returned an empty model response', metadata)
  }

  let output: VendorMatchingAgentOutput
  try {
    output = finalizeVendorMatchingOutput(
      vendorMatchingAgentOutputSchema.parse(parseJsonObject(content)),
      input
    )
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: vendorMatchingAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function finalizeVendorMatchingOutput(
  output: VendorMatchingAgentOutput,
  input: VendorMatchingAgentInput
): VendorMatchingAgentOutput {
  const allowedVendorIdsByServiceType = new Map(
    Object.entries(input.ranked_vendors_by_service_type).map(([serviceType, vendors]) => [
      serviceType,
      new Set(vendors.map((vendor) => vendor.vendor_id)),
    ])
  )
  const surfacedByServiceType: VendorMatchingAgentOutput['surfaced_by_service_type'] = {}

  for (const [serviceType, vendors] of Object.entries(output.surfaced_by_service_type)) {
    const allowedVendorIds = allowedVendorIdsByServiceType.get(serviceType)
    if (!allowedVendorIds) {
      throw new Error(`vendor_matching returned unknown service_type: ${serviceType}`)
    }

    const seenVendorIds = new Set<string>()
    surfacedByServiceType[serviceType] = vendors.slice(0, 3).map((vendor, index) => {
      if (!allowedVendorIds.has(vendor.vendor_id)) {
        throw new Error(`vendor_matching returned unknown vendor id: ${vendor.vendor_id}`)
      }
      if (seenVendorIds.has(vendor.vendor_id)) {
        throw new Error(`vendor_matching returned duplicate vendor id: ${vendor.vendor_id}`)
      }
      seenVendorIds.add(vendor.vendor_id)

      return {
        ...vendor,
        position: index + 1,
      }
    })
  }

  const skippedFlags = input.skipped_stack_items.map((item) =>
    `${item.service_type}: ${item.reason.replace(/_/g, ' ')}`
  )
  const flagsForUser = Array.from(new Set([...output.flags_for_user, ...skippedFlags]))

  return vendorMatchingAgentOutputSchema.parse({
    ...output,
    surfaced_by_service_type: surfacedByServiceType,
    flags_for_user: flagsForUser,
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse vendor_matching model JSON'
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
      throw new Error(`Failed to parse vendor_matching model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse vendor_matching model JSON')
  }
}
