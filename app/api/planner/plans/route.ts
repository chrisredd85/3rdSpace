/**
 * API route for Agent Planner plan collection operations.
 *
 * Purpose:
 * - POST creates a plan from the user's first chat message.
 * - GET lists plans owned by the authenticated community builder.
 *
 * Route inputs:
 * - POST body: `{ message: string }`.
 * - GET query: optional `limit` and `offset` pagination params.
 *
 * Key behaviors:
 * - Uses deterministic keyword extraction from `parseEventIntent`; no external LLM calls.
 * - Inserts the plan, first user message, first agent confirmation message, and audit log.
 * - Uses the repo Supabase server wrapper from `@/lib/supabase/server`.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { determineNextResponse } from '@/lib/planner/agentResponder'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { parseEventIntent } from '@/lib/planner/intentParser'
import { createClient } from '@/lib/supabase/server'
import type {
  Json,
  Plan,
  PlanIntent,
  PlanMessage,
  PlannerApiErrorResponse,
  PlannerCreatePlanResponse,
  PlannerListPlansResponse,
} from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type AuthResult =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const planStatusSchema = z.enum(['drafting', 'ready', 'approved', 'executing', 'complete', 'archived'])
const planMessageRoleSchema = z.enum(['user', 'agent', 'system'])
const planMessageTypeSchema = z.enum(['text', 'confirmation_card', 'recommendation', 'approval_request', 'status_update'])
const draftMessageSchema = z.object({
  role: planMessageRoleSchema,
  content: z.string().trim().min(1).max(8000),
  message_type: planMessageTypeSchema,
  metadata: z.unknown().optional(),
  created_at: z.string().trim().optional(),
})
const createPlanSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  draft: z.object({
    plan: z.unknown().optional(),
    messages: z.array(draftMessageSchema).min(1).max(100).optional(),
  }).optional(),
})

const listPlansSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * Lists Agent Planner plans owned by the authenticated community builder.
 *
 * @param request - Next.js request carrying auth cookies and optional pagination query params.
 * @returns JSON response containing the user's plans or an auth/error payload.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<PlannerListPlansResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const params = listPlansSchema.safeParse({
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    })

    if (!params.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: params.error.flatten() as Json },
        { status: 400 }
      )
    }

    const { limit, offset } = params.data
    const { data, error } = await auth.db
      .from('plans')
      .select(PLAN_SELECT_COLUMNS)
      .eq('user_id', auth.userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Planner plans list error:', error)
      return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
    }

    const plans = (data ?? []) as Plan[]
    return NextResponse.json({ plans, count: plans.length })
  } catch (error) {
    console.error('Planner plans GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates an Agent Planner plan from the user's first natural-language message.
 *
 * Extraction logic:
 * - `parseEventIntent` uses supported keyword/regex matches for event type, headcount,
 *   budget, neighborhood, dates, ticketing, and profit target.
 * - Only fields extracted with deterministic matches are written to the plan.
 * - The first agent response is a confirmation card that asks for the first missing field.
 *
 * @param request - Next.js request with `{ message }` JSON body and auth cookies.
 * @returns JSON response containing the created plan and initial two-message exchange.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<PlannerCreatePlanResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const body = createPlanSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    const intent = parseEventIntent(body.data.message)
    const draftPlan = readRecord(body.data.draft?.plan)
    const draftMessages = body.data.draft?.messages ?? []
    const planInsert = buildPlanInsert(auth.userId, body.data.message, intent, draftPlan)

    const { data: planData, error: planError } = await auth.db
      .from('plans')
      .insert(planInsert)
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (planError || !planData) {
      console.error('Planner plan create error:', planError)
      return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
    }

    const plan = planData as Plan
    const messages = draftMessages.length > 0
      ? await insertDraftMessages(auth.db, plan.id, draftMessages)
      : await insertInitialMessages(auth.db, plan, body.data.message, intent)

    if (!messages) {
      return NextResponse.json({ error: 'Failed to create initial messages' }, { status: 500 })
    }

    await recordEventTypeCandidate(auth.db, {
      userId: auth.userId,
      planId: plan.id,
      intent,
    })
    await insertAuditLog(auth.db, {
      user_id: auth.userId,
      plan_id: plan.id,
      action: 'planner.plan.created',
      entity_type: 'plan',
      entity_id: plan.id,
      before_state: null,
      after_state: toJson({ plan, intent, message_ids: messages.map((message) => message.id) }),
      ip_address: getIpAddress(request),
    })

    return NextResponse.json({
      plan,
      messages,
      intent,
    })
  } catch (error) {
    console.error('Planner plans POST error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function getAuthenticatedPlannerDb(): Promise<AuthResult> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  const userType = user.user_metadata?.user_type
  if (userType !== 'community_builder') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    }
  }

  return { db, userId: user.id }
}

function buildPlanInsert(
  userId: string,
  message: string,
  intent: Partial<PlanIntent>,
  draftPlan: Record<string, unknown> | null = null
) {
  const draftStatus = planStatusSchema.safeParse(readString(draftPlan?.status))
  const status = draftStatus.success && !isTerminalStatus(draftStatus.data) ? draftStatus.data : 'drafting'

  return {
    user_id: userId,
    title: readString(draftPlan?.title) ?? buildPlanTitle(message, intent),
    event_type: readString(draftPlan?.event_type) ?? intent.event_type ?? intent.raw_event_type ?? null,
    status,
    guest_count: readNumber(draftPlan?.guest_count) ?? intent.guest_count ?? null,
    budget_cap_cents: readNumber(draftPlan?.budget_cap_cents) ?? intent.budget_cap ?? null,
    neighborhood: readString(draftPlan?.neighborhood) ?? intent.neighborhood ?? null,
    date_window_start: readString(draftPlan?.date_window_start) ?? intent.date_window_start ?? null,
    date_window_end: readString(draftPlan?.date_window_end) ?? intent.date_window_end ?? null,
    ticketed: readBoolean(draftPlan?.ticketed) ?? intent.ticketed ?? false,
    profit_goal_cents: intent.profit_goal ?? null,
    notes: readString(draftPlan?.notes) ?? (intent.date_hint ? `Initial date hint: ${intent.date_hint}` : null),
  }
}

async function insertInitialMessages(
  db: PlannerDb,
  plan: Plan,
  message: string,
  intent: Partial<PlanIntent>
): Promise<PlanMessage[] | null> {
  const { data: userMessageData, error: userMessageError } = await db
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'user',
      content: message,
      message_type: 'text',
      metadata: toJson({ intent }),
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (userMessageError || !userMessageData) {
    console.error('Planner initial message create error:', userMessageError)
    return null
  }

  const userMessage = userMessageData as PlanMessage
  const agentDraft = determineNextResponse(plan, [userMessage])
  const { data: agentMessageData, error: agentMessageError } = await db
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'agent',
      content: agentDraft.content,
      message_type: agentDraft.message_type,
      metadata: agentDraft.metadata,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (agentMessageError || !agentMessageData) {
    console.error('Planner initial agent response error:', agentMessageError)
    return null
  }

  return [userMessage, agentMessageData as PlanMessage]
}

async function insertDraftMessages(
  db: PlannerDb,
  planId: string,
  draftMessages: z.infer<typeof draftMessageSchema>[]
): Promise<PlanMessage[] | null> {
  const now = Date.now()
  const inserts = draftMessages.map((message, index) => ({
    plan_id: planId,
    role: message.role,
    content: message.content,
    message_type: message.message_type,
    metadata: toJsonValue(readRecord(message.metadata) ?? {}),
    created_at: normalizeCreatedAt(message.created_at, now + index),
  }))

  const { data, error } = await db
    .from('plan_messages')
    .insert(inserts)
    .select(PLAN_MESSAGE_SELECT_COLUMNS)

  if (error || !data) {
    console.error('Planner draft message migration error:', error)
    return null
  }

  return data as PlanMessage[]
}

function buildPlanTitle(message: string, intent: Partial<PlanIntent>): string {
  const eventType = intent.event_type ?? intent.raw_event_type
  if (eventType) {
    return `${toTitleCase(eventType)} plan`
  }

  const compact = message.replace(/\s+/g, ' ').trim()
  return compact.length > 64 ? `${compact.slice(0, 61)}...` : compact
}

async function recordEventTypeCandidate(
  db: PlannerDb,
  payload: {
    userId: string
    planId: string
    intent: Partial<PlanIntent>
  }
) {
  const candidate = payload.intent.taxonomy_candidate
  if (!candidate || payload.intent.is_supported_event_type !== false) return

  const { error } = await db.from('event_type_candidates').insert({
    user_id: payload.userId,
    plan_id: payload.planId,
    raw_phrase: candidate.raw_event_type,
    normalized_phrase: candidate.normalized_phrase,
    inferred_archetype: candidate.planning_archetype,
    suggested_event_type: candidate.suggested_event_type,
    event_components: candidate.event_components,
    suggested_questions: candidate.suggested_questions,
    example_plan_ids: [payload.planId],
    frequency_count: 1,
    status: 'pending',
  })

  if (error) console.error('Planner event type candidate insert error:', error)
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

async function insertAuditLog(
  db: PlannerDb,
  payload: {
    user_id: string
    plan_id: string | null
    action: string
    entity_type: string
    entity_id: string | null
    before_state: Json | null
    after_state: Json | null
    ip_address: string | null
  }
) {
  const { error } = await db.from('audit_logs').insert(payload)
  if (error) console.error('Planner audit log insert error:', error)
}

function getIpAddress(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isTerminalStatus(status: Plan['status']) {
  return status === 'complete' || status === 'archived'
}

function normalizeCreatedAt(value: string | undefined, fallbackMs: number) {
  if (value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }

  return new Date(fallbackMs).toISOString()
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}

function toJsonValue(value: unknown): Json {
  return value as Json
}
