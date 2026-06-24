import { render, screen, waitFor } from '@testing-library/react'
import { TicketingSetupGuide } from '@/components/auth/TicketingSetupGuide'
import { ToastProvider } from '@/components/ui/toast'

const originalFetch = global.fetch

function renderGuide() {
  return render(
    <ToastProvider>
      <TicketingSetupGuide
        selectedPlatforms={['eventbrite', 'posh', 'luma', 'partiful']}
        persistConnections
      />
    </ToastProvider>
  )
}

describe('TicketingSetupGuide', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    global.fetch = jest.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { platform?: string }
      const platform = body.platform ?? 'unknown'
      return jsonResponse({
        webhookUrl: platform === 'eventbrite'
          ? null
          : `https://3rdplace.test/api/webhooks/${platform}?builderConnectionId=connection-${platform}`,
      })
    }) as jest.Mock
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('renders setup cards for Eventbrite, Posh, Luma, and Partiful', async () => {
    renderGuide()

    expect(screen.getByText('Eventbrite account')).toBeInTheDocument()
    expect(screen.getByText('Posh webhook')).toBeInTheDocument()
    expect(screen.getByText('Luma webhook + API refresh')).toBeInTheDocument()
    expect(screen.getByText('Partiful CSV / event link')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Connect Eventbrite/i })).toBeEnabled()

    expect(await screen.findByText(/api\/webhooks\/posh/)).toBeInTheDocument()
    expect(screen.getByText(/api\/webhooks\/luma/)).toBeInTheDocument()
    expect(screen.getByText(/api\/webhooks\/partiful/)).toBeInTheDocument()
  })

  it('shows attendee CSV instructions and historical upload links for every platform', async () => {
    renderGuide()

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4))

    expect(screen.getAllByText('Download attendee CSV')).toHaveLength(4)
    expect(screen.getByText(/Open the Eventbrite event dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/Open the Posh event dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/Open the Luma event guest list/i)).toBeInTheDocument()
    expect(screen.getByText(/Open the Partiful event and go to the Guest List/i)).toBeInTheDocument()

    const uploadLinks = screen.getAllByRole('link', { name: /Upload historical data via CSV/i })
    expect(uploadLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/planner/events/import?source=eventbrite',
      '/planner/events/import?source=posh',
      '/planner/events/import?source=luma',
      '/planner/events/import?source=partiful',
    ])
  })

  it('treats Partiful as CSV-first while exposing webhook only as an advanced path', async () => {
    renderGuide()

    expect(screen.getByText('CSV-first RSVP import')).toBeInTheDocument()
    expect(screen.getByText('Event link and CSV are the default')).toBeInTheDocument()
    expect(screen.getByText(/Only use the webhook endpoint if Partiful exposes webhook settings/i)).toBeInTheDocument()
    expect(await screen.findByText(/api\/webhooks\/partiful/)).toBeInTheDocument()
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
