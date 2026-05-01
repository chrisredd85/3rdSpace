import { expect, test } from '@playwright/test'

const roleCards = [
  {
    title: /community builder/i,
    description: /create events, book venues and vendors/i,
  },
  {
    title: /venue owner/i,
    description: /list your space, set your rates/i,
  },
  {
    title: /^vendor$/i,
    description: /offer your services, set packages/i,
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
    heading: /list your venue on 3rdspace/i,
    fields: [/point-of-contact name/i, /booking email/i, /booking phone/i, /password/i],
  },
  {
    path: '/signup/vendor',
    heading: /get booked on 3rdspace/i,
    fields: [/your name/i, /business \/ stage name/i, /email/i, /phone/i, /password/i],
  },
]

test.describe('Signup flow', () => {
  test('signup chooser displays all role cards and routes', async ({ page }) => {
    await page.goto('/signup')

    await expect(page.getByRole('heading', { name: /join 3rdspace/i })).toBeVisible()

    for (const card of roleCards) {
      await expect(page.getByText(card.title).first()).toBeVisible()
      await expect(page.getByText(card.description)).toBeVisible()
    }

    await page.getByRole('button', { name: /community builder/i }).click()
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
    await page.goto('/signup/vendor')
    await page.getByRole('button', { name: /back/i }).click()

    await expect(page.getByRole('heading', { name: /join 3rdspace/i })).toBeVisible()
    await expect(page.getByText(/^vendor$/i)).toBeVisible()
  })
})
