import { expect, test } from '@playwright/test'

test.describe('Persona: Alex — venue owner wants to list', () => {
  test('/signup/venue shows the venue listing signup form', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/venue sign-up · step 1 of 5/i)).toBeVisible()
    await expect(page.getByText(/booking email/i).first()).toBeVisible()
    await expect(page.getByText(/booking phone/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible()
  })

  test('homepage Sign up link reaches /signup/venue via the role picker', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('networkidle')

    const signupLink = page.locator('nav').getByRole('link', { name: /^sign up$/i }).first()
    await expect(signupLink).toHaveAttribute('href', '/signup')
    await Promise.all([page.waitForURL('**/signup', { timeout: 15000 }), signupLink.click()])
    await expect(page).toHaveURL(/\/signup$/)
    const venueCard = page.getByRole('link', { name: /list my venue/i })
    await expect(venueCard).toHaveAttribute('href', '/signup/venue')
    await Promise.all([page.waitForURL('**/signup/venue', { timeout: 15000 }), venueCard.click()])
    await expect(page).toHaveURL(/\/signup\/venue$/)
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
  })
})
