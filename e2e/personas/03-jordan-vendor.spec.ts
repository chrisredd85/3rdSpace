import { expect, test } from '@playwright/test'

test.describe('Persona: Jordan — vendor wants to join', () => {
  test('/signup/vendor shows vendor signup with service fields', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/vendor sign-up · step 1 of 4/i)).toBeVisible()
    await expect(page.getByText(/your name/i).first()).toBeVisible()
    await expect(page.getByText(/business \/ stage name/i).first()).toBeVisible()
    await expect(page.getByText(/phone/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible()
  })

  test('"List my services" role card reaches vendor signup', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('networkidle')

    const signupLink = page.locator('nav').getByRole('link', { name: /^sign up$/i }).first()
    await expect(signupLink).toHaveAttribute('href', '/signup')
    await Promise.all([page.waitForURL('**/signup', { timeout: 15000 }), signupLink.click()])
    await expect(page).toHaveURL(/\/signup$/)
    const vendorCard = page.getByRole('link', { name: /list my services/i })
    await expect(vendorCard).toHaveAttribute('href', '/signup/vendor')
    await Promise.all([page.waitForURL('**/signup/vendor', { timeout: 15000 }), vendorCard.click()])
    await expect(page).toHaveURL(/\/signup\/vendor$/)
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
  })

  test('unknown portal path returns 404', async ({ page }) => {
    const response = await page.goto('/signup/sponsor', { waitUntil: 'domcontentloaded' })

    expect(response?.status()).toBe(404)
  })
})
