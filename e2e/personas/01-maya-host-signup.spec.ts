import { expect, test } from '@playwright/test'

test.describe('Persona: Maya — SF host, first visit', () => {
  test('homepage Sign up nav link routes to the role picker with venue and vendor options', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('networkidle')

    const signupLink = page.locator('nav').getByRole('link', { name: /^sign up$/i }).first()
    await expect(signupLink).toBeVisible()
    await expect(signupLink).toHaveAttribute('href', '/signup')
    await Promise.all([page.waitForURL('**/signup', { timeout: 15000 }), signupLink.click()])
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: /which one are you\?/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /list my venue/i })).toHaveAttribute('href', '/signup/venue')
    await expect(page.getByRole('link', { name: /list my services/i })).toHaveAttribute('href', '/signup/vendor')
  })

  test('Sign up link is reachable from the mobile menu', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForLoadState('networkidle')

    const nav = page.locator('nav')
    const menuTrigger = page.getByRole('button', { name: /open menu/i })
    await menuTrigger.click()
    await expect(page.getByRole('button', { name: /close menu/i })).toBeVisible()
    await expect(nav.getByRole('link', { name: /^sign up$/i }).first()).toBeVisible()
  })

  test('homepage opens with public event creation input', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /know what worked/i })).toBeVisible()
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
    await expect(page.getByRole('button', { name: /send event draft/i })).toBeVisible()
  })

  test('venue role card navigates to venue signup form', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const venueCard = page.getByRole('link', { name: /list my venue/i })
    await expect(venueCard).toHaveAttribute('href', '/signup/venue')
    await Promise.all([page.waitForURL('**/signup/venue', { timeout: 15000 }), venueCard.click()])
    await expect(page).toHaveURL(/\/signup\/venue$/)
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/booking email/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('vendor role card navigates to vendor signup form', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const vendorCard = page.getByRole('link', { name: /list my services/i })
    await expect(vendorCard).toHaveAttribute('href', '/signup/vendor')
    await Promise.all([page.waitForURL('**/signup/vendor', { timeout: 15000 }), vendorCard.click()])
    await expect(page).toHaveURL(/\/signup\/vendor$/)
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/business \/ stage name/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('creator role card navigates to builder signup form', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const creatorCard = page.getByRole('link', { name: /run events/i })
    await expect(creatorCard).toHaveAttribute('href', '/signup/builder')
    await Promise.all([page.waitForURL('**/signup/builder', { timeout: 15000 }), creatorCard.click()])
    await expect(page).toHaveURL(/\/signup\/builder$/)
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
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
