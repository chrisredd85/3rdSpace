import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlannerOutcomeCard, buildOutcomePayload } from '../PlannerOutcomeCard'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'

describe('PlannerOutcomeCard', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('converts dollar inputs to exact integer cents', () => {
    expect(buildOutcomePayload({
      attendance: '84',
      revenueDollars: '2450.50',
      costDollars: '1725.25',
      notes: 'Strong repeat candidate.',
    })).toEqual({
      actualAttendance: 84,
      grossRevenueCents: 245050,
      totalCostCents: 172525,
      notes: 'Strong repeat candidate.',
    })
    expect(buildOutcomePayload({
      attendance: '',
      revenueDollars: '12.999',
      costDollars: '',
      notes: '',
    })).toEqual({ error: 'Gross revenue must use dollars with no more than two decimal places.' })
  })

  it('submits structured evidence and refreshes completed state', async () => {
    const onCompleted = jest.fn()
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        return response({ success: true, template_eligible: true })
      }
      return response({
        plan: { id: PLAN_ID, status: 'booked' },
        event: {
          id: 'event-1',
          event_name: 'Founder dinner',
          ends_at: '2026-07-02T04:00:00.000Z',
          outcome_recorded_at: null,
          outcome_summary: null,
        },
        canRecord: true,
        reason: null,
        templateEligible: false,
      })
    })

    renderCard(<PlannerOutcomeCard planId={PLAN_ID} onCompleted={onCompleted} />)

    expect(await screen.findByText('Record the event outcome')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Actual attendance'), { target: { value: '84' } })
    fireEvent.change(screen.getByLabelText('Gross revenue ($)'), { target: { value: '2450.50' } })
    fireEvent.change(screen.getByLabelText('Total cost ($)'), { target: { value: '1725.25' } })
    fireEvent.change(screen.getByLabelText('Outcome notes'), { target: { value: 'Strong repeat candidate.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record outcome and complete event' }))

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall?.[0]).toBe(`/api/planner/plans/${PLAN_ID}/outcome`)
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      actualAttendance: 84,
      grossRevenueCents: 245050,
      totalCostCents: 172525,
      notes: 'Strong repeat candidate.',
    })
  })

  it('does not expose completion before the canonical end time', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({
      plan: { id: PLAN_ID, status: 'booked' },
      event: {
        id: 'event-1',
        event_name: 'Founder dinner',
        ends_at: '2027-07-02T04:00:00.000Z',
        outcome_recorded_at: null,
        outcome_summary: null,
      },
      canRecord: false,
      reason: 'event_not_ended',
      templateEligible: false,
    }))

    renderCard(<PlannerOutcomeCard planId={PLAN_ID} />)

    expect(await screen.findByText('Outcome entry opens after the event')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record outcome and complete event' })).not.toBeInTheDocument()
  })
})

function renderCard(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
