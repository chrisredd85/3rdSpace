import { parseEventIntent } from '@/lib/planner/intentParser'

describe('planner parser MVP regressions', () => {
  it.each([
    ['next month', /next month/i],
    ['first weekend of August', /first weekend of august/i],
    ['mid-July', /mid-july/i],
  ])('parses vague date phrase "%s"', (phrase, expectedHint) => {
    const intent = parseEventIntent(`Plan a mixer for 40 people ${phrase}`)

    expect(intent.date_hint).toMatch(expectedHint)
    expect(intent.date_window_start).toBeDefined()
    expect(intent.date_window_end).toBeDefined()
  })

  it('falls through unsupported event types to a generic taxonomy prompt', () => {
    const intent = parseEventIntent('Host a puppet speed dating night for 45 people in SoMa')

    expect(intent.event_type).toBeUndefined()
    expect(intent.raw_event_type).toBe('puppet speed dating night')
    expect(intent.is_supported_event_type).toBe(false)
    expect(intent.taxonomy_candidate?.suggested_questions.length).toBeGreaterThan(0)
  })

  it('preserves multi-part events instead of flattening to the secondary part', () => {
    const intent = parseEventIntent('Rooftop mixer Friday and brunch Saturday for 80 people in Hayes Valley')

    expect(intent.event_type).toBe('mixer')
    expect(intent.guest_count).toBe(80)
    expect(intent.event_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'rooftop mixer', role: 'primary' }),
        expect.objectContaining({ label: 'brunch', role: 'secondary' }),
      ])
    )
  })

  it.each([
    ['$8k', 800_000],
    ['$30k', 3_000_000],
    ['$1.5M', 150_000_000],
    ['$500', 50_000],
  ])('normalizes budget shorthand "%s" to cents', (budget, expectedCents) => {
    const intent = parseEventIntent(`Plan a dinner for 20 people with a ${budget} budget`)

    expect(intent.budget_cap).toBe(expectedCents)
  })

  it.each([
    ['25-person team offsite', 25],
    ['Corporate retreat for 40 executives', 40],
    ['Mixer for ~80 people', 80],
    ['Launch party for 300 attendees', 300],
  ])('extracts headcount from "%s"', (phrase, expectedHeadcount) => {
    const intent = parseEventIntent(phrase)

    expect(intent.guest_count).toBe(expectedHeadcount)
  })

  it('treats open bar as organizer-prepaid food and beverage', () => {
    const intent = parseEventIntent('Host a day party for 80 people with open bar')

    expect(intent.food_responsibility).toBe('Organizer prepays food/beverage')
  })

  it('does not treat cash bar as organizer-prepaid food and beverage', () => {
    const intent = parseEventIntent('Host a day party for 80 people with cash bar')

    expect(intent.food_responsibility).not.toBe('Organizer prepays food/beverage')
    expect(intent.food_responsibility).toBe('Guests pay venue directly')
  })

  it('returns all requested areas for multi-area input', () => {
    const intent = parseEventIntent('Host a mixer for 60 people in Hayes Valley or Mission')

    expect(intent.neighborhood).toBe('Hayes Valley')
    expect(intent.areas).toEqual(['Hayes Valley', 'Mission'])
  })
})
