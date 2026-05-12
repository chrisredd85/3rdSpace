import { hasUnknownBudgetSignal, parseEventIntent, parseStandaloneGuestCountReply } from '@/lib/planner/intentParser'

describe('planner parser MVP regressions', () => {
  it.each([
    ['next month', /next month/i],
    ['first weekend of August', /first weekend of august/i],
    ['mid-July', /mid-july/i],
    ['4th of July', /4th of july/i],
  ])('parses vague date phrase "%s"', (phrase, expectedHint) => {
    const intent = parseEventIntent(`Plan a mixer for 40 people ${phrase}`)

    expect(intent.date_hint).toMatch(expectedHint)
    expect(intent.date_window_start).toBeDefined()
    expect(intent.date_window_end).toBeDefined()
  })

  it('parses holiday dates written as ordinal-of-month phrases', () => {
    const intent = parseEventIntent('I want to host a 4th of July day party')

    expect(intent.date_window_start).toBe('2026-07-04')
    expect(intent.date_window_end).toBe('2026-07-04')
  })

  it('parses bare month references as full-month planning windows', () => {
    const intent = parseEventIntent('Plan a retreat offsite in Napa for 45 people in August')

    expect(intent.date_hint).toBe('in august')
    expect(intent.date_window_start).toBe('2026-08-01')
    expect(intent.date_window_end).toBe('2026-08-31')
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
    'I do not know my budget yet',
    "I don't know the budget yet",
    'No budget right now, help me estimate',
  ])('keeps unknown budget phrase "%s" unset', (phrase) => {
    expect(hasUnknownBudgetSignal(phrase)).toBe(true)
    expect(parseEventIntent(`Plan a workshop for 35 people. ${phrase}`).budget_cap).toBeUndefined()
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

  it.each([
    ['40', 40],
    ['115', 115],
    ['2,000', 2000],
    ['40k', 40000],
    ['around 115', 115],
  ])('parses standalone contextual headcount reply "%s"', (reply, expectedHeadcount) => {
    expect(parseStandaloneGuestCountReply(reply)).toBe(expectedHeadcount)
  })

  it.each([
    '$5000',
    'under 5000 budget',
    'May 15',
    '5/15',
    '2 hours',
    '75 per ticket',
    '40001',
  ])('does not treat non-headcount numeric reply "%s" as standalone guest count', (reply) => {
    expect(parseStandaloneGuestCountReply(reply)).toBeNull()
  })

  it('does not confuse a date day number with founder/operator headcount', () => {
    const intent = parseEventIntent('Host a founder dinner in Hayes Valley for 20 operators on July 9. Guests pay venue directly.')

    expect(intent.guest_count).toBe(20)
    expect(intent.date_window_start).toBe('2026-07-09')
    expect(intent.date_window_end).toBe('2026-07-09')
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
