export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveArchetypeKey } from '@/lib/planner/archetypes'
import { PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { summarizeBuilderAttendance } from '@/lib/server/builderAttendanceHistory'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan, Recommendation } from '@/lib/types'

const TEMPLATE_SELECT_COLUMNS = `
  id,
  name,
  event_type,
  target_audience,
  guest_count_min,
  guest_count_max,
  budget_model,
  ticket_price_model,
  profit_assumptions,
  kickback_model,
  run_of_show,
  shopping_list,
  email_copy,
  export_copy,
  approval_checklist,
  historical_performance,
  created_at
`

type TemplateRow = {
  id: string
  name: string
  event_type: string | null
  target_audience: string | null
  guest_count_min: number | null
  guest_count_max: number | null
  budget_model: Json
  ticket_price_model: Json
  profit_assumptions: Json
  kickback_model: Json
  run_of_show: Json
  shopping_list: Json
  email_copy: string | null
  export_copy: string | null
  approval_checklist: Json
  historical_performance: Json
  created_at: string
}

type PlannerTemplate = {
  id: string
  name: string
  description: string | null
  snapshot: Json
  created_at: string
}

type PlannerDb = { from: (table: string) => any }

const createTemplateSchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
})

export async function GET() {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('templates')
      .select(TEMPLATE_SELECT_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[agent.run] Planner templates GET failed', error)
      return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
    }

    return NextResponse.json({ templates: (data ?? []).map(normalizeTemplateRow) })
  } catch (error) {
    console.error('[agent.run] Planner templates GET unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const db = supabase as unknown as PlannerDb
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = createTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const { data: planData, error: planError } = await db
      .from('plans')
      .select(PLAN_SELECT_COLUMNS)
      .eq('id', parsed.data.plan_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (planError) {
      console.error('[planner.templates] Source plan lookup failed', planError)
      return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 })
    }

    const plan = planData as Plan | null
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const { data: recommendationsData, error: recommendationsError } = await db
      .from('recommendations')
      .select(RECOMMENDATION_SELECT_COLUMNS)
      .eq('plan_id', plan.id)
      .order('rank', { ascending: true })
      .limit(12)

    if (recommendationsError) {
      console.error('[planner.templates] Recommendation snapshot lookup failed', recommendationsError)
      return NextResponse.json({ error: 'Failed to load recommendations' }, { status: 500 })
    }

    // Best-effort: fetch builder profile to pull historical attendance stats.
    // A missing builder profile is not fatal — we fall back to empty history.
    const { data: builderProfileRow } = await supabase
      .from('builder_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    const builderProfileId = (builderProfileRow as { id?: string } | null)?.id ?? null
    const archetypeKey = resolveArchetypeKey([plan.event_type ?? ''].join(' '))
    const attendanceSummary = builderProfileId
      ? await summarizeBuilderAttendance(supabase as never, builderProfileId, {
          archetype_key: archetypeKey ?? undefined,
        })
      : null

    const templateInsert = buildTemplateInsert({
      userId: user.id,
      plan,
      recommendations: (recommendationsData ?? []) as Recommendation[],
      requestedName: parsed.data.name,
      attendanceSummary,
    })

    const { data: template, error: insertError } = await db
      .from('templates')
      .insert(templateInsert)
      .select(TEMPLATE_SELECT_COLUMNS)
      .single()

    if (insertError || !template) {
      console.error('[planner.templates] Template insert failed', insertError)
      return NextResponse.json({ error: 'Failed to save template' }, { status: 500 })
    }

    return NextResponse.json({ template: normalizeTemplateRow(template as TemplateRow) }, { status: 201 })
  } catch (error) {
    console.error('[planner.templates] POST unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

function normalizeTemplateRow(row: TemplateRow): PlannerTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.target_audience ?? row.event_type ?? row.export_copy,
    snapshot: {
      event_type: row.event_type,
      target_audience: row.target_audience,
      guest_count_min: row.guest_count_min,
      guest_count_max: row.guest_count_max,
      budget_model: row.budget_model,
      ticket_price_model: row.ticket_price_model,
      profit_assumptions: row.profit_assumptions,
      kickback_model: row.kickback_model,
      run_of_show: row.run_of_show,
      shopping_list: row.shopping_list,
      email_copy: row.email_copy,
      approval_checklist: row.approval_checklist,
      historical_performance: row.historical_performance,
    } as Json,
    created_at: row.created_at,
  }
}

type AttendanceSummaryInput = {
  archetype_key: string | null
  sample_size: number
  avg_tickets_sold: number
  p75_tickets_sold: number
  p95_tickets_sold: number
  last_event_at: string | null
  confidence: 'low' | 'medium' | 'high'
} | null

function buildTemplateInsert(input: {
  userId: string
  plan: Plan
  recommendations: Recommendation[]
  requestedName?: string
  attendanceSummary: AttendanceSummaryInput
}) {
  const metadata = readRecord(input.plan.metadata)
  const ticketPriceTargetCents = readNumber(metadata?.ticket_price_target_cents) ?? readNumber(metadata?.ticket_price_target)
  const guestCount = input.plan.guest_count
  const recommendations = input.recommendations.map((recommendation) => ({
    id: recommendation.id,
    type: recommendation.type,
    reference_id: recommendation.reference_id,
    external_name: recommendation.external_name,
    price_cents: recommendation.price_cents,
    rank: recommendation.rank,
    is_best_fit: recommendation.is_best_fit,
    metadata: recommendation.metadata,
  }))
  const economicsRecommendation = input.recommendations.find((recommendation) => {
    const metadata = readRecord(recommendation.metadata)
    return readString(metadata?.recommendation_type) === 'economics'
  })
  const economicsMetadata = readRecord(economicsRecommendation?.metadata)

  return {
    user_id: input.userId,
    source_plan_id: input.plan.id,
    name: input.requestedName ?? buildDefaultTemplateName(input.plan),
    event_type: input.plan.event_type,
    target_audience: input.plan.neighborhood,
    guest_count_min: typeof guestCount === 'number' ? Math.max(0, Math.floor(guestCount * 0.8)) : null,
    guest_count_max: typeof guestCount === 'number' ? Math.ceil(guestCount * 1.2) : null,
    budget_model: {
      budget_cap_cents: input.plan.budget_cap_cents,
      venue_terms: input.plan.venue_terms,
      food_responsibility: input.plan.food_responsibility,
      source: 'planner_plan',
      accuracy: 'estimate_until_partner_quotes_confirmed',
    } as Json,
    ticket_price_model: {
      ticketed: input.plan.ticketed,
      ticketing_model: input.plan.ticketing_model,
      ticket_price_target_cents: ticketPriceTargetCents,
      source: 'planner_plan',
    } as Json,
    profit_assumptions: {
      profit_goal_cents: input.plan.profit_goal_cents,
      latest_economics: economicsMetadata,
      accuracy: 'estimate_until_partner_quotes_confirmed',
    } as Json,
    kickback_model: {
      venue_terms: input.plan.venue_terms,
      food_responsibility: input.plan.food_responsibility,
    } as Json,
    run_of_show: (readRecord(metadata?.run_of_show) ?? readRecord(metadata?.timeline) ?? {}) as Json,
    shopping_list: {
      recommendations,
      selected_venue: recommendations.find((recommendation) => recommendation.type === 'venue' && recommendation.is_best_fit) ?? null,
      selected_vendors: recommendations.filter((recommendation) => recommendation.type === 'vendor'),
    } as Json,
    email_copy: null,
    export_copy: buildTemplateExportCopy(input.plan),
    approval_checklist: {
      required_before_execution: [
        'Refresh recommendations for the new date and headcount.',
        'Confirm venue/vendor quotes.',
        'Approve outreach before any partner is contacted.',
        'Authorize deposits only after partner terms are confirmed.',
      ],
    } as Json,
    historical_performance: buildHistoricalPerformance(input.attendanceSummary) as Json,
  }
}

function buildDefaultTemplateName(plan: Plan): string {
  const base = plan.title || plan.event_type || 'Event plan'
  return `${base} template`
}

function buildTemplateExportCopy(plan: Plan): string {
  const parts = [
    plan.event_type,
    typeof plan.guest_count === 'number' ? `${plan.guest_count} guests` : null,
    plan.neighborhood,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : 'Reusable planner template'
}

function buildHistoricalPerformance(summary: AttendanceSummaryInput): Record<string, unknown> {
  if (!summary || summary.sample_size === 0) return {}
  return {
    source: 'builder_history_aggregate',
    archetype_key: summary.archetype_key,
    sample_size: summary.sample_size,
    confidence: summary.confidence,
    avg_tickets_sold: summary.avg_tickets_sold,
    p75_tickets_sold: summary.p75_tickets_sold,
    p95_tickets_sold: summary.p95_tickets_sold,
    last_event_at: summary.last_event_at,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
