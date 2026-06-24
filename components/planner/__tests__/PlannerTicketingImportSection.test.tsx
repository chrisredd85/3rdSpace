import { render, screen } from '@testing-library/react'
import { PlannerTicketingImportSection } from '@/components/planner/PlannerTicketingImportSection'

jest.mock('@/components/planner/EventbriteEventImportWizard', () => ({
  EventbriteEventImportWizard: ({ className }: { className?: string }) => (
    <section className={className}>Eventbrite import wizard</section>
  ),
}))

describe('PlannerTicketingImportSection', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('shows setup instructions instead of Eventbrite import controls when Eventbrite is disconnected', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
      connection: {
        status: 'not_connected',
        connected: false,
        webhookUrl: null,
        hasWebhookSecret: false,
        lastConnectedAt: null,
        lastEventReceivedAt: null,
        lastWebhookEventType: null,
        lastError: null,
      },
    }))

    render(<PlannerTicketingImportSection />)

    expect(await screen.findByText('Connect a source before importing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect Eventbrite/i })).toHaveAttribute('href', '/planner/integrations/eventbrite')
    expect(screen.getByRole('link', { name: /Open Posh setup/i })).toHaveAttribute('href', '/planner/integrations/posh')
    expect(screen.getByRole('link', { name: /Import CSV data/i })).toHaveAttribute('href', '/planner/events/import')
    expect(screen.queryByText('Eventbrite import wizard')).not.toBeInTheDocument()
  })

  it('renders the Eventbrite import wizard when Eventbrite is connected', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
      connection: {
        status: 'connected',
        connected: true,
        webhookUrl: 'https://3rdplace.test/api/webhooks/eventbrite?builderConnectionId=connection-1',
        hasWebhookSecret: true,
        lastConnectedAt: '2026-06-24T12:00:00.000Z',
        lastEventReceivedAt: null,
        lastWebhookEventType: null,
        lastError: null,
      },
    }))

    render(<PlannerTicketingImportSection />)

    expect(await screen.findByText('Eventbrite import wizard')).toBeInTheDocument()
    expect(screen.queryByText('Connect a source before importing')).not.toBeInTheDocument()
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
