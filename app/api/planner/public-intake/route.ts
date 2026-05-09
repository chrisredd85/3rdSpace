export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgent } from '@/lib/ai/agents'
import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import type { EventPlan } from '@/lib/ai/types'
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import type { Plan, PlanMessage } from '@/lib/types'

const publicIntakeRequestSchema = z.object({
  user_message: z.string().trim().min(1).max(4000),
  current_plan: z.record(z.unknown()).nullable().optional(),
})

type PublicIntakeAgentDraft = {
  content: string
  message_type: PlanMessage['message_type']
  metadata: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(`planner-public-intake:${getIpAddress(request)}`, {
      limit: 10,
      windowMs: 60_000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many planner requests. Try again in a minute.' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      )
    }

    const body = publicIntakeRequestSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI intake is not configured' },
        { status: 503 }
      )
    }

    const agentResult = await runAgent({
      agent_name: 'intake',
      event_id: null,
      user_id: 'public-planner-draft',
      payload: {
        user_message: body.data.user_message,
        current_plan: body.data.current_plan ?? null,
        existing_event_plan: buildEventPlanFromPublicDraft(body.data.current_plan ?? null),
      },
    })

    if ((agentResult.status as string) !== 'succeeded') {
      return NextResponse.json(
        { error: 'Intake agent did not complete' },
        { status: 503 }
      )
    }

    const output = agentResult.output as IntakeAgentOutput
    return NextResponse.json({
      data: {
        agent_draft: buildPublicIntakeAgentDraft(output),
        plan_patch: buildPlanPatchFromIntakeOutput(output),
      },
    })
  } catch (error) {
    console.error('[planner.public-intake] failed', error)
    return NextResponse.json(
      { error: 'Unable to run planner intake' },
      { status: 503 }
    )
  }
}

function buildPublicIntakeAgentDraft(output: IntakeAgentOutput): PublicIntakeAgentDraft {
  const missingQuestions = output.missing_questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
  const nextBestQuestion = output.next_best_question?.trim() || null
  const reflection = output.reflection.trim()

  return {
    content: nextBestQuestion
      ? `${reflection} ${nextBestQuestion}`
      : reflection,
    message_type: missingQuestions.length > 0 ? 'text' : 'recommendation',
    metadata: {
      agent_name: 'intake',
      agent_mode: 'openai',
      agent_output: output,
    },
  }
}

function buildPlanPatchFromIntakeOutput(output: IntakeAgentOutput): Partial<Plan> {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const patch: Partial<Plan> = {}

  if (eventPlan.event_name) patch.title = eventPlan.event_name
  if (extracted.event_type || eventPlan.venue_type) patch.event_type = extracted.event_type ?? eventPlan.venue_type

  const guestCount = extracted.guest_count ?? eventPlan.expected_attendance ?? eventPlan.headcount_max ?? eventPlan.headcount_min
  if (typeof guestCount === 'number') patch.guest_count = guestCount

  if (typeof extracted.budget_cap_cents === 'number') {
    patch.budget_cap_cents = extracted.budget_cap_cents
  } else if (typeof eventPlan.budget === 'number') {
    patch.budget_cap_cents = normalizePlanningMoneyToCents(eventPlan.budget)
  }

  if (typeof extracted.profit_goal_cents === 'number') {
    patch.profit_goal_cents = extracted.profit_goal_cents
  } else if (typeof eventPlan.profit_goal === 'number') {
    patch.profit_goal_cents = normalizePlanningMoneyToCents(eventPlan.profit_goal)
  }

  const neighborhood = extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  if (neighborhood) patch.neighborhood = neighborhood

  if (extracted.date_window_start || extracted.date_window_end) {
    patch.date_window_start = extracted.date_window_start
    patch.date_window_end = extracted.date_window_end ?? extracted.date_window_start
  } else if (eventPlan.event_date) {
    patch.date_window_start = eventPlan.event_date
    patch.date_window_end = eventPlan.event_date
  }

  if (typeof extracted.ticketed === 'boolean') {
    patch.ticketed = extracted.ticketed
    patch.ticketing_model = extracted.ticketed ? 'ticketed' : 'rsvp'
  }
  if (eventPlan.monetization_model) {
    patch.ticketing_model = eventPlan.monetization_model
    const monetizationModel = eventPlan.monetization_model.trim().toLowerCase()
    if (monetizationModel.includes('ticket') || monetizationModel.includes('paid')) patch.ticketed = true
    if (
      monetizationModel.includes('free') ||
      monetizationModel.includes('rsvp') ||
      monetizationModel.includes('invite') ||
      monetizationModel.includes('sponsor')
    ) {
      patch.ticketed = false
    }
  }

  if (typeof eventPlan.ticket_price_target === 'number') {
    patch.ticketing_model = patch.ticketing_model ?? 'ticketed'
    patch.ticketed = true
    patch.metadata = {
      ticket_price_target_cents: normalizePlanningMoneyToCents(eventPlan.ticket_price_target),
    }
  }

  if (extracted.food_responsibility) patch.food_responsibility = extracted.food_responsibility
  else if (output.food_drink_needs) patch.food_responsibility = output.food_drink_needs
  patch.updated_at = new Date().toISOString()

  return patch
}

function buildEventPlanFromPublicDraft(plan: Record<string, unknown> | null): EventPlan | null {
  if (!plan) return null

  const guestCount = readNumber(plan.guest_count)
  const budgetCapCents = readNumber(plan.budget_cap_cents)
  const profitGoalCents = readNumber(plan.profit_goal_cents)
  const ticketed = readBoolean(plan.ticketed)

  return {
    event_name: readString(plan.title),
    expected_attendance: guestCount,
    city: readString(plan.city),
    venue_type: readString(plan.event_type),
    budget: budgetCapCents,
    event_date: readString(plan.date_window_start) ?? readString(plan.date_window_end),
    monetization_model: ticketed ? 'ticketed' : readString(plan.ticketing_model),
    headcount_min: guestCount,
    headcount_max: guestCount,
    ticket_price_target: null,
    profit_goal: profitGoalCents,
  }
}

function normalizePlanningMoneyToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 10000 ? value * 100 : value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function getIpAddress(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
