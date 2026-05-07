import { expect, test } from '@playwright/test'
import { annotateFailure } from '../helpers/failure-taxonomy'

const portals = [
  {
    path: '/signup/builder',
    heading: /set up your creator account/i,
    fields: [/full name/i, /work email/i, /password/i],
    hasSignupForm: true,
  },
  {
    path: '/signup/venue',
    heading: /list your venue on 3rdplace/i,
    fields: [/free curated listing/i, /leads from verified sf event organizers/i, /you set your rates/i],
    hasSignupForm: false,
  },
  {
    path: '/signup/vendor',
    heading: /join 3rdplace as a vendor/i,
    fields: [/free listing/i, /booked by verified event hosts/i, /you control your packages/i],
    hasSignupForm: false,
  },
]

test.describe('auth: role signup portals', () => {
  for (const portal of portals) {
    test(`${portal.path} renders the first-step signup contract`, async ({ page }, testInfo) => {
      annotateFailure(testInfo, 'AUTH_ROLE_ACCESS', `${portal.path} should render the correct role-specific signup entry point`)

      await page.goto(portal.path, { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('heading', { name: portal.heading })).toBeVisible()
      if (portal.hasSignupForm) {
        await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()
        await expect(page.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login')
      } else {
        await expect(page.getByRole('button', { name: /continue/i })).not.toBeVisible()
        await expect(page.locator('input[type="password"]')).not.toBeVisible()
      }

      for (const field of portal.fields) {
        await expect(page.getByText(field).first()).toBeVisible()
      }
    })
  }
})
