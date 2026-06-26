export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertCommitment } from '@/lib/finance/costCommitments'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const EVENT_EVIDENCE_BUCKET = 'event-evidence'
const SIGNED_URL_TTL_SECONDS = 60 * 60

const paramsSchema = z.object({
  eventId: z.string().uuid(),
})

const commitmentCreateSchema = z.object({
  category: z.enum(['venue', 'vendor', 'staff', 'marketing', 'platform_fee', 'tax', 'other']),
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  amount_cents: z.number().int().nonnegative(),
  state: z.enum(['estimated', 'quoted', 'accepted', 'invoiced', 'paid', 'cancelled']).default('estimated'),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  source: z.enum(['manual', 'outreach_reply', 'receipt_upload', 'csv_import', 'webhook']).default('manual'),
  evidence_url: z.string().trim().min(1).nullable().optional(),
  evidence_type: z.enum(['contract', 'invoice', 'receipt', 'screenshot', 'none']).default('none'),
  metadata: z.record(z.unknown()).default({}),
  paid_at: z.string().trim().min(1).nullable().optional(),
})

type PlannerDb = { from: (table: string) => any; storage?: any }

type EventAccess =
  | { db: PlannerDb; admin: PlannerDb; builderProfileId: string; event: { id: string; builder_id: string } }
  | { response: NextResponse<{ error: string }> }

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const { data, error } = await access.admin
      .from('event_cost_commitments')
      .select('*')
      .eq('event_id', access.event.id)
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message ?? 'Failed to load cost commitments')

    const commitments = await withSignedEvidenceUrls(access.admin, data ?? [])
    return NextResponse.json({ commitments })
  } catch (error) {
    console.error('[planner.event.commitments] Failed to load commitments', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load cost commitments' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const parsedBody = commitmentCreateSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid commitment payload' }, { status: 400 })
    }

    const commitment = await upsertCommitment(access.admin, {
      ...parsedBody.data,
      event_id: access.event.id,
      plan_id: null,
      org_id: access.builderProfileId,
      committed_at: parsedBody.data.state === 'accepted' ? new Date().toISOString() : null,
      paid_at: parsedBody.data.state === 'paid' ? parsedBody.data.paid_at ?? new Date().toISOString() : parsedBody.data.paid_at ?? null,
    })

    const [withEvidence] = await withSignedEvidenceUrls(access.admin, [commitment])
    return NextResponse.json({ commitment: withEvidence }, { status: 201 })
  } catch (error) {
    console.error('[planner.event.commitments] Failed to create commitment', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create cost commitment' },
      { status: 500 }
    )
  }
}

async function getEventAccess(eventId: string): Promise<EventAccess> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  const db = supabase as unknown as PlannerDb
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id, builder_id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event access')
  if (!event) {
    return { response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  return {
    db,
    admin: createServiceRoleClient() as unknown as PlannerDb,
    builderProfileId,
    event: event as { id: string; builder_id: string },
  }
}

async function withSignedEvidenceUrls(admin: PlannerDb, rows: unknown[]) {
  return Promise.all(
    rows.map(async (row) => {
      const record = row as Record<string, unknown>
      const evidencePath = typeof record.evidence_url === 'string' && record.evidence_url.trim()
        ? record.evidence_url.trim()
        : null
      if (!evidencePath || !admin.storage) {
        return { ...record, evidence_signed_url: null }
      }

      const { data, error } = await admin.storage
        .from(EVENT_EVIDENCE_BUCKET)
        .createSignedUrl(evidencePath, SIGNED_URL_TTL_SECONDS)

      return {
        ...record,
        evidence_signed_url: error ? null : data?.signedUrl ?? null,
      }
    })
  )
}
