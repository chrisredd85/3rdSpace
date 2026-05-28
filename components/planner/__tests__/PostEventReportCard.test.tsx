import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PostEventReportCard } from '@/components/planner/PostEventReportCard'
import type { Plan } from '@/lib/types'

const basePlan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Tech Mixer',
  event_type: 'mixer',
  status: 'complete',
  guest_count: 100,
  budget_cap_cents: 1000000,
  neighborhood: 'SoMa',
  date_window_start: '2026-01-01T00:00:00.000Z',
  date_window_end: null,
  ticketed: true,
  profit_goal_cents: null,
  notes: null,
} as Plan

describe('PostEventReportCard', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('loads eligibility and submits a manual attendance report', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        eligible: true,
        event_has_passed: true,
        event_name: 'Tech Mixer',
        event_date: '2026-01-01T00:00:00.000Z',
        pending_agreements: [{ id: 'agreement-1', venue_id: 'venue-1', venue_name: 'The Roof' }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        extracted_value: null,
        confidence: 'high',
        reasoning: 'Manual attendance override submitted without document extraction.',
        agreement_id: 'agreement-1',
        final_attendance: 87,
      }))

    const user = userEvent.setup()
    render(<PostEventReportCard plan={basePlan} />)

    expect(await screen.findByText(/How did Tech Mixer go/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Verified attendance/i), '87')
    await user.click(screen.getByRole('button', { name: /Submit attendance/i }))

    await screen.findByText(/87 attendees recorded/i)
    expect(fetchMock).toHaveBeenCalledWith('/api/planner/plans/plan-1/event-report', { cache: 'no-store' })
    const postCall = fetchMock.mock.calls.find((call) => call[1] && typeof call[1] === 'object' && (call[1] as RequestInit).method === 'POST')
    expect(postCall).toBeTruthy()
    expect((postCall?.[1] as RequestInit).body).toBeInstanceOf(FormData)
    expect(((postCall?.[1] as RequestInit).body as FormData).get('actual_attendance_override')).toBe('87')
  })

  it('does not render or fetch before the event date passes', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const futurePlan = {
      ...basePlan,
      date_window_start: '2999-01-01T00:00:00.000Z',
    } as Plan

    const { container } = render(<PostEventReportCard plan={futurePlan} />)

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled())
  })
})

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
