import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerEventMaterializationCard } from '@/components/planner/PlannerEventMaterializationCard'

const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'

describe('PlannerEventMaterializationCard', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('requires exact host confirmation, materializes once, and invalidates plan/event analytics reads', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const onMaterialized = jest.fn().mockResolvedValue(undefined)
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      existing: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient, { onMaterialized })

    expect(screen.getByLabelText('Event date')).toHaveValue('2026-08-20')
    expect(screen.getByLabelText('Local start time')).toHaveValue('18:00')
    expect(screen.getByLabelText('Duration in minutes')).toHaveValue(180)
    expect(screen.getByLabelText('IANA timezone')).toHaveValue('America/Los_Angeles')
    expect(screen.getByRole('button', { name: 'Confirm exact schedule' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /I confirm this exact date/i }))
    const submitButton = screen.getByRole('button', { name: 'Confirm exact schedule' })
    expect(submitButton).toBeEnabled()
    expect(submitButton.closest('form')?.checkValidity()).toBe(true)
    await user.click(submitButton)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(`/api/planner/plans/${PLAN_ID}/materialize`, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        eventDate: '2026-08-20',
        startTime: '18:00',
        durationMinutes: 180,
        timeZone: 'America/Los_Angeles',
        confirmed: true,
      }),
    }))
    expect(await screen.findByText('Exact event schedule confirmed')).toBeInTheDocument()
    expect(screen.getByText(/No booking, payment, or partner message was created/i)).toBeInTheDocument()
    expect(onMaterialized).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['events'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner', 'plans'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-analytics'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-ticketing-analytics'] })
    expect((global.fetch as jest.Mock).mock.calls.every(([url]) => !/book|payment|purchase/i.test(String(url)))).toBe(true)
  })

  it('shows an accessible schedule error and blocks an invalid timezone before any write', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn()

    renderCard(queryClient)
    await user.clear(screen.getByLabelText('IANA timezone'))
    await user.type(screen.getByLabelText('IANA timezone'), 'Mars/Olympus_Mons')

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid IANA timezone')
    expect(screen.getByRole('button', { name: 'Confirm exact schedule' })).toBeDisabled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not offer first materialization before the plan is approved', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderCard(queryClient, { planStatus: 'ready' })

    expect(screen.queryByText('Confirm the event record')).not.toBeInTheDocument()
  })
})

function renderCard(
  queryClient: QueryClient,
  overrides: Partial<React.ComponentProps<typeof PlannerEventMaterializationCard>> = {}
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PlannerEventMaterializationCard
        planId={PLAN_ID}
        planStatus="approved"
        dateWindowStart="2026-08-20"
        dateWindowEnd="2026-08-22"
        {...overrides}
      />
    </QueryClientProvider>
  )
}
