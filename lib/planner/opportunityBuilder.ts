/**
 * Builds venue/vendor opportunity briefs from planner context.
 *
 * The planner uses this module after an event is coherent enough to recommend
 * concrete venues/vendors. Matching is deterministic: capacity first, then budget,
 * location, requirement coverage, and claim state. No external AI or network call
 * happens here.
 */
import type {
  AgentAction,
  Approval,
  Json,
  Plan,
  PlanMessage,
  PlannerOpportunityApprovalDraft,
  PlannerOpportunityBriefDraft,
  PlannerOpportunityMatchTarget,
  VenueOpportunityBrief,
  VenueOpportunityInvite,
} from '@/lib/types'
import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'

type PlannerDb = { from: (table: string) => any }

interface OpportunityVenueRow {
  id: string
  venue_name?: string | null
  name?: string | null
  city?: string | null
  state?: string | null
  venue_type?: string | null
  description?: string | null
  standing_capacity?: number | null
  seated_capacity?: number | null
  hourly_rate?: number | null
  minimum_hours?: number | null
  deposit_amount?: number | null
  deposit_percentage?: number | null
  auto_approve_conditions?: Json | null
  unique_features?: string | null
  unique_features_tags?: string[] | null
  is_claimed?: boolean | null
  is_admin_seeded?: boolean | null
  claimed_user_id?: string | null
  is_published?: boolean | null
}

interface OpportunityVendorRow {
  id: string
  name?: string | null
  vendor_type?: string | null
  service_type?: string | null
  bio?: string | null
  availability_notes?: string | null
  regions_served?: string | null
  services_offered?: string[] | null
  compatible_features?: string[] | null
  hourly_rate?: number | null
  base_rate?: number | null
  per_person_rate?: number | null
  deposit_amount?: number | null
  deposit_percentage?: number | null
  is_claimed?: boolean | null
  is_admin_seeded?: boolean | null
  claimed_user_id?: string | null
  is_published?: boolean | null
}

interface CreateVenueOpportunityBundleInput {
  db: PlannerDb
  plan: Plan
  messages: PlanMessage[]
  userId: string
  force?: boolean
}

interface CreatedVenueOpportunityBundle {
  opportunity: VenueOpportunityBrief
  invites: VenueOpportunityInvite[]
  agentAction: AgentAction
  approval: Approval
  approvalMessage: PlanMessage
}

const VENUE_OPPORTUNITY_SELECT = `
  id,
  venue_name,
  city,
  state,
  venue_type,
  description,
  standing_capacity,
  seated_capacity,
  hourly_rate,
  minimum_hours,
  deposit_amount,
  deposit_percentage,
  auto_approve_conditions,
  unique_features,
  unique_features_tags,
  is_claimed,
  is_admin_seeded,
  claimed_user_id,
  is_published
`

const VENDOR_OPPORTUNITY_SELECT = `
  id,
  name,
  vendor_type,
  service_type,
  bio,
  availability_notes,
  regions_served,
  services_offered,
  compatible_features,
  hourly_rate,
  base_rate,
  per_person_rate,
  deposit_amount,
  deposit_percentage,
  is_claimed,
  is_admin_seeded,
  claimed_user_id,
  is_published
`

async function filterCompliantOpportunityMatches(
  db: PlannerDb,
  matches: PlannerOpportunityMatchTarget[]
) {
  const checked = await Promise.all(matches.map(async (match) => {
    if (match.target_type !== 'venue') return match
    if (!match.target_id) return null

    try {
      const status = await getVenueComplianceStatus(db as any, match.target_id)
      if (!status.is_compliant) {
        console.warn('Planner opportunity venue blocked for compliance', {
          venue_id: match.target_id,
          reason: status.reason,
        })
        return null
      }
      return match
    } catch (error) {
      console.error('Planner opportunity venue compliance check failed:', error)
      return match
    }
  }))

  return checked.filter((match): match is PlannerOpportunityMatchTarget => match !== null)
}

/**
 * Builds a normalized opportunity brief draft from the current plan and messages.
 *
 * @param plan - Planner source-of-truth row.
 * @param messages - Full conversation thread for summary metadata.
 * @param userId - Organizer user id.
 * @returns Opportunity brief draft ready for insertion.
 */
export function buildOpportunityBriefDraft(
  plan: Plan,
  messages: PlanMessage[],
  userId: string
): PlannerOpportunityBriefDraft {
  const summary = readLatestSummary(messages)
  const eventType = readString(summary.event_type) ?? plan.event_type
  const guestCount = readNumber(summary.guest_count) ?? plan.guest_count
  const budgetCents = readNumber(summary.budget_cents) ?? plan.budget_cap_cents
  const mustHaves = readStringArray(summary.must_haves)
  const eventComponents = readEventComponents(summary.event_components)
  const area = readString(summary.area) ?? plan.neighborhood
  const dateWindowStart = readString(summary.date_window_start) ?? plan.date_window_start
  const dateWindowEnd = readString(summary.date_window_end) ?? plan.date_window_end
  const timePreference = readString(summary.time_preference)
  const depositTargetCents = estimateTotalDepositCents(budgetCents)

  return {
    plan_id: plan.id,
    organizer_user_id: userId,
    title: `${eventType ?? 'Event'} opportunity`,
    event_type: eventType,
    event_components: eventComponents,
    guest_count: guestCount,
    date_window_start: dateWindowStart,
    date_window_end: dateWindowEnd,
    time_preference: timePreference,
    neighborhood: area,
    budget_cents: budgetCents,
    must_haves: mustHaves,
    requested_terms: {
      ticketed: plan.ticketed,
      requirements: mustHaves,
      time_preference: timePreference,
    } as Record<string, Json>,
    deposit_target_cents: depositTargetCents,
    status: 'approval_requested',
  }
}

/**
 * Ranks venue and vendor targets for a planner opportunity.
 *
 * Capacity, budget, and requirement fit are treated as hard MVP signals. Unclaimed
 * listings are still returned, but they are flagged for concierge handling.
 *
 * @param input - Brief plus catalog rows to evaluate.
 * @returns Ranked opportunity targets.
 */
export function rankOpportunityTargets(input: {
  brief: PlannerOpportunityBriefDraft
  venues: OpportunityVenueRow[]
  vendors: OpportunityVendorRow[]
}): PlannerOpportunityMatchTarget[] {
  const venueMatches = input.venues
    .map((venue) => scoreVenue(input.brief, venue))
    .filter((target) => target.capacity_fit && target.budget_fit)
    .sort(sortTargets)
    .slice(0, 5)

  const vendorMatches = input.vendors
    .map((vendor) => scoreVendor(input.brief, vendor))
    .filter((target) => target.budget_fit)
    .sort(sortTargets)
    .slice(0, 3)

  const matches = [...venueMatches, ...vendorMatches]

  if (matches.length > 0) return matches

  return [
    {
      target_type: 'concierge',
      target_id: null,
      name: '3rdSpace concierge queue',
      area: input.brief.neighborhood,
      is_claimed: false,
      route_to_concierge: true,
      match_score: 50,
      capacity_fit: Boolean(input.brief.guest_count),
      budget_fit: Boolean(input.brief.budget_cents),
      requirement_fit: {
        matched: [],
        missing: input.brief.must_haves,
      },
      quoted_price_cents: null,
      proposed_deposit_cents: input.brief.deposit_target_cents,
      fit_reason: 'No exact catalog fit yet. Concierge should source options manually.',
      invite_status: 'concierge_queue',
    },
  ]
}

/**
 * Builds the approval-card copy for sending a brief to venue/vendor targets.
 *
 * @param matches - Ranked targets that will receive the opportunity.
 * @param brief - Opportunity brief draft.
 * @returns Approval payload for a `Send to venues` card.
 */
export function buildSendToVenuesApprovalDraft(
  matches: PlannerOpportunityMatchTarget[],
  brief: PlannerOpportunityBriefDraft
): PlannerOpportunityApprovalDraft {
  const venueCount = matches.filter((match) => match.target_type === 'venue').length
  const vendorCount = matches.filter((match) => match.target_type === 'vendor').length
  const conciergeCount = matches.filter((match) => match.route_to_concierge).length
  const requestedAmountCents = matches.reduce(
    (total, match) => total + (match.proposed_deposit_cents ?? 0),
    0
  )

  return {
    action_label: 'Send to venues',
    provider: '3rdSpace venue + vendor network',
    requested_amount_cents: requestedAmountCents,
    package_details:
      `Send this ${brief.event_type ?? 'event'} brief to ${venueCount} venue${venueCount === 1 ? '' : 's'}` +
      `${vendorCount > 0 ? ` and ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}` : ''}. ` +
      'No charge is made now; this only authorizes outreach and proposed deposit terms.',
    refund_terms: 'No payment is collected by sending the brief.',
    cancellation_terms: 'You can cancel before a venue or vendor accepts terms.',
    delivery_email: null,
    venue_count: venueCount,
    vendor_count: vendorCount,
    concierge_count: conciergeCount,
  }
}

/**
 * Creates an opportunity brief, target invites, linked agent action, approval,
 * and approval_request message for a coherent planner plan.
 *
 * @param input - Database port, plan, messages, and organizer user id.
 * @returns Created bundle, or null when an active opportunity already exists.
 */
export async function createVenueOpportunityBundle(
  input: CreateVenueOpportunityBundleInput
): Promise<CreatedVenueOpportunityBundle | null> {
  if (!input.force) {
    const existing = await input.db
      .from('venue_opportunity_briefs')
      .select('id')
      .eq('plan_id', input.plan.id)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle()

    if (existing.data) return null
  }

  const briefDraft = buildOpportunityBriefDraft(input.plan, input.messages, input.userId)
  const [venueResult, vendorResult] = await Promise.all([
    input.db
      .from('venues')
      .select(VENUE_OPPORTUNITY_SELECT)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(40),
    input.db
      .from('vendor_profiles')
      .select(VENDOR_OPPORTUNITY_SELECT)
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  if (venueResult.error) {
    console.error('Planner opportunity venue lookup error:', venueResult.error)
  }
  if (vendorResult.error) {
    console.error('Planner opportunity vendor lookup error:', vendorResult.error)
  }

  const matches = rankOpportunityTargets({
    brief: briefDraft,
    venues: (venueResult.data ?? []) as OpportunityVenueRow[],
    vendors: (vendorResult.data ?? []) as OpportunityVendorRow[],
  })

  const approvalDraft = buildSendToVenuesApprovalDraft(matches, briefDraft)
  const briefInsert = {
    ...briefDraft,
    event_components: briefDraft.event_components as unknown as Json,
    must_haves: briefDraft.must_haves as unknown as Json,
    requested_terms: briefDraft.requested_terms as unknown as Json,
  }
  const { data: briefData, error: briefError } = await input.db
    .from('venue_opportunity_briefs')
    .insert(briefInsert)
    .select('*')
    .single()

  if (briefError || !briefData) {
    console.error('Planner opportunity brief insert error:', briefError)
    return null
  }

  const opportunity = briefData as VenueOpportunityBrief
  const compliantMatches = await filterCompliantOpportunityMatches(input.db, matches)
  if (compliantMatches.length === 0) {
    console.warn('Planner opportunity invite creation skipped: no compliant venue matches remain')
    return null
  }

  const invitePayloads = compliantMatches.map((match) => ({
    opportunity_id: opportunity.id,
    brief_id: opportunity.id,
    target_type: match.target_type,
    venue_id: match.target_type === 'venue' ? match.target_id : null,
    vendor_profile_id: match.target_type === 'vendor' ? match.target_id : null,
    status: 'queued',
    is_claimed: match.is_claimed,
    route_to_concierge: match.route_to_concierge,
    match_score: match.match_score,
    capacity_fit: match.capacity_fit,
    budget_fit: match.budget_fit,
    requirement_fit: match.requirement_fit as unknown as Json,
    proposed_deposit_cents: match.proposed_deposit_cents,
    quoted_price_cents: match.quoted_price_cents,
    venue_response_json: {
      status: 'pending',
      target_name: match.name,
      fit_reason: match.fit_reason,
    } as Json,
    admin_notes: match.route_to_concierge ? 'Unclaimed or concierge-only target. Route through internal queue.' : null,
  }))

  const { data: inviteData, error: inviteError } = await input.db
    .from('venue_opportunity_invites')
    .insert(invitePayloads)
    .select('*')

  if (inviteError || !inviteData) {
    console.error('Planner opportunity invite insert error:', inviteError)
    return null
  }

  const invites = inviteData as VenueOpportunityInvite[]
  const targetSummary = compliantMatches.map((match) => ({
    target_type: match.target_type,
    target_id: match.target_id,
    name: match.name,
    proposed_deposit_cents: match.proposed_deposit_cents,
    match_score: match.match_score,
    route_to_concierge: match.route_to_concierge,
  }))

  const { data: actionData, error: actionError } = await input.db
    .from('agent_actions')
    .insert({
      plan_id: input.plan.id,
      action_type: 'opportunity_send_venues',
      description: approvalDraft.action_label,
      provider: approvalDraft.provider,
      amount_cents: approvalDraft.requested_amount_cents,
      currency: 'usd',
      status: 'pending',
      target_type: 'opportunity',
      target_id: opportunity.id,
      payload_json: {
        opportunity_brief_id: opportunity.id,
        invite_ids: invites.map((invite) => invite.id),
        venue_ids: matches
          .filter((match) => match.target_type === 'venue' && match.target_id)
          .map((match) => match.target_id),
        summary: `${briefDraft.title}: ${briefDraft.guest_count ?? 'TBD'} guests in ${briefDraft.neighborhood ?? 'the Bay Area'}.`,
        requirements: {
          must_haves: briefDraft.must_haves,
          requested_terms: briefDraft.requested_terms,
          date_window_start: briefDraft.date_window_start,
          date_window_end: briefDraft.date_window_end,
          budget_cents: briefDraft.budget_cents,
        },
        response_deadline: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        targets: targetSummary,
        action: 'send_to_venues',
      } as Json,
      result_metadata: {
        source: 'planner_opportunity_marketplace',
      } as Json,
    })
    .select('*')
    .single()

  if (actionError || !actionData) {
    console.error('Planner opportunity action insert error:', actionError)
    return null
  }

  const agentAction = actionData as AgentAction
  const { data: approvalData, error: approvalError } = await input.db
    .from('approvals')
    .insert({
      plan_id: input.plan.id,
      agent_action_id: agentAction.id,
      action_label: approvalDraft.action_label,
      provider: approvalDraft.provider,
      price_cents: approvalDraft.requested_amount_cents,
      fees_cents: 0,
      package_details: approvalDraft.package_details,
      refund_terms: approvalDraft.refund_terms,
      cancellation_terms: approvalDraft.cancellation_terms,
      delivery_email: approvalDraft.delivery_email,
      requested_amount_cents: approvalDraft.requested_amount_cents,
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')
    .single()

  if (approvalError || !approvalData) {
    console.error('Planner opportunity approval insert error:', approvalError)
    return null
  }

  const approval = approvalData as Approval
  await input.db.from('agent_actions').update({ approval_id: approval.id }).eq('id', agentAction.id)
  await createConciergeFallbackTask(input.db, input.plan, opportunity, invites)

  const { data: messageData, error: messageError } = await input.db
    .from('plan_messages')
    .insert({
      plan_id: input.plan.id,
      role: 'agent',
      content:
        'I can send this event brief to matched venues and vendors now. Approve the outreach card and I will route unclaimed listings through concierge.',
      message_type: 'approval_request',
      metadata: {
        state: 'opportunity_approval_requested',
        status: 'pending',
        opportunity,
        invites,
        deposit_proposals: targetSummary,
        approval,
      } as unknown as Json,
    })
    .select('*')
    .single()

  if (messageError || !messageData) {
    console.error('Planner opportunity approval message insert error:', messageError)
    return null
  }

  return {
    opportunity,
    invites,
    agentAction: { ...agentAction, approval_id: approval.id },
    approval,
    approvalMessage: messageData as PlanMessage,
  }
}

function scoreVenue(brief: PlannerOpportunityBriefDraft, venue: OpportunityVenueRow): PlannerOpportunityMatchTarget {
  const capacity = readCapacity(venue)
  const guestCount = brief.guest_count ?? 0
  const capacityFit = !guestCount || capacity >= guestCount
  const estimatedPrice = estimateVenuePriceCents(venue, guestCount)
  const budgetFit = fitsBudget(estimatedPrice, brief.budget_cents, 0.6)
  const requirementFit = scoreRequirementFit(brief.must_haves, buildVenueSearchText(venue))
  const venueArea = readVenueArea(venue)
  const areaScore = scoreArea(brief.neighborhood, [venueArea, venue.city, venue.state])
  const score = clampScore(
    (capacityFit ? 32 : 0) +
      (budgetFit ? 28 : 0) +
      areaScore +
      requirementFit.matched.length * 6 +
      (venue.is_claimed ? 8 : 4)
  )

  return {
    target_type: 'venue',
    target_id: venue.id,
    name: venue.venue_name ?? venue.name ?? 'Venue',
    area: venueArea ?? venue.city ?? null,
    is_claimed: Boolean(venue.is_claimed),
    route_to_concierge: !venue.is_claimed,
    match_score: score,
    capacity_fit: capacityFit,
    budget_fit: budgetFit,
    requirement_fit: requirementFit,
    quoted_price_cents: estimatedPrice,
    proposed_deposit_cents: estimateVenueDepositCents(venue, estimatedPrice, brief.budget_cents),
    fit_reason: `${capacity || 'Unknown'} capacity · ${budgetFit ? 'within budget' : 'needs quote'} · ${requirementFit.matched.length} requirement matches`,
    invite_status: venue.is_claimed ? 'pending_organizer_approval' : 'concierge_queue',
  }
}

function scoreVendor(brief: PlannerOpportunityBriefDraft, vendor: OpportunityVendorRow): PlannerOpportunityMatchTarget {
  const guestCount = brief.guest_count ?? 0
  const estimatedPrice = estimateVendorPriceCents(vendor, guestCount)
  const budgetFit = fitsBudget(estimatedPrice, brief.budget_cents, 0.35)
  const requirementFit = scoreRequirementFit(brief.must_haves, buildVendorSearchText(vendor))
  const areaScore = scoreArea(brief.neighborhood, [vendor.regions_served])
  const score = clampScore(
    (budgetFit ? 30 : 0) +
      areaScore +
      requirementFit.matched.length * 9 +
      (vendor.is_claimed ? 8 : 4) +
      (estimatedPrice ? 10 : 4)
  )

  return {
    target_type: 'vendor',
    target_id: vendor.id,
    name: vendor.name ?? vendor.vendor_type ?? 'Vendor',
    area: vendor.regions_served ?? null,
    is_claimed: Boolean(vendor.is_claimed),
    route_to_concierge: !vendor.is_claimed,
    match_score: score,
    capacity_fit: true,
    budget_fit: budgetFit,
    requirement_fit: requirementFit,
    quoted_price_cents: estimatedPrice,
    proposed_deposit_cents: estimateVendorDepositCents(vendor, estimatedPrice, brief.budget_cents),
    fit_reason: `${vendor.vendor_type ?? vendor.service_type ?? 'Vendor'} · ${budgetFit ? 'budget fit' : 'needs quote'} · ${requirementFit.matched.length} requirement matches`,
    invite_status: vendor.is_claimed ? 'pending_organizer_approval' : 'concierge_queue',
  }
}

function sortTargets(a: PlannerOpportunityMatchTarget, b: PlannerOpportunityMatchTarget) {
  if (b.match_score !== a.match_score) return b.match_score - a.match_score
  const aPrice = a.quoted_price_cents ?? Number.MAX_SAFE_INTEGER
  const bPrice = b.quoted_price_cents ?? Number.MAX_SAFE_INTEGER
  return aPrice - bPrice
}

function readLatestSummary(messages: PlanMessage[]) {
  const message = [...messages]
    .reverse()
    .find((item) => item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) && 'summary' in item.metadata)
  const metadata = message?.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const summary = metadata.summary
  return summary && typeof summary === 'object' && !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : {}
}

function readEventComponents(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is PlannerOpportunityBriefDraft['event_components'][number] =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item) && typeof (item as { label?: unknown }).label === 'string'
  )
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readCapacity(venue: OpportunityVenueRow) {
  return venue.standing_capacity ?? venue.seated_capacity ?? 0
}

function estimateVenuePriceCents(venue: OpportunityVenueRow, guestCount: number) {
  const hourlyRate = toIntegerCents(venue.hourly_rate)
  const minimumHours = Math.max(venue.minimum_hours ?? 4, 4)
  const rental = hourlyRate ? hourlyRate * minimumHours : null
  const perGuestFloor = guestCount > 0 ? guestCount * 3500 : 0
  return rental ? Math.max(rental, perGuestFloor) : perGuestFloor || null
}

function estimateVendorPriceCents(vendor: OpportunityVendorRow, guestCount: number) {
  const baseRate = toIntegerCents(vendor.base_rate) ?? toIntegerCents(vendor.hourly_rate)
  const perPerson = toIntegerCents(vendor.per_person_rate)
  if (perPerson && guestCount > 0) return Math.max(perPerson * guestCount, baseRate ?? 0)
  return baseRate
}

function toIntegerCents(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value > 1000 ? Math.round(value) : Math.round(value * 100)
}

function fitsBudget(estimatedPriceCents: number | null, budgetCents: number | null, allocation: number) {
  if (!budgetCents || budgetCents <= 0) return true
  if (!estimatedPriceCents || estimatedPriceCents <= 0) return true
  return estimatedPriceCents <= Math.round(budgetCents * allocation)
}

function estimateTotalDepositCents(budgetCents: number | null) {
  if (!budgetCents || budgetCents <= 0) return null
  return Math.max(25_000, Math.round(budgetCents * 0.2))
}

function estimateVenueDepositCents(
  venue: OpportunityVenueRow,
  estimatedPriceCents: number | null,
  budgetCents: number | null
) {
  const explicitDeposit = toIntegerCents(venue.deposit_amount)
  if (explicitDeposit) return explicitDeposit
  if (venue.deposit_percentage && estimatedPriceCents) {
    return Math.round(estimatedPriceCents * (venue.deposit_percentage / 100))
  }
  const baseline = estimatedPriceCents ?? budgetCents ?? 0
  return baseline > 0 ? Math.max(25_000, Math.round(baseline * 0.2)) : null
}

function estimateVendorDepositCents(
  vendor: OpportunityVendorRow,
  estimatedPriceCents: number | null,
  budgetCents: number | null
) {
  const explicitDeposit = toIntegerCents(vendor.deposit_amount)
  if (explicitDeposit) return explicitDeposit
  if (vendor.deposit_percentage && estimatedPriceCents) {
    return Math.round(estimatedPriceCents * (vendor.deposit_percentage / 100))
  }
  const baseline = estimatedPriceCents ?? (budgetCents ? Math.round(budgetCents * 0.25) : 0)
  return baseline > 0 ? Math.max(10_000, Math.round(baseline * 0.2)) : null
}

function scoreRequirementFit(requirements: string[], searchText: string) {
  const normalizedText = searchText.toLowerCase()
  const matched = requirements.filter((requirement) => normalizedText.includes(requirement.toLowerCase()))
  const missing = requirements.filter((requirement) => !matched.includes(requirement))
  return { matched, missing }
}

function scoreArea(area: string | null, values: Array<string | null | undefined>) {
  if (!area) return 10
  const normalizedArea = area.toLowerCase()
  const haystack = values.filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(normalizedArea) || normalizedArea.includes(haystack) ? 22 : 6
}

function buildVenueSearchText(venue: OpportunityVenueRow) {
  return [
    venue.venue_name,
    venue.name,
    readVenueArea(venue),
    venue.city,
    venue.venue_type,
    venue.description,
    venue.unique_features,
    ...(venue.unique_features_tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}

function readVenueArea(venue: OpportunityVenueRow) {
  const conditions = venue.auto_approve_conditions
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return null
  const neighborhood = (conditions as Record<string, unknown>).neighborhood
  return typeof neighborhood === 'string' && neighborhood.trim().length > 0 ? neighborhood.trim() : null
}

function buildVendorSearchText(vendor: OpportunityVendorRow) {
  return [
    vendor.name,
    vendor.vendor_type,
    vendor.service_type,
    vendor.bio,
    vendor.availability_notes,
    vendor.regions_served,
    ...(vendor.services_offered ?? []),
    ...(vendor.compatible_features ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

async function createConciergeFallbackTask(
  db: PlannerDb,
  plan: Plan,
  opportunity: VenueOpportunityBrief,
  invites: VenueOpportunityInvite[]
) {
  const conciergeInvites = invites.filter((invite) => invite.route_to_concierge)
  if (conciergeInvites.length === 0) return

  const { error } = await db.from('admin_tasks').insert({
    plan_id: plan.id,
    task_type: 'concierge_booking',
    description: `Route ${conciergeInvites.length} opportunity target${conciergeInvites.length === 1 ? '' : 's'} through concierge fallback.`,
    status: 'open',
    notes: JSON.stringify({
      opportunity_id: opportunity.id,
      invite_ids: conciergeInvites.map((invite) => invite.id),
      reason: 'Unclaimed venue/vendor listing or no direct owner response UI yet.',
    }),
  })

  if (error) console.error('Planner opportunity concierge task insert error:', error)
}
