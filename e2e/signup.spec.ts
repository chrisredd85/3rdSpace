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
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /join 3rdplace/i })).toBeVisible()

    for (const card of roleCards) {
      const roleCard = page.locator('button').filter({
        has: page.getByRole('heading', { name: card.title }),
      })

      await expect(roleCard).toBeVisible()
      await expect(page.getByText(card.description).first()).toBeVisible()
    }

    await page.getByRole('button', { name: /^community builder/i }).click()
    await expect(page.getByRole('heading', { name: /set up your creator account/i })).toBeVisible()
  })

  for (const portal of rolePortals) {
    test(`${portal.path} renders first-step signup fields`, async ({ page }) => {
      await page.goto(portal.path, { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('heading', { name: portal.heading })).toBeVisible()
      await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()

      for (const field of portal.fields) {
        await expect(page.getByText(field).first()).toBeVisible()
      }
    })
  }

  test('signup portals can return to the role chooser', async ({ page }) => {
    await page.goto('/signup/builder', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /back/i }).click()

    await expect(page.getByRole('heading', { name: /join 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^community builder$/i })).toBeVisible()
  })

  test('/signup/venue shows info page, not a signup form', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('/signup/vendor shows info page, not a signup form', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /join 3rdplace as a vendor/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
  })

  test('signup chooser venue card opens the venue signup flow', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /venue owner/i }).click()
    await expect(page).toHaveURL('/signup')
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('signup chooser vendor card opens the vendor signup flow', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /^vendor/i }).click()
    await expect(page).toHaveURL('/signup')
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})
