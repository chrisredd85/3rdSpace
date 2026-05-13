import { expect, test } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'
import { getPersonaCredentials, hasSupabaseAdminEnv } from './helpers/env'

test.describe('vendor invite, claim, and rebook loop', () => {
  test.skip(
    process.env.VENDOR_INVITE_E2E !== '1' || !hasSupabaseAdminEnv(),
    'Set VENDOR_INVITE_E2E=1 plus Supabase admin env and seeded builder/vendor auth users to run the full loop.'
  )

  test('organizer invites a vendor, vendor claims, and organizer sees confirmed private-rate provenance', async ({ page, context }) => {
    const builderCredentials = getPersonaCredentials('builder')
    const vendorPassword = process.env.E2E_VENDOR_INVITE_PASSWORD || process.env.E2E_TEST_PASSWORD
    test.skip(!builderCredentials || !vendorPassword, 'Set E2E_BUILDER_EMAIL and E2E_TEST_PASSWORD.')

    await loginAsPersona(page, 'builder', builderCredentials!)
    await page.goto('/planner/vendors')

    await page.getByRole('button', { name: /invite someone i work with/i }).click()
    const vendorEmail = `test-vendor-invite-${Date.now()}@example.com`
    await page.getByLabel(/vendor name/i).fill('E2E Private Rate DJ')
    await page.getByLabel(/^email$/i).fill(vendorEmail)
    await page.getByLabel(/private agreed rate/i).fill('450')
    await page.getByRole('button', { name: /send invite/i }).click()

    const claimLink = page.getByRole('link', { name: /vendor\/claim/i })
    await expect(claimLink).toBeVisible({ timeout: 15000 })
    const claimUrl = await claimLink.getAttribute('href')
    expect(claimUrl).toBeTruthy()

    const vendorPage = await context.newPage()
    await vendorPage.goto(claimUrl!)
    await vendorPage.getByLabel(/email/i).fill(vendorEmail)
    await vendorPage.getByLabel(/password/i).fill(vendorPassword!)
    await vendorPage.getByRole('button', { name: /create account|continue/i }).click()
    await vendorPage.getByRole('button', { name: /accept/i }).click()
    await vendorPage.getByLabel(/standard rate|public base rate/i).fill('900')
    await vendorPage.getByRole('button', { name: /finish|continue|dashboard/i }).click()

    await page.reload()
    await expect(page.getByText('E2E Private Rate DJ')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/invited — pending signup/i)).toHaveCount(0)

    await page.getByRole('button', { name: /add to active plan/i }).first().click()
    await expect(page.getByText(/\$450 — your rate from/i)).toBeVisible({ timeout: 15000 })
  })
})
