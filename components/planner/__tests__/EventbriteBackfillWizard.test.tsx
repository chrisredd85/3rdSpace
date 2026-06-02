import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventbriteBackfillWizard } from '@/components/planner/EventbriteBackfillWizard'

describe('EventbriteBackfillWizard', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('requires host verification before importing a selected Eventbrite event', async () => {
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
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        imported: 1,
        results: [{
          eventId: 'event-1',
          externalEventId: 'eventbrite-event-1',
          ordersImported: 4,
          attendeesImported: 12,
          salesImported: 4,
          feeCommitmentsImported: 4,
        }],
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
            imported: true,
          },
        ],
      }))

    const user = userEvent.setup()
    render(<EventbriteBackfillWizard />)

    expect(await screen.findByText('Backfill Night')).toBeInTheDocument()
    const importButton = screen.getByRole('button', { name: /Import verified event/i })
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
