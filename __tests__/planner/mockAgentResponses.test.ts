import { getMockAgentResponse } from '@/lib/planner/mockAgentResponses'
import type { PlanMessage } from '@/lib/types'

describe('getMockAgentResponse', () => {
  it('keeps corporate retreat intent ahead of dinner must-haves', () => {
    const content =
      'Corporate retreat for 40 executives, Napa Valley, September 20th, $30k budget, need wine tasting, team dinner, morning yoga'
    const message: PlanMessage = {
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'user',
      content,
      message_type: 'text',
      metadata: {},
      created_at: '2026-05-05T00:00:00.000Z',
    }

    const response = getMockAgentResponse([message], content, null)

    expect(response.planPatch.event_type).toBe('Retreat / offsite')
  })

  it('turns recommend model into commercial model comparison metadata', () => {
    const content =
      'Founder mixer for 80 founders in SOMA next Friday evening around $8k. Ticketing model: paid tickets. Food responsibility: cash bar. Vendor needs: no vendors. Amenities: AV and check-in. Venue terms: flexible. Commercial model: recommend model. Agent action: show options only. Audience is founders and operators. Drinks-only.'
    const message: PlanMessage = {
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'user',
      content,
      message_type: 'text',
      metadata: {},
      created_at: '2026-05-05T00:00:00.000Z',
    }

    const response = getMockAgentResponse([message], content, null)
    const recommendationMessage = response.messages.find((item) => item.message_type === 'recommendation')
    const recommendations = recommendationMessage?.metadata.recommendations

    expect(Array.isArray(recommendations)).toBe(true)
    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tags: expect.arrayContaining(['Compare commercial models']),
          recommended_commercial_model: expect.stringMatching(/bar consumption CHI|ticket CHI|per-head/i),
          commercial_model_options: expect.arrayContaining(['Flat rental', 'Minimum spend', 'Per-head CHI']),
        }),
      ])
    )
  })

  it('asks dinner-specific cuisine question before generic booking terms', () => {
    const content = 'I want to host a dinner for 20 people in San Francisco on September 20th around $8k'
    const message: PlanMessage = {
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'user',
      content,
      message_type: 'text',
      metadata: {},
      created_at: '2026-05-05T00:00:00.000Z',
    }

    const response = getMockAgentResponse([message], content, null)
    const question = response.messages[0]?.metadata.questions

    expect(question).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'event_dinner_cuisine',
          label: 'Cuisine',
        }),
      ])
    )
  })

  it('recommends dinner-specific place paths when dinner context is complete', () => {
    const content =
      'Private dinner for 20 people in San Francisco on September 20th around $8k. Shared plates. Private room. Guests pay venue directly. Dietary options needed. Ticketing model: Free RSVP. Vendor needs: no vendors. Amenities: standard setup. Venue terms: minimum spend. Commercial model: recommend model. Agent action: show options only.'
    const message: PlanMessage = {
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'user',
      content,
      message_type: 'text',
      metadata: {},
      created_at: '2026-05-05T00:00:00.000Z',
    }

    const response = getMockAgentResponse([message], content, null)
    const recommendationMessage = response.messages.find((item) => item.message_type === 'recommendation')
    const recommendations = recommendationMessage?.metadata.recommendations

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringMatching(/private dining room/i),
          fit: expect.stringMatching(/restaurant|private dining/i),
          note: expect.stringMatching(/guest-pay dining fit/i),
        }),
      ])
    )
  })
})
