import { expect, test } from '@playwright/test'

const roleCards = [
  {
    title: /community builder/i,
    description: /create events, book venues and vendors/i,
  },
  {
    title: /venue owner/i,
    description: /free to list/i,
  },
  {
    title: /^vendor$/i,
    description: /free to list/i,
  },
]

const rolePortals = [
  {
    path: '/signup/builder',
    heading: /set up your creator account/i,
    fields: [/full name/i, /work email/i, /password/i],
  },
]

test.describe('Signup flow', () => {
  test('signup chooser displays all role cards and routes', async ({ page }) => {
    await page.goto('/signup')

    await expect(page.getByRole('heading', { name: /join 3rdspace/i })).toBeVisible()

    for (const card of roleCards) {
      const roleCard = page.locator('button').filter({
        has: page.getByRole('heading', { name: card.title }),
      })

      await expect(roleCard).toBeVisible()
      await expect(roleCard.getByText(card.description)).toBeVisible()
    }

    await page.getByRole('button', { name: /^community builder/i }).click()
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
  })

  for (const portal of rolePortals) {
    test(`${portal.path} renders first-step signup fields`, async ({ page }) => {
      await page.goto(portal.path)

      await expect(page.getByRole('heading', { name: portal.heading })).toBeVisible()
      await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()

      for (const field of portal.fields) {
        await expect(page.getByText(field).first()).toBeVisible()
      }
    })
  }

  test('signup portals can return to the role chooser', async ({ page }) => {
    await page.goto('/signup/builder')
    await page.getByRole('button', { name: /back/i }).click()

    await expect(page.getByRole('heading', { name: /join 3rdspace/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^community builder$/i })).toBeVisible()
  })

  test('/signup/venue shows info page, not a signup form', async ({ page }) => {
    await page.goto('/signup/venue')

    await expect(page.getByRole('heading', { name: /list your venue on 3rdspace/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
    await expect(page.locator('form')).not.toBeVisible()
  })

  test('/signup/vendor shows info page, not a signup form', async ({ page }) => {
    await page.goto('/signup/vendor')

    await expect(page.getByRole('heading', { name: /join 3rdspace as a vendor/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
    await expect(page.locator('form')).not.toBeVisible()
  })

  test('signup chooser venue card routes to info page, not a form', async ({ page }) => {
    await page.goto('/signup')
    // Click whichever element represents the venue option in the chooser
    await page.getByRole('link', { name: /venue/i }).first().click()
    await expect(page).toHaveURL('/signup/venue')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdspace/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('signup chooser vendor card routes to info page, not a form', async ({ page }) => {
    await page.goto('/signup')
    await page.getByRole('link', { name: /vendor/i }).first().click()
    await expect(page).toHaveURL('/signup/vendor')
    await expect(page.getByRole('heading', { name: /join 3rdspace as a vendor/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })
})
