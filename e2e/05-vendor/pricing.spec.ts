import { expect, test } from '@playwright/test'
import { e2ePersonas } from '../fixtures/personas'
import { annotateFailure } from '../helpers/failure-taxonomy'
import { loginAsPersona } from '../helpers/auth'
import { getPersonaCredentials } from '../helpers/env'

test.describe('vendor pricing workflow', () => {
  test('DJ can set a $45 hourly rate', async ({ page }, testInfo) => {
    const credentials = getPersonaCredentials('vendor')
    if (!credentials) {
      test.skip(true, 'Set E2E_VENDOR_EMAIL and E2E_VENDOR_PASSWORD to run this persona workflow')
      return
    }

    annotateFailure(testInfo, 'UI_STATE_NOT_PERSISTED', 'Vendor hourly pricing must persist for DJ booking quotes')

    await loginAsPersona(page, 'vendor', credentials)
    await page.goto('/vendor/pricing')

    await expect(page.getByRole('heading', { name: /pricing & packages/i })).toBeVisible()
    await page.getByRole('button', { name: /hourly/i }).click()
    await page.locator('input[name="base_rate"]').fill(String(e2ePersonas.vendor.hourlyRate))
    await page.getByRole('button', { name: /save pricing/i }).click()

    await expect(page.getByText(/pricing updated/i)).toBeVisible()
  })
})
