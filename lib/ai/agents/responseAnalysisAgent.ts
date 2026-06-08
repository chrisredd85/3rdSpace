import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

const centsSchema = z.number().int().nonnegative().nullable()

export const responseAnalysisAgentInputSchema = z.object({
  raw_email_text: z.string().trim().min(1),
  attachments_text: z.string().trim().min(1).nullish(),
  event_plan: eventPlanSchema,
  partner_type: z.enum(['venue', 'vendor', 'sponsor']),
})

export const responseAnalysisAgentOutputSchema = z.object({
  availability_status: z.enum(['available', 'unavailable', 'tentative', 'unknown']),
  quoted_price_cents: centsSchema,
  minimum_spend_cents: centsSchema,
  deposit_required_cents: centsSchema,
  capacity_notes: z.string().trim().min(1).nullable(),
  included_services: z.array(z.string().trim().min(1)),
  exclusions: z.array(z.string().trim().min(1)),
  hidden_fees: z.array(z.string().trim().min(1)),
  cancellation_terms: z.string().trim().min(1).nullable(),
  required_next_steps: z.array(z.string().trim().min(1)),
  summary: z.string().trim().min(1),
  risk_flags: z.array(z.string().trim().min(1)),
  extracted_questions: z.array(z.string().trim().min(1)),
})

export type ResponseAnalysisAgentInput = z.infer<typeof responseAnalysisAgentInputSchema>
export type ResponseAnalysisAgentOutput = z.infer<typeof responseAnalysisAgentOutputSchema>
export type ResponseAnalysisAgentResult = AgentResult<ResponseAnalysisAgentOutput>

export const responseAnalysisAgentDefinition = {
  agentName: 'response_analysis',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const RESPONSE_ANALYSIS_OUTPUT_CONTRACT = {
  availability_status: 'available | unavailable | tentative | unknown',
  quoted_price_cents: 'integer cents or null',
  minimum_spend_cents: 'integer cents or null',
  deposit_required_cents: 'integer cents or null',
  capacity_notes: 'string or null',
  included_services: ['string'],
  exclusions: ['string'],
  hidden_fees: ['string'],
  cancellation_terms: 'string or null',
  required_next_steps: ['string'],
  summary: 'string',
  risk_flags: ['string'],
  extracted_questions: ['string'],
}

const RESPONSE_ANALYSIS_SYSTEM_PROMPT = [
  'You are the 3rdPlace Response Analysis Agent.',
  'Parse venue, vendor, and sponsor replies into structured booking data.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'All monetary outputs must be integer cents. Never return dollar-decimal strings or formatted money.',
  'Use null for any field not present in the email or attachment text. Never invent missing terms.',
  'If the email gives a deposit percentage and a minimum spend or quoted price, calculate deposit_required_cents from that base amount.',
  'Flag ambiguous pricing in risk_flags.',
  'Flag contract, payment, deposit, refund, cancellation, service charge, tax, gratuity, and fee risks in risk_flags.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  `Output JSON must match this contract: ${JSON.stringify(RESPONSE_ANALYSIS_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runResponseAnalysisAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<ResponseAnalysisAgentResult> {
  const startedAt = Date.now()
  const input = responseAnalysisAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: RESPONSE_ANALYSIS_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: responseAnalysisAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, responseAnalysisAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('response_analysis returned an empty model response', metadata)
  }

  let output: ResponseAnalysisAgentOutput
  try {
    const modelOutput = responseAnalysisAgentOutputSchema.parse(parseJsonObject(content))
    output = finalizeResponseAnalysisOutput(input, modelOutput)
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: responseAnalysisAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse response_analysis model JSON'
}

function finalizeResponseAnalysisOutput(
  input: ResponseAnalysisAgentInput,
  modelOutput: ResponseAnalysisAgentOutput
): ResponseAnalysisAgentOutput {
  const sourceText = [input.raw_email_text, input.attachments_text ?? ''].join('\n')
  const depositPercentage = extractDepositPercentage(sourceText)
  const depositBaseCents = modelOutput.minimum_spend_cents ?? modelOutput.quoted_price_cents
  const depositRequiredCents = modelOutput.deposit_required_cents
    ?? (depositPercentage !== null && depositBaseCents !== null
      ? Math.round(depositBaseCents * depositPercentage)
      : null)

  return responseAnalysisAgentOutputSchema.parse({
    ...modelOutput,
    deposit_required_cents: depositRequiredCents,
    risk_flags: addDeterministicRiskFlags(modelOutput.risk_flags, sourceText, depositRequiredCents),
  })
}

function extractDepositPercentage(sourceText: string): number | null {
  const depositMatch = sourceText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:non[-\s]?refundable\s*)?deposit/i)
    ?? sourceText.match(/deposit\s*(?:of|is|:)?\s*(\d+(?:\.\d+)?)\s*%/i)

  if (!depositMatch?.[1]) return null

  const percentage = Number(depositMatch[1])
  if (!Number.isFinite(percentage) || percentage <= 0) return null

  return percentage / 100
}

function addDeterministicRiskFlags(
  riskFlags: string[],
  sourceText: string,
  depositRequiredCents: number | null
): string[] {
  const normalizedText = sourceText.toLowerCase()
  const flags = new Set(riskFlags)

  if (/\b(starting at|estimate|estimated|subject to|plus fees|fees tbd|tax not included|service charge|gratuity)\b/i.test(sourceText)) {
    flags.add('Pricing may be ambiguous or incomplete.')
  }

  if (/\b(contract|payment due|non[-\s]?refundable|deposit|cancellation|refund)\b/i.test(sourceText)) {
    flags.add('Contract, payment, deposit, or cancellation terms require review before approval.')
  }

  if (normalizedText.includes('deposit') && depositRequiredCents === null) {
    flags.add('Deposit terms are mentioned but the required deposit amount is unclear.')
  }

  return Array.from(flags)
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
      throw new Error(`Failed to parse response_analysis model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse response_analysis model JSON')
  }
}
