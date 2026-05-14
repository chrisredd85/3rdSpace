import { expect, test } from '@playwright/test'

test.describe('Persona: Maya — SF host, first visit', () => {
  test('homepage exposes venue and vendor signup links from the supply dropdown on desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('networkidle')

    const nav = page.locator('nav')
    const supplyTrigger = nav.getByRole('button', { name: /list with us/i })
    await supplyTrigger.click()
    await expect(supplyTrigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem', { name: /list your venue/i })).toHaveAttribute('href', '/signup/venue')
    await expect(page.getByRole('menuitem', { name: /list as vendor/i })).toHaveAttribute('href', '/signup/vendor')
  })

  test('supply links move into the mobile menu', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForLoadState('networkidle')

    const nav = page.locator('nav')
    await expect(nav.getByRole('button', { name: /list with us/i })).toBeHidden()
    const menuTrigger = nav.getByRole('button', { name: /open menu/i })
    await menuTrigger.click()
    await expect(nav.getByRole('button', { name: /close menu/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /list your venue/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /list as vendor/i })).toBeVisible()
  })

  test('homepage opens with public event creation input', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /stop planning the same event from scratch/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()
  })

  test('public event creation input starts planner without signup', async ({ page }) => {
    const draft = 'Plan a founder dinner for 18 people in Hayes Valley under $2500'
    await page.goto(`/planner?draft=${encodeURIComponent(draft)}`, { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/planner/, { timeout: 15000 })
    await expect(page.getByText(/founder dinner|private dinner|active plan/i).first()).toBeVisible({ timeout: 15000 })
  })

  test('homepage planner composer is the creator entry point', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('textbox', { name: /describe the event you want to host/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /start planning/i })).toBeVisible()
  })

  test('venue role card navigates to venue signup form', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const supplyTrigger = page.locator('nav').getByRole('button', { name: /list with us/i })
    await supplyTrigger.click()
    await expect(supplyTrigger).toHaveAttribute('aria-expanded', 'true')
    const venueCard = page.getByRole('menuitem', { name: /list your venue/i })
    await expect(venueCard).toHaveAttribute('href', '/signup/venue')
    await page.goto('/signup/venue')

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/booking email/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('vendor role card navigates to vendor signup form', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const supplyTrigger = page.locator('nav').getByRole('button', { name: /list with us/i })
    await supplyTrigger.click()
    await expect(supplyTrigger).toHaveAttribute('aria-expanded', 'true')
    const vendorCard = page.getByRole('menuitem', { name: /list as vendor/i })
    await expect(vendorCard).toHaveAttribute('href', '/signup/vendor')
    await page.goto('/signup/vendor')

    await expect(page).toHaveURL('/signup/vendor')
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/business \/ stage name/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('/signup/builder still renders the builder signup form', async ({ page }) => {
    await page.goto('/signup/builder', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).not.toBeVisible()
  })
})
