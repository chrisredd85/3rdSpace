import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, emptyAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import {
  preFilterVenues,
  type PreFilteredVenue,
  venueMatchingCandidateSchema,
} from '@/lib/venues/venuePreFilter'

export const venueMatchingAgentInputSchema = z.object({
  event_plan: eventPlanSchema,
  candidate_venues: z.array(venueMatchingCandidateSchema),
  organizer_preferences: z.record(z.unknown()).nullish(),
})

export const rankedVenueSchema = z.object({
  venue_id: z.string().trim().min(1),
  venue_name: z.string().trim().min(1),
  fit_score: z.number().int().min(0).max(100),
  pros: z.array(z.string().trim().min(1)),
  cons: z.array(z.string().trim().min(1)),
  questions_to_ask_venue: z.array(z.string().trim().min(1)),
})

export const venueMatchingAgentOutputSchema = z.object({
  ranked_venues: z.array(rankedVenueSchema).max(10),
  best_recommendation: z.string().trim().min(1).nullable(),
  reason_summary: z.string().trim().min(1),
  no_match: z.boolean(),
}).superRefine((output, context) => {
  if (!output.no_match && output.ranked_venues.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ranked_venues must not be empty when no_match is false',
      path: ['ranked_venues'],
    })
  }

  if (!output.no_match && output.best_recommendation === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'best_recommendation is required when no_match is false',
      path: ['best_recommendation'],
    })
  }
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
  'You are the 3rdSpace Venue Matching Agent.',
  'Rank pre-filtered venues against an event plan and explain tradeoffs.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The application has already filtered by is_published, city, and capacity before this model call.',
  'Never include a venue that is not in candidate_venues.',
  'Do not invent venue fields. Use only candidate id, venue_name, venue_type, standing_capacity, seated_capacity, city, state, hourly_rate, minimum_hours, per_head_kickback, offers_kickbacks, deposit_percentage, cancellation_terms, available_days, bar_revenue_share_enabled, venue_amenities. Amenity data is from venue_amenities.amenity_name.',
  'Use deterministic_score as the fit_score. The application code owns filtering and scoring; your job is to explain pros, cons, questions, and the recommendation.',
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
        organizer_preferences: input.organizer_preferences ?? null,
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
    }
  })

  return venueMatchingAgentOutputSchema.parse({
    ...modelOutput,
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
