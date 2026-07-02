/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}))

import { runIntakePhraseEval } from './pilot-phrase-eval'
import type { IntakePhraseEvalReport } from './pilot-phrase-eval'

const describeIntakeEval = process.env.RUN_INTAKE_LLM_EVAL === '1' ? describe : describe.skip

describeIntakeEval('pilot phrase LLM eval', () => {
  let report: IntakePhraseEvalReport

  beforeAll(async () => {
    report = await runIntakePhraseEval({
      writeHistory: false,
      threshold: 0.9,
    })
  }, 20 * 60 * 1000)

  it('achieves at least 90% archetype match rate', () => {
    const { summary } = report
    expect(summary.match_rate).toBeGreaterThanOrEqual(0.9)
  })

  it('keeps median latency under 3 seconds', () => {
    const { summary } = report
    expect(summary.p50_latency_ms).toBeLessThan(3000)
  })
})
