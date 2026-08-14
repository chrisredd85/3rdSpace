import { randomBytes } from 'node:crypto'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export interface VenueOpportunityCreateInput {
  db: PlannerDb
  writeDb?: PlannerDb
  plan: Plan
  userId: string
  venueIds: string[]
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  outreachMessage?: Json | null
  issueTokens?: boolean
}

export interface VenueOpportunityInviteWithVenue {
  id: string
  brief_id: string
  opportunity_id?: string
  venue_id: string | null
  status: string
  magic_link_token: string | null
  magic_link_expires_at: string | null
  sent_at: string | null
  viewed_at: string | null
  response_at: string | null
  response_payload: Json
  created_at: string
  venue: {
    id: string
    venue_name: string
    city: string | null
    state: string | null
    standing_capacity: number | null
  } | null
}

export interface VenueOpportunityBriefWithInvites {
  id: string
  plan_id: string
  summary: string | null
  requirements: Json
  budget_range_cents: string | null
  date_window: string | null
  response_deadline: string | null
  created_at: string
  invites: VenueOpportunityInviteWithVenue[]
}

const VENUE_DISPLAY_SELECT = `
  id,
  venue_name,
  city,
  state,
  standing_capacity,
  is_claimed,
  is_admin_seeded
`

/**
 * Creates a venue opportunity brief and queued invite rows for selected venues.
 */
export async function createVenueOpportunityBrief(input: VenueOpportunityCreateInput) {
  const venueIds = Array.from(new Set(input.venueIds)).filter(isUuid)
  if (venueIds.length === 0) throw new Error('At least one valid venue id is required')

  const venueRows = await loadVenueRows(input.db, venueIds)
  const now = new Date()
  const tokenExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const budgetRange = buildBudgetRange(input.plan.budget_cap_cents)
  const dateWindow = buildDateWindow(input.plan.date_window_start, input.plan.date_window_end)
  const firstDate = input.plan.date_window_start
  const lastDate = input.plan.date_window_end ?? input.plan.date_window_start

  const briefInsert = {
    plan_id: input.plan.id,
    organizer_user_id: input.userId,
    title: `${input.plan.event_type ?? 'Event'} venue opportunity`,
    event_type: input.plan.event_type,
    guest_count: input.plan.guest_count,
    date_window_start: firstDate,
    date_window_end: lastDate,
    neighborhood: input.plan.neighborhood,
    budget_cents: input.plan.budget_cap_cents,
    must_haves: readJsonArray(input.requirements.must_haves),
    requested_terms: input.requirements as Json,
    status: 'approval_requested',
    summary: input.summary,
    requirements: input.requirements as Json,
    budget_range_cents: budgetRange,
    date_window: dateWindow,
    response_deadline: input.responseDeadline,
    approval_status: input.approvalStatus ?? 'pending',
    outreach_message: input.outreachMessage ?? null,
  }

  const writeDb = input.writeDb ?? input.db
  const { data: briefData, error: briefError } = await writeDb
    .from('venue_opportunity_briefs')
    .insert(briefInsert)
    .select('*')
    .single()

  if (briefError || !briefData) {
    console.error('Venue opportunity brief insert error:', briefError)
    throw new Error('Failed to create venue opportunity brief')
  }

  const brief = briefData as Record<string, unknown>
  const inviteRows = venueIds.map((venueId) => {
    const venue = venueRows.get(venueId)
    return {
      opportunity_id: brief.id,
      brief_id: brief.id,
      target_type: 'venue',
      venue_id: venueId,
      vendor_profile_id: null,
      status: 'queued',
      is_claimed: Boolean(venue?.is_claimed),
      route_to_concierge: !venue?.is_claimed,
      match_score: 0,
      capacity_fit: true,
      budget_fit: true,
      requirement_fit: {} as Json,
      proposed_deposit_cents: 0,
      quoted_price_cents: null,
      venue_response_json: {} as Json,
      response_payload: {} as Json,
      magic_link_token: input.issueTokens ? randomToken() : null,
      magic_link_expires_at: input.issueTokens ? tokenExpiry : null,
    }
  })

  const { data: inviteData, error: inviteError } = await writeDb
    .from('venue_opportunity_invites')
    .insert(inviteRows)
    .select('*')

  if (inviteError || !inviteData) {
    console.error('Venue opportunity invite insert error:', inviteError)
    throw new Error('Failed to create venue opportunity invites')
  }

  return {
    brief,
    invites: inviteData as Record<string, unknown>[],
  }
}

/**
 * Adds unique 14-day magic-link tokens to queued invites for an existing brief.
 */
export async function ensureVenueOpportunityInviteTokens(
  db: PlannerDb,
  briefId: string,
  writeDb: PlannerDb = db
) {
  const { data, error } = await db
    .from('venue_opportunity_invites')
    .select('*')
    .eq('brief_id', briefId)

  if (error) {
    console.error('Venue opportunity invite token lookup error:', error)
    throw new Error('Failed to load venue opportunity invites')
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const updatedRows = await Promise.all(
    rows.map(async (row) => {
      if (typeof row.magic_link_token === 'string' && row.magic_link_token.length > 0) {
        return row
      }

      const { data: updated, error: updateError } = await writeDb
        .from('venue_opportunity_invites')
        .update({
          status: 'queued',
          magic_link_token: randomToken(),
          magic_link_expires_at: expiresAt,
        })
        .eq('id', row.id)
        .select('*')
        .single()

      if (updateError || !updated) {
        console.error('Venue opportunity invite token update error:', updateError)
        throw new Error('Failed to update venue opportunity invite token')
      }

      return updated as Record<string, unknown>
    })
  )

  return updatedRows
}

/**
 * Lists venue opportunity briefs and their venue invites for display.
 */
export async function listVenueOpportunityBriefs(db: PlannerDb, planId: string) {
  const { data: briefData, error: briefError } = await db
    .from('venue_opportunity_briefs')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })

  if (briefError) {
    console.error('Venue opportunity brief list error:', briefError)
    throw new Error('Failed to load venue opportunity briefs')
  }

  const briefs = (briefData ?? []) as Record<string, unknown>[]
  if (briefs.length === 0) return []

  const briefIds = briefs.map((brief) => String(brief.id))
  const { data: inviteData, error: inviteError } = await db
    .from('venue_opportunity_invites')
    .select('*')
    .in('brief_id', briefIds)
    .order('created_at', { ascending: true })

  if (inviteError) {
    console.error('Venue opportunity invite list error:', inviteError)
    throw new Error('Failed to load venue opportunity invites')
  }

  const invites = (inviteData ?? []) as Record<string, unknown>[]
  const venueIds = invites
    .map((invite) => invite.venue_id)
    .filter((id): id is string => typeof id === 'string')
  const venues = await loadVenueRows(db, venueIds)

  return briefs.map((brief) => ({
    ...brief,
    invites: invites
      .filter((invite) => invite.brief_id === brief.id)
      .map((invite) => ({
        ...invite,
        venue: typeof invite.venue_id === 'string' ? venues.get(invite.venue_id) ?? null : null,
      })),
  })) as VenueOpportunityBriefWithInvites[]
}

function buildBudgetRange(budgetCapCents: number | null): string | null {
  if (!budgetCapCents || budgetCapCents <= 0) return null
  return `[0,${Math.round(budgetCapCents)}]`
}

function buildDateWindow(start: string | null, end: string | null): string | null {
  if (!start && !end) return null
  const lower = start ?? end
  const upper = end ?? start
  return `[${lower},${upper}]`
}

async function loadVenueRows(db: PlannerDb, venueIds: string[]) {
  const ids = Array.from(new Set(venueIds)).filter(isUuid)
  if (ids.length === 0) return new Map<string, Record<string, unknown>>()

  const { data, error } = await db
    .from('venues')
    .select(VENUE_DISPLAY_SELECT)
    .in('id', ids)

  if (error) {
    console.error('Venue opportunity venue lookup error:', error)
    throw new Error('Failed to load venues')
  }

  return new Map(((data ?? []) as Record<string, unknown>[]).map((venue) => [String(venue.id), venue]))
}

function readJsonArray(value: unknown): Json {
  if (Array.isArray(value)) return value as Json
  return [] as unknown as Json
}

function randomToken() {
  return randomBytes(32).toString('hex')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
