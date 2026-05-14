import { expect, test } from '@playwright/test'

test.describe('Persona: Alex — venue owner wants to list', () => {
  test('/signup/venue shows the venue listing signup form', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/venue sign-up · step 1 of 5/i)).toBeVisible()
    await expect(page.getByText(/booking email/i).first()).toBeVisible()
    await expect(page.getByText(/booking phone/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('supply dropdown on homepage links to /signup/venue', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('networkidle')

    const supplyTrigger = page.locator('nav').getByRole('button', { name: /list with us/i })
    await supplyTrigger.click()
    await expect(supplyTrigger).toHaveAttribute('aria-expanded', 'true')
    const venueNavBtn = page.getByRole('menuitem', { name: /list your venue/i })
    await expect(venueNavBtn).toHaveAttribute('href', '/signup/venue')
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
  })
})
