import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RevisionHistoryModal } from '@/components/planner/RevisionHistoryModal'

describe('RevisionHistoryModal', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('loads and renders revision history newest first', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      revisions: [
        {
          id: 'rev-2',
          plan_id: 'plan-1',
          triggered_by_user_id: 'user-1',
          trigger_type: 'date_change',
          trigger_payload: {
            field: 'date window',
            source_message_excerpt: 'Move it to July 20.',
          },
          source_message_id: 'msg-2',
          impact_summary: {
            superseded_recommendation_ids: ['rec-1'],
            superseded_approval_ids: ['approval-1'],
          },
          rediscovery_triggered_for: ['venue'],
          applied_at: '2026-06-20T12:00:00.000Z',
          audit_log_id: 'audit-2',
        },
      ],
    }), { status: 200 }))

    render(<RevisionHistoryModal planId="plan-1" isOpen onClose={jest.fn()} />)

    expect(await screen.findByText(/Date change changed date window/i)).toBeInTheDocument()
    expect(screen.getByText('Move it to July 20.')).toBeInTheDocument()
    expect(screen.getByText(/1 recommendation marked stale/i)).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/planner/plans/plan-1/revisions', expect.objectContaining({
      method: 'GET',
    }))
  })

  it('paginates revision history twenty rows at a time', async () => {
    const revisions = Array.from({ length: 21 }, (_, index) => ({
      id: `rev-${index}`,
      plan_id: 'plan-1',
      triggered_by_user_id: null,
      trigger_type: 'budget_change',
      trigger_payload: { field: `budget ${index}` },
      source_message_id: null,
      impact_summary: {},
      rediscovery_triggered_for: [],
      applied_at: `2026-06-${String(20 - Math.min(index, 19)).padStart(2, '0')}T12:00:00.000Z`,
      audit_log_id: null,
    }))
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ revisions }), { status: 200 }))
    const user = userEvent.setup()

    render(<RevisionHistoryModal planId="plan-1" isOpen onClose={jest.fn()} />)

    expect(await screen.findByText(/Budget change changed budget 0/i)).toBeInTheDocument()
    expect(screen.queryByText(/Budget change changed budget 20/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /older/i }))

    await waitFor(() => {
      expect(screen.getByText(/Budget change changed budget 20/i)).toBeInTheDocument()
    })
  })

  it('shows an empty state when no revisions exist', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ revisions: [] }), { status: 200 }))

    render(<RevisionHistoryModal planId="plan-1" isOpen onClose={jest.fn()} />)

    expect(await screen.findByText('No plan revisions yet.')).toBeInTheDocument()
  })
})
