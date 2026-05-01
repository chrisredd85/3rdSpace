import { expect, test } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'
import { getPersonaCredentials } from './helpers/env'

test.describe('Event creation', () => {
  test('builder can open the new event workspace when E2E credentials are configured', async ({ page }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD to run this event workflow')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
    await page.goto('/builder/event/new')

    await expect(page.getByRole('heading', { name: /new event/i })).toBeVisible()
  })
})
