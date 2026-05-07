/**
 * API route for booked venue/vendor partnership workspaces.
 *
 * Purpose:
 * - GET creates/loads partner workspaces from accepted opportunity invites whose
 *   deposit step is unblocked.
 * - POST records MVP workspace actions: messages, deposit placed, document upload,
 *   and milestone completion.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  listPartnershipWorkspaces,
  mutatePartnershipWorkspace,
} from '@/lib/planner/partnershipWorkspaces'
import { createClient } from '@/lib/supabase/server'
import type { Json, PartnershipPartnerKind, PlannerApiErrorResponse, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const partnerKindSchema = z.enum(['venue', 'vendor'])

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send_message'),
    threadId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal('mark_deposit_placed'),
    threadId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('upload_document'),
    threadId: z.string().uuid(),
    kind: z.enum(['contract', 'coi', 'invoice', 'receipt']),
    url: z.string().trim().min(1).max(2000),
    signedAt: z.string().trim().max(80).nullable().optional(),
  }),
  z.object({
    action: z.literal('complete_milestone'),
    threadId: z.string().uuid(),
    milestoneId: z.string().uuid(),
  }),
])

interface RouteContext {
  params: {
    planId: string
  }
}

/**
 * Loads accepted booked partner workspaces for a planner plan.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ workspaces: Awaited<ReturnType<typeof listPartnershipWorkspaces>> } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const kind = parsePartnerKind(request.nextUrl.searchParams.get('kind'))
    const workspaces = await listPartnershipWorkspaces(auth.db, plan.id, kind)

    return NextResponse.json({ workspaces })
  } catch (error) {
    console.error('Planner partnerships GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Mutates one booked partner workspace and returns the refreshed list.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ workspaces: Awaited<ReturnType<typeof listPartnershipWorkspaces>> } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const parsed = actionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const kind = parsePartnerKind(request.nextUrl.searchParams.get('kind'))
    const workspaces = await mutatePartnershipWorkspace(auth.db, plan.id, parsed.data, kind)

    return NextResponse.json({ workspaces })
  } catch (error) {
    console.error('Planner partnerships POST error:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Planner partnership plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}

function parsePartnerKind(value: string | null): PartnershipPartnerKind | undefined {
  const parsed = partnerKindSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
