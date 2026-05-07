import { expect, test } from '@playwright/test'

test.describe('Persona: Maya — SF host, first visit', () => {
  test('homepage shows "List your venue" and "List as vendor" nav buttons on desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })

    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: /list your venue/i })).toBeVisible()
    await expect(nav.getByRole('link', { name: /list as vendor/i })).toBeVisible()
  })

  test('nav buttons are hidden on mobile', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 375, height: 812 })

    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: /list your venue/i })).toBeHidden()
    await expect(nav.getByRole('link', { name: /list as vendor/i })).toBeHidden()
  })

  test('homepage opens with public event creation input', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /3rdplace is the bay area's leading/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()
  })

  test('public event creation input starts planner without signup', async ({ page }) => {
    const draft = 'Plan a founder dinner for 18 people in Hayes Valley under $2500'
    await page.goto(`/planner?draft=${encodeURIComponent(draft)}`, { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/planner/, { timeout: 15000 })
    await expect(page.getByText(/plan a founder dinner for 18 people/i)).toBeVisible({ timeout: 15000 })
  })

  test('homepage planner composer is the creator entry point', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /start planning/i })).toBeVisible()
  })

  test('venue role card navigates to venue info page — not a signup form', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const venueCard = page.locator('nav').getByRole('link', { name: /list your venue/i })
    await expect(venueCard).toBeVisible()
    await expect(venueCard).toHaveAttribute('href', '/signup/venue')
    await page.goto('/signup/venue')

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('textbox')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('vendor role card navigates to vendor info page — not a signup form', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const vendorCard = page.locator('nav').getByRole('link', { name: /list as vendor/i })
    await expect(vendorCard).toBeVisible()
    await expect(vendorCard).toHaveAttribute('href', '/signup/vendor')
    await page.goto('/signup/vendor')

    await expect(page).toHaveURL('/signup/vendor')
    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).toBeVisible()
    await expect(page.getByRole('textbox')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('/signup/builder still renders the builder signup form', async ({ page }) => {
    await page.goto('/signup/builder', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).not.toBeVisible()
  })
})
