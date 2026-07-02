jest.mock('server-only', () => ({}))

import { AMBIGUOUS_PILOT_PHRASES } from '@/test/fixtures/pilot-phrases'
import { mergeSupplyIntentMetadata, pickSupplyIntentClarificationQuestion } from '@/lib/planner/supplyIntent/activityCatalog'

describe('pilot phrase supply-intent extension point', () => {
  it('asks a supply clarification for ambiguous activity phrases', () => {
    for (const { phrase } of AMBIGUOUS_PILOT_PHRASES.filter(({ phrase }) => phrase !== 'party')) {
      const metadata = mergeSupplyIntentMetadata({}, { userMessage: phrase })
      const question = pickSupplyIntentClarificationQuestion({ metadata })

      expect(question).toMatch(/need/i)
    }
  })
})
