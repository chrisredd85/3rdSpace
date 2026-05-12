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
  {
    path: '/signup/venue',
    heading: /list your venue on 3rdplace/i,
    fields: [/point-of-contact name/i, /booking email/i, /booking phone/i, /password/i],
  },
  {
    path: '/signup/vendor',
    heading: /get booked on 3rdplace/i,
    fields: [/your name/i, /business \/ stage name/i, /email/i, /phone/i, /password/i],
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

  test('signup chooser remains directly reachable from portal pages', async ({ page }) => {
    await page.goto('/signup/builder', { waitUntil: 'domcontentloaded' })
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /join 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^community builder$/i })).toBeVisible()
  })

  test('/signup/venue shows the venue signup form', async ({ page }) => {
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('/signup/vendor shows the vendor signup form', async ({ page }) => {
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
  })

  test('direct venue portal opens the venue signup flow', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.goto('/signup/venue', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /list your venue on 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('direct vendor portal opens the vendor signup flow', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' })
    await page.goto('/signup/vendor', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /get booked on 3rdplace/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})
