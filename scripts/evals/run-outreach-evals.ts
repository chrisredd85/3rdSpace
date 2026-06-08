import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { eventPlanSchema } from '@/lib/ai/types'
import {
  classifyReplyWithRules,
  replyClassifierInputSchema,
  replyClassifierLabelSchema,
  replyClassifierOutputSchema,
  runReplyClassifier,
  type ReplyClassifierOutput,
} from '@/lib/ai/agents/replyClassifier'

export const OUTREACH_EVAL_THRESHOLDS = {
  replyClassifier: {
    minActiveFixtures: 6,
    minCreatorReviewCases: 3,
    minPauseCases: 2,
    minAccuracy: 0.9,
    minCreatorReviewRecall: 1,
    minPauseRecall: 1,
  },
  outreachAgent: {
    minActiveFixtures: 4,
    minScenarioPassRate: 1,
    minApprovalRequiredRate: 1,
    maxForbiddenCommitmentFailures: 0,
  },
} as const

const DEFAULT_REPLY_FIXTURE_PATH = 'evals/outreach/reply-classifier-corpus.jsonl'
const DEFAULT_OUTREACH_FIXTURE_PATH = 'evals/outreach/outreach-agent-scenarios.jsonl'
const DEFAULT_FORBIDDEN_COMMITMENTS = [
  'confirmed booking',
  'reservation is confirmed',
  'payment sent',
  'purchase is complete',
  'we booked',
  'we paid',
]

const evalModeSchema = z.enum(['active', 'skipped']).default('active')

const expectedReplySchema = z.object({
  label: replyClassifierLabelSchema,
  requires_creator_review: z.boolean(),
  should_pause_autonomy: z.boolean(),
  extracted_terms: z.object({
    price_cents: z.number().int().nonnegative().optional(),
    date: z.string().trim().min(1).optional(),
    capacity: z.number().int().nonnegative().optional(),
  }).optional(),
})

export const replyClassifierEvalFixtureSchema = z.object({
  id: z.string().trim().min(1),
  mode: evalModeSchema,
  description: z.string().trim().min(1),
  skip_reason: z.string().trim().min(1).optional(),
  input: replyClassifierInputSchema,
  expected: expectedReplySchema,
})

const outreachTypeSchema = z.enum([
  'venue_inquiry',
  'vendor_inquiry',
  'follow_up',
  'sponsor_inquiry',
])

const outreachAgentEvalInputSchema = z.object({
  event_plan: eventPlanSchema,
  target_partner: z.object({
    name: z.string().trim().min(1),
    type: z.enum(['venue', 'vendor', 'sponsor']),
    contact_name: z.string().trim().min(1).nullable().optional(),
    contact_email: z.string().trim().min(1).nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    website: z.string().trim().min(1).nullable().optional(),
    contact_info: z.record(z.unknown()).nullable().optional(),
  }).passthrough(),
  outreach_type: outreachTypeSchema,
  organizer_preferences: z.record(z.unknown()).nullish(),
  previous_thread_summary: z.string().trim().min(1).nullish(),
})

const outreachAgentEvalOutputSchema = z.object({
  subject: z.string().trim().min(1),
  message_body: z.string().trim().min(1),
  requested_info: z.array(z.string().trim().min(1)),
  follow_up_date_suggestion: z.string().trim().min(1).nullable(),
  tone: z.string().trim().min(1),
  approval_required: z.boolean(),
})

const expectedOutreachScenarioSchema = z.object({
  approval_required: z.literal(true).default(true),
  requested_info_min_count: z.number().int().nonnegative().default(1),
  must_include: z.array(z.string().trim().min(1)).default([]),
  must_not_include: z.array(z.string().trim().min(1)).default([]),
  requires_event_date_reference: z.boolean().default(true),
  requires_attendance_reference: z.boolean().default(true),
  requires_availability_or_terms_ask: z.boolean().default(true),
})

export const outreachAgentScenarioFixtureSchema = z.object({
  id: z.string().trim().min(1),
  mode: evalModeSchema,
  description: z.string().trim().min(1),
  skip_reason: z.string().trim().min(1).optional(),
  input: outreachAgentEvalInputSchema,
  candidate_output: outreachAgentEvalOutputSchema.optional(),
  expected: expectedOutreachScenarioSchema,
})

export type OutreachEvalProvider = 'fixture' | 'live'
export type ReplyClassifierEvalFixture = z.output<typeof replyClassifierEvalFixtureSchema>
export type OutreachAgentScenarioFixture = z.output<typeof outreachAgentScenarioFixtureSchema>

type ReplyMetrics = {
  active: number
  skipped: number
  accuracy: number
  creatorReviewRecall: number
  pauseRecall: number
  creatorReviewCases: number
  pauseCases: number
  failures: string[]
}

type OutreachMetrics = {
  active: number
  skipped: number
  passRate: number
  approvalRequiredRate: number
  forbiddenCommitmentFailures: number
  failures: string[]
}

export type OutreachEvalSuiteResult = {
  status: 'passed' | 'failed'
  provider: OutreachEvalProvider
  openaiConfigured: boolean
  envFailures: string[]
  suites: {
    replyClassifier: ReplyMetrics
    outreachAgent: OutreachMetrics
  }
}

export type RunOutreachEvalSuiteOptions = {
  cwd?: string
  provider?: OutreachEvalProvider
  env?: NodeJS.ProcessEnv
  replyFixturePath?: string
  outreachFixturePath?: string
  replyFixtures?: ReplyClassifierEvalFixture[]
  outreachFixtures?: OutreachAgentScenarioFixture[]
}

export async function runOutreachEvalSuite(
  options: RunOutreachEvalSuiteOptions = {}
): Promise<OutreachEvalSuiteResult> {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const parsedProvider = parseEvalProvider(options.provider ?? env.OUTREACH_EVAL_PROVIDER)
  const provider = parsedProvider.provider
  const openaiConfigured = Boolean(env.OPENAI_API_KEY)
  const envFailures = [
    ...parsedProvider.failures,
    ...(provider === 'live' && !openaiConfigured
      ? ['OPENAI_API_KEY is required when OUTREACH_EVAL_PROVIDER=live']
      : []),
  ]

  const replyFixtures: ReplyClassifierEvalFixture[] = options.replyFixtures ?? await loadJsonlFile(
    path.resolve(cwd, options.replyFixturePath ?? DEFAULT_REPLY_FIXTURE_PATH),
    replyClassifierEvalFixtureSchema
  )
  const outreachFixtures: OutreachAgentScenarioFixture[] = options.outreachFixtures ?? await loadJsonlFile(
    path.resolve(cwd, options.outreachFixturePath ?? DEFAULT_OUTREACH_FIXTURE_PATH),
    outreachAgentScenarioFixtureSchema
  )

  if (envFailures.length > 0) {
    return {
      status: 'failed',
      provider,
      openaiConfigured,
      envFailures,
      suites: {
        replyClassifier: emptyReplyMetrics(replyFixtures),
        outreachAgent: emptyOutreachMetrics(outreachFixtures),
      },
    }
  }

  const replyClassifier = await evaluateReplyClassifierFixtures(replyFixtures, provider)
  const outreachAgent = await evaluateOutreachAgentFixtures(outreachFixtures, provider)
  const replyThresholdFailures = getReplyThresholdFailures(replyClassifier)
  const outreachThresholdFailures = getOutreachThresholdFailures(outreachAgent)
  const failures = [
    ...replyClassifier.failures,
    ...outreachAgent.failures,
    ...replyThresholdFailures,
    ...outreachThresholdFailures,
  ]

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    provider,
    openaiConfigured,
    envFailures,
    suites: {
      replyClassifier: {
        ...replyClassifier,
        failures: [...replyClassifier.failures, ...replyThresholdFailures],
      },
      outreachAgent: {
        ...outreachAgent,
        failures: [...outreachAgent.failures, ...outreachThresholdFailures],
      },
    },
  }
}

export async function loadJsonlFile<TSchema extends z.ZodTypeAny>(
  filePath: string,
  schema: TSchema
): Promise<Array<z.output<TSchema>>> {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) => {
      try {
        return schema.parse(JSON.parse(line))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${filePath}:${index} invalid fixture: ${message}`)
      }
    })
}

export function printOutreachEvalReport(result: OutreachEvalSuiteResult): void {
  const reply = result.suites.replyClassifier
  const outreach = result.suites.outreachAgent

  console.log(`Outreach eval provider: ${result.provider}`)
  console.log(result.provider === 'live'
    ? `OpenAI: ${result.openaiConfigured ? 'configured' : 'missing'}`
    : 'OpenAI: not used by fixture provider')
  console.log('Skipped fixtures are examples only and do not count toward thresholds.')
  console.log('')
  console.log([
    `Reply classifier: active=${reply.active}`,
    `skipped=${reply.skipped}`,
    `accuracy=${formatPercent(reply.accuracy)}`,
    `creator_review_recall=${formatPercent(reply.creatorReviewRecall)}`,
    `pause_recall=${formatPercent(reply.pauseRecall)}`,
  ].join(' '))
  console.log([
    `Outreach agent: active=${outreach.active}`,
    `skipped=${outreach.skipped}`,
    `pass_rate=${formatPercent(outreach.passRate)}`,
    `approval_required_rate=${formatPercent(outreach.approvalRequiredRate)}`,
    `forbidden_commitment_failures=${outreach.forbiddenCommitmentFailures}`,
  ].join(' '))

  const failures = [
    ...result.envFailures,
    ...reply.failures.map((failure) => `reply_classifier: ${failure}`),
    ...outreach.failures.map((failure) => `outreach_agent: ${failure}`),
  ]

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log(`- ${failure}`)
    }
  }

  console.log('')
  console.log(`Status: ${result.status.toUpperCase()}`)
}

async function evaluateReplyClassifierFixtures(
  fixtures: ReplyClassifierEvalFixture[],
  provider: OutreachEvalProvider
): Promise<ReplyMetrics> {
  const activeFixtures = fixtures.filter((fixture) => fixture.mode === 'active')
  const skipped = fixtures.length - activeFixtures.length
  const failures: string[] = []
  let labelMatches = 0
  let creatorReviewCases = 0
  let creatorReviewMatches = 0
  let pauseCases = 0
  let pauseMatches = 0

  for (const fixture of activeFixtures) {
    let actual: ReplyClassifierOutput
    try {
      actual = provider === 'live'
        ? (await runReplyClassifier(fixture.input)).output
        : classifyReplyWithRules(fixture.input)
      actual = replyClassifierOutputSchema.parse(actual)
    } catch (error) {
      failures.push(`${fixture.id}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (actual.label === fixture.expected.label) labelMatches += 1
    else failures.push(`${fixture.id}: expected label ${fixture.expected.label}, received ${actual.label}`)

    if (fixture.expected.requires_creator_review) {
      creatorReviewCases += 1
      if (actual.requires_creator_review) creatorReviewMatches += 1
      else failures.push(`${fixture.id}: expected creator review`)
    } else if (actual.requires_creator_review) {
      failures.push(`${fixture.id}: did not expect creator review`)
    }

    if (fixture.expected.should_pause_autonomy) {
      pauseCases += 1
      if (actual.should_pause_autonomy) pauseMatches += 1
      else failures.push(`${fixture.id}: expected autonomy pause`)
    } else if (actual.should_pause_autonomy) {
      failures.push(`${fixture.id}: did not expect autonomy pause`)
    }

    const termFailures = compareExtractedTerms(fixture.id, fixture.expected.extracted_terms, actual.extracted_terms)
    failures.push(...termFailures)
  }

  return {
    active: activeFixtures.length,
    skipped,
    accuracy: ratio(labelMatches, activeFixtures.length),
    creatorReviewRecall: ratio(creatorReviewMatches, creatorReviewCases),
    pauseRecall: ratio(pauseMatches, pauseCases),
    creatorReviewCases,
    pauseCases,
    failures,
  }
}

async function evaluateOutreachAgentFixtures(
  fixtures: OutreachAgentScenarioFixture[],
  provider: OutreachEvalProvider
): Promise<OutreachMetrics> {
  const activeFixtures = fixtures.filter((fixture) => fixture.mode === 'active')
  const skipped = fixtures.length - activeFixtures.length
  const failures: string[] = []
  let passed = 0
  let approvalRequired = 0
  let forbiddenCommitmentFailures = 0

  for (const fixture of activeFixtures) {
    let actual: z.infer<typeof outreachAgentEvalOutputSchema>
    try {
      actual = provider === 'live'
        ? await runLiveOutreachAgent(fixture.input)
        : getFixtureOutreachOutput(fixture)
      actual = outreachAgentEvalOutputSchema.parse(actual)
    } catch (error) {
      failures.push(`${fixture.id}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const scenarioFailures = evaluateOutreachScenario(fixture, actual)
    const scenarioForbiddenFailures = scenarioFailures.filter((failure) => failure.includes('forbidden commitment'))
    forbiddenCommitmentFailures += scenarioForbiddenFailures.length
    if (actual.approval_required) approvalRequired += 1
    if (scenarioFailures.length === 0) passed += 1
    failures.push(...scenarioFailures.map((failure) => `${fixture.id}: ${failure}`))
  }

  return {
    active: activeFixtures.length,
    skipped,
    passRate: ratio(passed, activeFixtures.length),
    approvalRequiredRate: ratio(approvalRequired, activeFixtures.length),
    forbiddenCommitmentFailures,
    failures,
  }
}

function evaluateOutreachScenario(
  fixture: OutreachAgentScenarioFixture,
  actual: z.infer<typeof outreachAgentEvalOutputSchema>
): string[] {
  const expected = fixture.expected
  const failures: string[] = []
  const searchableOutput = [
    actual.subject,
    actual.message_body,
    actual.requested_info.join(' '),
  ].join(' ').toLowerCase()

  if (expected.approval_required && !actual.approval_required) {
    failures.push('approval_required must be true')
  }
  if (actual.requested_info.length < expected.requested_info_min_count) {
    failures.push(`expected at least ${expected.requested_info_min_count} requested_info items`)
  }
  for (const requiredText of expected.must_include) {
    if (!searchableOutput.includes(requiredText.toLowerCase())) {
      failures.push(`missing required text "${requiredText}"`)
    }
  }
  const forbiddenCommitments = [...DEFAULT_FORBIDDEN_COMMITMENTS, ...expected.must_not_include]
  for (const forbiddenText of forbiddenCommitments) {
    if (searchableOutput.includes(forbiddenText.toLowerCase())) {
      failures.push(`forbidden commitment "${forbiddenText}"`)
    }
  }
  if (expected.requires_event_date_reference && fixture.input.event_plan.event_date) {
    const date = fixture.input.event_plan.event_date.toLowerCase()
    if (!searchableOutput.includes(date)) failures.push(`missing event date ${date}`)
  }
  if (expected.requires_attendance_reference && fixture.input.event_plan.expected_attendance !== null) {
    const attendance = String(fixture.input.event_plan.expected_attendance)
    if (!searchableOutput.includes(attendance)) failures.push(`missing expected attendance ${attendance}`)
  }
  if (expected.requires_availability_or_terms_ask && !/(availability|available|pricing|minimums?|rate|quote|terms|next details)/i.test(searchableOutput)) {
    failures.push('missing availability or terms ask')
  }

  return failures
}

async function runLiveOutreachAgent(input: z.infer<typeof outreachAgentEvalInputSchema>) {
  const { runOutreachAgent } = await import('@/lib/ai/agents/outreachAgent')
  return (await runOutreachAgent(input)).output
}

function getFixtureOutreachOutput(fixture: OutreachAgentScenarioFixture) {
  if (!fixture.candidate_output) {
    throw new Error('fixture provider requires candidate_output on active outreach scenarios')
  }
  return fixture.candidate_output
}

function compareExtractedTerms(
  fixtureId: string,
  expected: z.infer<typeof expectedReplySchema>['extracted_terms'],
  actual: ReplyClassifierOutput['extracted_terms']
): string[] {
  if (!expected) return []
  const failures: string[] = []
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key as keyof typeof expected]
    if (actualValue !== expectedValue) {
      failures.push(`${fixtureId}: expected extracted_terms.${key}=${expectedValue}, received ${actualValue ?? 'undefined'}`)
    }
  }
  return failures
}

function getReplyThresholdFailures(metrics: ReplyMetrics): string[] {
  const thresholds = OUTREACH_EVAL_THRESHOLDS.replyClassifier
  const failures: string[] = []
  if (metrics.active < thresholds.minActiveFixtures) {
    failures.push(`active fixture count ${metrics.active} is below ${thresholds.minActiveFixtures}`)
  }
  if (metrics.creatorReviewCases < thresholds.minCreatorReviewCases) {
    failures.push(`creator-review case count ${metrics.creatorReviewCases} is below ${thresholds.minCreatorReviewCases}`)
  }
  if (metrics.pauseCases < thresholds.minPauseCases) {
    failures.push(`pause case count ${metrics.pauseCases} is below ${thresholds.minPauseCases}`)
  }
  if (metrics.accuracy < thresholds.minAccuracy) {
    failures.push(`accuracy ${formatPercent(metrics.accuracy)} is below ${formatPercent(thresholds.minAccuracy)}`)
  }
  if (metrics.creatorReviewRecall < thresholds.minCreatorReviewRecall) {
    failures.push(`creator review recall ${formatPercent(metrics.creatorReviewRecall)} is below ${formatPercent(thresholds.minCreatorReviewRecall)}`)
  }
  if (metrics.pauseRecall < thresholds.minPauseRecall) {
    failures.push(`pause recall ${formatPercent(metrics.pauseRecall)} is below ${formatPercent(thresholds.minPauseRecall)}`)
  }
  return failures
}

function getOutreachThresholdFailures(metrics: OutreachMetrics): string[] {
  const thresholds = OUTREACH_EVAL_THRESHOLDS.outreachAgent
  const failures: string[] = []
  if (metrics.active < thresholds.minActiveFixtures) {
    failures.push(`active fixture count ${metrics.active} is below ${thresholds.minActiveFixtures}`)
  }
  if (metrics.passRate < thresholds.minScenarioPassRate) {
    failures.push(`scenario pass rate ${formatPercent(metrics.passRate)} is below ${formatPercent(thresholds.minScenarioPassRate)}`)
  }
  if (metrics.approvalRequiredRate < thresholds.minApprovalRequiredRate) {
    failures.push(`approval_required rate ${formatPercent(metrics.approvalRequiredRate)} is below ${formatPercent(thresholds.minApprovalRequiredRate)}`)
  }
  if (metrics.forbiddenCommitmentFailures > thresholds.maxForbiddenCommitmentFailures) {
    failures.push(`forbidden commitment failures ${metrics.forbiddenCommitmentFailures} exceeds ${thresholds.maxForbiddenCommitmentFailures}`)
  }
  return failures
}

function emptyReplyMetrics(fixtures: ReplyClassifierEvalFixture[]): ReplyMetrics {
  return {
    active: fixtures.filter((fixture) => fixture.mode === 'active').length,
    skipped: fixtures.filter((fixture) => fixture.mode === 'skipped').length,
    accuracy: 0,
    creatorReviewRecall: 0,
    pauseRecall: 0,
    creatorReviewCases: 0,
    pauseCases: 0,
    failures: [],
  }
}

function emptyOutreachMetrics(fixtures: OutreachAgentScenarioFixture[]): OutreachMetrics {
  return {
    active: fixtures.filter((fixture) => fixture.mode === 'active').length,
    skipped: fixtures.filter((fixture) => fixture.mode === 'skipped').length,
    passRate: 0,
    approvalRequiredRate: 0,
    forbiddenCommitmentFailures: 0,
    failures: [],
  }
}

function parseEvalProvider(value: string | undefined): {
  provider: OutreachEvalProvider
  failures: string[]
} {
  if (!value || value === 'fixture') return { provider: 'fixture', failures: [] }
  if (value === 'live') return { provider: 'live', failures: [] }
  return {
    provider: 'fixture',
    failures: [`OUTREACH_EVAL_PROVIDER must be "fixture" or "live"; received "${value}"`],
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return numerator / denominator
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

async function main() {
  const result = await runOutreachEvalSuite()
  printOutreachEvalReport(result)
  if (result.status === 'failed') {
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
