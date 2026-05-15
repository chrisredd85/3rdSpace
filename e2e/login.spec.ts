import { expect, test } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'
import { getPersonaCredentials } from './helpers/env'

test.describe('Login portals', () => {
  test('login route opens the builder portal and links supply portals', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/login\/builder/)
    await expect(page.getByRole('heading', { name: /event creator/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /venue partner login/i })).toHaveAttribute('href', '/login/venue')
    await expect(page.getByRole('link', { name: /^vendor login$/i })).toHaveAttribute('href', '/login/vendor')
  })

  test('role portal validates email sign-in fields', async ({ page }) => {
    await page.goto('/login/builder', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /event creator/i })).toBeVisible()
    await page.getByRole('button', { name: /^sign in/i }).click()

    await expect(page.getByText(/invalid email address/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/password must be at least 6 characters/i)).toBeVisible({ timeout: 10000 })
  })

  test('builder persona can sign in when E2E credentials are configured', async ({ page }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD to run this login workflow')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
  })
})
