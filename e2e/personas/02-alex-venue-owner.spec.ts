import { expect, test } from '@playwright/test'

test.describe('Persona: Alex — venue owner wants to list', () => {
  test('/signup/venue shows listing info page with correct heading', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
  })

  test('venue info page shows three feature bullets', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/free curated listing/i)).toBeVisible()
    await expect(page.getByText(/verified sf event organizers/i)).toBeVisible()
    await expect(page.getByText(/you set your rates/i)).toBeVisible()
  })

  test('venue info page CTA is a mailto link — not a form or router push', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    const cta = page.getByRole('link', { name: /apply to list your venue/i })
    await expect(cta).toBeVisible()

    const href = await cta.getAttribute('href')
    expect(href).toMatch(/^mailto:/)
    expect(href).toContain('venues@3rdspace.com')
  })

  test('venue info page has no form inputs or password fields', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('input[type="email"]')).not.toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
    await expect(page.locator('form')).not.toBeVisible()
  })

  test('venue info page has back link to homepage', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    const backLink = page.getByRole('link', { name: /back/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/')
  })

  test('venue info page shows claim hint for existing listings', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/already listed/i)).toBeVisible()
    await expect(page.getByText(/check your email for a claim link/i)).toBeVisible()
  })

  test('nav buttons on homepage link to /signup/venue', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })

    const venueNavBtn = page.getByRole('link', { name: /list your venue/i }).first()
    await expect(venueNavBtn).toBeVisible()
    await expect(venueNavBtn).toHaveAttribute('href', '/signup/venue')
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
  })
})
