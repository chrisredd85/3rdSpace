import { expect, test } from '@playwright/test'

test.describe('Persona: Alex — venue owner wants to list', () => {
  test('/signup/venue shows the venue listing signup form', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByText(/venue sign-up · step 1 of 5/i)).toBeVisible()
    await expect(page.getByText(/booking email/i).first()).toBeVisible()
    await expect(page.getByText(/booking phone/i).first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('signup chooser links to /signup/venue', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })

    const venueNavBtn = page.getByRole('link', { name: /venue list my venue/i })
    await expect(venueNavBtn).toHaveAttribute('href', '/signup/venue')
    await venueNavBtn.click()

    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
  })
})
