import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PILOT_PHRASES } from '@/test/fixtures/pilot-phrases'
import { runIntakeAgent } from '@/lib/ai/agents/intakeAgent'
import {
  buildArchetypeAnswerText,
  buildArchetypeQuestionPriority,
  getArchetypeByKey,
  resolveArchetypeIntakeContext,
  resolveArchetypeMatch,
} from '@/lib/planner/archetypes'

const GPT_4O_INPUT_CENTS_PER_MILLION = 500
const GPT_4O_OUTPUT_CENTS_PER_MILLION = 1500
const DEFAULT_MATCH_RATE_THRESHOLD = 0.9
const DEFAULT_HISTORY_DIR = 'evals/intake/history'

export type IntakePhraseEvalResult = {
  phrase: string
  expected_archetype: string
  actual_archetype: string | null
  actual_event_type: string | null
  match: boolean
  latency_ms: number
  prompt_tokens: number | null
  completion_tokens: number | null
  cost_estimate_cents: number
  next_best_question: string | null
  reflection: string
}

export type IntakePhraseEvalSummary = {
  total: number
  matched: number
  match_rate: number
  total_cost_cents: number
  p50_latency_ms: number
  p95_latency_ms: number
  threshold: number
  previous_7_day_match_rate: number | null
  match_rate_delta_from_previous_7_day: number | null
}

export type IntakePhraseEvalReport = {
  generated_at: string
  model: 'gpt-4o'
  results: IntakePhraseEvalResult[]
  summary: IntakePhraseEvalSummary
}

type CliOptions = {
  output: 'text' | 'json'
  writeHistory: boolean
  historyDir: string
  threshold: number
  limit: number | null
}

export async function runIntakePhraseEval(options: Partial<CliOptions> = {}): Promise<IntakePhraseEvalReport> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to run the intake phrase eval')
  }

  const limit = options.limit ?? null
  const phrases = limit ? PILOT_PHRASES.slice(0, limit) : PILOT_PHRASES
  const results: IntakePhraseEvalResult[] = []

  for (const fixture of phrases) {
    const startedAt = Date.now()
    const resolvedArchetype = resolveArchetypeIntakeContext(fixture.phrase)
    const archetype = getArchetypeByKey(resolvedArchetype?.key)
    const conversationText = buildArchetypeAnswerText([{ role: 'user', content: fixture.phrase }])

    const result = await runIntakeAgent({
      user_message: fixture.phrase,
      current_plan: {},
      existing_event_plan: null,
      connected_platforms: [],
      can_match_now: false,
      resolved_archetype: resolvedArchetype,
      archetype_resolution: resolvedArchetype,
      archetype_question_priority: archetype
        ? buildArchetypeQuestionPriority({
            archetype,
            plan: {},
            conversationText,
          })
        : null,
    })

    const output = result.output
    const actualEventType = pickActualEventType(output)
    const actualArchetype = actualEventType ? resolveArchetypeMatch(actualEventType)?.key ?? null : null
    const promptTokens = result.prompt_tokens
    const completionTokens = result.completion_tokens
    const costEstimateCents = estimateGpt4oCostCents(promptTokens, completionTokens)

    results.push({
      phrase: fixture.phrase,
      expected_archetype: fixture.expected_archetype,
      actual_archetype: actualArchetype,
      actual_event_type: actualEventType,
      match: actualArchetype === fixture.expected_archetype,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_estimate_cents: costEstimateCents,
      next_best_question: output.next_best_question,
      reflection: output.reflection,
    })
  }

  const historyDir = options.historyDir ?? DEFAULT_HISTORY_DIR
  const threshold = options.threshold ?? DEFAULT_MATCH_RATE_THRESHOLD
  const historicalMatchRate = await readPreviousSevenDayMatchRate(historyDir)
  const summary = buildSummary(results, threshold, historicalMatchRate)
  const report: IntakePhraseEvalReport = {
    generated_at: new Date().toISOString(),
    model: 'gpt-4o',
    results,
    summary,
  }

  if (options.writeHistory ?? true) {
    await writeHistoryReport(report, historyDir)
  }

  return report
}

function pickActualEventType(output: Awaited<ReturnType<typeof runIntakeAgent>>['output']) {
  return [
    output.extracted_fields.event_type,
    output.updated_event_plan.event_name,
    output.updated_event_plan.venue_type,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null
}

function estimateGpt4oCostCents(promptTokens: number | null, completionTokens: number | null) {
  const inputCost = ((promptTokens ?? 0) / 1_000_000) * GPT_4O_INPUT_CENTS_PER_MILLION
  const outputCost = ((completionTokens ?? 0) / 1_000_000) * GPT_4O_OUTPUT_CENTS_PER_MILLION
  return Number((inputCost + outputCost).toFixed(4))
}

function buildSummary(
  results: IntakePhraseEvalResult[],
  threshold: number,
  historicalMatchRate: number | null
): IntakePhraseEvalSummary {
  const matched = results.filter((result) => result.match).length
  const latencies = results.map((result) => result.latency_ms).sort((first, second) => first - second)
  const matchRate = results.length > 0 ? matched / results.length : 0

  return {
    total: results.length,
    matched,
    match_rate: matchRate,
    total_cost_cents: Number(results.reduce((sum, result) => sum + result.cost_estimate_cents, 0).toFixed(4)),
    p50_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    threshold,
    previous_7_day_match_rate: historicalMatchRate,
    match_rate_delta_from_previous_7_day:
      historicalMatchRate == null ? null : Number((matchRate - historicalMatchRate).toFixed(4)),
  }
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1))
  return sortedValues[index]
}

async function readPreviousSevenDayMatchRate(historyDir: string) {
  try {
    const files = await readdir(historyDir)
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const rates: number[] = []

    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const content = await readFile(path.join(historyDir, file), 'utf8')
      const parsed = JSON.parse(content) as Partial<IntakePhraseEvalReport>
      const generatedAt = parsed.generated_at ? Date.parse(parsed.generated_at) : NaN
      const rate = parsed.summary?.match_rate
      if (!Number.isFinite(generatedAt) || typeof rate !== 'number') continue
      if (now - generatedAt <= 0 || now - generatedAt > sevenDaysMs) continue
      rates.push(rate)
    }

    if (rates.length === 0) return null
    return Number((rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(4))
  } catch {
    return null
  }
}

async function writeHistoryReport(report: IntakePhraseEvalReport, historyDir: string) {
  await mkdir(historyDir, { recursive: true })
  const safeTimestamp = report.generated_at.replace(/[:.]/g, '-')
  await writeFile(
    path.join(historyDir, `${safeTimestamp}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  )
}

function parseCliOptions(argv: string[]): CliOptions {
  const output = argv.includes('--output=json') ? 'json' : 'text'
  const noHistory = argv.includes('--no-history')
  const thresholdArg = argv.find((arg) => arg.startsWith('--threshold='))
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))
  const historyDirArg = argv.find((arg) => arg.startsWith('--history-dir='))

  return {
    output,
    writeHistory: !noHistory,
    historyDir: historyDirArg?.split('=').slice(1).join('=') || DEFAULT_HISTORY_DIR,
    threshold: thresholdArg ? Number(thresholdArg.split('=')[1]) : DEFAULT_MATCH_RATE_THRESHOLD,
    limit: limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : null,
  }
}

function printTextReport(report: IntakePhraseEvalReport) {
  const { summary } = report
  console.log('Intake phrase eval')
  console.log(`Generated: ${report.generated_at}`)
  console.log(`Model: ${report.model}`)
  console.log(`Phrases: ${summary.total}`)
  console.log(`Matched: ${summary.matched}`)
  console.log(`Match rate: ${formatPercent(summary.match_rate)}`)
  console.log(`Estimated cost: ${summary.total_cost_cents.toFixed(2)} cents`)
  console.log(`Latency p50/p95: ${summary.p50_latency_ms}ms / ${summary.p95_latency_ms}ms`)
  if (summary.previous_7_day_match_rate != null) {
    console.log(`Previous 7-day match rate: ${formatPercent(summary.previous_7_day_match_rate)}`)
    console.log(`Delta: ${formatPercent(summary.match_rate_delta_from_previous_7_day ?? 0)}`)
  }

  const failures = report.results.filter((result) => !result.match)
  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log(`- ${failure.phrase}: expected ${failure.expected_archetype}, got ${failure.actual_archetype ?? 'null'}`)
    }
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2))
  const report = await runIntakePhraseEval(options)

  if (options.output === 'json') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printTextReport(report)
  }

  if (report.summary.match_rate < report.summary.threshold) {
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('pilot-phrase-eval.ts')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
