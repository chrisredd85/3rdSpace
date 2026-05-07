import { expect, test } from '@playwright/test'

test.describe('Persona: Maya — SF host, first visit', () => {
  test('homepage shows "List your venue" and "List as vendor" nav buttons on desktop', async ({ page }) => {
    await page.goto('/')
    await page.setViewportSize({ width: 1280, height: 800 })

    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: /list your venue/i })).toBeVisible()
    await expect(nav.getByRole('link', { name: /list as vendor/i })).toBeVisible()
  })

  test('nav buttons are hidden on mobile', async ({ page }) => {
    await page.goto('/')
    await page.setViewportSize({ width: 375, height: 812 })

    const nav = page.locator('nav')
    await expect(nav.getByRole('link', { name: /list your venue/i })).toBeHidden()
    await expect(nav.getByRole('link', { name: /list as vendor/i })).toBeHidden()
  })

  test('homepage opens with public event creation input', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /3rdplace is the bay area's leading/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()
  })

  test('public event creation input starts planner without signup', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('textbox', { name: /describe the event you want to host/i })
      .fill('Plan a founder dinner for 18 people in Hayes Valley under $2500')
    await page.getByRole('button', { name: /start planning/i }).click()

    await expect(page).toHaveURL(/\/planner\?draft=/)
    await expect(page.getByRole('heading', { name: /dinner plan/i })).toBeVisible()
    await expect(page.getByText(/plan a founder dinner for 18 people/i)).toBeVisible()
  })

  test('event creator role card navigates to planner, not signup', async ({ page }) => {
    await page.goto('/')

    const creatorCard = page.locator('a[href="/planner"]').first()
    await expect(creatorCard).toBeVisible()
    await creatorCard.click()

    await expect(page).toHaveURL('/planner')
    await expect(page.getByRole('textbox', { name: /describe your event/i })).toBeVisible()
  })

  test('venue role card navigates to venue info page — not a signup form', async ({ page }) => {
    await page.goto('/')

    const venueCard = page.locator('a[href="/signup/venue"]').first()
    await expect(venueCard).toBeVisible()
    await venueCard.click()

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdspace/i })).toBeVisible()
    await expect(page.getByRole('textbox')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('vendor role card navigates to vendor info page — not a signup form', async ({ page }) => {
    await page.goto('/')

    const vendorCard = page.locator('a[href="/signup/vendor"]').first()
    await expect(vendorCard).toBeVisible()
    await vendorCard.click()

    await expect(page).toHaveURL('/signup/vendor')
    await expect(page.getByRole('heading', { name: /join 3rdspace as a vendor/i })).toBeVisible()
    await expect(page.getByRole('textbox')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('/signup/builder still renders the builder signup form', async ({ page }) => {
    await page.goto('/signup/builder')

    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /list your venue on 3rdspace/i })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /join 3rdspace as a vendor/i })).not.toBeVisible()
  })
})
