import { rankVenueCommercialModels } from '@/lib/planner/commercialModelRanker'
import { archetypeFor } from '@/lib/planner/archetypes'
import type { EventArchetypeConfig } from '@/lib/planner/archetypes'
import { parseNeighborhoodPhrase } from '@/lib/planner/areaParsing'
import type { BuilderAttendanceSummary } from '@/lib/server/builderAttendanceHistory'
import { readCents } from '@/lib/money'
import { computeVendorLocationScore, formatVendorLocationContext } from '@/lib/planner/geography'
import { scoreVenueAgainstArchetype } from '@/lib/venues/venueRanker'

export type CatalogPartnerKind = 'venue' | 'vendor'

export type CatalogFitLabel = 'Best fit' | 'Budget fit' | 'Stretch' | 'Premium service fit'

export interface CatalogPlanRankingInput {
  id?: string
  headcount?: number | null
  guest_count?: number | null
  area?: string | null
  neighborhood?: string | null
  budget_cents?: number | null
  budget_cap_cents?: number | null
  event_type?: string | null
  must_haves?: string[] | null
  ticketing_model?: string | null
  food_responsibility?: string | null
  venue_terms?: string | null
  consumption_share?: string | null
  room_type?: string | null
  date_window?: string | null
  date_window_start?: string | null
  date_window_end?: string | null
  metadata?: unknown
  /** Preferred venue IDs from a saved template rebook. Eligible preferred venues receive a score boost. */
  preferred_venue_ids?: string[] | null
  /** Preferred vendor IDs from a saved template rebook. Eligible preferred vendors receive a score boost. */
  preferred_vendor_ids?: string[] | null
  /** Creator signup amenity preferences. These are soft tie-breakers, not hard requirements. */
  organizer_preferred_amenities?: string[] | null
  /** Canonical event city used as the default vendor sourcing boundary. */
  event_city?: string | null
  /** Whether organizer explicitly approved adjacent-city vendors. */
  vendor_out_of_city_approved?: boolean | null
  /** Adjacent cities approved by organizer for vendor sourcing. */
  vendor_approved_adjacent_cities?: string[] | null
}

export type CatalogVenueRankingInput = Record<string, unknown> & {
  id: string
}

export type CatalogVendorRankingInput = Record<string, unknown> & {
  id: string
}

export interface RankedCatalogRecommendation {
  partner_id: string
  kind: CatalogPartnerKind
  name: string
  fit_label: CatalogFitLabel
  estimate_cents: number
  score: number
  reasoning: string[]
  blocking_issues: string[]
  capacity: number | null
  capacity_known: boolean
  tags: string[]
  metadata: Record<string, unknown>
}

export interface CatalogRankingResult {
  archetype: EventArchetypeConfig
  recommendations: RankedCatalogRecommendation[]
  rejected: RankedCatalogRecommendation[]
}

interface RankCatalogPartnersInput {
  plan: CatalogPlanRankingInput
  venues: CatalogVenueRankingInput[]
  vendors: CatalogVendorRankingInput[]
  archetype?: EventArchetypeConfig
  builderAttendance?: BuilderAttendanceSummary | null
  limit?: number
  venueLimit?: number
  vendorLimit?: number
}

interface AreaGroup {
  id: string
  parent?: 'sf' | 'oakland' | 'south_bay' | 'peninsula' | 'marin' | 'wine_country'
  aliases: string[]
}

const AREA_GROUPS: AreaGroup[] = [
  { id: 'sf', aliases: ['sf', 'san francisco', 'the city'] },
  { id: 'soma', parent: 'sf', aliases: ['soma', 'south of market'] },
  { id: 'mission', parent: 'sf', aliases: ['mission', 'mission district'] },
  { id: 'hayes_valley', parent: 'sf', aliases: ['hayes valley', 'hayes'] },
  { id: 'castro', parent: 'sf', aliases: ['castro'] },
  { id: 'marina', parent: 'sf', aliases: ['marina'] },
  { id: 'nob_hill', parent: 'sf', aliases: ['nob hill'] },
  { id: 'north_beach', parent: 'sf', aliases: ['north beach'] },
  { id: 'chinatown', parent: 'sf', aliases: ['chinatown'] },
  { id: 'fidi', parent: 'sf', aliases: ['financial district', 'fidi'] },
  { id: 'downtown_sf', parent: 'sf', aliases: ['downtown sf', 'downtown san francisco', 'downtown'] },
  { id: 'dogpatch', parent: 'sf', aliases: ['dogpatch'] },
  { id: 'potrero_hill', parent: 'sf', aliases: ['potrero hill'] },
  { id: 'richmond', parent: 'sf', aliases: ['richmond', 'inner richmond', 'outer richmond'] },
  { id: 'sunset', parent: 'sf', aliases: ['sunset', 'inner sunset', 'outer sunset'] },
  { id: 'haight', parent: 'sf', aliases: ['haight'] },
  { id: 'fillmore', parent: 'sf', aliases: ['fillmore'] },
  { id: 'pac_heights', parent: 'sf', aliases: ['pac heights', 'pacific heights'] },
  { id: 'embarcadero', parent: 'sf', aliases: ['embarcadero'] },
  { id: 'oakland', aliases: ['oakland'] },
  { id: 'downtown_oakland', parent: 'oakland', aliases: ['downtown oakland'] },
  { id: 'uptown_oakland', parent: 'oakland', aliases: ['uptown oakland'] },
  { id: 'east_oakland', parent: 'oakland', aliases: ['east oakland'] },
  { id: 'jack_london', parent: 'oakland', aliases: ['jack london square', 'jack london'] },
  { id: 'berkeley', aliases: ['berkeley'] },
  { id: 'emeryville', aliases: ['emeryville'] },
  { id: 'alameda', aliases: ['alameda'] },
  { id: 'south_bay', aliases: ['south bay'] },
  { id: 'san_jose', parent: 'south_bay', aliases: ['san jose'] },
  { id: 'santa_clara', parent: 'south_bay', aliases: ['santa clara'] },
  { id: 'sunnyvale', parent: 'south_bay', aliases: ['sunnyvale'] },
  { id: 'mountain_view', parent: 'south_bay', aliases: ['mountain view'] },
  { id: 'palo_alto', parent: 'peninsula', aliases: ['palo alto'] },
  { id: 'menlo_park', parent: 'peninsula', aliases: ['menlo park'] },
  { id: 'redwood_city', parent: 'peninsula', aliases: ['redwood city'] },
  { id: 'burlingame', parent: 'peninsula', aliases: ['burlingame'] },
  { id: 'san_mateo', parent: 'peninsula', aliases: ['san mateo'] },
  { id: 'peninsula', aliases: ['peninsula'] },
  { id: 'marin', aliases: ['marin'] },
  { id: 'sausalito', parent: 'marin', aliases: ['sausalito'] },
  { id: 'mill_valley', parent: 'marin', aliases: ['mill valley'] },
  { id: 'tiburon', parent: 'marin', aliases: ['tiburon'] },
  { id: 'wine_country', aliases: ['wine country', 'napa valley'] },
  { id: 'napa', parent: 'wine_country', aliases: ['napa'] },
  { id: 'sonoma', parent: 'wine_country', aliases: ['sonoma'] },
  { id: 'petaluma', parent: 'wine_country', aliases: ['petaluma'] },
]

const EVENT_TYPE_ALIASES: Record<string, string[]> = {
  dinner: ['dinner', 'supper club', 'private dinner', 'founder dinner', 'tasting menu'],
  mixer: ['mixer', 'networking mixer', 'founder mixer', 'happy hour', 'meetup', 'social'],
  retreat: ['retreat', 'corporate retreat', 'offsite', 'team offsite'],
  'day party': ['day party', 'brunch party', 'rooftop party', 'sunday party', 'patio party'],
  'listening party': ['listening party', 'album party', 'release listen', 'music preview'],
  workshop: ['workshop', 'class', 'skill session'],
  panel: ['panel', 'fireside chat', 'speaker panel', 'talk'],
  hackathon: ['hackathon', 'builder weekend', 'code sprint'],
  'watch party': ['watch party', 'screening', 'sports watch', 'movie watch'],
}

const SERVICE_KEYWORDS: Record<string, string[]> = {
  dj: ['dj', 'music', 'dance', 'party', 'listening', 'sound'],
  catering: ['food', 'catering', 'dinner', 'lunch', 'meal', 'bites', 'tasting'],
  bartending: ['bar', 'drinks', 'alcohol', 'cocktail', 'mocktail', 'beer', 'wine'],
  photography: ['photo', 'photographer', 'content'],
  videography: ['video', 'videographer', 'recording'],
  av_tech: ['av', 'projector', 'screen', 'mic', 'speaker', 'sound', 'stage'],
  event_planning: ['security', 'check-in', 'staff', 'registration', 'producer'],
  florist: ['floral', 'decor', 'flowers'],
}

/**
 * Ranks seeded venue and vendor catalog rows against a planner brief.
 *
 * Hard-blocked venue candidates are returned in `rejected` for server logging only.
 * Public API callers should return only `recommendations`.
 */
export function rankCatalogPartners(input: RankCatalogPartnersInput): CatalogRankingResult {
  const limit = input.limit ?? 6
  const venueLimit = input.venueLimit ?? Math.min(3, limit)
  const vendorLimit = input.vendorLimit ?? Math.min(3, Math.max(limit - venueLimit, 0))
  const rejected: RankedCatalogRecommendation[] = []
  const archetype = input.archetype ?? archetypeFor(input.plan.event_type ?? null)

  const venueCandidates = input.venues
    .map((venue) => rankVenue(input.plan, venue, archetype, input.builderAttendance ?? null))
    .filter((recommendation) => {
      if (recommendation.blocking_issues.length === 0) return true
      rejected.push(recommendation)
      return false
    })
    .sort(compareRecommendations)
  const venueRecommendations = attachCategoryRanks(selectTopVenuesByCluster(input.plan, venueCandidates, venueLimit))

  const vendorCandidates = input.vendors
    .map((vendor) => rankVendor(input.plan, vendor))
    .filter((recommendation) => {
      if (recommendation.blocking_issues.length === 0) return true
      rejected.push(recommendation)
      return false
    })
    .sort(compareRecommendations)
  const vendorRecommendations = selectTopVendorsByCategory(input.plan, vendorCandidates, vendorLimit)

  return {
    archetype,
    recommendations: [...venueRecommendations, ...vendorRecommendations].slice(0, limit),
    rejected,
  }
}

/** Score bonus applied to preferred (previously-used) partners that still pass all hard gates. */
const REBOOK_PREFERENCE_SCORE_BOOST = 12
const ORGANIZER_AMENITY_PREFERENCE_SCORE_BOOST = 8
const UNKNOWN_CAPACITY_SCORE_PENALTY = 15
const UNKNOWN_AMENITY_SCORE_PENALTY = 10
export const CAPACITY_INFERENCE_CONFIDENCE_THRESHOLD = 0.7

function rankVenue(
  plan: CatalogPlanRankingInput,
  venue: CatalogVenueRankingInput,
  archetype: EventArchetypeConfig,
  builderAttendance: BuilderAttendanceSummary | null
): RankedCatalogRecommendation {
  const headcount = readNumber(plan.headcount ?? plan.guest_count) ?? 0
  const budgetCents = readNumber(plan.budget_cents ?? plan.budget_cap_cents) ?? 0
  const budgetAllocationCents = budgetCents > 0 ? Math.round(budgetCents * 0.55) : 0
  const area = plan.area ?? plan.neighborhood ?? null
  const mustHaves = normalizeStringArray(plan.must_haves)
  const organizerPreferredAmenities = normalizeStringArray(plan.organizer_preferred_amenities)
  const capacity = readCapacity(venue)
  const capacityKnown = capacity !== null
  const amenityDataKnown = hasVenueAmenityEvidence(venue)
  const baselineEstimateCents = estimateVenueCents(venue)
  const commercialRanking = rankVenueCommercialModels(
    { ...plan, venue_terms: getCommercialModelPreference(plan) },
    venue,
    baselineEstimateCents
  )
  const estimateCents = commercialRanking.recommended.organizer_outlay_cents
  const searchText = buildSearchText(venue, [
    'name',
    'venue_name',
    'description',
    'venue_type',
    'address',
    'city',
    'state',
    'neighborhood',
    'unique_features',
    'unique_features_tags',
    'auto_approve_conditions',
  ])
  const blockingIssues: string[] = []

  const archetypeScore = scoreVenueAgainstArchetype({
    plan,
    venue,
    archetype,
    context: { builder_attendance: builderAttendance },
  })
  const projectedAttendance = archetypeScore.projected_attendance ?? headcount

  if (projectedAttendance > 0 && capacity !== null && capacity < projectedAttendance) {
    const capacityTarget =
      builderAttendance && builderAttendance.sample_size > 0 && projectedAttendance !== headcount
        ? `${projectedAttendance} projected guests`
        : `${headcount} guests`
    blockingIssues.push(`Capacity ${capacity} is below ${capacityTarget}`)
  }
  if (area && !matchesAreaPreference(area, searchText)) {
    blockingIssues.push(`Area does not match ${area}`)
  }
  if (!supportsEventType(venue, plan.event_type)) {
    blockingIssues.push(`Does not support ${plan.event_type}`)
  }
  if (!supportsVenueTerms(venue, plan.venue_terms)) {
    blockingIssues.push(`Does not support ${plan.venue_terms}`)
  }

  const cateringBlock = amenityDataKnown ? getCateringBlockingIssue(archetypeScore.warnings) : null
  if (cateringBlock) blockingIssues.push(cateringBlock)
  if (amenityDataKnown) blockingIssues.push(...archetypeScore.hard_gate_failures)

  const amenity = scoreAmenityCoverage(mustHaves, searchText)
  if (mustHaves.length > 0 && amenityDataKnown && amenity.missing.length > 0) {
    blockingIssues.push(`Missing required amenities: ${amenity.missing.join(', ')}`)
  }
  const organizerAmenityPreference = scoreSoftAmenityPreference(organizerPreferredAmenities, searchText)
  const budgetScore = scoreBudgetFit(estimateCents, budgetAllocationCents)
  const foodScore = scoreFoodAlignment(plan.food_responsibility, searchText)
  const dateScore = scoreDateAvailability(plan, venue)
  const partnerScore = scorePartnerSignals(venue)
  const dinnerScore = scoreDinnerVenueFit(plan, searchText)
  const isPreferred = Boolean(
    blockingIssues.length === 0 &&
    plan.preferred_venue_ids &&
    plan.preferred_venue_ids.includes(venue.id)
  )
  const rebookScore = isPreferred ? REBOOK_PREFERENCE_SCORE_BOOST : 0
  const unknownCapacityPenalty = capacityKnown ? 0 : UNKNOWN_CAPACITY_SCORE_PENALTY
  const unknownAmenityPenalty =
    mustHaves.length > 0 && !amenityDataKnown ? UNKNOWN_AMENITY_SCORE_PENALTY : 0
  const score = Math.round(
    budgetScore +
      amenity.score +
      foodScore +
      dateScore +
      partnerScore +
      dinnerScore +
      archetypeScore.venue_type_score +
      archetypeScore.commercial_model_alignment_score +
      rebookScore +
      organizerAmenityPreference.score -
      unknownCapacityPenalty -
      unknownAmenityPenalty
  )
  const overBudget = budgetAllocationCents > 0 && estimateCents > budgetAllocationCents
  const fitLabel = chooseFitLabel(score, overBudget, false)
  const reasoning = buildVenueReasoning({
    plan,
    venue,
    archetype,
    capacity,
    estimateCents,
    budgetAllocationCents,
    amenityMatches: amenity.matched,
    searchText,
    commercialReasoning: commercialRanking.recommended.reasoning,
    archetypeReasons: archetypeScore.reasons,
    archetypeWarnings: archetypeScore.warnings,
    organizerPreferenceMatches: organizerAmenityPreference.matched,
    isPreferred,
  })

  return {
    partner_id: venue.id,
    kind: 'venue',
    name: readString(venue.name) ?? readString(venue.venue_name) ?? 'Unnamed venue',
    fit_label: fitLabel,
    estimate_cents: estimateCents,
    score: clamp(score, 0, 100),
    reasoning,
    blocking_issues: blockingIssues,
    capacity,
    capacity_known: capacityKnown,
    tags: readTags(venue, ['unique_features_tags', 'amenities', 'tags']),
    metadata: {
      category: commercialRanking.recommended.model,
      category_label: commercialRanking.recommended.label,
      commercial_model: commercialRanking.recommended.model,
      commercial_model_label: commercialRanking.recommended.label,
      commercial_model_score: commercialRanking.recommended.score,
      commercial_model_risk: commercialRanking.recommended.risk_level,
      organizer_outlay_cents: commercialRanking.recommended.organizer_outlay_cents,
      expected_profit_cents: commercialRanking.recommended.expected_profit_cents,
      venue_upside_cents: commercialRanking.recommended.venue_upside_cents,
      compared_models: commercialRanking.compared_models,
      budget_score: budgetScore,
      amenity_score: amenity.score,
      amenity_known: amenityDataKnown,
      amenity_missing: amenity.missing,
      amenity_score_penalty: unknownAmenityPenalty,
      food_score: foodScore,
      date_score: dateScore,
      partner_score: partnerScore,
      dinner_score: dinnerScore,
      rebook_score: rebookScore,
      is_rebook_preferred: isPreferred,
      organizer_amenity_preference_score: organizerAmenityPreference.score,
      organizer_amenity_preference_matches: organizerAmenityPreference.matched,
      capacity_known: capacityKnown,
      capacity_score_penalty: unknownCapacityPenalty,
      archetype: {
        key: archetype.key,
        display_name: archetype.display_name,
      },
      archetype_vendor_stack: archetype.vendor_stack,
      archetype_warnings: archetypeScore.warnings,
      archetype_reasons: archetypeScore.reasons,
      capacity_calibration: {
        projected_attendance: archetypeScore.projected_attendance,
        calibration_signal: archetypeScore.calibration_signal,
        history_p75: archetypeScore.score_breakdown.capacity.details.history_p75,
        sample_size: builderAttendance?.sample_size ?? 0,
        confidence: builderAttendance?.confidence ?? null,
      },
      venue_type_score: archetypeScore.venue_type_score,
      commercial_model_alignment_score: archetypeScore.commercial_model_alignment_score,
      commercial_model_match: archetypeScore.commercial_model_match,
      primary_commercial_model: archetypeScore.primary_commercial_model,
      budget_allocation_cents: budgetAllocationCents,
      venue_cluster_id: readVenueClusterId(venue),
      subspace_hint: readVenueSubspaceHint(venue),
    },
  }
}

function rankVendor(
  plan: CatalogPlanRankingInput,
  vendor: CatalogVendorRankingInput
): RankedCatalogRecommendation {
  const budgetCents = readNumber(plan.budget_cents ?? plan.budget_cap_cents) ?? 0
  const vendorBudgetCents = budgetCents > 0 ? Math.round(budgetCents * 0.3) : 0
  const mustHaves = normalizeStringArray(plan.must_haves)
  const searchText = buildSearchText(vendor, [
    'name',
    'business_name',
    'vendor_type',
    'service_type',
    'bio',
    'availability_notes',
    'services_offered',
    'compatible_features',
    'regions_served',
    'service_area',
    'city',
    'state',
  ])
  const amenity = scoreVendorServiceFit(plan, mustHaves, searchText)
  const category = inferVendorCategory(plan, vendor, searchText, amenity.matched)
  const estimateCents = sanitizeVendorEstimateCents(estimateVendorCents(plan, vendor), category)
  const budgetScore = scoreBudgetFit(estimateCents, vendorBudgetCents)
  const foodScore = scoreFoodAlignment(plan.food_responsibility, searchText)
  const dateScore = scoreDateAvailability(plan, vendor)
  const partnerScore = scorePartnerSignals(vendor)
  const vendorLocation = {
    city: readString(vendor.city),
    formatted_address: readString(vendor.formatted_address),
    address: readString(vendor.address),
    service_area: readString(vendor.service_area),
    regions_served: readString(vendor.regions_served),
    availability_notes: readString(vendor.availability_notes),
    neighborhood: readString(vendor.neighborhood),
  }
  const areaScore = computeVendorLocationScore(vendorLocation, plan)
  const isPreferred = Boolean(
    plan.preferred_vendor_ids &&
    plan.preferred_vendor_ids.includes(vendor.id)
  )
  const rebookScore = isPreferred ? REBOOK_PREFERENCE_SCORE_BOOST : 0
  const score = Math.round(budgetScore + amenity.score + foodScore + dateScore + partnerScore + areaScore + rebookScore)
  const overBudget = vendorBudgetCents > 0 && estimateCents > vendorBudgetCents
  const premium = /premium|pro|preferred|high[-\s]?touch/i.test(searchText)
  const fitLabel = chooseFitLabel(score, overBudget, premium)

  return {
    partner_id: vendor.id,
    kind: 'vendor',
    name: readString(vendor.business_name) ?? readString(vendor.name) ?? 'Unnamed vendor',
    fit_label: fitLabel,
    estimate_cents: estimateCents,
    score: clamp(score, 0, 100),
    reasoning: buildVendorReasoning({
      plan,
      vendor,
      estimateCents,
      vendorBudgetCents,
      serviceMatches: amenity.matched,
      searchText,
      isPreferred,
    }),
    blocking_issues: [],
    capacity: null,
    capacity_known: false,
    tags: readTags(vendor, ['services_offered', 'compatible_features', 'tags']),
    metadata: {
      category,
      service_type: category,
      category_label: formatServiceType(category),
      estimate_status: estimateCents > 0 ? 'estimated' : 'quote_required',
      budget_score: budgetScore,
      service_score: amenity.score,
      food_score: foodScore,
      date_score: dateScore,
      partner_score: partnerScore,
      area_score: areaScore,
      location_context: formatVendorLocationContext(vendorLocation, plan),
      rebook_score: rebookScore,
      is_rebook_preferred: isPreferred,
      budget_allocation_cents: vendorBudgetCents,
    },
  }
}

function compareRecommendations(a: RankedCatalogRecommendation, b: RankedCatalogRecommendation): number {
  return b.score - a.score || a.estimate_cents - b.estimate_cents || a.name.localeCompare(b.name)
}

function getCommercialModelPreference(plan: CatalogPlanRankingInput): string | null | undefined {
  if (/\brecommend|compare|best model|open|flexible\b/i.test(plan.consumption_share ?? '')) return plan.consumption_share
  return plan.venue_terms ?? plan.consumption_share
}

function attachCategoryRanks(recommendations: RankedCatalogRecommendation[]): RankedCatalogRecommendation[] {
  const categoryCounts = new Map<string, number>()

  return recommendations.map((recommendation) => {
    const category = readString(recommendation.metadata.category) ?? recommendation.kind
    const categoryRank = (categoryCounts.get(category) ?? 0) + 1
    categoryCounts.set(category, categoryRank)

    return {
      ...recommendation,
      metadata: {
        ...recommendation.metadata,
        category,
        category_rank: categoryRank,
      },
    }
  })
}

function selectTopVendorsByCategory(
  plan: CatalogPlanRankingInput,
  candidates: RankedCatalogRecommendation[],
  vendorLimit: number
): RankedCatalogRecommendation[] {
  if (vendorLimit <= 0) return []

  const selected: RankedCatalogRecommendation[] = []
  const selectedIds = new Set<string>()
  const categoriesInNeedOrder = inferServiceNeeds(plan.event_type, normalizeStringArray(plan.must_haves))
  const categories = categoriesInNeedOrder.length > 0
    ? categoriesInNeedOrder
    : Array.from(new Set(candidates.map((candidate) => readString(candidate.metadata.category) ?? 'vendor')))

  for (const category of categories) {
    if (selected.length >= vendorLimit) break
    const match = candidates.find((candidate) =>
      !selectedIds.has(candidate.partner_id) && readString(candidate.metadata.category) === category
    )
    if (match) {
      selected.push(match)
      selectedIds.add(match.partner_id)
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= vendorLimit) break
    if (selectedIds.has(candidate.partner_id)) continue
    selected.push(candidate)
    selectedIds.add(candidate.partner_id)
  }

  return attachCategoryRanks(selected)
}

function selectTopVenuesByCluster(
  plan: CatalogPlanRankingInput,
  candidates: RankedCatalogRecommendation[],
  venueLimit: number
): RankedCatalogRecommendation[] {
  if (venueLimit <= 0) return []
  if (allowsBroadVenueExploration(plan)) return candidates.slice(0, venueLimit)

  const groups = new Map<string, RankedCatalogRecommendation[]>()
  for (const candidate of candidates) {
    const clusterId = readString(candidate.metadata.venue_cluster_id) ?? candidate.partner_id
    const existing = groups.get(clusterId) ?? []
    existing.push(candidate)
    groups.set(clusterId, existing)
  }

  return Array.from(groups.entries())
    .map(([clusterId, group]) => {
      const sortedGroup = [...group].sort(compareRecommendations)
      const primary = sortedGroup[0]
      return {
        ...primary,
        metadata: {
          ...primary.metadata,
          venue_cluster_id: clusterId,
          venue_cluster_primary: true,
          venue_cluster_size: group.length,
          venue_cluster_sibling_ids: sortedGroup.slice(1).map((sibling) => sibling.partner_id),
        },
      }
    })
    .sort(compareRecommendations)
    .slice(0, venueLimit)
}

function allowsBroadVenueExploration(plan: CatalogPlanRankingInput) {
  const metadata = readRecord(plan.metadata)
  return (
    metadata?.places_broad_exploration === true ||
    metadata?.broad_venue_exploration === true ||
    /\b(broad|explore|all options|compare all|show all)\b/i.test(
      [
        readString(plan.room_type),
        readString(plan.venue_terms),
        readString(plan.consumption_share),
      ].filter(Boolean).join(' ')
    )
  )
}

function readVenueClusterId(venue: CatalogVenueRankingInput): string | null {
  const direct = readString(venue.venue_cluster_id)
  if (direct) return direct
  const metadata = readRecord(venue.metadata)
  return readString(metadata?.venue_cluster_id)
}

function readVenueSubspaceHint(venue: CatalogVenueRankingInput): string | null {
  const direct = readString(venue.subspace_hint)
  if (direct) return direct
  const metadata = readRecord(venue.metadata)
  return readString(metadata?.subspace_hint)
}

export function resolveVenueCapacityForRanking(row: Record<string, unknown>): number | null {
  const values = [
    row.capacity,
    row.standing_capacity,
    row.capacity_standing,
    row.capacity_cocktail,
    row.capacity_max,
    row.max_capacity,
    row.seated_capacity,
    row.capacity_seated,
  ]
    .map(readNumber)
    .filter((value): value is number => value !== null)

  if (values.length > 0) return Math.max(...values)

  const adminStatus = readString(row.capacity_inference_admin_status)
  const confidence = readNumber(row.capacity_inference_confidence)
  const shouldTrustInference =
    adminStatus === 'approved' ||
    adminStatus === 'edited' ||
    (adminStatus !== 'rejected' && confidence !== null && confidence >= CAPACITY_INFERENCE_CONFIDENCE_THRESHOLD)

  if (!shouldTrustInference) return null

  const inferredValues = [
    row.inferred_capacity_standing,
    row.inferred_capacity_seated,
  ]
    .map(readNumber)
    .filter((value): value is number => value !== null)

  if (inferredValues.length === 0) return null
  return Math.max(...inferredValues)
}

function readCapacity(row: Record<string, unknown>): number | null {
  return resolveVenueCapacityForRanking(row)
}

function estimateVenueCents(row: Record<string, unknown>): number {
  const directEstimate = readNumber(row.estimate_cents ?? row.price_cents ?? row.total_price_cents)
  if (directEstimate !== null) return Math.round(directEstimate)

  const autoApprove = readRecord(row.auto_approve_conditions)
  const minimumSpend =
    readNumber(row.minimum_spend_cents ?? autoApprove?.minimum_spend_cents) ??
    readCents(null, row.minimum_spend as number | string | null | undefined)
  if (minimumSpend !== null && minimumSpend > 0) return Math.round(minimumSpend)

  const hourlyRate = readCents(
    row.hourly_rate_cents as number | string | null | undefined,
    row.hourly_rate as number | string | null | undefined
  )
  if (hourlyRate !== null && hourlyRate > 0) {
    const minimumHours = readNumber(row.minimum_hours) ?? 4
    return Math.round(hourlyRate * minimumHours)
  }

  const dailyRate = readCents(
    row.daily_rate_cents as number | string | null | undefined,
    row.daily_rate as number | string | null | undefined
  )
  if (dailyRate !== null && dailyRate > 0) return Math.round(dailyRate)

  const nightlyRate = readCents(
    row.price_per_night_cents as number | string | null | undefined,
    row.price_per_night as number | string | null | undefined
  )
  if (nightlyRate !== null && nightlyRate > 0) return Math.round(nightlyRate)

  return 0
}

function estimateVendorCents(
  plan: CatalogPlanRankingInput,
  row: Record<string, unknown>
): number {
  const directEstimate = readNumber(row.estimate_cents ?? row.price_cents ?? row.total_price_cents)
  if (directEstimate !== null) return Math.round(directEstimate)

  const baseRate = readNumber(row.base_rate ?? row.package_rate)
  if (baseRate !== null && baseRate > 0) return Math.round(baseRate)

  const perPersonRate = readNumber(row.per_person_rate)
  const headcount = readNumber(plan.headcount ?? plan.guest_count)
  if (perPersonRate !== null && headcount !== null && perPersonRate > 0) {
    return Math.round(perPersonRate * headcount)
  }

  const hourlyRate = readNumber(row.hourly_rate)
  if (hourlyRate !== null && hourlyRate > 0) {
    const minimumHours = readNumber(row.minimum_hours) ?? 4
    return Math.round(hourlyRate * minimumHours)
  }

  return 0
}

function scoreBudgetFit(estimateCents: number, budgetAllocationCents: number): number {
  if (budgetAllocationCents <= 0 || estimateCents <= 0) return 18

  const ratio = estimateCents / budgetAllocationCents
  if (ratio <= 1) {
    return clamp(30 - Math.abs(0.85 - ratio) * 18, 18, 30)
  }

  return clamp(30 - (ratio - 1) * 35, 5, 22)
}

function scoreAmenityCoverage(
  mustHaves: string[],
  searchText: string
): { score: number; matched: string[]; missing: string[] } {
  if (mustHaves.length === 0) return { score: 18, matched: [], missing: [] }

  const matched = mustHaves.filter((mustHave) => matchesConcept(searchText, mustHave))
  const missing = mustHaves.filter((mustHave) => !matched.includes(mustHave))
  return {
    score: Math.round((matched.length / mustHaves.length) * 25),
    matched,
    missing,
  }
}

function hasVenueAmenityEvidence(row: Record<string, unknown>): boolean {
  return buildSearchText(row, [
    'description',
    'unique_features',
    'unique_features_tags',
    'amenities',
    'venue_amenities',
    'layout_options',
    'production_capabilities',
    'auto_approve_conditions',
  ]).length > 0
}

function scoreSoftAmenityPreference(
  preferredAmenities: string[],
  searchText: string
): { score: number; matched: string[]; missing: string[] } {
  if (preferredAmenities.length === 0) return { score: 0, matched: [], missing: [] }

  const coverage = scoreAmenityCoverage(preferredAmenities, searchText)
  return {
    ...coverage,
    score: Math.round((coverage.matched.length / preferredAmenities.length) * ORGANIZER_AMENITY_PREFERENCE_SCORE_BOOST),
  }
}

function scoreVendorServiceFit(
  plan: CatalogPlanRankingInput,
  mustHaves: string[],
  searchText: string
): { score: number; matched: string[]; missing: string[] } {
  const serviceNeeds = inferServiceNeeds(plan.event_type, mustHaves)
  if (serviceNeeds.length === 0) return scoreAmenityCoverage(mustHaves, searchText)

  const matched = serviceNeeds.filter((service) => {
    const keywords = SERVICE_KEYWORDS[service] ?? [service]
    return keywords.some((keyword) => matchesConcept(searchText, keyword)) || matchesConcept(searchText, service)
  })

  return {
    score: Math.round((matched.length / serviceNeeds.length) * 25),
    matched,
    missing: serviceNeeds.filter((service) => !matched.includes(service)),
  }
}

function scoreFoodAlignment(foodResponsibility: string | null | undefined, searchText: string): number {
  if (!foodResponsibility) return 10

  const food = normalizeText(foodResponsibility)
  if (food.includes('no food') || food.includes('no vendors') || food.includes('guests pay')) return 15
  if (food.includes('organizer') || food.includes('prepay') || food.includes('included')) {
    return /\b(catering|food|kitchen|menu|restaurant|bar|drink|beverage)\b/i.test(searchText) ? 15 : 7
  }
  if (food.includes('venue') || food.includes('minimum spend')) {
    return /\b(restaurant|bar|minimum spend|food|beverage|kitchen)\b/i.test(searchText) ? 15 : 7
  }

  return 10
}

function scoreDateAvailability(
  plan: CatalogPlanRankingInput,
  row: Record<string, unknown>
): number {
  const dateCandidates = [
    plan.date_window,
    plan.date_window_start,
    plan.date_window_end,
  ].filter((value): value is string => Boolean(value))

  if (dateCandidates.length === 0) return 8

  const availableDates = normalizeStringArray(row.available_dates ?? row.availability_dates)
  const unavailableDates = normalizeStringArray(row.unavailable_dates ?? row.blackout_dates)
  if (availableDates.length === 0 && unavailableDates.length === 0) return 8

  const normalizedDates = dateCandidates.map(normalizeText)
  if (normalizedDates.some((date) => unavailableDates.some((blocked) => normalizeText(blocked).includes(date)))) {
    return 0
  }
  if (normalizedDates.some((date) => availableDates.some((available) => normalizeText(available).includes(date)))) {
    return 15
  }

  return 6
}

function scorePartnerSignals(row: Record<string, unknown>): number {
  const responseRate = readNumber(row.response_rate ?? row.response_rate_pct)
  if (responseRate !== null) return clamp(responseRate > 1 ? responseRate / 100 : responseRate, 0, 1) * 15

  const tier = normalizeText(readString(row.partner_tier) ?? readString(row.tier) ?? '')
  if (tier.includes('premium') || tier.includes('preferred')) return 15
  if (tier.includes('verified') || tier.includes('pro')) return 13

  const rating = readNumber(row.average_rating ?? row.rating)
  const bookings = readNumber(row.total_bookings ?? row.total_gigs ?? row.review_count)
  const claimedBoost = row.is_claimed === true ? 3 : 0
  const ratingScore = rating === null ? 6 : clamp((rating / 5) * 8, 0, 8)
  const activityScore = bookings === null ? 2 : clamp(bookings / 10, 0, 4)

  return clamp(ratingScore + activityScore + claimedBoost, 0, 15)
}

function scoreDinnerVenueFit(plan: CatalogPlanRankingInput, searchText: string): number {
  if (!isDinnerLike(plan.event_type)) return 0

  let score = 0
  if (/\b(restaurant|private dining|dining room|chef|menu|kitchen|supper|tasting|prix fixe)\b/i.test(searchText)) {
    score += 8
  }
  if (/\b(private room|semi private|semi-private|chef s table|buyout|full buyout)\b/i.test(searchText)) {
    score += 5
  }
  if (/\b(bar|wine|cocktail|beverage|minimum spend)\b/i.test(searchText)) {
    score += 4
  }

  return clamp(score, 0, 12)
}

function chooseFitLabel(score: number, overBudget: boolean, premium: boolean): CatalogFitLabel {
  if (overBudget) return 'Stretch'
  if (premium && score >= 72) return 'Premium service fit'
  if (score >= 80) return 'Best fit'
  return 'Budget fit'
}

function buildVenueReasoning(input: {
  plan: CatalogPlanRankingInput
  venue: CatalogVenueRankingInput
  archetype: EventArchetypeConfig
  capacity: number | null
  estimateCents: number
  budgetAllocationCents: number
  amenityMatches: string[]
  searchText: string
  commercialReasoning: string[]
  archetypeReasons: string[]
  archetypeWarnings: string[]
  organizerPreferenceMatches: string[]
  isPreferred?: boolean
}): string[] {
  const reasons: string[] = []
  const headcount = readNumber(input.plan.headcount ?? input.plan.guest_count)
  const area = input.plan.area ?? input.plan.neighborhood
  const venueArea = readVenueArea(input.venue)

  if (input.isPreferred) reasons.push('Previously used in this template')
  if (input.capacity !== null && headcount !== null) {
    reasons.push(`Capacity ${input.capacity} fits ${headcount} guests`)
  }
  // Show a fallback label for any archetype when the venue type does not match the
  // primary preferred type. This covers dinners, nightlife, fitness, and all others.
  const preferredVenueTypes = input.archetype.preferred_venue_types
  if (preferredVenueTypes.length > 0) {
    const venueType = normalizeText(String(input.venue.venue_type ?? ''))
    const isPreferredType = preferredVenueTypes.some((preferred) => normalizeText(preferred) === venueType)
    if (!isPreferredType && venueType) {
      const primaryPreferredLabel = formatVenueTypeLabel(preferredVenueTypes[0])
      reasons.push(`Nearby alternative — not a ${primaryPreferredLabel}`)
    }
  }
  if (area) {
    if (venueArea && !areaLabelMatchesRequested(area, venueArea)) {
      reasons.push(`Nearby — outside ${area}`)
    } else if (venueArea || matchesAreaPreference(area, input.searchText)) {
      reasons.push(`${area} area match`)
    }
  }
  if (input.budgetAllocationCents > 0 && input.estimateCents > input.budgetAllocationCents) {
    reasons.push(`Estimate ${formatCents(input.estimateCents)} is above the venue allocation`)
  } else if (input.budgetAllocationCents > 0) {
    reasons.push(`Estimate ${formatCents(input.estimateCents)} fits the venue allocation`)
  }
  if (input.amenityMatches.length > 0) {
    reasons.push(`Covers ${input.amenityMatches.slice(0, 3).join(', ')}`)
  }
  if (input.organizerPreferenceMatches.length > 0) {
    reasons.push(`Matches your saved preferences: ${input.organizerPreferenceMatches.slice(0, 3).join(', ')}`)
  }
  if (/\b(av|projector|screen|sound|wifi|stage)\b/i.test(input.searchText)) {
    reasons.push('AV or production signals present')
  }
  if (input.commercialReasoning[0]) reasons.push(input.commercialReasoning[0])
  input.archetypeReasons.slice(0, 2).forEach((reason) => reasons.push(reason))
  input.archetypeWarnings.slice(0, 1).forEach((warning) => reasons.push(warning))
  if (input.plan.event_type) reasons.push(`Supports ${input.plan.event_type}`)

  return reasons.slice(0, 5)
}

function getCateringBlockingIssue(warnings: string[]): string | null {
  return warnings.find((warning) => /usually needs in-house food|kitchen/i.test(warning)) ?? null
}

function buildVendorReasoning(input: {
  plan: CatalogPlanRankingInput
  vendor: CatalogVendorRankingInput
  estimateCents: number
  vendorBudgetCents: number
  serviceMatches: string[]
  searchText: string
  isPreferred?: boolean
}): string[] {
  const reasons: string[] = []
  const serviceType = readString(input.vendor.service_type) ?? readString(input.vendor.vendor_type)
  const eventType = readString(input.plan.event_type)
  const area = readString(input.plan.area) ?? readString(input.plan.neighborhood)

  if (input.isPreferred) reasons.push('Previously used in this template')

  // Service match — human-readable, never a bare "X service fit" template
  if (serviceType) {
    const label = formatServiceType(serviceType)
    if (eventType) {
      reasons.push(`${label} matches your ${eventType} format`)
    } else {
      reasons.push(`${label} service`)
    }
  }

  // Location — only show if the vendor actually serves the area
  if (area && matchesAreaPreference(area, input.searchText)) {
    const parentGroup = AREA_GROUPS.find((group) => group.id === 'sf')
    const isSfArea = parentGroup?.aliases.some((alias) => normalizeText(area).includes(alias)) ||
      AREA_GROUPS.some((group) => group.parent === 'sf' && group.aliases.some((alias) => normalizeText(area).includes(alias)))
    if (isSfArea) {
      reasons.push('Serves SF Bay Area')
    } else {
      reasons.push(`Serves ${area}`)
    }
  }

  // Estimate — only show a dollar amount when it is credible. Low/demo values
  // are normalized to quote-required upstream and should stay visible as TBD.
  if (input.estimateCents > 0) {
    if (input.vendorBudgetCents > 0 && input.estimateCents > input.vendorBudgetCents) {
      reasons.push(`Estimated ${formatCents(input.estimateCents)} — above vendor allocation`)
    } else {
      reasons.push(`Estimated ${formatCents(input.estimateCents)} for your headcount`)
    }
  } else {
    reasons.push('Est. TBD — confirm with vendor')
  }

  if (input.serviceMatches.length > 0) {
    reasons.push(`Covers ${input.serviceMatches.slice(0, 3).join(', ')}`)
  }

  if (/\b(preferred|premium|verified|claimed)\b/i.test(input.searchText) || input.vendor.is_claimed === true) {
    reasons.push('Strong partner signal')
  }

  return reasons.slice(0, 5)
}

function supportsEventType(row: Record<string, unknown>, eventType: string | null | undefined): boolean {
  if (!eventType) return true

  const explicitTypes = normalizeStringArray(
    row.allows_event_type ?? row.allowed_event_types ?? row.event_types ?? row.available_events
  )
  if (explicitTypes.length === 0) return true

  const aliases = getEventAliases(eventType)
  return explicitTypes.some((type) => {
    const normalizedType = normalizeText(type)
    return aliases.some((alias) => normalizedType.includes(alias) || alias.includes(normalizedType))
  })
}

function supportsVenueTerms(row: Record<string, unknown>, venueTerms: string | null | undefined): boolean {
  const desiredTerms = normalizeVenueTerms(venueTerms)
  if (desiredTerms.length === 0) return true

  const explicitTerms = normalizeStringArray(row.terms_supported ?? row.supported_terms ?? row.venue_terms_supported)
    .flatMap(normalizeVenueTerms)
  if (explicitTerms.length > 0) {
    return desiredTerms.some((term) => explicitTerms.includes(term))
  }

  const inferredTerms = inferVenueTerms(row)
  if (inferredTerms.length === 0) return true
  return desiredTerms.some((term) => inferredTerms.includes(term))
}

function inferVenueTerms(row: Record<string, unknown>): string[] {
  const terms = new Set<string>()
  const pricingModel = normalizeText(readString(row.pricing_model) ?? '')
  const autoApprove = readRecord(row.auto_approve_conditions)

  if (
    pricingModel.includes('hourly') ||
    pricingModel.includes('flat') ||
    readCents(
      row.hourly_rate_cents as number | string | null | undefined,
      row.hourly_rate as number | string | null | undefined
    ) !== null ||
    readCents(
      row.price_per_night_cents as number | string | null | undefined,
      row.price_per_night as number | string | null | undefined
    ) !== null
  ) {
    terms.add('flat_rental')
  }
  if (
    pricingModel.includes('minimum') ||
    readNumber(row.minimum_spend_cents ?? autoApprove?.minimum_spend_cents) !== null ||
    readCents(null, row.minimum_spend as number | string | null | undefined) !== null
  ) {
    terms.add('min_spend')
  }
  if (row.ticket_sales_share_enabled === true || row.bar_consumption_share_enabled === true) {
    terms.add('consumption_share')
  }
  if (
    (readCents(
      row.per_head_chi_cents as number | string | null | undefined,
      (row.per_head_chi_cents ?? row.per_head_chi_cents) as number | string | null | undefined
    ) ?? 0) > 0
  ) {
    terms.add('per_head_chi_cents')
  }

  return [...terms]
}

function normalizeVenueTerms(value: string | null | undefined): string[] {
  if (!value) return []

  const normalized = normalizeText(value)
  if (/\b(recommend|compare|flexible|open|any|best model)\b/.test(normalized)) return []

  const terms: string[] = []
  if (/\b(flat|rental|hourly|buyout|room fee)\b/.test(normalized)) terms.push('flat_rental')
  if (/\b(min|minimum spend|f&b minimum)\b/.test(normalized)) terms.push('min_spend')
  if (/\b(consumption|share|bar chi|ticket chi)\b/.test(normalized)) terms.push('consumption_share')
  if (/\b(per head|chi|attendee)\b/.test(normalized)) terms.push('per_head_chi_cents')
  if (/\b(free|no fee|comp)\b/.test(normalized)) terms.push('free_space')
  return terms.length > 0 ? terms : [normalized.replace(/\s+/g, '_')]
}

function matchesAreaPreference(areaPreference: string, candidateText: string): boolean {
  const planAreaIds = detectAreaIds(areaPreference)
  if (planAreaIds.size === 0) return includesLoose(candidateText, areaPreference)

  const candidateAreaIds = detectAreaIds(candidateText)
  if (candidateAreaIds.size === 0) return false

  for (const planAreaId of planAreaIds) {
    for (const candidateAreaId of candidateAreaIds) {
      if (areaIdsMatch(planAreaId, candidateAreaId)) return true
    }
  }

  return false
}

function areaIdsMatch(planAreaId: string, candidateAreaId: string): boolean {
  if (planAreaId === candidateAreaId) return true

  const planGroup = AREA_GROUPS.find((group) => group.id === planAreaId)
  const candidateGroup = AREA_GROUPS.find((group) => group.id === candidateAreaId)
  if (!planGroup || !candidateGroup) return false

  return (
    planGroup.parent === candidateAreaId ||
    candidateGroup.parent === planAreaId ||
    (planGroup.parent !== undefined && planGroup.parent === candidateGroup.parent)
  )
}

function detectAreaIds(value: string): Set<string> {
  const normalized = normalizeText(value)
  const ids = new Set<string>()

  parseNeighborhoodPhrase(normalized).forEach((areaId) => {
    ids.add(areaId)
    const group = AREA_GROUPS.find((candidate) => candidate.id === areaId)
    if (group?.parent) ids.add(group.parent)
  })

  for (const group of AREA_GROUPS) {
    if (group.aliases.some((alias) => includesLoose(normalized, alias))) {
      ids.add(group.id)
      if (group.parent) ids.add(group.parent)
    }
  }

  return ids
}

function getEventAliases(eventType: string): string[] {
  const normalized = normalizeText(eventType)
  const aliases = new Set<string>([normalized])

  for (const [canonical, values] of Object.entries(EVENT_TYPE_ALIASES)) {
    if (canonical === normalized || values.some((value) => normalizeText(value) === normalized)) {
      aliases.add(canonical)
      values.forEach((value) => aliases.add(normalizeText(value)))
    }
  }

  return [...aliases]
}

function inferServiceNeeds(eventType: string | null | undefined, mustHaves: string[]): string[] {
  const text = normalizeText([eventType, ...mustHaves].filter(Boolean).join(' '))
  const services = new Set<string>()

  for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    if (keywords.some((keyword) => includesLoose(text, keyword))) services.add(service)
  }

  return [...services]
}

function isDinnerLike(eventType: string | null | undefined) {
  return Boolean(eventType && /\b(dinner|supper|tasting|private dining|founder dinner)\b/i.test(eventType))
}

function inferVendorCategory(
  plan: CatalogPlanRankingInput,
  vendor: CatalogVendorRankingInput,
  searchText: string,
  serviceMatches: string[]
): string {
  const explicit = readString(vendor.service_type) ?? readString(vendor.vendor_type)
  if (explicit) return normalizeCategory(explicit)
  if (serviceMatches[0]) return normalizeCategory(serviceMatches[0])

  const inferred = inferServiceNeeds(plan.event_type, normalizeStringArray(plan.must_haves))
    .find((service) => {
      const keywords = SERVICE_KEYWORDS[service] ?? [service]
      return keywords.some((keyword) => matchesConcept(searchText, keyword))
    })

  return inferred ?? 'general_vendor'
}

function normalizeCategory(value: string): string {
  return normalizeText(value).replace(/\s+/g, '_')
}

function sanitizeVendorEstimateCents(estimateCents: number, category: string | null | undefined): number {
  if (!isNonTrivialVendorCategory(category)) return estimateCents
  if (estimateCents > 0 && estimateCents < 5_000) return 0
  return estimateCents
}

function isNonTrivialVendorCategory(category: string | null | undefined): boolean {
  const normalized = normalizeCategory(category ?? '')
  return [
    'av_tech',
    'av_production',
    'audio_visual_tech',
    'catering',
    'bartending',
    'photography',
    'photographer',
    'videography',
    'videographer',
    'florist',
    'decor',
    'lighting',
    'staffing',
    'security',
    'event_planning',
    'dj',
  ].includes(normalized)
}

function readVenueArea(venue: CatalogVenueRankingInput): string | null {
  return readString(venue.neighborhood) ?? readString(venue.area) ?? readString(venue.district) ?? readString(venue.city)
}

function areaLabelMatchesRequested(requestedArea: string, candidateArea: string): boolean {
  const requestedIds = detectExplicitAreaIds(requestedArea)
  const candidateIds = detectExplicitAreaIds(candidateArea)

  if (requestedIds.size === 0 || candidateIds.size === 0) {
    return includesLoose(candidateArea, requestedArea) || includesLoose(requestedArea, candidateArea)
  }

  for (const requestedId of requestedIds) {
    if (candidateIds.has(requestedId)) return true
  }

  return false
}

function detectExplicitAreaIds(value: string): Set<string> {
  const normalized = normalizeText(value)
  const ids = new Set<string>()

  parseNeighborhoodPhrase(normalized).forEach((areaId) => ids.add(areaId))

  for (const group of AREA_GROUPS) {
    if (group.aliases.some((alias) => includesLoose(normalized, alias))) {
      ids.add(group.id)
    }
  }

  return ids
}

function matchesConcept(searchText: string, concept: string): boolean {
  const normalizedConcept = normalizeText(concept)
  if (!normalizedConcept) return false
  if (includesLoose(searchText, normalizedConcept)) return true

  const aliasGroups = [
    ['av', 'a/v', 'projector', 'screen', 'sound', 'mic', 'speaker'],
    ['dj', 'music', 'sound', 'dance'],
    ['bar', 'drinks', 'cocktail', 'mocktail', 'beer', 'wine', 'beverage'],
    ['outdoor', 'patio', 'rooftop', 'garden'],
    ['parking', 'valet'],
    ['wifi', 'wi-fi', 'internet'],
    ['catering', 'food', 'kitchen', 'menu'],
  ]

  return aliasGroups.some((aliases) => (
    aliases.some((alias) => includesLoose(normalizedConcept, alias)) &&
    aliases.some((alias) => includesLoose(searchText, alias))
  ))
}

function buildSearchText(row: Record<string, unknown>, keys: string[]): string {
  return normalizeText(
    keys
      .map((key) => serializeSearchValue(row[key]))
      .filter(Boolean)
      .join(' ')
  )
}

function serializeSearchValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(serializeSearchValue).join(' ')
  if (typeof value === 'object') return Object.values(value).map(serializeSearchValue).join(' ')
  return String(value)
}

function readTags(row: Record<string, unknown>, keys: string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => normalizeStringArray(row[key]))))
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringArray(item))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        return normalizeStringArray(JSON.parse(trimmed) as unknown)
      } catch {
        return [trimmed]
      }
    }
    return trimmed
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesLoose(text: string, needle: string): boolean {
  const normalizedText = normalizeText(text)
  const normalizedNeedle = normalizeText(needle)
  if (!normalizedNeedle) return false

  const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(normalizedText)
}

function formatServiceType(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/**
 * Returns a human-readable label for a venue type key so the fallback
 * "Nearby alternative — not a X" label reads naturally.
 *
 * Examples: 'restaurant' → 'restaurant', 'coworking_event_space' → 'coworking / event space'
 */
function formatVenueTypeLabel(venueType: string): string {
  const VENUE_TYPE_LABELS: Record<string, string> = {
    restaurant: 'restaurant',
    private_dining_room: 'private dining room',
    restaurant_buyout: 'restaurant buyout',
    bar: 'bar',
    lounge: 'lounge',
    rooftop: 'rooftop',
    coworking_event_space: 'coworking / event space',
    gallery: 'gallery',
    showroom: 'showroom',
    event_space: 'event space',
    retail: 'retail space',
    cafe: 'cafe',
    market_hall: 'market hall',
    studio: 'studio',
    classroom: 'classroom',
    theater: 'theater',
    auditorium: 'auditorium',
    startup_venue: 'startup venue',
    expo_space: 'expo space',
    campus: 'campus',
    event_hall: 'event hall',
    community_space: 'community space',
    ballroom: 'ballroom',
    club: 'club',
    warehouse: 'warehouse',
    sports_bar: 'sports bar',
    hotel: 'hotel',
    conference_center: 'conference center',
    winery: 'winery',
    private_estate: 'private estate',
    loft_warehouse: 'loft / warehouse',
    outdoor_park: 'outdoor park',
  }
  return VENUE_TYPE_LABELS[venueType] ?? venueType.replace(/_/g, ' ')
}

function formatCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
