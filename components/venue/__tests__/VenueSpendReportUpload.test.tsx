import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  VenueSpendReportUpload,
  parseDollarsToCents,
} from '@/components/venue/VenueSpendReportUpload'

describe('VenueSpendReportUpload', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects unsupported POS proof file types before upload', async () => {
    render(
      <VenueSpendReportUpload
        settlement={{
          id: 'agreement:settlement-1',
          agreement_id: 'settlement-1',
          status: 'revenue_report_needed',
          currency: 'usd',
          proof_status: 'needed',
        }}
      />
    )

    fireEvent.change(screen.getByLabelText(/Upload POS proof/i), {
      target: {
        files: [new File(['bad'], 'notes.txt', { type: 'text/plain' })],
      },
    })

    expect(await screen.findByText(/Unsupported file type/i)).toBeInTheDocument()
  })

  it('submits supported proof files and manual revenue as integer cents', async () => {
    const user = userEvent.setup()
    const onUploaded = jest.fn()
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      extracted_value: 428000,
      confidence: 'high',
      reasoning: 'Net sales was clearly labeled.',
      calculated_owed_cents: 51360,
      payment_id: 'payment-1',
      extraction_status: 'extracted',
      review_status: 'ready_for_invoice_review',
      uploaded_proof: {
        filename: 'square.csv',
        mime_type: 'text/csv',
        size_bytes: 18,
        path: 'settlement-1/square.csv',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    global.fetch = fetchMock

    render(
      <VenueSpendReportUpload
        settlement={{
          id: 'agreement:settlement-1',
          agreement_id: 'settlement-1',
          status: 'revenue_report_needed',
          currency: 'usd',
          proof_status: 'needed',
        }}
        onUploaded={onUploaded}
      />
    )

    await user.upload(
      screen.getByLabelText(/Upload POS proof/i),
      new File(['Net sales,4280.00'], 'square.csv', { type: 'text/csv' })
    )
    await user.type(screen.getByLabelText(/Verified revenue/i), '4280.00')
    await user.click(screen.getByRole('button', { name: /Submit proof/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/venue/community-host-incentive/settlement-1/spend-report', expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }))
    })
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('reported_revenue_cents_override')).toBe('428000')
    expect(body.get('image')).toBeInstanceOf(File)
    expect(await screen.findByText(/Revenue extracted/i)).toBeInTheDocument()
    expect(screen.getByText(/Settlement impact: \$513.60/i)).toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('parses decimal dollars without storing float values', () => {
    expect(parseDollarsToCents('4,280.25')).toBe(428025)
    expect(parseDollarsToCents('$0.99')).toBe(99)
    expect(parseDollarsToCents('12.999')).toBeNull()
  })
})
