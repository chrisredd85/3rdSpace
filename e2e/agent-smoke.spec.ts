import { test } from '@playwright/test'

// Skipped for MVP: requires dedicated E2E community_builder account with
// completed onboarding. Track as follow-up — not a launch blocker.
// Agent registry coverage is verified in lib/ai/__tests__/agents.test.ts.
test.describe.skip('agent smoke', () => {
  test('planner intake agent updates plan and advances intake structurally', async () => {
    // Covered by unit-level agent registry tests until a dedicated E2E account exists.
  })
})
