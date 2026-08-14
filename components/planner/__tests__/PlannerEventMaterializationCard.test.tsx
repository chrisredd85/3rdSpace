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
      booking_resume: {
        status: 'complete',
        results: [{
          disposition: 'executing',
          metadata: { booking_id: 'booking-1', booking_status: 'pending' },
        }],
        error: null,
      },
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
    expect(screen.getByText(/1 approved booking request is now linked/i)).toBeInTheDocument()
    expect(screen.getByText(/No payment or outbound send occurred/i)).toBeInTheDocument()
    expect(onMaterialized).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['events'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner', 'plans'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-analytics'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['planner-ticketing-analytics'] })
    expect((global.fetch as jest.Mock).mock.calls.every(([url]) => !/book|payment|purchase/i.test(String(url)))).toBe(true)
  })

  it('keeps booking-handoff recovery reachable after the canonical event already exists', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      booking_resume: {
        status: 'complete',
        results: [{ disposition: 'executing', metadata: { booking_id: 'booking-1' } }],
        error: null,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient, {
      planStatus: 'executing',
      materializedEventId: EVENT_ID,
    })

    await user.click(screen.getByRole('button', { name: 'Sync approved booking handoffs' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      `/api/planner/plans/${PLAN_ID}/materialize`,
      { method: 'PATCH', credentials: 'include' },
    ))
    expect(await screen.findByText(/1 approved booking request is now linked/i)).toBeInTheDocument()
  })

  it('shows a retry control when post-materialization booking resume fails', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      existing: false,
      booking_resume: {
        status: 'failed',
        results: [],
        error: 'canonical_quote_booking_resume_failed',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient)
    await user.click(screen.getByRole('checkbox', { name: /I confirm this exact date/i }))
    await user.click(screen.getByRole('button', { name: 'Confirm exact schedule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/booking handoff still needs attention/i)
    expect(screen.getByRole('button', { name: 'Retry approved booking handoffs' })).toBeEnabled()
  })

  it('routes an expired pre-start booking approval to the existing approval review surface', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      existing: false,
      booking_resume: {
        status: 'reapproval_required',
        results: [{
          disposition: 'waiting',
          metadata: {
            canonical_booking_status: 'reapproval_required',
            reapproval_required: true,
            reapproval_reason: 'approval_expired',
            approval_id: 'approval-expired',
          },
        }],
        error: null,
        reapproval: {
          approval_ids: ['approval-expired'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient)
    await user.click(screen.getByRole('checkbox', { name: /I confirm this exact date/i }))
    await user.click(screen.getByRole('button', { name: 'Confirm exact schedule' }))

    expect(await screen.findByText('Exact event schedule confirmed')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/terms expired or changed before execution started/i)
    expect(screen.getByRole('link', { name: 'Review approval' })).toHaveAttribute(
      'href',
      `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
    )
    expect(screen.queryByRole('button', { name: /Retry approved booking handoffs/i })).not.toBeInTheDocument()
  })

  it('routes a persisted failed handoff to the approval recovery controls', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      booking_resume: {
        status: 'failed',
        results: [{
          disposition: 'waiting',
          metadata: { action_status: 'failed', agent_action_id: 'action-failed' },
        }],
        error: 'canonical_quote_booking_action_failed',
        recovery: {
          action_ids: ['action-failed'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'action_failed',
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient)
    await user.click(screen.getByRole('checkbox', { name: /I confirm this exact date/i }))
    await user.click(screen.getByRole('button', { name: 'Confirm exact schedule' }))

    expect(await screen.findByRole('link', { name: 'Review failed handoff' })).toHaveAttribute(
      'href',
      `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
    )
    expect(screen.queryByRole('button', { name: /Retry approved booking handoffs/i })).not.toBeInTheDocument()
  })

  it('turns a pre-existing failed action found during manual sync into explicit review, not another retry', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      booking_resume: {
        status: 'failed',
        results: [{
          disposition: 'waiting',
          metadata: {
            canonical_booking_status: 'failed',
            action_status: 'failed',
            agent_action_id: 'action-preexisting-failed',
          },
        }],
        error: 'canonical_quote_booking_action_failed',
        recovery: {
          action_ids: ['action-preexisting-failed'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'action_failed',
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient, {
      planStatus: 'executing',
      materializedEventId: EVENT_ID,
    })
    await user.click(screen.getByRole('button', { name: 'Sync approved booking handoffs' }))

    expect(await screen.findByRole('link', { name: 'Review failed handoff' })).toHaveAttribute(
      'href',
      `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
    )
    expect(screen.queryByRole('button', { name: /Retry approved booking handoffs/i })).not.toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows explicit review instead of retry when a completed plan blocks resume', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      event_id: EVENT_ID,
      booking_resume: {
        status: 'failed',
        results: [{
          disposition: 'waiting',
          metadata: {
            canonical_booking_status: 'resume_blocked_plan_status',
            resume_blocked: true,
            plan_status: 'completed',
            action_status: 'approved',
            agent_action_id: 'action-completed',
          },
        }],
        error: 'canonical_quote_booking_resume_blocked',
        recovery: {
          action_ids: ['action-completed'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'plan_status_ineligible',
          plan_statuses: ['completed'],
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    renderCard(queryClient, { planStatus: 'completed', materializedEventId: EVENT_ID })
    await user.click(screen.getByRole('button', { name: 'Sync approved booking handoffs' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/plan is no longer executable/i)
    expect(screen.getByText(/cannot resume after this plan left an executable state/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review blocked handoff' })).toHaveAttribute(
      'href',
      `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
    )
    expect(screen.queryByRole('button', { name: /Retry approved booking handoffs/i })).not.toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)
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
