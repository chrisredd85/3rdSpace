import { expect, test } from '@playwright/test'
import { annotateFailure } from '../helpers/failure-taxonomy'

const portals = [
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

test.describe('auth: role signup portals', () => {
  for (const portal of portals) {
    test(`${portal.path} renders the first-step signup contract`, async ({ page }, testInfo) => {
      annotateFailure(testInfo, 'AUTH_ROLE_ACCESS', `${portal.path} should render the correct role-specific signup entry point`)

      await page.goto(portal.path)

      await expect(page.getByRole('heading', { name: portal.heading })).toBeVisible()
      await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
      await expect(page.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login')

      for (const field of portal.fields) {
        await expect(page.getByText(field).first()).toBeVisible()
      }
    })
  }
})
