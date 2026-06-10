import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VenuePayoutsPage from '@/app/(dashboard)/venue/payouts/page'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

describe('venue payouts rental refund UI', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/venue/stripe/status') {
        return Promise.resolve(jsonResponse({
          account: {
            stripe_account_id: 'acct_venue',
            account_status: 'active',
            charges_enabled: true,
            payouts_enabled: true,
            requirements_due: [],
          },
          completionPercent: 100,
        }))
      }
      if (url === '/api/venue/community-host-incentive/summary') {
        return Promise.resolve(jsonResponse({
          summary: { pending: 0, processing: 0, completed: 0, refunded: 0, count: 1 },
          payments: [{
            id: 'agreement:agreement-pos',
            agreement_id: 'agreement-pos',
            payment_id: null,
            amount: null,
            amount_cents: 0,
            principal_cents: 0,
            payout_cents: 0,
            processing_fee_cents: 0,
            invoice_hosted_url: null,
            refund_amount_cents: null,
            refund_reason: null,
            refund_requested_at: null,
            currency: 'usd',
            status: 'revenue_report_needed',
            proof_status: 'needed',
            event_name: 'Founder dinner',
            event_date: '2026-06-19T00:00:00.000Z',
            builder_name: 'Chris Builder',
            actual_attendance: 90,
            per_head_amount: null,
            reported_revenue_cents: null,
            revenue_extracted_value_cents: null,
            revenue_extraction_confidence: null,
            revenue_proof_url: null,
            revenue_submitted_at: null,
            revenue_share_percent: 12,
            agreement_status: 'attendance_locked',
            requires_manual_review: false,
            initiated_at: null,
            completed_at: null,
            failure_reason: null,
          }],
        }))
      }
      if (url === '/api/venue/community-host-incentive/agreement-pos/spend-report') {
        return Promise.resolve(jsonResponse({
          extracted_value: 428000,
          confidence: 'high',
          reasoning: 'Net sales was clearly labeled.',
          calculated_owed_cents: 51360,
          payment_id: 'payment-pos',
          extraction_status: 'extracted',
          review_status: 'ready_for_invoice_review',
          uploaded_proof: {
            filename: 'square.csv',
            mime_type: 'text/csv',
            size_bytes: 18,
            path: 'agreement-pos/square.csv',
          },
        }))
      }
      if (url === '/api/venue/rentals/summary') {
        return Promise.resolve(jsonResponse({
          summary: {
            total_received_cents: 100000,
            pending_refund_requests: 1,
            refunded_cents: 0,
            count: 1,
          },
          transactions: [{
            id: 'tx-rental',
            plan_id: 'plan-1',
            event_name: 'NSBE mixer',
            event_date: '2026-06-01T00:00:00.000Z',
            builder_name: 'Chris Builder',
            amount_cents: 100000,
            processing_fee_cents: 2930,
            venue_payout_cents: 100000,
            currency: 'usd',
            status: 'refund_requested',
            payment_method_type: 'card',
            paid_at: '2026-06-01T10:00:00.000Z',
            transfer_completed_at: '2026-06-01T10:01:00.000Z',
            created_at: '2026-06-01T09:00:00.000Z',
            stripe_transfer_id: 'tr_rental',
            refund_amount_cents: 20000,
            refund_reason: 'Rain moved the event indoors.',
            refund_requested_at: '2026-06-02T00:00:00.000Z',
            refund_approved_at: null,
          }],
        }))
      }
      if (url === '/api/venue/rentals/tx-rental/refund-decision') {
        return Promise.resolve(jsonResponse({ ok: true }))
      }
      return Promise.reject(new Error(`Unhandled fetch ${url} ${init?.method ?? 'GET'}`))
    }) as jest.Mock
  })

  it('submits the refund decision payload from the rental payments modal', async () => {
    const user = userEvent.setup()

    render(<VenuePayoutsPage />)

    expect(await screen.findByText('Rental payments received')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Decide on refund/i }))
    await user.click(screen.getByRole('button', { name: /^counter$/i }))
    await user.clear(screen.getByLabelText(/Counter amount/i))
    await user.type(screen.getByLabelText(/Counter amount/i), '150.00')
    await user.type(screen.getByLabelText(/Venue note/i), 'Approving a lower amount for the unused portion.')
    await user.click(screen.getByRole('button', { name: /Submit decision/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/venue/rentals/tx-rental/refund-decision', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          decision: 'counter',
          note: 'Approving a lower amount for the unused portion.',
          counter_amount_cents: 15000,
        }),
      }))
    })
  })

  it('uploads POS proof from the venue settlement ledger', async () => {
    const user = userEvent.setup()

    render(<VenuePayoutsPage />)

    expect(await screen.findByText('Settlement ledger')).toBeInTheDocument()
    expect(await screen.findByText('POS proof needed')).toBeInTheDocument()

    await user.upload(
      screen.getByLabelText(/Upload POS proof/i),
      new File(['Net sales,4280.00'], 'square.csv', { type: 'text/csv' })
    )
    await user.type(screen.getByLabelText(/Verified revenue/i), '4280.00')
    await user.click(screen.getByRole('button', { name: /Submit proof/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/venue/community-host-incentive/agreement-pos/spend-report', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }))
    })
    const spendReportCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/venue/community-host-incentive/agreement-pos/spend-report')
    const formData = spendReportCall?.[1].body as FormData
    expect(formData.get('reported_revenue_cents_override')).toBe('428000')
    expect(formData.get('image')).toBeInstanceOf(File)
    expect(await screen.findByText(/Revenue extracted/i)).toBeInTheDocument()
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
