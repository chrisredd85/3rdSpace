import { render, screen } from '@testing-library/react'
import { DiscoveryFieldValue } from '../DiscoveryFieldValue'
import { readDiscoveryFields } from '@/lib/discovery/foundation/reader'
import type { DiscoveryValue } from '@/lib/discovery/foundation/fields'

describe('dormant discovery value view', () => {
  it.each(['missing', 'invalid', 'unresolved', 'google_content'] as const)('renders %s as unavailable, not a blank or invented zero', reason => {
    render(<DiscoveryFieldValue label="Capacity" field={{ status: 'unavailable', reason }} />)
    expect(screen.getByLabelText('Capacity: unavailable')).toHaveTextContent('Unavailable')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('reads and renders a legacy row without field evidence', () => {
    const fields = readDiscoveryFields('venue', { id: 'legacy', name: 'Old label', capacity_seated: 60 })
    render(<DiscoveryFieldValue label="Capacity" field={fields.capacity_seated} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it.each<[DiscoveryValue, string]>([[0, '0'], [false, 'No'], [[], 'None']])('retains a known value %p', (value, text) => {
    render(<DiscoveryFieldValue label="Value" field={{ status: 'available', value,
      provenance: { resolution: 'resolved', source: 'host_input', evidence_reference: 'host:1',
        collected_at: '2026-09-22T12:00:00Z', confidence: null, confirmation_status: 'unconfirmed', lineage: [] },
    }} />)
    expect(screen.getByLabelText('Value')).toHaveTextContent(text)
  })
})
