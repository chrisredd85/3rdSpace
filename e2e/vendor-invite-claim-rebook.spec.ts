import { expect, test, type Page } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'
import { getPersonaCredentials, hasSupabaseAdminEnv } from './helpers/env'

test.describe('vendor invite, claim, and rebook loop', () => {
  test.setTimeout(90_000)

  test.skip(
    process.env.VENDOR_INVITE_E2E !== '1' || !hasSupabaseAdminEnv(),
    'Set VENDOR_INVITE_E2E=1 plus Supabase admin env and seeded builder/vendor auth users to run the full loop.'
  )

  test('organizer invites a vendor, vendor claims, and organizer sees confirmed private-rate provenance', async ({ page, browser }) => {
    const builderCredentials = getPersonaCredentials('builder')
    const vendorPassword = process.env.E2E_VENDOR_INVITE_PASSWORD || process.env.E2E_TEST_PASSWORD
    test.skip(!builderCredentials || !vendorPassword, 'Set E2E_BUILDER_EMAIL and E2E_TEST_PASSWORD.')

    await loginAsPersona(page, 'builder', builderCredentials!)
    const activePlan = await createActivePlannerPlan(page)
    await publishPlannerLivePlan(page, activePlan)
    await page.goto('/planner/vendors')

    await page.getByRole('button', { name: /invite someone i work with/i }).click()
    const runId = Date.now()
    const vendorName = `E2E Private Rate DJ ${runId}`
    const vendorEmail = `test-vendor-invite-${runId}@example.com`
    await page.getByLabel(/vendor name/i).fill(vendorName)
    await page.getByLabel(/^email$/i).fill(vendorEmail)
    await page.getByLabel(/private agreed rate/i).fill('450')
    await page.getByRole('button', { name: /send invite/i }).click()

    const claimLink = page.getByRole('link', { name: /vendor\/claim/i })
    await expect(claimLink).toBeVisible({ timeout: 15000 })
    const claimUrl = await claimLink.getAttribute('href')
    expect(claimUrl).toBeTruthy()

    const vendorContext = await browser.newContext()
    const vendorPage = await vendorContext.newPage()
    await vendorPage.goto(claimUrl!)
    await vendorPage.getByLabel(/email/i).fill(vendorEmail)
    await vendorPage.getByRole('textbox', { name: /password/i }).fill(vendorPassword!)
    await vendorPage.getByRole('button', { name: /^next$/i }).click()
    await vendorPage.getByRole('button', { name: /accept/i }).click()
    await vendorPage.getByRole('button', { name: /^next$/i }).click()
    await vendorPage.getByLabel(/standard rate|public base rate/i).fill('900')
    const claimResponsePromise = vendorPage.waitForResponse((response) =>
      response.url().includes('/api/vendor/claim') && response.request().method() === 'POST'
    )
    await vendorPage.getByRole('button', { name: /claim vendor profile/i }).click()
    const claimResponse = await claimResponsePromise
    expect(claimResponse.ok()).toBeTruthy()
    await vendorContext.close()

    await page.reload()
    const vendorCard = page.locator('article').filter({ hasText: vendorName }).first()
    await expect(vendorCard).toBeVisible({ timeout: 15000 })
    await expect(vendorCard.getByText(/invited — pending signup/i)).toHaveCount(0)

    await vendorCard.getByRole('button', { name: /add to active plan/i }).click()
    await expect(vendorCard.getByText(/\$450 — your rate from/i)).toBeVisible({ timeout: 15000 })
  })
})

async function createActivePlannerPlan(page: Page) {
  const response = await page.request.post('/api/planner/plans', {
    data: {
      message: 'E2E vendor rebook test for 35 guests in Mission on May 20',
    },
  })
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  expect(payload.plan?.id).toBeTruthy()
  return {
    plan: payload.plan,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
  }
}

async function publishPlannerLivePlan(
  page: Page,
  payload: { plan: Record<string, unknown>; messages: unknown[] }
) {
  const livePlanPayload = {
    plan: payload.plan,
    messages: payload.messages,
    planId: payload.plan.id,
  }

  await page.addInitScript((value) => {
    window.localStorage.setItem('planner-live-plan', JSON.stringify(value))
  }, livePlanPayload)
  await page.evaluate((value) => {
    window.localStorage.setItem('planner-live-plan', JSON.stringify(value))
    window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: value }))
  }, livePlanPayload)
}
