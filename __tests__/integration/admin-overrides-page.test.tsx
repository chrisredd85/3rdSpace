import { render, screen, within } from '@testing-library/react'
import AdminOverridesPage from '@/app/admin/overrides/page'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/server/admin-auth', () => ({ getAdminContext: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn(() => { throw new Error('redirect') }) }))

const baseRow = {
  id: '11111111-1111-4111-8111-111111111111',
  plan_id: '22222222-2222-4222-8222-222222222222',
  reference_id: '33333333-3333-4333-8333-333333333333',
  type: 'venue', external_name: 'Original recommendation', price_cents: 70000,
  rank: 1, is_best_fit: true, status: 'pending', created_at: '2026-11-01T12:00:00Z',
}
const marker = {
  venue_content_unavailable: true,
  unavailable_code: 'legacy_discovery_evidence_missing',
}

function database(rows: unknown[]) {
  const query = { select: jest.fn(), order: jest.fn(), limit: jest.fn() }
  query.select.mockReturnValue(query)
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

it('selects the marker and retains retired identity/history without stale recommendation presentation', async () => {
  const query = database([{ ...baseRow, metadata: { ...marker, reason_summary: 'Unproven recommendation prose' } }])
  const { container } = render(await AdminOverridesPage())
  expect(query.from).toHaveBeenCalledWith('recommendations')
  expect(query.select.mock.calls[0][0].split(',').map((column: string) => column.trim())).toContain('metadata')
  const row = screen.getByText(baseRow.reference_id).closest('tr')!
  const cells = within(row).getAllByRole('cell')
  expect(cells[2]).toHaveTextContent('—')
  expect(cells[3]).toHaveTextContent('—')
  expect(cells[4]).toHaveTextContent('Unavailable')
  expect(cells[5]).toHaveTextContent(new Date(baseRow.created_at).toLocaleDateString())
  expect(container).not.toHaveTextContent(baseRow.external_name)
  expect(container).not.toHaveTextContent('Unproven recommendation prose')
  expect(container.querySelector(`[title="${baseRow.external_name}"]`)).toBeNull()
})

it.each([
  undefined,
  {},
  { venue_content_unavailable: true },
  { ...marker, venue_content_unavailable: false },
  { ...marker, unavailable_code: 'another_reason' },
])('keeps existing name/rank/best/status presentation without the exact marker: %j', async (metadata) => {
  database([{ ...baseRow, metadata }])
  render(await AdminOverridesPage())
  const row = screen.getByText(baseRow.external_name).closest('tr')!
  const cells = within(row).getAllByRole('cell')
  expect(cells[2]).toHaveTextContent('1')
  expect(cells[3]).toHaveTextContent('Yes')
  expect(cells[4]).toHaveTextContent('pending')
  expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
})

it('keeps the admin authorization gate before the privileged client', async () => {
  jest.mocked(getAdminContext).mockResolvedValue({ authorized: false, status: 403, error: 'Admin access required' })
  render(await AdminOverridesPage())
  expect(screen.getByRole('heading', { name: 'Access required' })).toBeInTheDocument()
  expect(createServiceRoleClient).not.toHaveBeenCalled()
})
