import { expect, test } from '@playwright/test'

const launchPages = [
  { path: '/', text: /Know what worked|Repeat what paid/i },
  { path: '/signup', text: /Which one are you/i },
  { path: '/planner?mock=1', text: /3rdPlace|Describe your next event|Ask 3rdPlace/i },
  { path: '/terms', text: /Terms of Service/i },
  { path: '/privacy', text: /Privacy Policy/i },
]

test.describe('launch page smoke', () => {
  for (const pageSpec of launchPages) {
    test(`${pageSpec.path} loads without stale brand copy`, async ({ page }) => {
      const response = await page.goto(pageSpec.path, { waitUntil: 'domcontentloaded' })

      expect(response?.status() ?? 200).toBeLessThan(500)
      await expect(page.getByText(pageSpec.text).first()).toBeVisible()
      await expect(page.locator('body')).not.toContainText('3rdSpace')
    })
  }
})
