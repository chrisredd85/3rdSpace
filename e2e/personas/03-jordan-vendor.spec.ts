import { expect, test } from '@playwright/test'

test.describe('Persona: Jordan — vendor wants to join', () => {
  test('/signup/vendor shows vendor info page with correct heading', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).toBeVisible()
  })

  test('vendor info page shows three feature bullets', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).toBeVisible()
    await expect(page.getByText(/free listing/i)).toBeVisible()
    await expect(page.getByText(/booked by verified event hosts/i)).toBeVisible()
    await expect(page.getByText(/you control your packages/i)).toBeVisible()
  })

  test('vendor info page CTA is a mailto link to vendors@3rdspace.com', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    const cta = page.getByRole('link', { name: /apply to list as a vendor/i })
    await expect(cta).toBeVisible()

    const href = await cta.getAttribute('href')
    expect(href).toMatch(/^mailto:/)
    expect(href).toContain('vendors@3rdspace.com')
  })

  test('vendor info page has no form inputs', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('input')).not.toBeVisible()
    await expect(page.locator('form')).not.toBeVisible()
  })

  test('vendor info page back link returns to homepage', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/')
  })

  test('vendor info page shows claim hint', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/already listed/i)).toBeVisible()
    await expect(page.getByText(/check your email for a claim link/i)).toBeVisible()
  })

  test('"List as vendor" nav button on homepage reaches vendor info page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })

    const nav = page.locator('nav')
    const vendorNav = nav.getByRole('link', { name: /list as vendor/i })
    await expect(vendorNav).toHaveAttribute('href', '/signup/vendor')
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL('/signup/vendor')
    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).toBeVisible()
  })

  test('unknown portal path returns 404', async ({ page }) => {
    const response = await page.goto('/signup/sponsor', { waitUntil: 'domcontentloaded' })

    expect(response?.status()).toBe(404)
  })
})
