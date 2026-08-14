import { render, screen } from '@testing-library/react'
import PaymentsPage from '../page'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

describe('Payments approval attention queue', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders failed and expired approvals with their truthful recovery actions', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/builder/payouts/summary') {
        return jsonResponse({
          account: null,
          summary: { pending: 0, completed: 0, failed: 0, refunded: 0, count: 0 },
          payments: [],
        })
      }
      if (url === '/api/planner/payments/venue-rentals/summary') {
        return jsonResponse({
          summary: {
            total_paid_cents: 0,
            total_processing_fee_cents: 0,
            refunded_cents: 0,
            pending_refund_count: 0,
            count: 0,
          },
          transactions: [],
        })
      }
      if (url === '/api/planner/approvals/pending') {
        return jsonResponse({
          active_plan: {
            id: 'plan-1',
            title: 'Oakland community dinner',
            event_type: 'community_dinner',
            guest_count: 40,
            neighborhood: 'Oakland',
            date_window_start: '2026-08-20',
            date_window_end: '2026-08-20',
            status: 'ready',
            updated_at: '2026-07-09T12:00:00.000Z',
          },
          approvals: [
            approvalRow({
              id: 'approval-failed',
              action_label: 'Send venue outreach',
              status: 'authorized',
              action_status: 'failed',
              ui_status: 'failed',
              available_actions: ['retry'],
              requested_amount_cents: 9550,
            }),
            approvalRow({
              id: 'approval-expired',
              action_label: 'Reserve venue hold',
              status: 'expired',
              ui_status: 'expired',
              available_actions: ['request_reapproval'],
            }),
          ],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<PaymentsPage />)

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Retry/i })).toHaveAttribute('href', '/planner?plan=plan-1&tab=approvals')
    expect(screen.getByRole('link', { name: /Request re-approval/i })).toHaveAttribute('href', '/planner?plan=plan-1&tab=approvals')
    expect(screen.getByText('$95.50 requires approval')).toBeInTheDocument()
  })
})

function approvalRow(overrides: Record<string, unknown>) {
  return {
    id: 'approval-1',
    plan_id: 'plan-1',
    action_label: 'Review approval',
    provider: 'Moongate Lounge',
    event_date: '2026-08-20',
    price_cents: null,
    fees_cents: null,
    refund_terms: null,
    cancellation_terms: null,
    package_details: null,
    status: 'pending',
    action_status: null,
    ui_status: 'pending',
    available_actions: ['edit', 'authorize', 'cancel'],
    requested_amount_cents: null,
    authorized_amount_cents: null,
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    plan: null,
    ...overrides,
  }
}
