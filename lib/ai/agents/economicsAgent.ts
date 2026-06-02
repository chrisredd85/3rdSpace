import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import {
  calculateEventPlanningEconomics,
  calculateVenueKickbackProjectionCents,
  eventPlanningEconomicsInputSchema,
  eventPlanningEconomicsOutputSchema,
} from '@/lib/finance/eventPlanningEconomics'
import {
  evaluateLiveTriggers,
  liveTriggerSchema,
  pnlSnapshotSchema,
  type LiveTrigger,
  type PnLSnapshot,
} from '@/lib/finance/liveTriggers'

const elasticitySignalSchema = z.object({
  archetype_key: z.string().trim().min(1).nullable(),
  sample_size: z.number().int().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  tier_pattern: z.enum([
    'premium_first',
    'budget_first',
    'middle_first',
    'proportional',
    'vip_dead',
    'unknown',
  ]),
  velocity_vector: z.array(z.object({
    price_cents: z.number().int().nonnegative(),
    avg_days_to_sellout: z.number().nonnegative().nullable(),
    sellout_rate: z.number().min(0).max(1),
  })),
  recommended_price_floor_cents: z.number().int().nonnegative().nullable(),
  recommended_price_ceiling_cents: z.number().int().nonnegative().nullable(),
  reasoning_for_agent: z.string().trim().min(1),
})

const economicsPricePointSchema = z.object({
  price_cents: z.number().int().nonnegative(),
  projected_net_cents: z.number().int(),
  break_even_tickets: z.number().int().nonnegative(),
  recommendation: z.enum(['aggressive', 'recommended', 'conservative', 'avoid']),
  reasoning: z.string().trim().min(1),
})

const modelPricePointSchema = z.object({
  price_cents: z.preprocess(coerceFiniteNumber, z.number().int().nonnegative()),
  recommendation: z.enum(['aggressive', 'recommended', 'conservative', 'avoid']).optional(),
  reasoning: z.string().trim().min(1).optional(),
})

const economicsModeSchema = z.enum(['projection', 'live', 'post_event'])

const debriefSchema = z.object({
  repeat_recommendation: z.enum(['repeat', 'adjust', 'retire']),
  reasoning: z.string().trim().min(1),
})

export const economicsAgentInputSchema = eventPlanningEconomicsInputSchema.extend({
  mode: economicsModeSchema.default('projection'),
  actuals: pnlSnapshotSchema.nullable().default(null),
  venue: z.record(z.unknown()).nullish(),
  score_breakdown: z.record(z.unknown()).nullish(),
  plan: z.record(z.unknown()).nullish(),
  archetype: z.record(z.unknown()).nullish(),
  archetype_intake: z.record(z.unknown()).nullish(),
  mutation_contract: z.record(z.unknown()).nullish(),
  conversation_history: z.array(z.record(z.unknown())).optional(),
  elasticity: elasticitySignalSchema.nullish(),
  historical_attendance: z.record(z.unknown()).nullish(),
  ticket_price_sweep_cents: z.array(z.number().int().nonnegative()).min(1).optional(),
  cost_confidence: z.enum(['confirmed', 'estimated', 'mixed']).default('estimated'),
  negotiated_savings_cents: z.number().int().nonnegative().default(0),
})

const economicsRecommendationSchema = z.object({
  recommendation_summary: z.string().trim().min(1),
  narrative: z.string().trim().min(1).optional(),
  price_points: z.preprocess(
    normalizeModelPricePoints,
    z.array(modelPricePointSchema)
  ).optional(),
  recommended_price_cents: z.preprocess(coerceFiniteNumber, z.number().int().nonnegative()).optional(),
  historical_anchor: z.unknown().nullable().optional(),
  debrief: debriefSchema.optional().nullable(),
})

export const economicsAgentOutputSchema = eventPlanningEconomicsOutputSchema.extend({
  recommendation_summary: z.string().trim().min(1),
  narrative: z.string().trim().min(1),
  price_points: z.array(economicsPricePointSchema),
  recommended_price_cents: z.number().int().nonnegative(),
  historical_anchor: z.string().trim().min(1).nullable(),
  live_triggers: z.array(liveTriggerSchema).optional(),
  debrief: debriefSchema.nullable().optional(),
  pnl_snapshot: pnlSnapshotSchema.nullable().optional(),
})

export type EconomicsAgentInput = z.input<typeof economicsAgentInputSchema>
type ParsedEconomicsAgentInput = z.output<typeof economicsAgentInputSchema>
export type EconomicsAgentOutput = z.infer<typeof economicsAgentOutputSchema>
export type EconomicsAgentResult = AgentResult<EconomicsAgentOutput>

export const economicsAgentDefinition = {
  agentName: 'economics',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const ECONOMICS_SYSTEM_PROMPT = [
  'You are the 3rdPlace Event Economics Agent.',
  'You operate in exactly one mode: projection, live, or post_event.',
  'projection: Explain pre-event profitability projections from supplied hypothetical inputs only.',
  'live: Report on actuals. Each item in live_triggers must be cited with its evidence numbers verbatim. Do not recommend price changes that contradict elasticity bounds. Do not invent triggers.',
  'post_event: Produce a debrief. Compare actuals to the original projection. Output debrief.repeat_recommendation with clear reasoning. No price recommendations.',
  'Return JSON only with recommendation_summary, narrative, price_points, recommended_price_cents, historical_anchor, and optional debrief.',
  'Do not recalculate, overwrite, or reinterpret numeric fields. The application code owns all totals, scenarios, margins, and break-even math.',
  'If any raw model number conflicts with the supplied calculated_price_points or calculated_output_cents, the server will clamp it and annotate with deterministic warnings. Prefer returning null/no value over inventing unsupported profit, cost, or break-even math.',
  'All money in the input is integer cents. Convert cents to dollars only inside display wording.',
  'You will receive an elasticity field with the builder historical tier-level pricing signals when available.',
  'If elasticity.confidence is high, open narrative with one sentence quoting elasticity.reasoning_for_agent verbatim. Then proceed.',
  'recommended_price_cents must fall within [recommended_price_floor_cents, recommended_price_ceiling_cents] when both are set. If you recommend outside this band, explicitly note that it is outside historical patterns.',
  'If elasticity.tier_pattern is vip_dead, do not recommend the highest price point. Note: historically your top tier has not moved, so recommend a tighter band.',
  'If elasticity.confidence is low or elasticity is null, ignore tier elasticity and price using archetype defaults plus venue economics only. Do not fabricate historical patterns.',
  'You will receive cost_confidence for vendor costs. If cost_confidence is confirmed, you may state vendor-cost assumptions directly. If it is mixed, say some vendor rates are confirmed and some are estimates. If it is estimated, hedge the narrative and say vendor quotes still need confirmation.',
  'You will receive negotiated_savings_cents. This is deterministic and organizer-scoped. Never recompute it, never alter it, and only quote it verbatim when useful.',
  'The financial figures come from score_breakdown.financial.details and calculated_price_points and must be used verbatim. Elasticity affects price recommendations, not the math of any specific price point.',
  'Use archetype_intake and conversation_history only for narrative risks and assumptions, such as user-stated load-in windows, outside vendors, or required support. Do not recalculate totals from conversational text.',
  'Honor mutation_contract when present. Treat locked_archetype as authoritative and never reclassify the event inside economics output.',
  'Do not read from a database, send outreach, create bookings, authorize payments, or execute any action.',
].join('\n')

export async function runEconomicsAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<EconomicsAgentResult> {
  const startedAt = Date.now()
  const input = economicsAgentInputSchema.parse(payload)
  const calculations = calculateEventPlanningEconomics(input)
  const deterministicPricePoints = buildPricePoints(input, calculations.cost_summary_cents.total_cost_cents)
  const liveTriggers = input.mode === 'live' && input.actuals
    ? evaluateLiveTriggers(input.actuals)
    : []

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: ECONOMICS_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        mode: input.mode,
        event_plan: input.event_plan,
        input_cents: {
          budget_line_items: input.budget_line_items,
          expected_attendance: input.expected_attendance,
          venue_cost_cents: input.venue_cost_cents,
          vendor_cost_cents: input.vendor_cost_cents,
          ticket_price_cents: input.ticket_price_cents,
          sponsorship_revenue_cents: input.sponsorship_revenue_cents,
          venue_commercial_model: input.venue_commercial_model ?? null,
          venue_kickback_rate: input.venue_kickback_rate,
          estimated_spend_per_head_cents: input.estimated_spend_per_head_cents,
          cost_confidence: input.cost_confidence,
          negotiated_savings_cents: input.negotiated_savings_cents,
        },
        calculated_output_cents: calculations,
        pnl_snapshot: input.actuals,
        live_triggers: liveTriggers,
        score_breakdown: {
          ...(input.score_breakdown ?? {}),
          financial: {
            details: {
              total_cost_cents: calculations.cost_summary_cents.total_cost_cents,
              price_points: deterministicPricePoints,
            },
          },
        },
        elasticity: input.elasticity ?? null,
        historical_attendance: input.historical_attendance ?? null,
        ticket_price_sweep_cents: getTicketPriceSweep(input),
        cost_confidence: input.cost_confidence,
        negotiated_savings_cents: input.negotiated_savings_cents,
        archetype: input.archetype ?? null,
        archetype_intake: input.archetype_intake ?? null,
        mutation_contract: input.mutation_contract ?? null,
        conversation_history: input.conversation_history ?? [],
        venue: input.venue ?? null,
        plan: input.plan ?? null,
      }),
    },
  ]

  const completion = await client.create({
    model: economicsAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, economicsAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('economics returned an empty model response', metadata)
  }

  let output: EconomicsAgentOutput
  try {
    const recommendation = economicsRecommendationSchema.parse(parseJsonObject(content))
    const recommendedPriceCents = input.mode === 'post_event'
      ? 0
      : chooseRecommendedPrice(input, recommendation.recommended_price_cents, deterministicPricePoints)
    const pricePoints = input.mode === 'post_event'
      ? []
      : mergePricePointNarrative(deterministicPricePoints, recommendation.price_points ?? [], recommendedPriceCents, input.elasticity ?? null)
    const historicalAnchor = input.elasticity?.confidence === 'high'
      ? input.elasticity.reasoning_for_agent
      : null
    const narrative = buildNarrative(
      recommendation,
      historicalAnchor,
      calculations.revenue_scenarios.expected.kickback_projection_cents,
      input.mode,
      liveTriggers
    )
    output = economicsAgentOutputSchema.parse({
      ...calculations,
      recommendation_summary: recommendation.recommendation_summary,
      narrative,
      price_points: pricePoints,
      recommended_price_cents: recommendedPriceCents,
      historical_anchor: historicalAnchor,
      live_triggers: liveTriggers,
      debrief: input.mode === 'post_event'
        ? buildPostEventDebrief(recommendation.debrief ?? null, input.actuals, calculations)
        : null,
      pnl_snapshot: input.actuals,
    })
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: economicsAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function buildPricePoints(
  input: ParsedEconomicsAgentInput,
  totalCostCents: number
): z.infer<typeof economicsPricePointSchema>[] {
  const sweep = getTicketPriceSweep(input)
  const netCostAfterSponsorshipCents = Math.max(totalCostCents - input.sponsorship_revenue_cents, 0)

  return sweep.map((priceCents) => {
    const grossTicketRevenueCents = input.expected_attendance * priceCents
    const kickbackProjectionCents = calculateVenueKickbackProjectionCents({
      model: input.venue_commercial_model,
      kickbackRate: input.venue_kickback_rate,
      attendance: input.expected_attendance,
      grossTicketRevenueCents,
      estimatedSpendPerHeadCents: input.estimated_spend_per_head_cents,
    })
    const projectedNetCents = input.expected_attendance * priceCents +
      input.sponsorship_revenue_cents -
      totalCostCents +
      kickbackProjectionCents

    return {
      price_cents: priceCents,
      projected_net_cents: projectedNetCents,
      break_even_tickets: priceCents > 0
        ? clampBreakEvenTickets(Math.ceil(netCostAfterSponsorshipCents / priceCents), input.expected_attendance)
        : 0,
      recommendation: 'conservative',
      reasoning: `At ${formatCurrency(priceCents)}, projected net is ${formatCurrency(projectedNetCents)}.`,
    }
  })
}

function clampBreakEvenTickets(rawBreakEvenTickets: number, expectedAttendance: number): number {
  if (expectedAttendance <= 0) return 0
  return Math.min(Math.max(rawBreakEvenTickets, 1), expectedAttendance)
}

function normalizeModelPricePoints(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return value

  return Object.entries(value as Record<string, unknown>).map(([key, rawPoint]) => {
    if (typeof rawPoint === 'number' || typeof rawPoint === 'string') {
      return {
        price_cents: rawPoint,
        recommendation: recommendationFromPricePointKey(key),
      }
    }
    if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) return rawPoint
    const point = rawPoint as Record<string, unknown>
    return {
      ...point,
      recommendation: normalizeModelRecommendation(point.recommendation) ?? recommendationFromPricePointKey(key),
    }
  })
}

function normalizeModelRecommendation(value: unknown): 'aggressive' | 'recommended' | 'conservative' | 'avoid' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'aggressive' || normalized === 'recommended' || normalized === 'conservative' || normalized === 'avoid') {
    return normalized
  }
  return null
}

function recommendationFromPricePointKey(key: string): 'aggressive' | 'recommended' | 'conservative' | 'avoid' | undefined {
  const normalized = key.trim().toLowerCase()
  if (/\b(avoid|risky|high_end)\b/.test(normalized)) return 'avoid'
  if (/\b(optimistic|aggressive|premium)\b/.test(normalized)) return 'aggressive'
  if (/\b(mid|middle|recommended|target)\b/.test(normalized)) return 'recommended'
  if (/\b(conservative|floor|budget|low)\b/.test(normalized)) return 'conservative'
  return undefined
}

function coerceFiniteNumber(value: unknown): unknown {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return value

  const parsed = Number.parseFloat(value.replace(/[$,%\s,]/g, ''))
  return Number.isFinite(parsed) ? parsed : value
}

function getTicketPriceSweep(input: ParsedEconomicsAgentInput): number[] {
  const rawSweep = input.ticket_price_sweep_cents?.length
    ? input.ticket_price_sweep_cents
    : [input.ticket_price_cents || 2500, 5000, 7500, 10000]

  return Array.from(new Set(rawSweep.filter((price) => price >= 0).map((price) => Math.round(price))))
    .sort((first, second) => first - second)
}

function chooseRecommendedPrice(
  input: ParsedEconomicsAgentInput,
  modelRecommendedPrice: number | undefined,
  pricePoints: z.infer<typeof economicsPricePointSchema>[]
): number {
  const prices = pricePoints.map((point) => point.price_cents)
  const elasticity = input.elasticity ?? null
  const floor = elasticity?.recommended_price_floor_cents ?? null
  const ceiling = elasticity?.recommended_price_ceiling_cents ?? null
  const highestPrice = Math.max(...prices)
  const modelChoiceIsAllowed =
    modelRecommendedPrice !== undefined &&
    prices.includes(modelRecommendedPrice) &&
    (floor === null || modelRecommendedPrice >= floor) &&
    (ceiling === null || modelRecommendedPrice <= ceiling) &&
    !(elasticity?.tier_pattern === 'vip_dead' && modelRecommendedPrice === highestPrice)

  if (modelChoiceIsAllowed) return modelRecommendedPrice

  const eligible = pricePoints.filter((point) => {
    if (floor !== null && point.price_cents < floor) return false
    if (ceiling !== null && point.price_cents > ceiling) return false
    if (elasticity?.tier_pattern === 'vip_dead' && point.price_cents === highestPrice) return false
    return true
  })
  const candidates = eligible.length > 0 ? eligible : pricePoints
  const profitable = candidates.filter((point) => point.projected_net_cents >= 0)

  return (profitable[0] ?? candidates[candidates.length - 1] ?? pricePoints[0])?.price_cents ?? input.ticket_price_cents
}

function mergePricePointNarrative(
  deterministicPoints: z.infer<typeof economicsPricePointSchema>[],
  modelPoints: Array<{
    price_cents: number
    recommendation?: 'aggressive' | 'recommended' | 'conservative' | 'avoid'
    reasoning?: string
  }>,
  recommendedPriceCents: number,
  elasticity: ParsedEconomicsAgentInput['elasticity']
): z.infer<typeof economicsPricePointSchema>[] {
  const modelByPrice = new Map(modelPoints.map((point) => [point.price_cents, point]))
  const highestPrice = Math.max(...deterministicPoints.map((point) => point.price_cents))

  return deterministicPoints.map((point) => {
    const modelPoint = modelByPrice.get(point.price_cents)
    const recommendation = elasticity?.tier_pattern === 'vip_dead' && point.price_cents === highestPrice
      ? 'avoid'
      : point.price_cents === recommendedPriceCents
        ? 'recommended'
        : point.price_cents > recommendedPriceCents
          ? 'aggressive'
          : 'conservative'

    return {
      ...point,
      recommendation,
      reasoning: modelPoint?.reasoning?.trim() || point.reasoning,
    }
  })
}

function buildNarrative(
  recommendation: z.infer<typeof economicsRecommendationSchema>,
  historicalAnchor: string | null,
  expectedKickbackProjectionCents: number,
  mode: z.infer<typeof economicsModeSchema>,
  liveTriggers: LiveTrigger[]
): string {
  const narrative = recommendation.narrative ?? recommendation.recommendation_summary
  const withKickbackLine = expectedKickbackProjectionCents > 0
    ? `${narrative} Expected venue kickback: ${formatCurrency(expectedKickbackProjectionCents)}.`
    : narrative
  const withTriggerEvidence = mode === 'live' && liveTriggers.length > 0
    ? `${withKickbackLine} ${formatLiveTriggerEvidence(liveTriggers)}`
    : withKickbackLine

  if (!historicalAnchor) return withTriggerEvidence
  if (withTriggerEvidence.startsWith(historicalAnchor)) return withTriggerEvidence
  return `${historicalAnchor} ${withTriggerEvidence}`
}

function formatLiveTriggerEvidence(liveTriggers: LiveTrigger[]) {
  const triggerSummary = liveTriggers.map((trigger) => {
    const evidence = Object.entries(trigger.evidence)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')
    return `${trigger.trigger_key} evidence ${evidence}`
  }).join('; ')

  return `Live triggers fired: ${triggerSummary}.`
}

function buildPostEventDebrief(
  modelDebrief: z.infer<typeof debriefSchema> | null,
  actuals: PnLSnapshot | null,
  calculations: z.infer<typeof eventPlanningEconomicsOutputSchema>
) {
  if (modelDebrief) return modelDebrief
  if (!actuals) {
    return {
      repeat_recommendation: 'adjust' as const,
      reasoning: 'No actual P&L snapshot was supplied, so repeatability cannot be scored from real event data yet.',
    }
  }

  const expectedProjectionCents = calculations.profit_projection_cents
  const actualExpectedNetCents = actuals.net.expected_cents
  const attendanceRatio = actuals.revenue.tickets_sold > 0 && calculations.revenue_scenarios.optimistic.attendance > 0
    ? actuals.revenue.tickets_sold / calculations.revenue_scenarios.optimistic.attendance
    : 0
  const refundRatio = actuals.revenue.gross_revenue_cents > 0
    ? actuals.revenue.refunds_cents / actuals.revenue.gross_revenue_cents
    : 0

  if (actualExpectedNetCents < 0 && (refundRatio >= 0.25 || attendanceRatio < 0.5)) {
    return {
      repeat_recommendation: 'retire' as const,
      reasoning: `Actual expected net was ${actualExpectedNetCents} cents against the original expected projection of ${expectedProjectionCents} cents, with refund_ratio=${roundNumber(refundRatio)} and attendance_ratio=${roundNumber(attendanceRatio)}.`,
    }
  }

  if (actualExpectedNetCents >= expectedProjectionCents && actuals.margin_pct >= 20 && attendanceRatio >= 0.8) {
    return {
      repeat_recommendation: 'repeat' as const,
      reasoning: `Actual expected net was ${actualExpectedNetCents} cents against the original expected projection of ${expectedProjectionCents} cents, margin_pct=${actuals.margin_pct}, and attendance_ratio=${roundNumber(attendanceRatio)}.`,
    }
  }

  return {
    repeat_recommendation: 'adjust' as const,
    reasoning: `Actual expected net was ${actualExpectedNetCents} cents against the original expected projection of ${expectedProjectionCents} cents, with margin_pct=${actuals.margin_pct}, refund_ratio=${roundNumber(refundRatio)}, and attendance_ratio=${roundNumber(attendanceRatio)}.`,
  }
}

function roundNumber(value: number) {
  return Math.round(value * 10000) / 10000
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse economics model JSON'
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
      throw new Error(`Failed to parse economics model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse economics model JSON')
  }
}
