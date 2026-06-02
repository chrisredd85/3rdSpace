import { expect, test } from '@playwright/test'
import { annotateFailure } from '../helpers/failure-taxonomy'
import { attachPageHealth, collectPageHealth, expectNoPageHealthIssues } from '../helpers/page-health'

test.describe('design system smoke', () => {
  test('homepage uses the warm editorial system and agent-first CTA remains reachable', async ({ page }, testInfo) => {
    annotateFailure(testInfo, 'DESIGN_REGRESSION', 'Homepage shell should preserve the warm editorial system')
    const issues = collectPageHealth(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: /^sign in$/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /start running events/i }).first()).toHaveAttribute('href', '/planner')
    expect(await page.getByRole('button', { name: /list with us/i }).count()).toBe(0)
    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()

    const bodyStyles = await page.locator('body').evaluate((body) => {
      const styles = window.getComputedStyle(body)
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
      }
    })

    expect(bodyStyles.backgroundColor, 'body background should use the warm editorial shell').toMatch(/^rgb\(24[89], 246, 241\)$/)
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
