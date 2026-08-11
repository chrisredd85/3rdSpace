/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/ai/agents/intakeAgent', () => ({ runIntakeAgent: jest.fn() }))

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runIntakeAgent } from '@/lib/ai/agents/intakeAgent'
import {
  pruneHistoryReports,
  readPreviousSevenDayMatchRate,
  runIntakePhraseEval,
} from './pilot-phrase-eval'

const mockedRunIntakeAgent = runIntakeAgent as jest.MockedFunction<typeof runIntakeAgent>
const originalApiKey = process.env.OPENAI_API_KEY
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
  process.env.OPENAI_API_KEY = 'test-eval-key'
  mockedRunIntakeAgent.mockReset()
})

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalApiKey
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

    const report = await runIntakePhraseEval({ historyDir, limit: 1 })
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
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(2)
  })

  it('rejects a missing credential before attempting a model call', async () => {
    delete process.env.OPENAI_API_KEY

    await expect(runIntakePhraseEval({ writeHistory: false, limit: 1 })).rejects.toThrow(
      'OPENAI_API_KEY is required to run the intake phrase eval',
    )
    expect(mockedRunIntakeAgent).not.toHaveBeenCalled()
  })
})
