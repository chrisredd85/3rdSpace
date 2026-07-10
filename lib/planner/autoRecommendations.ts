import { NextRequest } from 'next/server'
import { PLAN_MESSAGE_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { estimateVenueRecommendationPriceCents } from '@/lib/planner/venueEstimate'
import type { Json, PlanMessage } from '@/lib/types'

type PlanMessageInsertDb = {
  from: (table: 'plan_messages') => {
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: unknown
          error: { message?: string } | null
        }>
      }
    }
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: unknown
          error: { message?: string } | null
        }>
      }
    }
  }
}

export async function createAutoRecommendationMessage(input: {
  db: PlanMessageInsertDb
  writeDb: PlanMessageInsertDb
  request: NextRequest
  planId: string
}): Promise<PlanMessage[]> {
  const recommendationData = await requestRecommendationRun(input.request, input.planId)
  if (!recommendationData) {
    const fallbackMessage = await insertRecommendationFallbackMessage(input.writeDb, input.planId)
    return fallbackMessage ? [fallbackMessage] : []
  }

  const rankedVenues = readArray(recommendationData.ranked_venues)
  const vendorRecommendations = readArray(recommendationData.vendor_recommendations)
  const venueDisplayItems = buildDisplayRecommendations(recommendationData).filter((rec) => rec.type === 'Venue')
  const vendorDisplayItems = buildDisplayRecommendations(recommendationData).filter((rec) => rec.type !== 'Venue')

  // Message 1 — venues only
  const venueContent = buildVenueOnlyContent(recommendationData)
  const { data: venueMessageData, error: venueMessageError } = await input.writeDb
    .from('plan_messages')
    .insert({
      plan_id: input.planId,
      role: 'agent',
      content: venueContent,
      message_type: 'recommendation',
      metadata: toJson({
        source: 'planner_recommendations',
        recommendations: venueDisplayItems,
        recommendation_response: recommendationData,
        venue_match_notice: readRecord(recommendationData.venue_match_notice),
        resolved_archetype: readRecord(recommendationData.resolved_archetype),
        ranked_venues: rankedVenues,
        capacity_calibration: readRecord(recommendationData.capacity_calibration),
        elasticity: readRecord(recommendationData.elasticity),
        persisted_recommendation_ids: readArray(recommendationData.persisted_recommendation_ids),
      }),
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (venueMessageError || !venueMessageData) {
    console.error('[planner.recommend] Auto recommendation venue message insert error', venueMessageError)
    return []
  }

  const messages: PlanMessage[] = [venueMessageData as PlanMessage]

  // Message 2 — vendors + approval card (only insert if there are vendors or an approval)
  const approvalMessageId = readString(recommendationData.outreach_approval_message_id)
  const hasVendors = vendorRecommendations.length > 0
  if (hasVendors || approvalMessageId) {
    const vendorContent = buildVendorFollowUpContent(recommendationData)
    const { data: vendorMessageData, error: vendorMessageError } = await input.writeDb
      .from('plan_messages')
      .insert({
        plan_id: input.planId,
        role: 'agent',
        content: vendorContent,
        message_type: 'recommendation',
        metadata: toJson({
          source: 'planner_recommendations',
          recommendations: vendorDisplayItems,
          byo_vendors: readArray(recommendationData.byo_vendors),
          vendor_match_notice: readRecord(recommendationData.vendor_match_notice),
          resolved_archetype: readRecord(recommendationData.resolved_archetype),
          vendor_recommendations: vendorRecommendations,
          vendor_recommendation_groups: readArray(recommendationData.vendor_recommendation_groups),
          economics: readRecord(recommendationData.economics),
          economics_placeholder: readString(recommendationData.economics_placeholder),
          profit_projection: readRecord(recommendationData.profit_projection),
          ticketing_platform_prompt: readString(recommendationData.ticketing_platform_prompt),
          workspace_summary: readRecord(recommendationData.workspace_summary),
          timeline: readRecord(recommendationData.timeline),
        }),
      })
      .select(PLAN_MESSAGE_SELECT_COLUMNS)
      .single()

    if (!vendorMessageError && vendorMessageData) {
      messages.push(vendorMessageData as PlanMessage)
    } else if (vendorMessageError) {
      console.error('[planner.recommend] Auto recommendation vendor message insert error', vendorMessageError)
    }
  }

  // Append the approval card message (already persisted by the recommend route)
  if (approvalMessageId) {
    const approvalMessage = await loadPlanMessage(input.db, approvalMessageId)
    if (approvalMessage) messages.push(approvalMessage)
  }

  return messages
}

async function insertRecommendationFallbackMessage(
  db: PlanMessageInsertDb,
  planId: string
): Promise<PlanMessage | null> {
  const { data, error } = await db
    .from('plan_messages')
    .insert({
      plan_id: planId,
      role: 'agent',
      content: 'I have enough detail to start matching venues, but the recommendation engine hit a temporary issue. I saved the plan details; try again in a moment or adjust the plan and I will re-check options.',
      message_type: 'status_update',
      metadata: toJson({
        source: 'planner_recommendations',
        recommendation_error: true,
        requires_retry: true,
      }),
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[planner.recommend] Auto recommendation fallback insert error', error)
    return null
  }

  return data as PlanMessage
}

async function requestRecommendationRun(
  request: NextRequest,
  planId: string
): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL(`/api/planner/plans/${planId}/recommend`, request.url)
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ venueLimit: 3, vendorLimit: 3 }),
    })

    if (!response.ok) {
      console.warn('[planner.recommend] Auto recommendation fallback skipped:', response.status)
      return null
    }

    return readRecord(await response.json())
  } catch (error) {
    console.warn('[planner.recommend] Auto recommendation route failed:', error)
    return null
  }
}

function buildRecommendationContent(data: Record<string, unknown>): string {
  const venueCount = readArray(data.ranked_venues).length
  const vendorCount = readArray(data.vendor_recommendations).length
  const venueNoticeMessage = readString(readRecord(data.venue_match_notice)?.message)
  const vendorNoticeMessage = readString(readRecord(data.vendor_match_notice)?.message)
  const recommendedProjection = readRecord(readRecord(data.profit_projection)?.recommended_projection)
  const planTicketed = readBoolean(data.plan_ticketed)
  const ticketPriceCents = readNumber(recommendedProjection?.ticket_price_cents)
  const profitCents = readNumber(recommendedProjection?.net_profit_cents)
  const breakEvenTickets = readNumber(recommendedProjection?.break_even_tickets)
  const economicsPlaceholder = readString(data.economics_placeholder)
  const ticketingPlatformPrompt = readString(data.ticketing_platform_prompt)

  const parts = [
    venueNoticeMessage ??
      (venueCount > 0
        ? `I found ${venueCount} venue ${venueCount === 1 ? 'match' : 'matches'}`
        : 'I could not find a strong venue match yet'),
    vendorNoticeMessage ??
      (vendorCount > 0
      ? `and ${vendorCount} suggested vendor ${vendorCount === 1 ? 'type' : 'options'}`
      : null),
  ].filter((part): part is string => part !== null)

  const projection =
    !economicsPlaceholder &&
    planTicketed !== false &&
    ticketPriceCents !== null &&
    profitCents !== null &&
    breakEvenTickets !== null
      ? ` At ${formatCurrency(ticketPriceCents)} per ticket, projected profit is ${formatCurrency(profitCents)} with break-even at ${breakEvenTickets} tickets.`
      : ''
  const followUp = [economicsPlaceholder, ticketingPlatformPrompt]
    .filter((value): value is string => Boolean(value))
    .join(' ')

  return `${parts.join(' ')}.${projection}${followUp ? ` ${followUp}` : ''}`
}

/**
 * Builds the content for the first phased message: venues only.
 * If no venues found, notes that and segues to vendor options.
 */
function buildVenueOnlyContent(data: Record<string, unknown>): string {
  const venueCount = readArray(data.ranked_venues).length
  const venueNoticeMessage = readString(readRecord(data.venue_match_notice)?.message)

  if (venueCount > 0) {
    const venueLabel = venueCount === 1 ? 'venue match' : 'venue matches'
    const intro = venueNoticeMessage ?? `Here are the best venue ${venueLabel}.`
    return `${intro} Review these or I can reach out to all of them.`
  }

  return 'No venue matches yet — flagging for manual sourcing. Here are vendor options.'
}

/**
 * Builds the content for the second phased message: vendors + lead-in to approval card.
 * If no vendors, just confirms with a segue to the approval card.
 */
function buildVendorFollowUpContent(data: Record<string, unknown>): string {
  const vendorCount = readArray(data.vendor_recommendations).length
  const vendorNoticeMessage = readString(readRecord(data.vendor_match_notice)?.message)
  const economicsPlaceholder = readString(data.economics_placeholder)
  const ticketingPlatformPrompt = readString(data.ticketing_platform_prompt)
  const recommendedProjection = readRecord(readRecord(data.profit_projection)?.recommended_projection)
  const planTicketed = readBoolean(data.plan_ticketed)
  const ticketPriceCents = readNumber(recommendedProjection?.ticket_price_cents)
  const profitCents = readNumber(recommendedProjection?.net_profit_cents)
  const breakEvenTickets = readNumber(recommendedProjection?.break_even_tickets)

  const vendorPart =
    vendorNoticeMessage ??
    (vendorCount > 0
      ? `I also lined up ${vendorCount} vendor ${vendorCount === 1 ? 'option' : 'options'}.`
      : null)

  const projection =
    !economicsPlaceholder &&
    planTicketed !== false &&
    ticketPriceCents !== null &&
    profitCents !== null &&
    breakEvenTickets !== null
      ? ` At ${formatCurrency(ticketPriceCents)} per ticket, projected profit is ${formatCurrency(profitCents)} with break-even at ${breakEvenTickets} tickets.`
      : ''

  const followUp = [economicsPlaceholder, ticketingPlatformPrompt]
    .filter((value): value is string => Boolean(value))
    .join(' ')

  const parts = [vendorPart].filter((part): part is string => part !== null)
  const base = parts.length > 0 ? `${parts.join(' ')}` : 'Here is the approval request for outreach.'
  return `${base}${projection}${followUp ? ` ${followUp}` : ''}`
}

function buildDisplayRecommendations(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const archetype = readRecord(data.resolved_archetype)
  const archetypeLabel = readString(archetype?.display_name)
  const venues = readArray(data.ranked_venues).map((item, index) => {
    const venue = readRecord(item) ?? {}
    const pros = readStringArray(venue.pros)
    const cons = readStringArray(venue.cons)
    const intro = readString(venue.user_facing_intro)
    const archetypeReasons = readStringArray(venue.archetype_reasons)
    const commercialModelMatch = readString(venue.commercial_model_match)
    const capacityCalibration = readRecord(venue.capacity_calibration) ?? readRecord(data.capacity_calibration)
    const priceCents = estimateVenueRecommendationPriceCents(
      { ...venue, ...(capacityCalibration ? { projected_attendance: capacityCalibration.projected_attendance } : {}) },
      buildVenueEstimatePlanSummary(data, venue, capacityCalibration)
    )

    return {
      id: readString(venue.venue_id),
      name: readString(venue.venue_name) ?? `Venue option ${index + 1}`,
      type: 'Venue',
      fit: `${readNumber(venue.fit_score) ?? 0}% fit`,
      action: 'Review venue',
      note: [intro, ...pros, ...cons].filter((value): value is string => Boolean(value)).join(' '),
      price_cents: priceCents,
      execution_mode: readString(venue.execution_mode),
      has_controlled_payment_account: readBoolean(venue.has_controlled_payment_account),
      payment_required: readBoolean(venue.payment_required),
      matched_archetype: archetypeLabel,
      commercial_model_match: commercialModelMatch,
      capacity_calibration: capacityCalibration,
      archetype_reasons: [...archetypeReasons, intro, ...pros].filter((value): value is string => Boolean(value)).slice(0, 2),
      tags: ['venue match'],
    }
  })
  const vendors = readArray(data.vendor_recommendations).map((item, index) => {
    const vendor = readRecord(item) ?? {}
    const serviceType = readString(vendor.service_type)
    const necessity = readString(vendor.necessity)

    return {
      id: readString(vendor.vendor_id),
      name: readString(vendor.name) ?? `Vendor option ${index + 1}`,
      type: serviceType ? `Vendor · ${serviceType.replace(/_/g, ' ')}` : 'Vendor',
      fit: `${readNumber(vendor.fit_score) ?? 0}% fit`,
      action: 'Review vendor',
      note: readStringArray(vendor.pros).join(' '),
      price_cents: readNumber(vendor.base_rate_cents),
      execution_mode: readString(vendor.execution_mode),
      has_controlled_payment_account: readBoolean(vendor.has_controlled_payment_account),
      payment_required: readBoolean(vendor.payment_required),
      matched_archetype: archetypeLabel,
      necessity,
      tags: [serviceType, necessity].filter((value): value is string => Boolean(value)),
    }
  })

  return [...venues, ...vendors]
}

function buildVenueEstimatePlanSummary(
  data: Record<string, unknown>,
  venue: Record<string, unknown>,
  capacityCalibration: Record<string, unknown> | null
) {
  const plan = readRecord(data.plan)
  const eventPlan = readRecord(data.event_plan)
  const workspaceSummary = readRecord(readRecord(data.workspace_summary)?.output)

  return {
    guest_count:
      readNumber(data.guest_count) ??
      readNumber(plan?.guest_count) ??
      readNumber(eventPlan?.expected_attendance) ??
      readNumber(workspaceSummary?.guest_count) ??
      readNumber(capacityCalibration?.projected_attendance) ??
      readNumber(venue.projected_attendance),
    headcount:
      readNumber(data.headcount) ??
      readNumber(plan?.headcount) ??
      readNumber(eventPlan?.headcount_max),
    expected_attendance:
      readNumber(data.expected_attendance) ??
      readNumber(eventPlan?.expected_attendance) ??
      readNumber(capacityCalibration?.projected_attendance),
    duration_hours:
      readNumber(data.duration_hours) ??
      readNumber(plan?.duration_hours) ??
      readNumber(eventPlan?.duration_hours) ??
      readDurationHours(readString(data.duration) ?? readString(plan?.duration) ?? readString(eventPlan?.duration)),
  }
}

function readDurationHours(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

async function loadPlanMessage(db: PlanMessageInsertDb, messageId: string): Promise<PlanMessage | null> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('id', messageId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[planner.recommend] Auto recommendation approval message lookup error', error)
    return null
  }

  return data as PlanMessage
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}
