import { updatePlannerLivePlanPayload } from '../plannerLivePlanStorage'
import { persistStoredPlannerConversation, publishLivePlan, readStoredPlannerConversation } from '../planner-page/plannerState'
import type { Plan, PlanMessage } from '@/lib/types'

const plan = { id: 'plan-one', title: 'Host event', status: 'drafting', metadata: {}, guest_count: 50, budget_cap_cents: 220000 } as Plan
const canary = { discovery_venue_id: 'venue-one', source: 'google_places', name: 'GOOGLE_CANARY', website: 'https://GOOGLE_CANARY.example' }
beforeEach(() => localStorage.clear())

it('guards both actual browser writers before a mixed payload reaches storage', () => {
  const messages = [{ id: 'message-one', role: 'agent', content: 'Recommendation', metadata: { ranked_venues: [canary] } }] as unknown as PlanMessage[]
  expect(() => publishLivePlan(plan, messages)).toThrow()
  expect(() => persistStoredPlannerConversation(plan, messages, true)).toThrow()
  expect(localStorage.getItem('planner-live-plan')).toBeNull()
  expect(localStorage.getItem('planner-active-conversation')).toBeNull()
})
it('preserves host intent and cents and writes both contracts with a version', () => {
  publishLivePlan(plan, [])
  persistStoredPlannerConversation(plan, [], true)
  const live = JSON.parse(localStorage.getItem('planner-live-plan')!)
  const conversation = JSON.parse(localStorage.getItem('planner-active-conversation')!)
  expect(live).toMatchObject({ venue_storage_version: 1, plan: { budgetCapCents: 220000 } })
  expect(conversation).toMatchObject({ venue_storage_version: 1, plan: { budget_cap_cents: 220000 } })
})
it('a partial live-plan update cannot resurrect a legacy listing or agent prose', () => {
  localStorage.setItem('planner-live-plan', JSON.stringify({ plan: { selected_venue: canary }, messages: [{ role: 'agent', content: 'GOOGLE_CANARY' }] }))
  updatePlannerLivePlanPayload({ budgetCapCents: 220000 })
  const stored = localStorage.getItem('planner-live-plan')!
  expect(stored).not.toContain('GOOGLE_CANARY')
  expect(JSON.parse(stored)).toMatchObject({ venue_storage_version: 1, plan: { budgetCapCents: 220000 }, messages: [] })
})
it('restoring an old conversation retains user input but discards unverified generated prose', () => {
  localStorage.setItem('planner-active-conversation', JSON.stringify({ plan, messages: [{ role: 'agent', content: 'GOOGLE_CANARY' }, { role: 'user', content: 'My event' }] }))
  expect(JSON.stringify(readStoredPlannerConversation())).not.toContain('GOOGLE_CANARY')
})
