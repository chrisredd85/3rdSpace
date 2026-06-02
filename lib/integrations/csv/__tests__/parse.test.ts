jest.mock('server-only', () => ({}))

import {
  normalizeAttendeeRows,
  normalizeSalesRows,
  parseCsvImport,
} from '@/lib/integrations/csv/parse'

describe('event import CSV parser', () => {
  it('imports a Posh sales CSV with high csv_import confidence', () => {
    const csv = [
      'Order ID,Buyer Name,Buyer Email,Quantity,Ticket Type,Total,Fees,Currency,Purchase Date',
      'order-1,Maya Host,maya@example.com,2,General Admission,50.00,3.50,USD,2026-06-02T18:00:00Z',
    ].join('\n')
    const parsed = parseCsvImport(csv, 'sales')
    const rows = normalizeSalesRows({
      rows: parsed.rows,
      mapping: parsed.mapping.mapping,
      source: 'posh',
    })

    expect(parsed.mapping.needsMapping).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      order_id: 'posh:order-1',
      platform: 'posh',
      ticket_quantity: 2,
      total_amount_cents: 5000,
      fees_cents: 350,
      source: 'csv_import',
      field_confidence: {
        order_id: { confidence: 'high', source: 'csv_import' },
        total_amount: { confidence: 'high', source: 'csv_import' },
      },
    })
  })

  it('surfaces mapping for a Luma guest list with non-standard column names, then imports after mapping', () => {
    const csv = [
      'Guest,Contact,Arrived?,Pass,Scan time',
      'Ari Lee,ari@example.com,yes,Early Bird,2026-06-02T19:00:00Z',
    ].join('\n')
    const parsed = parseCsvImport(csv, 'attendees')

    expect(parsed.mapping.needsMapping).toBe(true)
    expect(parsed.mapping.missingRequired).toContain('email')

    const remapped = parseCsvImport(csv, 'attendees', {
      full_name: 'Guest',
      email: 'Contact',
      checked_in: 'Arrived?',
      ticket_type: 'Pass',
      check_in_time: 'Scan time',
    })
    const rows = normalizeAttendeeRows({
      rows: remapped.rows,
      mapping: remapped.mapping.mapping,
      source: 'luma',
    })

    expect(remapped.mapping.needsMapping).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      external_attendee_id: 'luma:ari@example.com',
      first_name: 'Ari',
      last_name: 'Lee',
      email: 'ari@example.com',
      checked_in: true,
      ticket_tier_name: 'Early Bird',
      field_confidence: {
        email: { confidence: 'high', source: 'csv_import' },
        checked_in: { confidence: 'high', source: 'csv_import' },
      },
    })
  })
})
