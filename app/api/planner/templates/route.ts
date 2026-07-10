export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonWithDeprecatedKeys } from '@/lib/api/legacy-key-compat'
import { resolveArchetypeKey } from '@/lib/planner/archetypes'
import { PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildTemplateInsert,
  isEligibleTemplateSourceEvent,
  normalizeTemplateRow,
  type TemplateRow,
  type TemplateSourceEventRow,
} from '@/lib/planner/templateIdentity'
import { summarizeBuilderAttendance } from '@/lib/server/builderAttendanceHistory'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan, Recommendation } from '@/lib/types'

const TEMPLATE_SELECT_COLUMNS = `
  id,
  name,
  source_event_id,
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

const TEMPLATE_SOURCE_EVENT_SELECT_COLUMNS = `
  id,
  plan_id,
  status,
  ends_at,
  outcome_summary,
  outcome_recorded_at
`

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

    return jsonWithDeprecatedKeys(
      { templates: (data ?? []).map(normalizeTemplateRow) },
      ['kickback_model']
    )
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

    if (!plan.materialized_event_id) {
      return NextResponse.json(
        {
          error: 'Complete the canonical event before saving it as a template',
          code: 'template_source_event_required',
        },
        { status: 409 }
      )
    }
    if (plan.status !== 'completed' && plan.status !== 'complete') {
      return NextResponse.json(
        {
          error: 'Templates can only be saved after the canonical event is completed',
          code: 'template_source_plan_incomplete',
        },
        { status: 409 }
      )
    }

    const { data: sourceEventData, error: sourceEventError } = await db
      .from('events')
      .select(TEMPLATE_SOURCE_EVENT_SELECT_COLUMNS)
      .eq('id', plan.materialized_event_id)
      .eq('plan_id', plan.id)
      .maybeSingle()

    if (sourceEventError) {
      console.error('[planner.templates] Canonical source event lookup failed', sourceEventError)
      return NextResponse.json({ error: 'Failed to load canonical event' }, { status: 500 })
    }

    if (!isEligibleTemplateSourceEvent(sourceEventData as TemplateSourceEventRow | null, plan)) {
      return NextResponse.json(
        {
          error: 'Record the completed event outcome before saving this template',
          code: 'template_source_event_ineligible',
        },
        { status: 409 }
      )
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

    return jsonWithDeprecatedKeys(
      { template: normalizeTemplateRow(template as TemplateRow) },
      ['kickback_model'],
      { status: 201 }
    )
  } catch (error) {
    console.error('[planner.templates] POST unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
