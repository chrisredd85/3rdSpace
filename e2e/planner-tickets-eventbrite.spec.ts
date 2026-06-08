import { expect, test } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'

test.describe('Planner tickets Eventbrite import', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Planner ticketing Eventbrite smoke is covered in Chromium.')
  })

  test('selects, verifies, and queues an Eventbrite import from planner tickets', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const credentials = {
      email: `test-builder-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`,
      password: 'TestPassword123!',
    }
    const signupResponse = await page.request.post('/api/auth/signup', {
      data: {
        userType: 'community_builder',
        email: credentials.email,
        password: credentials.password,
        name: 'Planner Tickets Test',
        organization_name: 'Planner Tickets QA',
        event_types: ['mixer'],
        preferred_amenities: ['bar', 'sound'],
        ticket_platforms: ['eventbrite'],
      },
    })
    expect(signupResponse.ok()).toBeTruthy()
    await loginAsPersona(page, 'builder', credentials)

    let queuedEventbriteEventId: string | null = null

    await page.route('**/api/integrations/ticketing/connections', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connections: [
            {
              id: 'connection-1',
              platform: 'eventbrite',
              status: 'connected',
              account_label: 'Eventbrite',
              external_account_id: null,
              webhook_url: 'https://3rdplace.test/api/webhooks/eventbrite?connection=connection-1',
              last_connected_at: '2026-06-02T12:00:00.000Z',
              last_error: null,
              config: {},
            },
          ],
        }),
      })
    })

    await page.route('**/api/planner/ticketing/analytics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: {
            tickets_sold: 0,
            gross_revenue_cents: 0,
            net_revenue_cents: 0,
            average_ticket_price_cents: 0,
          },
          rollups: [],
        }),
      })
    })

    await page.route('**/api/integrations/eventbrite/backfill', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ connection: connectedEventbriteConnection() }),
        })
        return
      }

      const body = route.request().postDataJSON() as Record<string, unknown>
      if (Array.isArray(body.eventbrite_event_ids)) {
        queuedEventbriteEventId = String(body.eventbrite_event_ids[0])
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            queued: 1,
            jobs: [{ id: 'job-1', status: 'pending', scheduled_at: '2026-06-02T12:01:00.000Z' }],
            connection: connectedEventbriteConnection(),
          }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connection: connectedEventbriteConnection(),
          events: [
            {
              id: 'eventbrite-event-1',
              name: 'Backfill Night',
              start: '2026-06-10T19:00:00',
              end: '2026-06-10T22:00:00',
              status: 'live',
              url: 'https://eventbrite.com/e/backfill-night-123',
              imported: false,
              importStatus: queuedEventbriteEventId === 'eventbrite-event-1' ? 'queued' : 'ready',
              importStatusMessage:
                queuedEventbriteEventId === 'eventbrite-event-1'
                  ? 'Import is queued and will run in the background.'
                  : null,
              preview: null,
            },
          ],
        }),
      })
    })

    await page.goto('/planner/tickets', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /^Tickets$/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Select, verify, and import/i })).toBeVisible()
    await expect(page.getByText('Backfill Night')).toBeVisible()

    const queueButton = page.getByRole('button', { name: /Queue import/i })
    await expect(queueButton).toBeDisabled()
    await page.getByRole('radio', { name: /Backfill Night/i }).click()
    await expect(page.getByText(/Needs host verification/i)).toBeVisible()
    await expect(queueButton).toBeDisabled()

    await page.getByRole('button', { name: /Verify this Eventbrite event/i }).click()
    await expect(page.getByText('Verified', { exact: true })).toBeVisible()
    await expect(queueButton).toBeEnabled()

    await queueButton.click()
    await expect(page.getByText(/import queued for 3rdPlace analytics/i)).toBeVisible()
    expect(queuedEventbriteEventId).toBe('eventbrite-event-1')
  })
})

function connectedEventbriteConnection() {
  return {
    status: 'connected',
    connected: true,
    webhookUrl: 'https://3rdplace.test/api/webhooks/eventbrite?connection=connection-1',
    hasWebhookSecret: true,
    lastConnectedAt: '2026-06-02T12:00:00.000Z',
    lastEventReceivedAt: null,
    lastWebhookEventType: null,
    lastError: null,
  }
}
