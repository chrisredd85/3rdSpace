/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}))

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { runIntakeAgent } from '@/lib/ai/agents/intakeAgent'
import {
  MAX_OUTPUT_TOKENS_PER_CALL,
  pruneHistoryReports,
  readPreviousSevenDayMatchRate,
  runIntakePhraseEval,
} from './pilot-phrase-eval'

const mockedRunIntakeAgent = jest.fn() as jest.MockedFunction<typeof runIntakeAgent>
const originalApiKey = process.env.OPENAI_API_KEY
const originalBudget = process.env.EVAL_BUDGET_USD
const tempDirs: string[] = []

async function makeTempDir() {
  const directory = await mkdtemp(path.join(tmpdir(), 'intake-eval-test-'))
  tempDirs.push(directory)
  return directory
}

async function writeHistoricalRate(directory: string, name: string, generatedAt: string, matchRate: number) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, name),
    JSON.stringify({ generated_at: generatedAt, summary: { match_rate: matchRate } }),
    'utf8',
  )
}

beforeEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.EVAL_BUDGET_USD
  mockedRunIntakeAgent.mockReset()
})

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalApiKey
  if (originalBudget === undefined) delete process.env.EVAL_BUDGET_USD
  else process.env.EVAL_BUDGET_USD = originalBudget
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('intake phrase eval history', () => {
  it('averages valid recent reports while ignoring stale, future, and malformed files', async () => {
    const historyDir = await makeTempDir()
    const now = Date.parse('2026-08-11T12:00:00.000Z')
    await writeHistoricalRate(historyDir, 'one-day.json', '2026-08-10T12:00:00.000Z', 0.8)
    await writeHistoricalRate(historyDir, 'two-days.json', '2026-08-09T12:00:00.000Z', 0.6)
    await writeHistoricalRate(historyDir, 'stale.json', '2026-08-01T12:00:00.000Z', 0.2)
    await writeHistoricalRate(historyDir, 'future.json', '2026-08-12T12:00:00.000Z', 1)
    await writeFile(path.join(historyDir, 'malformed.json'), '{broken', 'utf8')

    await expect(readPreviousSevenDayMatchRate(historyDir, now)).resolves.toBe(0.7)
  })

  it('prunes valid reports older than the artifact retention window without deleting unknown data', async () => {
    const historyDir = await makeTempDir()
    const now = Date.parse('2026-08-11T12:00:00.000Z')
    await writeHistoricalRate(historyDir, 'recent.json', '2026-08-01T12:00:00.000Z', 0.9)
    await writeHistoricalRate(historyDir, 'expired.json', '2026-06-01T12:00:00.000Z', 0.5)
    await writeFile(path.join(historyDir, 'malformed.json'), '{broken', 'utf8')

    await pruneHistoryReports(historyDir, now)

    await expect(readdir(historyDir)).resolves.toEqual(
      expect.arrayContaining(['recent.json', 'malformed.json']),
    )
    await expect(readFile(path.join(historyDir, 'expired.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes a new report and includes restored history in the rolling comparison', async () => {
    const historyDir = await makeTempDir()
    await writeHistoricalRate(
      historyDir,
      'prior.json',
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      0.5,
    )
    mockedRunIntakeAgent.mockResolvedValue({
      prompt_tokens: 100,
      completion_tokens: 50,
      output: {
        extracted_fields: { event_type: 'happy hour' },
        updated_event_plan: { event_name: null, venue_type: null },
        next_best_question: null,
        reflection: 'test result',
      },
    } as Awaited<ReturnType<typeof runIntakeAgent>>)

    const report = await runIntakePhraseEval(
      { historyDir, limit: 1 },
      { runAgent: mockedRunIntakeAgent },
    )
    const files = await readdir(historyDir)

    expect(report.summary).toEqual(
      expect.objectContaining({
        total: 1,
        matched: 1,
        match_rate: 1,
        previous_7_day_match_rate: 0.5,
        match_rate_delta_from_previous_7_day: 0.5,
      }),
    )
    const reportFiles = files.filter((file) => file.endsWith('.json'))
    const currentReportFile = reportFiles.find((file) => file !== 'prior.json')
    expect(reportFiles).toHaveLength(2)
    expect(currentReportFile).toBeDefined()
    await expect(
      readFile(path.join(historyDir, currentReportFile as string), 'utf8').then(JSON.parse),
    ).resolves.toEqual(report)
    expect(mockedRunIntakeAgent).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      { maxCompletionTokens: MAX_OUTPUT_TOKENS_PER_CALL },
    )
  })

  it('rejects a missing credential before attempting a model call', async () => {
    await expect(runIntakePhraseEval({ writeHistory: false, limit: 1 })).rejects.toThrow(
      'OPENAI_API_KEY is required to run the intake phrase eval',
    )
    expect(mockedRunIntakeAgent).not.toHaveBeenCalled()
  })

  it('rejects a projected over-budget run before the offline runner is called', async () => {
    process.env.EVAL_BUDGET_USD = '0.01'

    await expect(runIntakePhraseEval(
      { writeHistory: false, limit: 1 },
      { runAgent: mockedRunIntakeAgent },
    )).rejects.toThrow(/Projected intake eval cost .* aborting before model calls/)
    expect(mockedRunIntakeAgent).not.toHaveBeenCalled()
  })

  it('aborts before another call when actual cumulative usage crosses the budget', async () => {
    process.env.EVAL_BUDGET_USD = '0.06'
    mockedRunIntakeAgent.mockResolvedValue({
      prompt_tokens: 10_000,
      completion_tokens: MAX_OUTPUT_TOKENS_PER_CALL,
      output: {
        extracted_fields: { event_type: 'happy hour' },
        updated_event_plan: { event_name: null, venue_type: null },
        next_best_question: null,
        reflection: 'test result',
      },
    } as Awaited<ReturnType<typeof runIntakeAgent>>)

    await expect(runIntakePhraseEval(
      { writeHistory: false, limit: 2 },
      { runAgent: mockedRunIntakeAgent },
    )).rejects.toThrow(/cumulative cost .* exceeded EVAL_BUDGET_USD .* after 2 call\(s\)/)
    expect(mockedRunIntakeAgent).toHaveBeenCalledTimes(2)
  })

  it('uses a conservative non-zero cost when usage metadata is missing', async () => {
    mockedRunIntakeAgent.mockResolvedValue({
      prompt_tokens: null,
      completion_tokens: null,
      output: {
        extracted_fields: { event_type: 'happy hour' },
        updated_event_plan: { event_name: null, venue_type: null },
        next_best_question: null,
        reflection: 'test result',
      },
    } as Awaited<ReturnType<typeof runIntakeAgent>>)

    const report = await runIntakePhraseEval(
      { writeHistory: false, limit: 1 },
      { runAgent: mockedRunIntakeAgent },
    )

    expect(report.results[0]?.cost_estimate_cents).toBeGreaterThan(0)
    expect(report.summary.total_cost_cents).toBeGreaterThan(0)
  })

  it.each(['', 'bogus', 'Infinity', '-1', '0'])(
    'rejects invalid EVAL_BUDGET_USD=%p before the offline runner is called',
    async (budget) => {
      process.env.EVAL_BUDGET_USD = budget

      await expect(runIntakePhraseEval(
        { writeHistory: false, limit: 1 },
        { runAgent: mockedRunIntakeAgent },
      )).rejects.toThrow('EVAL_BUDGET_USD must be a positive finite number')
      expect(mockedRunIntakeAgent).not.toHaveBeenCalled()
    },
  )

  it('treats an explicit zero-call limit as zero calls instead of the full paid corpus', async () => {
    const report = await runIntakePhraseEval(
      { writeHistory: false, limit: 0 },
      { runAgent: mockedRunIntakeAgent },
    )

    expect(report.summary.total).toBe(0)
    expect(mockedRunIntakeAgent).not.toHaveBeenCalled()
  })
})
