jest.mock('server-only', () => ({}))

import {
  archetypeFor,
  buildArchetypeAnswerText,
  findAnsweredArchetypeQuestionForPrompt,
  getNextArchetypeIntakeQuestion,
} from '@/lib/planner/archetypes'

describe('archetype intake questions', () => {
  it('asks for the first day-party high-signal matching field before recommendations', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('day party'),
      plan: { event_type: 'Day party / brunch party' },
      conversationText: 'Day party in the Mission for 120 guests on June 20. It is ticketed.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('indoor_outdoor')
    expect(question?.prompt).toMatch(/indoor|outdoor|hybrid/i)
  })

  it('moves a listening party from music format to sound, then stops before timing logistics', () => {
    const archetype = archetypeFor('listening party')

    const soundQuestion = getNextArchetypeIntakeQuestion({
      archetype,
      plan: { event_type: 'Listening party / showcase' },
      conversationText: 'Listening party for 80 people in SF on May 15. Ticketed. We have a DJ.',
      includeRecommended: true,
    })
    expect(soundQuestion?.id).toBe('av_intensity')

    const highSignalQuestion = getNextArchetypeIntakeQuestion({
      archetype,
      plan: { event_type: 'Listening party / showcase' },
      conversationText: [
        'Listening party for 80 people in SF on May 15. Ticketed.',
        'We have a DJ bringing playback, need premium sound, and want an artist VIP green room.',
      ].join('\n'),
      includeRecommended: true,
    })
    expect(highSignalQuestion?.id).not.toBe('operational_timing')

    const readyQuestion = getNextArchetypeIntakeQuestion({
      archetype,
      plan: { event_type: 'Listening party / showcase' },
      conversationText: [
        'Listening party for 80 people in SF on May 15. Ticketed.',
        'We have a DJ bringing playback, need premium sound, and want an artist VIP green room.',
        'Plan for two hours of load-in, a sound check, and one hour of breakdown.',
      ].join('\n'),
      includeRecommended: true,
    })
    expect(readyQuestion).toBeNull()
  })

  it('asks for pop-up high-signal matching details without blocking on staffing', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('pop up'),
      plan: { event_type: 'Pop-up / activation' },
      conversationText: 'Retail pop-up for 200 shoppers in Hayes Valley next month. Free RSVP.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('indoor_outdoor')
  })

  it('does not repeat AV for a startup panel after mics, stage, recording, and live stream are answered', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('startup panel'),
      plan: {
        event_type: 'Panel / fireside',
        ticketing_model: 'rsvp',
      },
      conversationText: [
        'I want to host a start up panel in Oakland for 95 people on July 15th.',
        'Mics, stage recording and live stream.',
      ].join('\n'),
    })

    expect(question?.id).not.toBe('av_production')
  })

  it('does not repeat privacy for a founder dinner after shared space is answered', () => {
    const conversationText = [
      'Founder dinner for 20 in Hayes Valley on May 20th.',
      'Shared is okay.',
      'Flexible reception layout.',
    ].join('\n')

    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('founder dinner'),
      plan: { event_type: 'Founder/operator dinner' },
      conversationText,
    })

    expect(question?.id).not.toBe('privacy')
  })

  it('treats the founder dinner booking-options sequence as complete enough for matching', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('founder dinner'),
      plan: {
        event_type: 'Founder/operator dinner',
        guest_count: 20,
        neighborhood: 'Hayes Valley',
        date_window_start: '2026-05-20',
        date_window_end: '2026-05-20',
        ticketing_model: 'rsvp',
        food_responsibility: 'Seated dining',
        venue_terms: 'Semi-private space',
      },
      conversationText: [
        'Founder dinner for 20 in Hayes Valley.',
        'semi private',
        'May 20th',
        'seated dining',
        'just 30 minutes of prep time',
        'where should I book it?',
      ].join('\n'),
    })

    expect(question).toBeNull()
  })

  it('detects an answered archetype question when the agent tries to repeat it', () => {
    const repeatedQuestion = findAnsweredArchetypeQuestionForPrompt({
      archetype: archetypeFor('founder dinner'),
      plan: { event_type: 'Founder/operator dinner' },
      conversationText: [
        'Founder dinner for 20 in Hayes Valley on May 20th.',
        'Shared is okay.',
        'Flexible reception layout.',
      ].join('\n'),
      prompt: 'How private does the space need to be: private room, buyout, semi-private, or shared?',
    })

    expect(repeatedQuestion?.id).toBe('private_or_shared')
  })

  it('asks for game outing setup format instead of forcing external checkout details', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('game outing'),
      plan: { event_type: 'Game / sports outing' },
      conversationText: 'Warriors game outing for 45 people in SF next Friday. Ticketed.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('setup_format')
    expect(question?.prompt).toMatch(/seated|standing|reception/i)
  })

  it('treats a short answer after an archetype question as an answer to that question', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('day party'),
      plan: { event_type: 'Day party / brunch party' },
      conversationText: 'Day party in the Mission for 120 guests on June 20. It is ticketed.',
      includeRecommended: true,
    })

    const conversationText = buildArchetypeAnswerText([
      {
        role: 'user',
        content: 'Day party in the Mission for 120 guests on June 20. It is ticketed.',
        created_at: '2026-05-10T10:00:00Z',
      },
      {
        role: 'agent',
        content: question?.prompt ?? '',
        metadata: { archetype_question: question },
        created_at: '2026-05-10T10:00:01Z',
      },
      {
        role: 'user',
        content: 'yes',
        created_at: '2026-05-10T10:00:02Z',
      },
    ])

    const nextQuestion = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('day party'),
      plan: { event_type: 'Day party / brunch party' },
      conversationText,
      includeRecommended: true,
    })

    expect(nextQuestion?.id).not.toBe('music_format')
  })
})
