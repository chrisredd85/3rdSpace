import { z } from 'zod'
import { eventPlanSchema } from '@/lib/ai/types'
import { marginRatioToPercent } from '@/lib/money'

const SCENARIO_ATTENDANCE_RATES = {
  conservative: 0.7,
  expected: 0.85,
  optimistic: 1,
} as const

const TARGET_PROFIT_MARGIN_RATIO = 0.2
const TARGET_PROFIT_MARGIN_PERCENT = 20
const DEFAULT_ESTIMATED_SPEND_PER_HEAD_CENTS = 4000

const venueCommercialModelSchema = z.enum([
  'flat_rental',
  'minimum_spend',
  'per_head_chi_cents',
  'bar_consumption_share',
  'ticket_consumption_share',
])

export const budgetLineItemSchema = z.object({
  label: z.string().trim().min(1),
  amount_cents: z.number().int().nonnegative(),
  category: z.string().trim().min(1).optional(),
})

export const eventPlanningEconomicsInputSchema = z.object({
  event_plan: eventPlanSchema,
  budget_line_items: z.array(budgetLineItemSchema).default([]),
  expected_attendance: z.number().int().nonnegative(),
  venue_cost_cents: z.number().int().nonnegative(),
  vendor_cost_cents: z.number().int().nonnegative(),
  ticket_price_cents: z.number().int().nonnegative(),
  sponsorship_revenue_cents: z.number().int().nonnegative().default(0),
  venue_commercial_model: venueCommercialModelSchema.optional(),
  venue_chi_rate: z.number().nonnegative().default(0),
  estimated_spend_per_head_cents: z.number().int().nonnegative().default(DEFAULT_ESTIMATED_SPEND_PER_HEAD_CENTS),
})

export const revenueScenarioSchema = z.object({
  attendance: z.number().int().nonnegative(),
  ticket_revenue_cents: z.number().int(),
  sponsorship_revenue_cents: z.number().int(),
  venue_chi_projection_cents: z.number().int(),
  total_revenue_cents: z.number().int(),
  total_cost_cents: z.number().int(),
  profit_cents: z.number().int(),
  profit_margin: z.number().describe('Profit margin in percentage points, not a 0-1 ratio.'),
})

export const eventPlanningEconomicsOutputSchema = z.object({
  break_even_attendance: z.number().int().nonnegative().nullable(),
  recommended_ticket_price_range: z.object({
    min_cents: z.number().int().nonnegative(),
    max_cents: z.number().int().nonnegative(),
  }),
  revenue_scenarios: z.object({
    conservative: revenueScenarioSchema,
    expected: revenueScenarioSchema,
    optimistic: revenueScenarioSchema,
  }),
  cost_summary_cents: z.object({
    venue_cost_cents: z.number().int().nonnegative(),
    vendor_cost_cents: z.number().int().nonnegative(),
    budget_line_items_total_cents: z.number().int().nonnegative(),
    total_cost_cents: z.number().int().nonnegative(),
  }),
  profit_projection_cents: z.number().int(),
  risk_flags: z.array(z.string().trim().min(1)),
})

export type BudgetLineItem = z.infer<typeof budgetLineItemSchema>
export type EventPlanningEconomicsInput = z.input<typeof eventPlanningEconomicsInputSchema>
type ParsedEventPlanningEconomicsInput = z.output<typeof eventPlanningEconomicsInputSchema>
export type EventPlanningEconomicsOutput = z.infer<typeof eventPlanningEconomicsOutputSchema>
export type RevenueScenarioName = keyof typeof SCENARIO_ATTENDANCE_RATES

export function calculateEventPlanningEconomics(
  rawInput: EventPlanningEconomicsInput
): EventPlanningEconomicsOutput {
  const input = eventPlanningEconomicsInputSchema.parse(rawInput)
  const budgetLineItemsTotalCents = input.budget_line_items.reduce(
    (sum, item) => sum + item.amount_cents,
    0
  )
  const knownCostCents = input.venue_cost_cents + input.vendor_cost_cents + budgetLineItemsTotalCents
  const totalCostCents = Math.max(knownCostCents, input.event_plan.budget ?? 0)
  const netCostAfterSponsorshipCents = Math.max(totalCostCents - input.sponsorship_revenue_cents, 0)
  const rawBreakEvenAttendance =
    input.ticket_price_cents > 0 ? Math.ceil(netCostAfterSponsorshipCents / input.ticket_price_cents) : null
  const breakEvenAttendance = clampBreakEvenAttendance(rawBreakEvenAttendance, input.expected_attendance)
  const revenueScenarios = {
    conservative: buildRevenueScenario('conservative', input, totalCostCents),
    expected: buildRevenueScenario('expected', input, totalCostCents),
    optimistic: buildRevenueScenario('optimistic', input, totalCostCents),
  }
  const expectedScenario = revenueScenarios.expected

  return eventPlanningEconomicsOutputSchema.parse({
    break_even_attendance: breakEvenAttendance,
    recommended_ticket_price_range: buildRecommendedTicketPriceRange(
      input.expected_attendance,
      totalCostCents,
      input.sponsorship_revenue_cents
    ),
    revenue_scenarios: revenueScenarios,
    cost_summary_cents: {
      venue_cost_cents: input.venue_cost_cents,
      vendor_cost_cents: input.vendor_cost_cents,
      budget_line_items_total_cents: budgetLineItemsTotalCents,
      total_cost_cents: totalCostCents,
    },
    profit_projection_cents: expectedScenario.profit_cents,
    risk_flags: buildRiskFlags(input, rawBreakEvenAttendance, expectedScenario, revenueScenarios.optimistic),
  })
}

function buildRevenueScenario(
  scenario: RevenueScenarioName,
  input: ParsedEventPlanningEconomicsInput,
  totalCostCents: number
) {
  const attendance = Math.floor(input.expected_attendance * SCENARIO_ATTENDANCE_RATES[scenario])
  const ticketRevenueCents = attendance * input.ticket_price_cents
  const chiProjectionCents = calculateVenueChiProjectionCents({
    model: input.venue_commercial_model,
    chiRate: input.venue_chi_rate,
    attendance,
    grossTicketRevenueCents: ticketRevenueCents,
    estimatedSpendPerHeadCents: input.estimated_spend_per_head_cents,
  })
  const totalRevenueCents = ticketRevenueCents + input.sponsorship_revenue_cents + chiProjectionCents
  const profitCents = totalRevenueCents - totalCostCents

  return revenueScenarioSchema.parse({
    attendance,
    ticket_revenue_cents: ticketRevenueCents,
    sponsorship_revenue_cents: input.sponsorship_revenue_cents,
    venue_chi_projection_cents: chiProjectionCents,
    total_revenue_cents: totalRevenueCents,
    total_cost_cents: totalCostCents,
    profit_cents: profitCents,
    profit_margin: calculateProfitMargin(profitCents, totalRevenueCents),
  })
}

export function calculateVenueChiProjectionCents({
  model,
  chiRate,
  attendance,
  grossTicketRevenueCents,
  estimatedSpendPerHeadCents = DEFAULT_ESTIMATED_SPEND_PER_HEAD_CENTS,
}: {
  model?: z.infer<typeof venueCommercialModelSchema>
  chiRate?: number
  attendance: number
  grossTicketRevenueCents: number
  estimatedSpendPerHeadCents?: number
}) {
  const rate = Number.isFinite(chiRate ?? 0) ? Math.max(chiRate ?? 0, 0) : 0
  if (model === 'per_head_chi_cents') {
    return Math.round(rate) * attendance
  }

  if (model === 'bar_consumption_share') {
    const estimatedBarRevenueCents = attendance * Math.max(estimatedSpendPerHeadCents, 0)
    return Math.round(estimatedBarRevenueCents * (rate / 100))
  }

  if (model === 'ticket_consumption_share') {
    return Math.round(grossTicketRevenueCents * (rate / 100))
  }

  return 0
}

function buildRecommendedTicketPriceRange(
  expectedAttendance: number,
  totalCostCents: number,
  sponsorshipRevenueCents: number
) {
  const expectedPaidAttendance = Math.floor(expectedAttendance * SCENARIO_ATTENDANCE_RATES.expected)
  if (expectedPaidAttendance <= 0) {
    return { min_cents: 0, max_cents: 0 }
  }

  const netCostAfterSponsorshipCents = Math.max(totalCostCents - sponsorshipRevenueCents, 0)
  const breakEvenPriceCents = roundUpToNearestDollarCents(
    Math.ceil(netCostAfterSponsorshipCents / expectedPaidAttendance)
  )
  const targetMarginPriceCents = roundUpToNearestDollarCents(
    Math.ceil(netCostAfterSponsorshipCents / ((1 - TARGET_PROFIT_MARGIN_RATIO) * expectedPaidAttendance))
  )

  return {
    min_cents: breakEvenPriceCents,
    max_cents: Math.max(breakEvenPriceCents, targetMarginPriceCents),
  }
}

function buildRiskFlags(
  input: ParsedEventPlanningEconomicsInput,
  rawBreakEvenAttendance: number | null,
  expectedScenario: z.infer<typeof revenueScenarioSchema>,
  optimisticScenario: z.infer<typeof revenueScenarioSchema>
) {
  const flags: string[] = []

  if (expectedScenario.profit_margin < TARGET_PROFIT_MARGIN_PERCENT) {
    flags.push('Expected scenario is below a 20% projected profit margin.')
  }

  if (rawBreakEvenAttendance !== null && rawBreakEvenAttendance > input.expected_attendance) {
    flags.push('Break-even attendance is higher than expected attendance.')
  }

  if (input.ticket_price_cents === 0 && expectedScenario.profit_cents < 0) {
    flags.push('Ticket price is zero while projected costs exceed sponsorship revenue.')
  }

  if (input.sponsorship_revenue_cents === 0 && input.event_plan.monetization_model === 'free') {
    flags.push('Free event has no sponsorship revenue in the planning inputs.')
  }

  const profitGoalCents = input.event_plan.profit_goal
  if (profitGoalCents !== null && profitGoalCents > optimisticScenario.profit_cents) {
    flags.push(
      `Profit goal ${formatCurrency(profitGoalCents)} exceeds the maximum possible ${formatCurrency(optimisticScenario.profit_cents)} at ${input.expected_attendance} guests and ${formatCurrency(input.ticket_price_cents)} tickets with current projected costs.`
    )
  }

  return flags
}

function clampBreakEvenAttendance(rawBreakEvenAttendance: number | null, expectedAttendance: number): number | null {
  if (rawBreakEvenAttendance === null) return null
  if (expectedAttendance <= 0) return 0
  return clamp(rawBreakEvenAttendance, 1, expectedAttendance)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function calculateProfitMargin(profitCents: number, totalRevenueCents: number) {
  if (totalRevenueCents <= 0) return 0
  return marginRatioToPercent(profitCents / totalRevenueCents) ?? 0
}

function roundUpToNearestDollarCents(valueCents: number) {
  return Math.ceil(valueCents / 100) * 100
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
