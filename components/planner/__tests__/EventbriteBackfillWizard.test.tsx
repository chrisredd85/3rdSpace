import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventbriteEventImportWizard } from '@/components/planner/EventbriteEventImportWizard'

describe('EventbriteEventImportWizard', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('requires host verification before queueing a selected Eventbrite event import', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        connection: connectedEventbriteConnection(),
      }))
      .mockResolvedValueOnce(jsonResponse({
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
            importStatus: 'ready',
            importStatusMessage: null,
            preview: null,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        queued: 1,
        jobs: [{
          id: 'job-1',
          status: 'pending',
          scheduled_at: '2026-06-02T12:01:00.000Z',
        }],
        connection: connectedEventbriteConnection(),
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        connection: connectedEventbriteConnection(),
        events: [
          {
            id: 'eventbrite-event-1',
            name: 'Backfill Night',
            start: '2026-06-10T19:00:00',
            end: '2026-06-10T22:00:00',
            status: 'live',
            url: 'https://eventbrite.com/e/backfill-night-123',
            imported: true,
            importStatus: 'imported',
            importStatusMessage: 'Imported data is available for planner analytics.',
            preview: {
              eventId: 'event-1',
              integrationId: 'integration-1',
              syncStatus: 'completed',
              lastSyncAt: '2026-06-02T12:02:00.000Z',
              ticketsSold: 12,
              ticketsRefunded: 0,
              grossRevenueCents: 36000,
              netRevenueCents: 32000,
              attendeesImported: 12,
              checkedIn: 9,
              attendees: [],
            },
          },
        ],
      }))

    const user = userEvent.setup()
    render(<EventbriteEventImportWizard />)

    expect(await screen.findByText('Backfill Night')).toBeInTheDocument()
    const importButton = screen.getByRole('button', { name: /Queue import/i })
    expect(importButton).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /Backfill Night/i }))
    expect(screen.getByText(/Needs host verification/i)).toBeInTheDocument()
    expect(importButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Verify this Eventbrite event/i }))
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(importButton).toBeEnabled()

    await user.click(importButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/integrations/eventbrite/backfill', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ eventbrite_event_ids: ['eventbrite-event-1'] }),
      }))
    })
    expect(await screen.findByText(/import queued for 3rdPlace analytics/i)).toBeInTheDocument()
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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
