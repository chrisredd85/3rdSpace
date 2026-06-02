import { z } from 'zod'
import type { AgentResult } from '@/lib/ai/types'
import {
  rankVenueDiscoveryCandidates,
  type RankedVenueDiscoveryCandidate,
  type VenueDiscoveryCandidate,
} from '@/lib/planner/venueDiscoveryRanker'

const signalAggregateSchema = z.object({
  emailsSent30d: z.number().int().nonnegative().default(0),
  replies30d: z.number().int().nonnegative().default(0),
  bookings30d: z.number().int().nonnegative().default(0),
  declines30d: z.number().int().nonnegative().default(0),
  stale30d: z.number().int().nonnegative().default(0),
  avgReplyLatencySeconds: z.number().int().nonnegative().nullable().default(null),
})

const venueDiscoveryCandidateSchema = z.object({
  id: z.string().trim().min(1),
  source: z.enum(['onboarded', 'discovery']),
  name: z.string().trim().min(1),
  neighborhood: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  capacity_seated: z.number().int().nonnegative().nullable().optional(),
  capacity_standing: z.number().int().nonnegative().nullable().optional(),
  capacity_cocktail: z.number().int().nonnegative().nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  price_hint_cents_low: z.number().int().nonnegative().nullable().optional(),
  price_hint_cents_high: z.number().int().nonnegative().nullable().optional(),
  estimate_cents: z.number().int().nonnegative().nullable().optional(),
  vibe_tags: z.array(z.string().trim().min(1)).nullable().optional(),
  last_successful_booking_at: z.string().trim().min(1).nullable().optional(),
  claimed_venue_id: z.string().trim().min(1).nullable().optional(),
  contact_email: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().min(1).nullable().optional(),
  signals: signalAggregateSchema.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const venueDiscoveryAgentInputSchema = z.object({
  event_plan: z.object({
    headcount: z.number().int().nonnegative().nullable().optional(),
    guest_count: z.number().int().nonnegative().nullable().optional(),
    neighborhood: z.string().trim().min(1).nullable().optional(),
    area: z.string().trim().min(1).nullable().optional(),
    budget_cap_cents: z.number().int().nonnegative().nullable().optional(),
    budget_cents: z.number().int().nonnegative().nullable().optional(),
    event_type: z.string().trim().min(1).nullable().optional(),
    vibe_tags: z.array(z.string().trim().min(1)).nullable().optional(),
    must_haves: z.array(z.string().trim().min(1)).nullable().optional(),
  }).passthrough(),
  candidates: z.array(venueDiscoveryCandidateSchema),
  limit: z.number().int().positive().max(12).optional(),
})

export type VenueDiscoveryAgentInput = z.infer<typeof venueDiscoveryAgentInputSchema>

export type VenueDiscoveryAgentOutput = {
  candidate_venues: RankedVenueDiscoveryCandidate[]
  approval_required: true
  guardrails: string[]
}

export type VenueDiscoveryAgentResult = AgentResult<VenueDiscoveryAgentOutput>

export const venueDiscoveryAgentDefinition = {
  agentName: 'venue_discovery',
  model: 'deterministic',
} as const

/**
 * Ranks candidate venues from DB-backed rows only. This agent intentionally does
 * not call an LLM until there is a stronger reason to pay that complexity cost.
 */
export async function runVenueDiscoveryAgent(payload: unknown): Promise<VenueDiscoveryAgentResult> {
  const startedAt = Date.now()
  const input = venueDiscoveryAgentInputSchema.parse(payload)
  const ranked = rankVenueDiscoveryCandidates({
    plan: input.event_plan,
    candidates: input.candidates as VenueDiscoveryCandidate[],
    limit: input.limit ?? 12,
  })

  const candidateKeys = new Set(input.candidates.map((candidate) => `${candidate.source}:${candidate.id}`))
  const candidate_venues = ranked.filter((candidate) => {
    const source = candidate.source === 'discovery' ? 'discovery' : 'onboarded'
    return candidateKeys.has(`${source}:${candidate.candidate_id}`)
  })

  return {
    agent_name: venueDiscoveryAgentDefinition.agentName,
    status: 'succeeded',
    model: venueDiscoveryAgentDefinition.model,
    prompt_tokens: null,
    completion_tokens: null,
    messages_payload: [],
    raw_model_output: null,
    duration_ms: Date.now() - startedAt,
    output: {
      candidate_venues,
      approval_required: true,
      guardrails: [
        'Only returned candidates loaded from discovery_venues or venues.',
        'The agent does not contact venues, book spaces, or authorize payment.',
        'Discovery venues require creator-approved Gmail outreach before any contact.',
      ],
    },
  }
}
