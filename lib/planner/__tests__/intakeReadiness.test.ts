jest.mock('server-only', () => ({}))

import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import {
  isIntakeReadyForRecommendations,
  isPlanReadyForRequestedRecommendations,
  isRecommendationRequest,
} from '@/lib/planner/intakeReadiness'
import type { Plan } from '@/lib/types'

const baseOutput: IntakeAgentOutput = {
  reflection: 'Locked in.',
  extracted_fields: {
    event_type: 'Listening party / showcase',
    guest_count: 80,
    neighborhood: 'Mission',
    date_window_start: '2026-05-15',
    date_window_end: '2026-05-15',
    budget_cap_cents: null,
    ticketed: true,
    ticket_price_target: null,
    food_responsibility: null,
    profit_goal_cents: null,
  },
  updated_event_plan: {
    event_name: 'Listening party',
    expected_attendance: 80,
    city: 'Mission',
    venue_type: 'Listening party / showcase',
    budget: null,
    event_date: '2026-05-15',
    monetization_model: 'ticketed',
    headcount_min: 80,
    headcount_max: 80,
    ticket_price_target: null,
    profit_goal: null,
  },
  neighborhood: 'Mission',
  food_drink_needs: null,
  music_av_needs: null,
  vibe_audience: null,
  hard_constraints: [],
  missing_questions: [],
  confidence_score: 0.9,
  next_best_question: null,
  assumptions_made: [],
}

const basePlan: Plan = {
  id: 'plan_1',
  user_id: 'user_1',
  title: 'Listening party plan',
  event_type: 'Listening party / showcase',
  status: 'drafting',
  guest_count: 80,
  budget_cap_cents: null,
  neighborhood: 'Mission',
  date_window_start: '2026-05-15',
  date_window_end: '2026-05-15',
  ticketed: true,
  ticketing_model: 'ticketed',
  food_responsibility: null,
  venue_terms: null,
  agent_action: null,
  profit_goal_cents: null,
  notes: null,
  metadata: {},
  created_at: '2026-05-10T10:00:00Z',
  updated_at: '2026-05-10T10:00:00Z',
}

describe('isIntakeReadyForRecommendations', () => {
  it('does not trust model readiness until required archetype questions are answered', () => {
    expect(isIntakeReadyForRecommendations(baseOutput, basePlan, {
      conversationText: 'Listening party for 80 people in the Mission on May 15. It is ticketed.',
    })).toBe(false)
  })

  it('allows readiness after the listening party archetype requirements are answered', () => {
    expect(isIntakeReadyForRecommendations(baseOutput, basePlan, {
      conversationText: [
        'Listening party for 80 people in the Mission on May 15. It is ticketed.',
        'We have a DJ, need premium sound, want an artist VIP green room, and need two hours of load-in with a sound check.',
        'Full bar. No photographer needed.',
      ].join('\n'),
    })).toBe(true)
  })

  it('blocks founder dinner matching when only core fields plus default fills are present', () => {
    expect(isIntakeReadyForRecommendations({
      ...baseOutput,
      extracted_fields: {
        ...baseOutput.extracted_fields,
        event_type: 'Founder/operator dinner',
        guest_count: 24,
        neighborhood: 'Hayes Valley',
        ticketed: null,
      },
      updated_event_plan: {
        ...baseOutput.updated_event_plan,
        event_name: 'Founder dinner',
        venue_type: 'Founder/operator dinner',
        expected_attendance: 24,
        city: 'Hayes Valley',
        monetization_model: null,
      },
    }, {
      ...basePlan,
      event_type: 'Founder/operator dinner',
      guest_count: 24,
      neighborhood: 'Hayes Valley',
      date_window_start: '2026-05-30',
      date_window_end: '2026-05-30',
      ticketed: false,
      ticketing_model: null,
      metadata: {
        archetype_default_fills: {
          catering_style: 'venue_handles',
          bar_required: false,
          photo_video_priority: 'none',
        },
      },
    }, {
      conversationText: 'Monthly founder dinner for 24 in Hayes Valley on May 30th.',
    })).toBe(false)
  })
})

describe('requested recommendations readiness', () => {
  it('detects direct booking-options requests from the user', () => {
    expect(isRecommendationRequest('where should I book it?')).toBe(true)
    expect(isRecommendationRequest('show me venue options')).toBe(true)
    expect(isRecommendationRequest('just 30 minutes of prep time')).toBe(false)
  })

  it('allows a complete founder dinner to move to recommendations when the user asks where to book', () => {
    expect(isPlanReadyForRequestedRecommendations({
      event_type: 'Founder/operator dinner',
      guest_count: 20,
      neighborhood: 'Hayes Valley',
      date_window_start: '2026-05-20',
      date_window_end: '2026-05-20',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'Seated dining',
      venue_terms: 'Semi-private space',
      metadata: {
        event_requirements: {
          privacy: true,
          timing: true,
        },
      },
    }, {
      conversationText: [
        'Founder dinner for 20 in Hayes Valley.',
        'semi private',
        'May 20th',
        'venue handles food and bar',
        'no photographer',
        'budget around $3k',
        'where should I book it?',
      ].join('\n'),
    })).toBe(true)
  })
})
