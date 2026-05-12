import { expect, test } from '@playwright/test'
import { annotateFailure } from '../helpers/failure-taxonomy'
import { attachPageHealth, collectPageHealth, expectNoPageHealthIssues } from '../helpers/page-health'

test.describe('design system smoke', () => {
  test('homepage uses the dark vibrant system and role CTAs remain reachable', async ({ page }, testInfo) => {
    annotateFailure(testInfo, 'DESIGN_REGRESSION', 'Homepage shell should preserve the Lovable dark vibrant system')
    const issues = collectPageHealth(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('link', { name: /^sign in$/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /list your venue/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /list as vendor/i }).first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()

    const bodyStyles = await page.locator('body').evaluate((body) => {
      const styles = window.getComputedStyle(body)
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
      }
    })

    expect(bodyStyles.backgroundColor, 'body background should not regress to a white theme').not.toBe('rgb(255, 255, 255)')
    expect(bodyStyles.color, 'body text color should be present').not.toBe('')

    await attachPageHealth(testInfo, issues)
    expectNoPageHealthIssues(issues)
  })

  test('signup portals render branded role-specific forms', async ({ page }) => {
    await page.goto('/signup/builder', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()

    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()

    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
  })
})
