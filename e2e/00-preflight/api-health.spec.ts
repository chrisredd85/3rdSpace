import { expect, test } from '@playwright/test'
import { annotateFailure } from '../helpers/failure-taxonomy'

const unauthenticatedCriticalRoutes = [
  '/api/builder/events',
  '/api/messages/threads',
  '/api/vendor/bookings',
  '/api/venue/requests',
  '/api/builder/billing/status',
]

test.describe('preflight: critical API health', () => {
  for (const route of unauthenticatedCriticalRoutes) {
    test(`${route} does not fail with a server error when unauthenticated`, async ({ request }, testInfo) => {
      annotateFailure(testInfo, 'API_500', `${route} returned a 5xx before the browser workflow started`)

      const response = await request.get(route)

      expect(response.status(), `${route} should return auth/validation status, not 5xx`).toBeLessThan(500)
    })
  }
})
