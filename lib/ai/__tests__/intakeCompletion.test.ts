jest.mock('server-only', () => ({}))

import {
  archetypeFor,
  buildArchetypeQuestionPriority,
  getNextArchetypeIntakeQuestion,
} from '@/lib/planner/archetypes'

describe('archetype-aware intake completion', () => {
  it('asks theater-style or hands-on for a workshop missing setup format', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('workshop'),
      plan: {
        event_type: 'Workshop / class',
        neighborhood: 'Mission',
        guest_count: 35,
        date_window_start: '2026-05-19',
        date_window_end: '2026-05-19',
      },
      conversationText: 'AI workshop in the Mission next Tuesday for 35 people.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('setup_format')
    expect(question?.prompt).toMatch(/theater-style|hands-on/i)
  })

  it('defaults stage and two mics for a panel when the user does not volunteer otherwise', () => {
    const archetype = archetypeFor('panel fireside')
    const priority = buildArchetypeQuestionPriority({
      archetype,
      plan: {
        event_type: 'Panel / fireside',
        neighborhood: 'Oakland',
        guest_count: 95,
        date_window_start: '2026-07-15',
        date_window_end: '2026-07-15',
      },
      conversationText: 'Startup panel in Oakland for 95 on July 15.',
    })

    expect(priority.critical_missing).not.toContain('stage_required')
    expect(priority.critical_missing).not.toContain('mics_count')
  })

  it('pivots a panel to recommendations after core fields because stage and mics default', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('panel fireside'),
      plan: {
        event_type: 'Panel / fireside',
        neighborhood: 'Mission',
        guest_count: 100,
        date_window_start: '2026-05-30',
        date_window_end: '2026-05-30',
      },
      conversationText: 'I want to host a start up panel in the Mission for 100 people on May 30th.',
      includeRecommended: true,
    })

    expect(question).toBeNull()
  })

  it('asks how many days for a hackathon when duration days are missing', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('hackathon'),
      plan: {
        event_type: 'Hackathon',
        neighborhood: 'SOMA',
        guest_count: 120,
        date_window_start: '2026-06-10',
        date_window_end: '2026-06-10',
      },
      conversationText: 'Hackathon in SOMA for 120 on June 10.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('duration_days')
    expect(question?.prompt).toMatch(/how many days/i)
  })

  it('asks DJ, live, or both for nightlife when music format is missing', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('club night'),
      plan: {
        event_type: 'Nightlife / club night',
        neighborhood: 'Mission',
        guest_count: 180,
        date_window_start: '2026-06-12',
        date_window_end: '2026-06-12',
      },
      conversationText: 'Club night in the Mission for 180 next Friday.',
      includeRecommended: true,
    })

    expect(question?.id).toBe('music_format')
    expect(question?.prompt).toMatch(/DJ|live|both/i)
  })

  it('pivots to recommendations when launch critical fields fill at once', () => {
    const question = getNextArchetypeIntakeQuestion({
      archetype: archetypeFor('product launch'),
      plan: {
        event_type: 'Brand/product launch',
        neighborhood: 'SOMA',
        guest_count: 200,
        date_window_start: '2026-05-19',
        date_window_end: '2026-05-19',
      },
      conversationText: 'I want a launch event for 200 in SoMa next Tuesday with heavy AV and a photographer.',
      includeRecommended: true,
    })

    expect(question).toBeNull()
  })

  it('asks founder dinner archetype-specific intake questions before pivoting to recommendations', () => {
    const archetype = archetypeFor('founder dinner')

    // After core fields only — should ask catering/bar/photo/budget questions first.
    const firstQuestion = getNextArchetypeIntakeQuestion({
      archetype,
      plan: {
        event_type: 'Founder/operator dinner',
        neighborhood: 'Hayes Valley',
        guest_count: 20,
        date_window_start: '2026-05-20',
        date_window_end: '2026-05-20',
      },
      conversationText: 'Founder dinner for 20 in Hayes Valley on May 20th.',
      includeRecommended: true,
    })

    // Must be one of the required archetype-specific questions — not yet ready.
    expect(firstQuestion).not.toBeNull()
    expect(['catering_style', 'bar_required', 'photo_video_priority', 'budget_cap_cents']).toContain(firstQuestion?.id)

    // After answering all archetype-specific questions — should pivot to recommendations.
    const nextQuestion = getNextArchetypeIntakeQuestion({
      archetype,
      plan: {
        event_type: 'Founder/operator dinner',
        neighborhood: 'Hayes Valley',
        guest_count: 20,
        date_window_start: '2026-05-20',
        date_window_end: '2026-05-20',
      },
      conversationText: [
        'Founder dinner for 20 in Hayes Valley on May 20th.',
        'venue handles food and bar',
        'no photographer needed',
        'budget around $3k',
      ].join('\n'),
      includeRecommended: true,
    })

    expect(nextQuestion).toBeNull()
  })
})
