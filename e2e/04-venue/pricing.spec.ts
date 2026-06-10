import { expect, test } from '@playwright/test'
import { e2ePersonas, businessScenarios } from '../fixtures/personas'
import { annotateFailure } from '../helpers/failure-taxonomy'
import { loginAsPersona } from '../helpers/auth'
import { getPersonaCredentials } from '../helpers/env'

test.describe('venue pricing workflow', () => {
  test('bar owner can set a $3 per-head incentive rate', async ({ page }, testInfo) => {
    const credentials = getPersonaCredentials('venue')
    if (!credentials) {
      test.skip(true, 'Set E2E_VENUE_EMAIL and E2E_VENUE_PASSWORD to run this persona workflow')
      return
    }

    annotateFailure(testInfo, 'PAYOUT_STATE_ERROR', 'Venue per-head incentive settings must persist before attendee upload')

    await loginAsPersona(page, 'venue', credentials)
    await page.goto('/venue/pricing')

    await expect(page.getByRole('heading', { name: /pricing & revenue/i })).toBeVisible()
    await page.getByRole('button', { name: /community host incentive/i }).click()
    await page.locator('input[name="per_head_kickback"]').fill(String(e2ePersonas.venue.perHeadKickback))

    await expect(page.getByText('Per-head incentive')).toBeVisible()
    await expect(
      page.getByText(`$${e2ePersonas.venue.perHeadKickback * businessScenarios.verifiedAttendance}`)
    ).toBeVisible()

    await page.getByRole('button', { name: /save pricing/i }).click()
    await expect(page.getByText(/pricing updated/i)).toBeVisible()
  })
})
