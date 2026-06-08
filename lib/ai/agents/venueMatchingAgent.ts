import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, emptyAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { eventArchetypeConfigSchema } from '@/lib/planner/archetypes/types'
import {
  preFilterVenues,
  type PreFilteredVenue,
  venueMatchingCandidateSchema,
} from '@/lib/venues/venuePreFilter'

const builderAttendanceSummarySchema = z.object({
  builder_id: z.string().trim().min(1),
  archetype_key: z.string().trim().min(1).nullable(),
  sample_size: z.number().int().nonnegative(),
  avg_tickets_sold: z.number().nonnegative(),
  median_tickets_sold: z.number().nonnegative(),
  p75_tickets_sold: z.number().nonnegative(),
  p95_tickets_sold: z.number().nonnegative(),
  last_event_at: z.string().trim().min(1).nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
})

export const venueMatchingAgentInputSchema = z.object({
  event_plan: eventPlanSchema,
  candidate_venues: z.array(venueMatchingCandidateSchema),
  archetype: eventArchetypeConfigSchema.nullish(),
  builder_attendance: builderAttendanceSummarySchema.nullish(),
  ranked_venues: z.array(z.record(z.unknown())).default([]),
  plan: z.record(z.unknown()).nullish(),
  conversation_history: z.array(z.record(z.unknown())).optional(),
  archetype_intake: z.record(z.unknown()).nullish(),
  mutation_contract: z.record(z.unknown()).nullish(),
  organizer_preferences: z.record(z.unknown()).nullish(),
})

const rankedVenueFitScoreSchema = z.preprocess(
  coerceFiniteNumber,
  z.number().int().min(0).max(100)
)

const optionalNonEmptyStringSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().trim().min(1).optional()
)

export const rankedVenueSchema = z.object({
  venue_id: z.string().trim().min(1),
  venue_name: z.string().trim().min(1),
  fit_score: rankedVenueFitScoreSchema,
  user_facing_intro: z.string().trim().min(1).optional(),
  archetype_reasons: z.array(z.string().trim().min(1)).optional(),
  commercial_model_match: optionalNonEmptyStringSchema,
  capacity_calibration: z.object({
    projected_attendance: z.number().int().nonnegative().nullable(),
    calibration_signal: z.enum(['no_history', 'stated', 'historical_higher', 'historical_aligned']),
    score_calibration_signal: z.enum(['stated', 'historical_higher', 'historical_aligned']),
    history_p75: z.number().nonnegative().nullable(),
    sample_size: z.number().int().nonnegative(),
    confidence: z.enum(['low', 'medium', 'high']).nullable(),
  }).optional(),
  pros: z.array(z.string().trim().min(1)).default([]),
  cons: z.array(z.string().trim().min(1)).default([]),
  questions_to_ask_venue: z.array(z.string().trim().min(1)).default([]),
})

export const venueMatchingAgentOutputSchema = z.object({
  ranked_venues: z.array(rankedVenueSchema).max(10),
  best_recommendation: z.string().trim().min(1).nullable(),
  reason_summary: z.string().trim().min(1),
  no_match: z.boolean().default(false),
}).superRefine((output, context) => {
  if (!output.no_match && output.ranked_venues.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ranked_venues must not be empty when no_match is false',
      path: ['ranked_venues'],
    })
  }

  // The model can occasionally return ranked venues with a null best_recommendation.
  // finalizeVenueMatchingOutput fills that from the top ranked venue, so do not
  // reject an otherwise usable response here.
})

export type VenueMatchingAgentInput = z.infer<typeof venueMatchingAgentInputSchema>
export type VenueMatchingAgentOutput = z.infer<typeof venueMatchingAgentOutputSchema>
export type VenueMatchingAgentResult = AgentResult<VenueMatchingAgentOutput>

export const venueMatchingAgentDefinition = {
  agentName: 'venue_matching',
  model: 'gpt-4o',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const VENUE_MATCHING_OUTPUT_CONTRACT = {
  ranked_venues: [
    {
      venue_id: 'string from candidate id',
      venue_name: 'string from candidate venue_name',
      fit_score: 'integer 0-100 copied from deterministic_score',
      user_facing_intro: 'one sentence explaining why this venue fits the archetype',
      archetype_reasons: ['one or two archetype-specific reasons'],
      commercial_model_match: 'string if known',
      pros: ['string'],
      cons: ['string'],
      questions_to_ask_venue: ['string'],
    },
  ],
  best_recommendation: 'string or null only when no_match is true',
  reason_summary: 'string',
  no_match: false,
}

const VENUE_MATCHING_SYSTEM_PROMPT = [
  'You are the 3rdPlace Venue Matching Agent.',
  'Rank pre-filtered venues against an event plan and explain tradeoffs.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The application has already filtered by is_published, city, and capacity before this model call.',
  'Never include a venue that is not in candidate_venues.',
  'Do not invent venue fields. Use only candidate id, venue_name, venue_type, standing_capacity, seated_capacity, city, state, hourly_rate, minimum_hours, per_head_kickback, offers_kickbacks, deposit_percentage, cancellation_terms, available_days, bar_revenue_share_enabled, venue_amenities. Amenity data is from venue_amenities.amenity_name.',
  'Use deterministic_score as the fit_score. The application code owns filtering and scoring; your job is to explain pros, cons, questions, and the recommendation.',
  'When you write user_facing_intro for each venue, reference at least one archetype-specific reason from the archetype config, such as standing-capacity fit for a mixer or private dining intimacy for a founder dinner.',
  'Use archetype_intake and conversation_history to honor the user\'s clarified needs, such as DJ/music, AV, load-in, VIP flow, food/bar setup, seating, screens, security, or external ticket constraints.',
  'Use organizer_preferences as soft tie-breaker context from the builder profile. It may include event_archetype_keys and preferred_amenities from signup. Mention matching preferences when visible in the candidate data, but do not treat them as hard requirements unless they also appear in the plan or conversation.',
  'Honor mutation_contract when present. Treat locked_archetype as authoritative and do not reclassify the event; operational terms like artist, VIP, green room, DJ, guest list, sound check, load-in, tickets, sponsors, and bar minimum are requirements unless the user has confirmed an event-type change.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  `Output JSON must match this contract: ${JSON.stringify(VENUE_MATCHING_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runVenueMatchingAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<VenueMatchingAgentResult> {
  const startedAt = Date.now()
  const input = venueMatchingAgentInputSchema.parse(payload)
  const preFilteredVenues = preFilterVenues({
    event_plan: input.event_plan,
    candidate_venues: input.candidate_venues,
    archetype: input.archetype ?? null,
    builder_attendance: input.builder_attendance ?? null,
  })

  if (preFilteredVenues.length === 0) {
    return {
      agent_name: venueMatchingAgentDefinition.agentName,
      status: 'succeeded',
      ...emptyAgentRunMetadata(venueMatchingAgentDefinition.model),
      duration_ms: Date.now() - startedAt,
      output: venueMatchingAgentOutputSchema.parse({
        ranked_venues: [],
        best_recommendation: null,
        reason_summary: 'No published venues matched the event city and capacity requirements.',
        no_match: true,
      }),
    }
  }

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: VENUE_MATCHING_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        event_plan: input.event_plan,
        plan: input.plan ?? null,
        archetype: input.archetype ?? null,
        archetype_intake: input.archetype_intake ?? null,
        mutation_contract: input.mutation_contract ?? null,
        ranked_venues: input.ranked_venues,
        conversation_history: input.conversation_history ?? [],
        organizer_preferences: input.organizer_preferences ?? null,
        builder_attendance: input.builder_attendance ?? null,
        candidate_venues: preFilteredVenues.map(toModelCandidate),
      }),
    },
  ]

  const completion = await client.create({
    model: venueMatchingAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, venueMatchingAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('venue_matching returned an empty model response', metadata)
  }

  let output: VenueMatchingAgentOutput
  try {
    const modelOutput = venueMatchingAgentOutputSchema.parse(parseJsonObject(content))
    output = finalizeVenueMatchingOutput(modelOutput, preFilteredVenues)
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: venueMatchingAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse venue_matching model JSON'
}

function coerceFiniteNumber(value: unknown): unknown {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return value

  const parsed = Number.parseFloat(value.replace(/[%\s,]/g, ''))
  return Number.isFinite(parsed) ? parsed : value
}

function toModelCandidate(venue: PreFilteredVenue) {
  return {
    id: venue.id,
    venue_name: venue.venue_name,
    venue_type: venue.venue_type,
    standing_capacity: venue.standing_capacity,
    seated_capacity: venue.seated_capacity,
    city: venue.city,
    state: venue.state,
    hourly_rate: venue.hourly_rate,
    minimum_hours: venue.minimum_hours,
    per_head_kickback: venue.per_head_kickback,
    offers_kickbacks: venue.offers_kickbacks,
    deposit_percentage: venue.deposit_percentage,
    cancellation_terms: venue.cancellation_terms,
    available_days: venue.available_days,
    bar_revenue_share_enabled: venue.bar_revenue_share_enabled,
    venue_amenities: venue.venue_amenities.map((amenity) => ({
      amenity_name: amenity.amenity_name,
    })),
    deterministic_score: venue.deterministic_score,
    estimated_minimum_cost_cents: venue.estimated_minimum_cost_cents,
    score_reasons: venue.score_reasons,
    capacity_calibration: venue.capacity_calibration,
  }
}

function finalizeVenueMatchingOutput(
  modelOutput: VenueMatchingAgentOutput,
  preFilteredVenues: PreFilteredVenue[]
): VenueMatchingAgentOutput {
  if (modelOutput.no_match) {
    throw new Error('venue_matching returned no_match true even though candidates passed pre-filtering')
  }

  const candidatesById = new Map(preFilteredVenues.map((venue) => [venue.id, venue]))
  const seenVenueIds = new Set<string>()
  const rankedVenues = modelOutput.ranked_venues.map((rankedVenue) => {
    const candidate = candidatesById.get(rankedVenue.venue_id)
    if (!candidate) {
      throw new Error(`venue_matching returned unknown venue id: ${rankedVenue.venue_id}`)
    }

    if (seenVenueIds.has(rankedVenue.venue_id)) {
      throw new Error(`venue_matching returned duplicate venue id: ${rankedVenue.venue_id}`)
    }
    seenVenueIds.add(rankedVenue.venue_id)

    return {
      ...rankedVenue,
      venue_name: candidate.venue_name,
      fit_score: candidate.deterministic_score,
      user_facing_intro:
        rankedVenue.user_facing_intro ??
        candidate.score_reasons.find((reason) => /archetype|capacity|commercial|venue type|fits/i.test(reason)) ??
        rankedVenue.pros[0],
      archetype_reasons:
        rankedVenue.archetype_reasons ??
        candidate.score_reasons.filter((reason) => /capacity|commercial|venue type|fits|matches/i.test(reason)).slice(0, 2),
      capacity_calibration: candidate.capacity_calibration,
    }
  })

  return venueMatchingAgentOutputSchema.parse({
    ...modelOutput,
    best_recommendation:
      modelOutput.best_recommendation ??
      rankedVenues[0]?.user_facing_intro ??
      (rankedVenues[0] ? `${rankedVenues[0].venue_name} is the strongest fit.` : null),
    no_match: false,
    ranked_venues: rankedVenues,
  })
}

function parseJsonObject(content: string): unknown {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model response was not a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse venue_matching model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse venue_matching model JSON')
  }
}
