import fs from 'node:fs'
import path from 'node:path'

type JsonRecord = Record<string, unknown>

const ROOT = process.cwd()
const REPLY_FIXTURES = path.join(ROOT, 'evals/outreach/reply-classifier-corpus.jsonl')
const SCENARIO_FIXTURES = path.join(ROOT, 'evals/outreach/outreach-agent-scenarios.jsonl')
const MAX_KEY_INTENT_DROP = 0.03

function main() {
  const replyFixtures = loadJsonl(REPLY_FIXTURES)
  const scenarioFixtures = loadJsonl(SCENARIO_FIXTURES)

  validateReplyFixtures(replyFixtures)
  validateScenarioFixtures(scenarioFixtures)

  const activeReplies = replyFixtures.filter((record) => record.skip !== true)
  const activeScenarios = scenarioFixtures.filter((record) => record.skip !== true)

  if (activeReplies.length === 0 && activeScenarios.length === 0) {
    console.log('[outreach-evals] No active fixtures yet. Schema examples validated; live evals skipped.')
    return
  }

  const replyAccuracy = scoreRecordedReplyPredictions(activeReplies)
  const scenarioPassRate = scoreRecordedScenarioResults(activeScenarios)
  const baseline = loadBaseline()

  if (baseline?.reply_key_intent_accuracy !== undefined) {
    const drop = baseline.reply_key_intent_accuracy - replyAccuracy
    if (drop > MAX_KEY_INTENT_DROP) {
      throw new Error(`Reply key-intent accuracy dropped ${(drop * 100).toFixed(1)} points from baseline`)
    }
  }

  if (baseline?.outreach_scenario_pass_rate !== undefined) {
    const drop = baseline.outreach_scenario_pass_rate - scenarioPassRate
    if (drop > MAX_KEY_INTENT_DROP) {
      throw new Error(`Outreach scenario pass rate dropped ${(drop * 100).toFixed(1)} points from baseline`)
    }
  }

  console.log('[outreach-evals] Completed fixture-contract evals', {
    replyFixtures: activeReplies.length,
    scenarioFixtures: activeScenarios.length,
    replyAccuracy,
    scenarioPassRate,
    liveAgentEvals: process.env.RUN_LIVE_AGENT_EVALS === '1',
  })
}

function loadJsonl(filePath: string): JsonRecord[] {
  const content = fs.readFileSync(filePath, 'utf8').trim()
  if (!content) return []

  return content.split('\n').map((line, index) => {
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('record must be a JSON object')
      }
      return parsed as JsonRecord
    } catch (error) {
      throw new Error(`${path.relative(ROOT, filePath)}:${index + 1} ${error instanceof Error ? error.message : 'invalid JSON'}`)
    }
  })
}

function validateReplyFixtures(records: JsonRecord[]) {
  for (const record of records) {
    requireString(record, 'id')
    const input = requireObject(record, 'input')
    requireObject(input, 'thread')
    requireObject(input, 'inbound_message')
    const expected = requireObject(record, 'expected')
    requireString(expected, 'intent')
  }
}

function validateScenarioFixtures(records: JsonRecord[]) {
  for (const record of records) {
    requireString(record, 'id')
    const input = requireObject(record, 'input')
    requireObject(input, 'event_plan')
    requireObject(input, 'target_partner')
    const expectations = requireObject(record, 'expectations')
    if (typeof expectations.must_require_approval !== 'boolean') {
      throw new Error(`${record.id}: expectations.must_require_approval must be boolean`)
    }
    if (typeof expectations.must_not_commit_money !== 'boolean') {
      throw new Error(`${record.id}: expectations.must_not_commit_money must be boolean`)
    }
  }
}

function scoreRecordedReplyPredictions(records: JsonRecord[]) {
  const scored = records.filter((record) => typeof readObject(record.actual)?.intent === 'string')
  if (scored.length === 0) return 1

  const correct = scored.filter((record) => {
    const actual = readObject(record.actual)
    const expected = readObject(record.expected)
    return actual?.intent === expected?.intent
  }).length

  return correct / scored.length
}

function scoreRecordedScenarioResults(records: JsonRecord[]) {
  const scored = records.filter((record) => typeof readObject(record.actual)?.passed === 'boolean')
  if (scored.length === 0) return 1

  const passed = scored.filter((record) => readObject(record.actual)?.passed === true).length
  return passed / scored.length
}

function loadBaseline() {
  const baselinePath = path.join(ROOT, 'evals/outreach/baseline.json')
  if (!fs.existsSync(baselinePath)) return null
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
    reply_key_intent_accuracy?: number
    outreach_scenario_pass_rate?: number
  }
}

function requireObject(record: JsonRecord, key: string): JsonRecord {
  const value = record[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${record.id ?? 'record'}: ${key} must be an object`)
  }
  return value as JsonRecord
}

function readObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function requireString(record: JsonRecord, key: string) {
  if (typeof record[key] !== 'string' || String(record[key]).length === 0) {
    throw new Error(`${record.id ?? 'record'}: ${key} must be a non-empty string`)
  }
}

main()
