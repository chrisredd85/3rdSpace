import { expect, test } from '@playwright/test'

test.describe('venue payouts route', () => {
  test('loads through the venue auth gate for unauthenticated visitors', async ({ page }) => {
    const response = await page.goto('/venue/payouts')

    expect(response?.status()).toBeLessThan(400)
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('body')).toContainText(/venue|login|sign in/i)
  })
})
