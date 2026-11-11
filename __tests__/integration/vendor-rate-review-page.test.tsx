import { render, screen, within } from '@testing-library/react'
import VendorRateReviewPage from '@/app/admin/discovery/vendor-rate-review/page'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { independentVendorEvidence, SAFE_VENDOR_TABLE } from '@/lib/discovery/vendorRepository'

jest.mock('@/lib/server/admin-auth', () => ({ getAdminContext: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }))
jest.mock('@/app/admin/discovery/vendor-rate-review/actions', () => ({
  approveRate: jest.fn(), rejectRate: jest.fn(), editRate: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn(() => { throw new Error('redirect') }) }))

const evidence = independentVendorEvidence('venue_site', 'https://vendor.example/rates', '2026-11-10T00:00:00Z')
const baseRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Independent caterer', inferred_hourly_rate_cents: 0, inferred_package_rate_cents: 70000,
  inferred_minimum_cents: null, rate_inference_admin_status: 'pending',
  field_provenance: { name: evidence, inferred_hourly_rate_cents: evidence, inferred_package_rate_cents: evidence },
}

function database(rows: unknown[]) {
  const query = { select: jest.fn(), or: jest.fn(), order: jest.fn(), limit: jest.fn() }
  query.select.mockReturnValue(query)
  query.or.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.limit.mockResolvedValue({ data: rows, error: null })
  const from = jest.fn().mockReturnValue(query)
  jest.mocked(createServiceRoleClient).mockReturnValue({ from } as never)
  return { ...query, from }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getAdminContext).mockResolvedValue({ authorized: true, user: { id: 'admin', email: 'admin@example.com' } })
})

it('reads the safe view with evidence and renders known zero separately from unavailable amounts', async () => {
  const query = database([baseRow])
  render(await VendorRateReviewPage())
  expect(query.from).toHaveBeenCalledWith(SAFE_VENDOR_TABLE)
  expect(query.select.mock.calls[0][0].split(',')).toContain('field_provenance')
  expect(screen.getByRole('heading', { name: 'Independent caterer' })).toBeInTheDocument()
  expect(screen.getByLabelText('Hourly cents')).toHaveValue(0)
  expect(screen.getByLabelText('Package cents')).toHaveValue(70000)
  expect(screen.getByLabelText('Minimum cents')).toHaveValue(null)
  expect(screen.getByLabelText('Package cents')).toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: 'Save review' })).toBeEnabled()
})

it('does not render legacy/Google amounts or offer unsupported overrides', async () => {
  database([{ ...baseRow, field_provenance: {}, rate_inference_confidence: 1, rate_inference_source_quote: 'Unproven quote' }])
  const { container } = render(await VendorRateReviewPage())
  expect(screen.getByRole('heading', { name: 'Vendor name unavailable' })).toBeInTheDocument()
  expect(screen.getByLabelText('Package cents')).toHaveValue(null)
  expect(screen.getByRole('button', { name: 'Save review' })).toBeDisabled()
  expect(within(container).queryByText('Unproven quote')).not.toBeInTheDocument()
  expect(container).not.toHaveTextContent('100%')
  // Reviewing status remains possible without manufacturing fact evidence.
  expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
})

it('does not create a privileged client when the page is unauthorized', async () => {
  jest.mocked(getAdminContext).mockResolvedValue({ authorized: false, status: 403, error: 'Admin access required' })
  render(await VendorRateReviewPage())
  expect(screen.getByRole('heading', { name: 'Access required' })).toBeInTheDocument()
  expect(createServiceRoleClient).not.toHaveBeenCalled()
})
