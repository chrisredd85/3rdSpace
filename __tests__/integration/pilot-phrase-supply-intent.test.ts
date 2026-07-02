jest.mock('server-only', () => ({}))

import { AMBIGUOUS_PILOT_PHRASES } from '@/test/fixtures/pilot-phrases'
import { mergeSupplyIntentMetadata, pickSupplyIntentClarificationQuestion } from '@/lib/planner/supplyIntent/activityCatalog'

describe('pilot phrase supply-intent extension point', () => {
  it('asks a supply clarification for ambiguous activity phrases', () => {
    for (const { phrase } of AMBIGUOUS_PILOT_PHRASES.filter(({ expected_activity_type }) => expected_activity_type)) {
      const metadata = mergeSupplyIntentMetadata({}, { userMessage: phrase })
      const question = pickSupplyIntentClarificationQuestion({ metadata })

      expect(question).toMatch(/need/i)
    }
  })
})
