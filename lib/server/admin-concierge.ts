import 'server-only'

type SupabaseAdminClient = any
type JsonObject = Record<string, any>

export type ConciergeActionType = 'outreach_attempt' | 'response_logged' | 'status_override' | 'reassigned'

export type ConciergeInviteStatus =
  | 'queued'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'declined'
  | 'countered'
  | 'expired'
  | 'concierge_followup'
  | 'cancelled'

export interface ConciergeQueueRow {
  id: string
  status: string
  ageHours: number
  deadline: string | null
  isSlaRed: boolean
  plan: {
    id: string
    title: string
  }
  host: {
    id: string | null
    name: string
  }
  venue: {
    id: string | null
    name: string
    contactInfo: string[]
  }
  brief: {
    id: string
    summary: string
    requirements: JsonObject
  }
  lastAction: {
    action_type: string
    notes: string | null
    created_at: string
  } | null
}

export interface AdminConciergeData {
  generatedAt: string
  rows: ConciergeQueueRow[]
}

interface InviteRow {
  id: string
  brief_id?: string | null
  opportunity_id?: string | null
  venue_id: string | null
  status: string
  created_at: string
  updated_at?: string | null
  sent_at?: string | null
  response_at?: string | null
  responded_at?: string | null
}

interface BriefRow {
  id: string
  plan_id: string
  title?: string | null
  summary?: string | null
  requirements?: JsonObject | null
  response_deadline?: string | null
}

interface PlanRow {
  id: string
  user_id: string
  title: string | null
}

interface BuilderProfileRow {
  id: string
  user_id: string
  name: string | null
}

interface VenueRow {
  id: string
  venue_name: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  slug?: string | null
  contact_email?: string | null
}

interface ConciergeActionRow {
  id: string
  invite_id: string
  action_type: string
  notes: string | null
  created_at: string
}

/**
 * Loads the admin concierge queue for venue opportunity invites.
 */
export async function getAdminConciergeData(admin: SupabaseAdminClient): Promise<AdminConciergeData> {
  const { data, error } = await admin
    .from('venue_opportunity_invites')
    .select('*')
    .in('status', ['concierge_followup', 'sent'])
    .eq('target_type', 'venue')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`Failed to load concierge invites: ${error.message}`)

  const invites = ((data ?? []) as InviteRow[]).filter(Boolean)
  if (invites.length === 0) {
    return { generatedAt: new Date().toISOString(), rows: [] }
  }

  const briefIds = Array.from(new Set(invites.map((invite) => getBriefId(invite)).filter(Boolean)))
  const venueIds = Array.from(new Set(invites.map((invite) => invite.venue_id).filter(Boolean)))

  const [briefs, venues, actions] = await Promise.all([
    loadRows<BriefRow>(admin, 'venue_opportunity_briefs', briefIds),
    loadRows<VenueRow>(admin, 'venues', venueIds, 'id, venue_name, address, city, state, zip_code, slug, contact_email'),
    loadActions(admin, invites.map((invite) => invite.id)),
  ])

  const planIds = Array.from(new Set(briefs.map((brief) => brief.plan_id).filter(Boolean)))
  const plans = await loadRows<PlanRow>(admin, 'plans', planIds, 'id, user_id, title')
  const hostIds = Array.from(new Set(plans.map((plan) => plan.user_id).filter(Boolean)))
  const hosts = await loadBuilderProfiles(admin, hostIds)

  const briefById = new Map(briefs.map((brief) => [brief.id, brief]))
  const venueById = new Map(venues.map((venue) => [venue.id, venue]))
  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  const hostByUserId = new Map(hosts.map((host) => [host.user_id, host]))
  const actionsByInvite = groupActionsByInvite(actions)
  const now = Date.now()
  const soonCutoff = now + 24 * 60 * 60 * 1000

  const rows = invites.flatMap((invite) => {
    const brief = briefById.get(getBriefId(invite) ?? '')
    if (!brief) return []

    const deadlineTime = parseTime(brief.response_deadline)
    const hasResponse = Boolean(invite.response_at || invite.responded_at)
    const isStalled = invite.status === 'sent' && deadlineTime !== null && deadlineTime < soonCutoff && !hasResponse
    const isConcierge = invite.status === 'concierge_followup'
    if (!isConcierge && !isStalled) return []

    const plan = planById.get(brief.plan_id)
    const host = plan ? hostByUserId.get(plan.user_id) : null
    const venue = invite.venue_id ? venueById.get(invite.venue_id) : null
    const lastAction = actionsByInvite.get(invite.id)?.[0] ?? null
    const ageAnchor = invite.updated_at || invite.created_at
    const ageHours = getAgeHours(ageAnchor)
    const isSlaRed = invite.status === 'concierge_followup' && ageHours > 48 && !lastAction

    return [
      {
        id: invite.id,
        status: invite.status,
        ageHours,
        deadline: brief.response_deadline ?? null,
        isSlaRed,
        plan: {
          id: plan?.id ?? brief.plan_id,
          title: plan?.title || brief.title || 'Untitled plan',
        },
        host: {
          id: host?.id ?? plan?.user_id ?? null,
          name: host?.name || 'Unknown host',
        },
        venue: {
          id: venue?.id ?? invite.venue_id,
          name: venue?.venue_name || 'Unknown venue',
          contactInfo: buildVenueContactInfo(venue),
        },
        brief: {
          id: brief.id,
          summary: brief.summary || brief.title || 'No brief summary yet.',
          requirements: brief.requirements ?? {},
        },
        lastAction,
      } satisfies ConciergeQueueRow,
    ]
  })

  return {
    generatedAt: new Date().toISOString(),
    rows,
  }
}

/**
 * Logs a concierge action against an invite.
 */
export async function logConciergeAction(
  admin: SupabaseAdminClient,
  params: {
    inviteId: string
    adminUserId: string
    actionType: ConciergeActionType
    notes: string | null
    outcomePayload?: JsonObject
  }
) {
  const { data, error } = await admin
    .from('concierge_actions')
    .insert({
      invite_id: params.inviteId,
      admin_user_id: params.adminUserId,
      action_type: params.actionType,
      notes: params.notes,
      outcome_payload: params.outcomePayload ?? {},
    })
    .select('*')
    .single()

  if (error) throw new Error(`Failed to log concierge action: ${error.message}`)
  return data as ConciergeActionRow
}

/**
 * Overrides or reassigns an invite and records both concierge and admin audit rows.
 */
export async function overrideConciergeInvite(
  admin: SupabaseAdminClient,
  params: {
    inviteId: string
    adminUserId: string
    status: ConciergeInviteStatus
    notes: string | null
    outcomePayload?: JsonObject
    reassignedVenueId?: string | null
  }
) {
  const { data: before, error: beforeError } = await admin
    .from('venue_opportunity_invites')
    .select('*')
    .eq('id', params.inviteId)
    .single()

  if (beforeError || !before) {
    throw new Error(`Failed to load invite before override: ${beforeError?.message ?? 'not found'}`)
  }

  const isReassignment = Boolean(params.reassignedVenueId)
  const now = new Date().toISOString()
  const updates: JsonObject = isReassignment
    ? {
        venue_id: params.reassignedVenueId,
        status: 'queued',
        target_type: 'venue',
        response_at: null,
        responded_at: null,
        response_payload: {},
        venue_response_json: {},
        admin_notes: params.notes,
      }
    : {
        status: params.status,
        admin_notes: params.notes,
      }

  if (['accepted', 'declined', 'countered'].includes(params.status) && !isReassignment) {
    updates.response_at = now
    updates.responded_at = now
    updates.response_payload = params.outcomePayload ?? {}
    updates.venue_response_json = {
      status: params.status,
      notes: params.notes,
      source: 'admin_concierge',
      ...params.outcomePayload,
    }
  }

  const { data: after, error: updateError } = await admin
    .from('venue_opportunity_invites')
    .update(updates)
    .eq('id', params.inviteId)
    .select('*')
    .single()

  if (updateError || !after) {
    throw new Error(`Failed to override invite status: ${updateError?.message ?? 'not found'}`)
  }

  const action = await logConciergeAction(admin, {
    inviteId: params.inviteId,
    adminUserId: params.adminUserId,
    actionType: isReassignment ? 'reassigned' : 'status_override',
    notes: params.notes,
    outcomePayload: {
      ...(params.outcomePayload ?? {}),
      status: isReassignment ? 'queued' : params.status,
      reassignedVenueId: params.reassignedVenueId ?? null,
    },
  })

  await logAdminAudit(admin, {
    adminUserId: params.adminUserId,
    action: isReassignment ? 'concierge.invite.reassigned' : 'concierge.invite.status_override',
    entityType: 'venue_opportunity_invite',
    entityId: params.inviteId,
    beforeState: before,
    afterState: after,
    metadata: {
      concierge_action_id: action.id,
      notes: params.notes,
      outcome_payload: params.outcomePayload ?? {},
    },
  })

  return { invite: after as InviteRow, action }
}

async function logAdminAudit(
  admin: SupabaseAdminClient,
  params: {
    adminUserId: string
    action: string
    entityType: string
    entityId: string
    beforeState: JsonObject
    afterState: JsonObject
    metadata: JsonObject
  }
) {
  const { error } = await admin.from('admin_audit_log').insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId,
    before_state: params.beforeState,
    after_state: params.afterState,
    metadata: params.metadata,
  })

  if (error) throw new Error(`Failed to write admin audit log: ${error.message}`)
}

async function loadRows<T extends { id: string }>(
  admin: SupabaseAdminClient,
  table: string,
  ids: Array<string | null | undefined>,
  select = '*'
) {
  const safeIds = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
  if (safeIds.length === 0) return [] as T[]

  const { data, error } = await admin.from(table).select(select).in('id', safeIds)
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`)
  return (data ?? []) as T[]
}

async function loadActions(admin: SupabaseAdminClient, inviteIds: string[]) {
  const { data, error } = await admin
    .from('concierge_actions')
    .select('id, invite_id, action_type, notes, created_at')
    .in('invite_id', inviteIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[admin.concierge] concierge_actions unavailable', error)
    return [] as ConciergeActionRow[]
  }

  return (data ?? []) as ConciergeActionRow[]
}

async function loadBuilderProfiles(admin: SupabaseAdminClient, userIds: string[]) {
  const safeIds = Array.from(new Set(userIds.filter(Boolean)))
  if (safeIds.length === 0) return [] as BuilderProfileRow[]

  const { data, error } = await admin
    .from('builder_profiles')
    .select('id, user_id, name')
    .in('user_id', safeIds)

  if (error) {
    console.warn('[admin.concierge] builder_profiles unavailable', error)
    return [] as BuilderProfileRow[]
  }

  return (data ?? []) as BuilderProfileRow[]
}

function groupActionsByInvite(actions: ConciergeActionRow[]) {
  const grouped = new Map<string, ConciergeActionRow[]>()
  for (const action of actions) {
    const list = grouped.get(action.invite_id) ?? []
    list.push(action)
    grouped.set(action.invite_id, list)
  }
  return grouped
}

function getBriefId(invite: InviteRow) {
  return invite.brief_id || invite.opportunity_id || null
}

function parseTime(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function getAgeHours(value: string | null | undefined) {
  const time = parseTime(value)
  if (time === null) return 0
  return Math.max(0, Math.round((Date.now() - time) / (60 * 60 * 1000)))
}

function buildVenueContactInfo(venue: VenueRow | null | undefined) {
  if (!venue) return ['No venue details on file']
  const parts = [
    [venue.address, venue.city, venue.state, venue.zip_code].filter(Boolean).join(', '),
    venue.slug ? `Slug: ${venue.slug}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts : ['No phone or web contact on file']
}
