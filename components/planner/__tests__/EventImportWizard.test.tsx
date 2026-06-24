import { render, screen, waitFor } from '@testing-library/react'
import { EventImportWizard } from '@/components/planner/EventImportWizard'

const mockUseSearchParams = jest.fn()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}))

jest.mock('@/components/planner/CsvColumnMapper', () => ({
  CsvColumnMapper: () => <div>CSV mapper</div>,
}))

const originalFetch = global.fetch

describe('EventImportWizard', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''))
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ connections: [] })) as jest.Mock
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('preselects the import source from the query string', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('source=posh'))

    render(<EventImportWizard />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/integrations/ticketing/connections', { cache: 'no-store' }))
    expect(screen.getByRole('button', { name: /Posh Webhook or CSV/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Luma Guest list CSV/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('falls back to Luma when the query source is not supported', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('source=unknown'))

    render(<EventImportWizard />)

    expect(screen.getByRole('button', { name: /Luma Guest list CSV/i })).toHaveAttribute('aria-pressed', 'true')
  })
})

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
