jest.mock('server-only', () => ({}))

jest.mock('@/lib/finance/calculate-event-financials', () => ({
  recalculateEventFinancials: jest.fn().mockResolvedValue({}),
}))

import { processLumaWebhook } from '@/lib/server/ticket-webhooks'

type Row = Record<string, any>

describe('Luma webhook normalization', () => {
  it('writes analytics-ready sale and attendee rows idempotently', async () => {
    const db = new MemoryDb()
    const context = {
      integrationId: 'integration-1',
      eventId: 'event-1',
      builderId: 'builder-1',
      builderConnectionId: 'connection-1',
      externalEventId: 'luma-event-1',
      config: {},
    }
    const payload = {
      type: 'ticket.registered',
      event_id: 'luma-event-1',
      order_id: 'order-1',
      ticket_buyer_name: 'Julian Taylor',
      ticket_buyer_email: 'julian@example.com',
      ticket_quantity: 2,
      ticket_type: 'Founder ticket',
      ticket_price: 79,
      total_amount: 158,
      fees: 4.75,
      currency: 'USD',
      purchase_timestamp: '2026-07-01T18:00:00.000Z',
      data: {
        guest: {
          id: 'guest-1',
          name: 'Julian Taylor',
          email: 'julian@example.com',
        },
      },
    }

    const first = await processLumaWebhook(db, payload, context, 'webhook-1')
    const second = await processLumaWebhook(db, payload, context, 'webhook-1')

    expect(first).toMatchObject({ processed: true, salesUpserted: 1, attendeesUpserted: 1 })
    expect(second).toMatchObject({ processed: true, salesUpserted: 1, attendeesUpserted: 1 })
    expect(db.rows.event_sales_data).toHaveLength(1)
    expect(db.rows.event_sales_data[0]).toMatchObject({
      event_id: 'event-1',
      integration_id: 'integration-1',
      order_id: 'luma-event-1:order-1',
      platform: 'luma',
      ticket_quantity: 2,
      ticket_tier_name: 'Founder ticket',
      ticket_tier_category: 'vip',
      total_amount_cents: 15800,
      fees_cents: 475,
      source: 'luma_webhook',
      gross_cents: 15800,
      tier_name: 'Founder ticket',
    })
    expect(db.rows.event_sales_data[0].received_at).toEqual(expect.any(String))
    expect(db.rows.imported_attendees).toHaveLength(1)
  })
})

class MemoryDb {
  rows: Record<string, Row[]> = {
    event_sales_data: [],
    imported_attendees: [],
  }

  from(table: string) {
    return {
      upsert: (payload: Row | Row[], options?: { onConflict?: string }) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        const target = this.rows[table] ?? []
        for (const row of rows) {
          const conflictKeys = options?.onConflict?.split(',').map((key) => key.trim()).filter(Boolean) ?? []
          const existingIndex = conflictKeys.length
            ? target.findIndex((existing) => conflictKeys.every((key) => existing[key] === row[key]))
            : -1
          if (existingIndex >= 0) {
            target[existingIndex] = { ...target[existingIndex], ...row }
          } else {
            target.push(row)
          }
        }
        this.rows[table] = target
        return Promise.resolve({ data: null, error: null })
      },
    }
  }
}
