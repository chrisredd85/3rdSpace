import { render, screen, waitFor } from '@testing-library/react'
import { PlannerTicketingSetupGuideSection } from '@/components/planner/PlannerTicketingSetupGuideSection'

jest.mock('@/components/auth/TicketingSetupGuide', () => ({
  TicketingSetupGuide: ({ selectedPlatforms }: { selectedPlatforms: string[] }) => (
    <div data-testid="ticketing-guide">{selectedPlatforms.join(',')}</div>
  ),
}))

const originalFetch = global.fetch

describe('PlannerTicketingSetupGuideSection', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('defaults expanded when the organizer has no ticketing connections', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({ connections: [] })) as jest.Mock

    render(<PlannerTicketingSetupGuideSection />)

    expect(await screen.findByText(/Connect or import Eventbrite, Posh, Luma, and Partiful data/i)).toBeInTheDocument()
    expect(screen.getByTestId('ticketing-guide')).toHaveTextContent('eventbrite,posh,luma,partiful')
    expect(screen.getByText('Ticketing setup guide').closest('details')).toHaveAttribute('open')
  })

  it('defaults collapsed when at least one ticketing connection exists', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      connections: [{ id: 'connection-1', platform: 'eventbrite', status: 'connected' }],
    })) as jest.Mock

    render(<PlannerTicketingSetupGuideSection />)

    expect(await screen.findByText(/1 ticketing connection saved/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Ticketing setup guide').closest('details')).not.toHaveAttribute('open')
    })
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
