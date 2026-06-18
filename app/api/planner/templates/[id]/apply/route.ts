export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAutoRecommendationMessage } from '@/lib/planner/autoRecommendations'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan, PlanMessage, Recommendation } from '@/lib/types'

type DbError = { message: string }
type InsertTemplateRun = (values: {
  template_id: string
  plan_id: string
  new_date?: string | null
  expected_guest_count?: number | null
  budget_override_cents?: number | null
  use_same_venue?: boolean
  use_same_vendors?: boolean
  status?: 'pending' | 'confirmed' | 'cancelled'
}) => Promise<{ error: DbError | null }>

const applyTemplateSchema = z.object({
  plan_id: z.string().uuid().optional(),
  create_new_plan: z.boolean().optional(),
  date_window_start: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  date_window_end: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  guest_count: z.coerce.number().int().nonnegative().nullable().optional(),
  budget_cap_cents: z.coerce.number().int().nonnegative().nullable().optional(),
  neighborhood: z.string().trim().min(1).max(120).nullable().optional(),
  use_same_venue: z.boolean().default(false),
  use_same_vendors: z.boolean().default(false),
  rerun_recommendations: z.boolean().default(true),
}).superRefine((value, context) => {
  if (!value.plan_id && value.create_new_plan === false) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['plan_id'],
      message: 'plan_id is required unless create_new_plan is true.',
    })
  }
})

type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>
type PlanApplyResult =
  | { plan: Plan; changedFields: string[]; wasCreated: boolean }
  | { response: NextResponse<{ error: string } | { error: string; details: Json }> }

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
  historical_performance
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
}

interface RouteContext {
  params: {
    id: string
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = applyTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select(TEMPLATE_SELECT_COLUMNS)
      .eq('id', context.params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (templateError) {
      console.error('[agent.run] Planner template apply load failed', templateError)
      return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
    }

    const templateRow = template as TemplateRow | null
    if (!templateRow) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const applyInput = parsed.data
    const shouldCreateNewPlan = applyInput.create_new_plan === true || !applyInput.plan_id
    const planResult = shouldCreateNewPlan
      ? await createPlanFromTemplate(supabase, user.id, templateRow, applyInput)
      : await updatePlanFromTemplate(supabase, user.id, templateRow, applyInput)

    if ('response' in planResult) return planResult.response

    const { plan: updatedPlan, changedFields, wasCreated } = planResult

    const insertTemplateRun = supabase.from('template_runs').insert as unknown as InsertTemplateRun
    const { error: insertError } = await insertTemplateRun({
      template_id: templateRow.id,
      plan_id: updatedPlan.id,
      new_date: updatedPlan.date_window_start,
      expected_guest_count: updatedPlan.guest_count,
      budget_override_cents: updatedPlan.budget_cap_cents,
      use_same_venue: applyInput.use_same_venue,
      use_same_vendors: applyInput.use_same_vendors,
      status: 'confirmed',
    })

    if (insertError) {
      console.error('[agent.run] Planner template apply insert failed', insertError)
      return NextResponse.json({ error: 'Failed to apply template' }, { status: 500 })
    }

    const messages: PlanMessage[] = []
    const statusMessage = await insertPlanStatusMessage(supabase, {
      planId: updatedPlan.id,
      template: templateRow,
      wasCreated,
      changedFields,
      useSameVenue: applyInput.use_same_venue,
      useSameVendors: applyInput.use_same_vendors,
    })
    if (statusMessage) messages.push(statusMessage)

    if (!wasCreated && changedFields.length > 0) {
      await supersedeActiveRecommendations(supabase, updatedPlan.id, changedFields)
    }

    if (applyInput.rerun_recommendations && updatedPlan.status === 'ready') {
      const recommendationMessages = await createAutoRecommendationMessage({
        db: supabase as never,
        request,
        planId: updatedPlan.id,
      })
      messages.push(...recommendationMessages)
    }

    return NextResponse.json({
      success: true,
      plan: updatedPlan,
      messages,
      template_run: {
        template_id: templateRow.id,
        plan_id: updatedPlan.id,
        new_date: updatedPlan.date_window_start,
        expected_guest_count: updatedPlan.guest_count,
        budget_override_cents: updatedPlan.budget_cap_cents,
      },
    })
  } catch (error) {
    console.error('[agent.run] Planner template apply unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function insertPlanStatusMessage(
  supabase: ReturnType<typeof createClient>,
  input: {
    planId: string
    template: TemplateRow
    wasCreated: boolean
    changedFields: string[]
    useSameVenue: boolean
    useSameVendors: boolean
  }
): Promise<PlanMessage | null> {
  const insertPlanMessage = supabase.from('plan_messages').insert as unknown as (
    values: Record<string, unknown>
  ) => {
    select: (columns: string) => {
      single: () => Promise<{ data: unknown; error: DbError | null }>
    }
  }

  const hist = readHistoricalPerformance(input.template)
  const historyInsight = buildHistoryInsight(hist)
  const rebookPrefsNote = buildRebookPrefsNote(input.useSameVenue, input.useSameVendors)
  const baseMessage = input.wasCreated
    ? `Created a fresh plan from "${input.template.name}" and re-checking venues, vendors, and economics for the new numbers.`
    : `Applied "${input.template.name}" with fresh rebook inputs. I invalidated stale picks and am re-checking venues, vendors, and economics.`
  const parts = [baseMessage, rebookPrefsNote, historyInsight].filter(Boolean)
  const content = parts.join(' ')

  const { data, error } = await insertPlanMessage({
      plan_id: input.planId,
      role: 'agent',
      content,
      message_type: 'status_update',
      metadata: {
        template_id: input.template.id,
        template_name: input.template.name,
        template_applied: true,
        created_new_plan: input.wasCreated,
        changed_fields: input.changedFields,
        rerun_recommendations: true,
        historical_performance_used: hist !== null,
      } as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[agent.run] Planner template apply message insert failed', error)
    return null
  }

  return data as PlanMessage
}

async function createPlanFromTemplate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  template: TemplateRow,
  input: ApplyTemplateInput
): Promise<PlanApplyResult> {
  const planInsert = buildPlanInsertFromTemplate(userId, template, input)
  const insertPlan = supabase.from('plans').insert as unknown as (
    values: Record<string, unknown>
  ) => {
    select: (columns: string) => {
      single: () => Promise<{ data: unknown; error: DbError | null }>
    }
  }
  const { data, error } = await insertPlan(planInsert)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[agent.run] Planner template apply plan create failed', error)
    return { response: NextResponse.json({ error: 'Failed to create plan from template' }, { status: 500 }) }
  }

  return {
    plan: data as Plan,
    changedFields: Object.keys(planInsert).filter((field) => !['user_id', 'title', 'notes', 'metadata'].includes(field)),
    wasCreated: true,
  }
}

async function updatePlanFromTemplate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  template: TemplateRow,
  input: ApplyTemplateInput
): Promise<PlanApplyResult> {
  if (!input.plan_id) {
    return { response: NextResponse.json({ error: 'plan_id is required' }, { status: 400 }) }
  }

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', input.plan_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (planError) {
    console.error('[agent.run] Planner template apply plan load failed', planError)
    return { response: NextResponse.json({ error: 'Failed to load plan' }, { status: 500 }) }
  }

  const planRow = plan as Plan | null
  if (!planRow) {
    return { response: NextResponse.json({ error: 'Plan not found' }, { status: 404 }) }
  }

  const planUpdates = buildPlanUpdatesFromTemplate(planRow, template, input)
  const changedFields = Object.keys(planUpdates).filter((field) => field !== 'metadata')
  const updatePlan = supabase.from('plans').update as unknown as (
    values: Record<string, unknown>
  ) => {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        select: (columns: string) => {
          single: () => Promise<{ data: unknown; error: DbError | null }>
        }
      }
    }
  }
  const { data: updatedPlan, error: updateError } = Object.keys(planUpdates).length > 0
    ? await updatePlan(planUpdates)
      .eq('id', planRow.id)
      .eq('user_id', userId)
      .select(PLAN_SELECT_COLUMNS)
      .single()
    : { data: planRow, error: null }

  if (updateError || !updatedPlan) {
    console.error('[agent.run] Planner template apply plan update failed', updateError)
    return { response: NextResponse.json({ error: 'Failed to apply template to plan' }, { status: 500 }) }
  }

  return {
    plan: updatedPlan as Plan,
    changedFields,
    wasCreated: false,
  }
}

function buildPlanInsertFromTemplate(userId: string, template: TemplateRow, input: ApplyTemplateInput): Record<string, unknown> {
  const budgetModel = readRecord(template.budget_model)
  const ticketModel = readRecord(template.ticket_price_model)
  const guestCount = getInputGuestCount(input, template)
  const budgetCapCents = getInputBudgetCapCents(input, budgetModel)
  const dateWindowStart = input.date_window_start ?? null
  const dateWindowEnd = input.date_window_end ?? dateWindowStart
  const neighborhood = input.neighborhood ?? template.target_audience
  const ticketed = typeof ticketModel?.ticketed === 'boolean' ? ticketModel.ticketed : false
  const ticketingModel = readString(ticketModel?.ticketing_model) ?? (ticketed ? 'ticketed' : 'rsvp')
  const metadata = buildTemplateMetadata(null, template, input)

  return {
    user_id: userId,
    title: `${template.name.replace(/\s+template$/i, '')} rebook`,
    event_type: template.event_type,
    status: isReadyForRecommendations({
      event_type: template.event_type,
      guest_count: guestCount,
      neighborhood,
      date_window_start: dateWindowStart,
      date_window_end: dateWindowEnd,
    }) ? 'ready' : 'drafting',
    guest_count: guestCount,
    budget_cap_cents: budgetCapCents,
    neighborhood,
    date_window_start: dateWindowStart,
    date_window_end: dateWindowEnd,
    ticketed,
    ticketing_model: ticketingModel,
    food_responsibility: readString(budgetModel?.food_responsibility),
    venue_terms: readString(budgetModel?.venue_terms),
    profit_goal_cents: readNumber(readRecord(template.profit_assumptions)?.profit_goal_cents),
    notes: 'Created from a saved planner template. Recommendations and economics should be treated as fresh estimates for this run.',
    metadata,
  }
}

function buildPlanUpdatesFromTemplate(plan: Plan, template: TemplateRow, input: ApplyTemplateInput): Record<string, unknown> {
  const budgetModel = readRecord(template.budget_model)
  const ticketModel = readRecord(template.ticket_price_model)
  const nextMetadata = buildTemplateMetadata(plan.metadata, template, input)
  const ticketPriceTargetCents = readNumber(ticketModel?.ticket_price_target_cents)
  if (ticketPriceTargetCents !== null) {
    nextMetadata.ticket_price_target_cents = ticketPriceTargetCents
  }

  const updates: Record<string, unknown> = {
    metadata: nextMetadata,
  }

  if (template.event_type && plan.event_type !== template.event_type) updates.event_type = template.event_type

  const guestCount = getInputGuestCount(input, template)
  if (input.guest_count !== undefined || plan.guest_count === null) {
    if (guestCount !== null && plan.guest_count !== guestCount) updates.guest_count = guestCount
  }

  const budgetCapCents = getInputBudgetCapCents(input, budgetModel)
  if (input.budget_cap_cents !== undefined || plan.budget_cap_cents === null) {
    if (plan.budget_cap_cents !== budgetCapCents) updates.budget_cap_cents = budgetCapCents
  }

  if (input.date_window_start !== undefined && plan.date_window_start !== input.date_window_start) {
    updates.date_window_start = input.date_window_start
  }
  const dateWindowEnd = input.date_window_end !== undefined ? input.date_window_end : input.date_window_start
  if (dateWindowEnd !== undefined && plan.date_window_end !== dateWindowEnd) {
    updates.date_window_end = dateWindowEnd
  }

  if (input.neighborhood !== undefined && plan.neighborhood !== input.neighborhood) {
    updates.neighborhood = input.neighborhood
  }

  const ticketed = typeof ticketModel?.ticketed === 'boolean' ? ticketModel.ticketed : null
  if (ticketed !== null && plan.ticketed !== ticketed) updates.ticketed = ticketed

  const ticketingModel = readString(ticketModel?.ticketing_model)
  if (!plan.ticketing_model && ticketingModel) updates.ticketing_model = ticketingModel

  const foodResponsibility = readString(budgetModel?.food_responsibility)
  if (!plan.food_responsibility && foodResponsibility) updates.food_responsibility = foodResponsibility

  const venueTerms = readString(budgetModel?.venue_terms)
  if (!plan.venue_terms && venueTerms) updates.venue_terms = venueTerms

  const nextPlan = { ...plan, ...updates } as Plan
  if (nextPlan.status !== 'ready' && isReadyForRecommendations(nextPlan)) {
    updates.status = 'ready'
  }

  return updates
}

function buildTemplateMetadata(currentMetadata: unknown, template: TemplateRow, input?: ApplyTemplateInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(readRecord(currentMetadata) ?? {}),
    applied_template: {
      id: template.id,
      name: template.name,
      source: 'planner_template',
      applied_at: new Date().toISOString(),
    },
    template_snapshot: {
      budget_model: template.budget_model,
      ticket_price_model: template.ticket_price_model,
      profit_assumptions: template.profit_assumptions,
      chi_model: template.kickback_model,
      kickback_model: template.kickback_model,
      run_of_show: template.run_of_show,
      shopping_list: template.shopping_list,
      approval_checklist: template.approval_checklist,
      historical_performance: template.historical_performance,
    },
  }

  if (!input) return base

  const shoppingList = readRecord(template.shopping_list)
  const useSameVenue = input.use_same_venue === true
  const useSameVendors = input.use_same_vendors === true

  const preferredVenueIds: string[] = []
  const preferredVendorIds: string[] = []

  if (useSameVenue && shoppingList) {
    const selectedVenue = readRecord(shoppingList.selected_venue)
    const venueReferenceId = readString(selectedVenue?.reference_id)
    const venuePartnerId = readString(selectedVenue?.id)
    const venueId = venueReferenceId ?? venuePartnerId
    if (venueId) preferredVenueIds.push(venueId)
  }

  if (useSameVendors && shoppingList) {
    const selectedVendors = Array.isArray(shoppingList.selected_vendors) ? shoppingList.selected_vendors : []
    for (const vendor of selectedVendors) {
      const vendorRecord = readRecord(vendor)
      if (!vendorRecord) continue
      const vendorReferenceId = readString(vendorRecord.reference_id)
      const vendorPartnerId = readString(vendorRecord.id)
      const vendorId = vendorReferenceId ?? vendorPartnerId
      if (vendorId) preferredVendorIds.push(vendorId)
    }
  }

  if (preferredVenueIds.length > 0 || preferredVendorIds.length > 0 || useSameVenue || useSameVendors) {
    base.template_rebook_preferences = {
      template_id: template.id,
      use_same_venue: useSameVenue,
      use_same_vendors: useSameVendors,
      preferred_venue_ids: preferredVenueIds,
      preferred_vendor_ids: preferredVendorIds,
      applied_at: new Date().toISOString(),
    }
  }

  return base
}

function getInputGuestCount(input: ApplyTemplateInput, template: TemplateRow): number | null {
  if (input.guest_count !== undefined) return input.guest_count

  // If the builder's history shows a consistent p75 attendance that exceeds the
  // template midpoint at medium or high confidence, upsize the pre-fill to p75.
  // This ensures rebooks start at a realistic headcount rather than the first-run estimate.
  const hist = readHistoricalPerformance(template)
  if (hist && (hist.confidence === 'medium' || hist.confidence === 'high') && hist.p75_tickets_sold > 0) {
    const midpoint = midpointGuestCount(template)
    if (midpoint === null || hist.p75_tickets_sold > midpoint) {
      return hist.p75_tickets_sold
    }
  }

  return midpointGuestCount(template)
}

function getInputBudgetCapCents(input: ApplyTemplateInput, budgetModel: Record<string, unknown> | null): number | null {
  if (input.budget_cap_cents !== undefined) return input.budget_cap_cents
  return readNumber(budgetModel?.budget_cap_cents)
}

function isReadyForRecommendations(plan: {
  event_type?: string | null
  guest_count?: number | null
  neighborhood?: string | null
  date_window_start?: string | null
  date_window_end?: string | null
}) {
  return Boolean(plan.event_type && plan.guest_count && plan.neighborhood && (plan.date_window_start || plan.date_window_end))
}

async function supersedeActiveRecommendations(
  supabase: ReturnType<typeof createClient>,
  planId: string,
  changedFields: string[]
) {
  const { data, error } = await supabase
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .in('status', ['pending', 'selected'])

  if (error) {
    console.error('[agent.run] Planner template recommendation lookup failed', error)
    return
  }

  const supersededAt = new Date().toISOString()
  const updateRecommendation = supabase.from('recommendations').update as unknown as (
    values: Record<string, unknown>
  ) => {
    eq: (column: string, value: string) => Promise<{ error: DbError | null }>
  }

  await Promise.all(((data ?? []) as Recommendation[]).map(async (recommendation) => {
    const metadata = readRecord(recommendation.metadata) ?? {}
    const { error: updateError } = await updateRecommendation({
        status: 'rejected',
        metadata: {
          ...metadata,
          superseded_at: supersededAt,
          superseded_reason: 'template_rebook',
          superseded_changed_fields: changedFields,
        } as Json,
      })
      .eq('id', recommendation.id)

    if (updateError) console.error('[agent.run] Planner template recommendation supersede failed', updateError)
  }))
}

type ParsedHistoricalPerformance = {
  source: string
  archetype_key: string | null
  sample_size: number
  confidence: 'low' | 'medium' | 'high'
  avg_tickets_sold: number
  p75_tickets_sold: number
  p95_tickets_sold: number
  last_event_at: string | null
}

function readHistoricalPerformance(template: TemplateRow): ParsedHistoricalPerformance | null {
  const hist = readRecord(template.historical_performance)
  if (!hist) return null
  const sampleSize = readNumber(hist.sample_size)
  if (!sampleSize || sampleSize <= 0) return null
  const confidence = hist.confidence
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') return null
  return {
    source: typeof hist.source === 'string' ? hist.source : 'builder_history_aggregate',
    archetype_key: typeof hist.archetype_key === 'string' ? hist.archetype_key : null,
    sample_size: sampleSize,
    confidence,
    avg_tickets_sold: readNumber(hist.avg_tickets_sold) ?? 0,
    p75_tickets_sold: readNumber(hist.p75_tickets_sold) ?? 0,
    p95_tickets_sold: readNumber(hist.p95_tickets_sold) ?? 0,
    last_event_at: typeof hist.last_event_at === 'string' ? hist.last_event_at : null,
  }
}

function buildRebookPrefsNote(useSameVenue: boolean, useSameVendors: boolean): string | null {
  if (useSameVenue && useSameVendors) {
    return 'Your saved venue and vendors are preferred in matching — they will rank higher if still eligible for your new date, headcount, and budget.'
  }
  if (useSameVenue) {
    return 'Your saved venue is preferred in matching — it will rank higher if still eligible for your new date, headcount, and budget.'
  }
  if (useSameVendors) {
    return 'Your saved vendors are preferred in matching — they will rank higher if still eligible for your new date and budget.'
  }
  return null
}

function buildHistoryInsight(hist: ParsedHistoricalPerformance | null): string | null {
  if (!hist || hist.sample_size === 0) return null
  if (hist.confidence === 'low') return null

  const avg = Math.round(hist.avg_tickets_sold)
  const p75 = hist.p75_tickets_sold
  const count = hist.sample_size
  const eventWord = count === 1 ? 'run' : 'runs'

  if (hist.confidence === 'high') {
    return `Your last ${count} ${eventWord} of this type averaged ${avg} attendees (p75: ${p75}). I've pre-filled headcount from your p75 so venues and economics start at your realistic size.`
  }

  // medium confidence
  return `Based on ${count} previous ${eventWord}, you've averaged ${avg} attendees for this event type. I've used your p75 (${p75}) as the starting headcount.`
}

function midpointGuestCount(template: TemplateRow): number | null {
  if (typeof template.guest_count_min === 'number' && typeof template.guest_count_max === 'number') {
    return Math.round((template.guest_count_min + template.guest_count_max) / 2)
  }

  return template.guest_count_min ?? template.guest_count_max ?? null
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
