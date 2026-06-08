import {
  loadJsonlFile,
  outreachAgentScenarioFixtureSchema,
  replyClassifierEvalFixtureSchema,
  runOutreachEvalSuite,
  type OutreachAgentScenarioFixture,
  type ReplyClassifierEvalFixture,
} from '@/scripts/evals/run-outreach-evals'

describe('runOutreachEvalSuite', () => {
  it('passes the checked-in active outreach fixtures', async () => {
    const result = await runOutreachEvalSuite({ provider: 'fixture' })

    expect(result.status).toBe('passed')
    expect(result.suites.replyClassifier.active).toBeGreaterThan(0)
    expect(result.suites.replyClassifier.skipped).toBeGreaterThan(0)
    expect(result.suites.outreachAgent.active).toBeGreaterThan(0)
    expect(result.suites.outreachAgent.skipped).toBeGreaterThan(0)
  })

  it('fails when skipped examples are the only fixtures', async () => {
    const result = await runOutreachEvalSuite({
      provider: 'fixture',
      replyFixtures: [skippedReplyFixture()],
      outreachFixtures: [skippedOutreachFixture()],
    })

    expect(result.status).toBe('failed')
    expect(result.suites.replyClassifier.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('active fixture count 0')])
    )
    expect(result.suites.outreachAgent.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('active fixture count 0')])
    )
  })

  it('fails when an active labeled classifier fixture misses its expected label', async () => {
    const replyFixtures = await loadJsonlFile(
      'evals/outreach/reply-classifier-corpus.jsonl',
      replyClassifierEvalFixtureSchema
    )
    const outreachFixtures = await loadJsonlFile(
      'evals/outreach/outreach-agent-scenarios.jsonl',
      outreachAgentScenarioFixtureSchema
    )
    const mutatedReplyFixtures = replyFixtures.map((fixture, index) => index === 0
      ? { ...fixture, expected: { ...fixture.expected, label: 'bounce' as const } }
      : fixture
    )

    const result = await runOutreachEvalSuite({
      provider: 'fixture',
      replyFixtures: mutatedReplyFixtures,
      outreachFixtures,
    })

    expect(result.status).toBe('failed')
    expect(result.suites.replyClassifier.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('expected label bounce')])
    )
  })

  it('fails clearly in live mode when OpenAI credentials are missing', async () => {
    const result = await runOutreachEvalSuite({
      provider: 'live',
      env: {},
      replyFixtures: [skippedReplyFixture()],
      outreachFixtures: [skippedOutreachFixture()],
    })

    expect(result.status).toBe('failed')
    expect(result.envFailures).toEqual([
      'OPENAI_API_KEY is required when OUTREACH_EVAL_PROVIDER=live',
    ])
  })
})

function skippedReplyFixture(): ReplyClassifierEvalFixture {
  return replyClassifierEvalFixtureSchema.parse({
    id: 'skipped-reply',
    mode: 'skipped',
    description: 'Skipped reply example.',
    skip_reason: 'Example only.',
    input: { reply_text: 'Can you send more details?' },
    expected: {
      label: 'needs_follow_up',
      requires_creator_review: false,
      should_pause_autonomy: false,
    },
  })
}

function skippedOutreachFixture(): OutreachAgentScenarioFixture {
  return outreachAgentScenarioFixtureSchema.parse({
    id: 'skipped-outreach',
    mode: 'skipped',
    description: 'Skipped outreach example.',
    skip_reason: 'Example only.',
    input: {
      event_plan: {
        event_name: 'Example event',
        expected_attendance: 50,
        city: 'SF',
        venue_type: 'bar',
        budget: 500000,
        event_date: '2026-06-19',
        monetization_model: 'ticketed',
        headcount_min: 40,
        headcount_max: 60,
        ticket_price_target: 5000,
        profit_goal: 100000,
      },
      target_partner: { name: 'Example Venue', type: 'venue' },
      outreach_type: 'venue_inquiry',
    },
    candidate_output: {
      subject: 'Example',
      message_body: 'Example message for 50 guests on 2026-06-19 asking for availability.',
      requested_info: ['Availability'],
      follow_up_date_suggestion: null,
      tone: 'brief',
      approval_required: true,
    },
    expected: {
      approval_required: true,
      requested_info_min_count: 1,
      must_include: ['2026-06-19', '50'],
      must_not_include: [],
      requires_event_date_reference: true,
      requires_attendance_reference: true,
      requires_availability_or_terms_ask: true,
    },
  })
}
