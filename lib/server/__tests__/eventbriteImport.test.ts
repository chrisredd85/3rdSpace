jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/eventbrite', () => ({
  fetchEventbriteAttendeePage: jest.fn(),
  getEventbriteAccessToken: jest.fn(),
}))

import { mapEventbriteSale } from '@/lib/server/eventbrite-import'

describe('Eventbrite import mapping', () => {
  it('maps refunded attendees into negative refund sale rows', () => {
    const sale = mapEventbriteSale('integration-1', 'event-1', {
      id: 'attendee-1',
      order_id: 'order-1',
      status: 'refunded',
      ticket_class_name: 'GA',
      ticket_class_id: 'tier-1',
      refunded_at: '2026-07-05T18:00:00.000Z',
      costs: {
        gross: { minor_value: 4000, currency: 'USD' },
        eventbrite_fee: { minor_value: 250, currency: 'USD' },
        payment_fee: { minor_value: 150, currency: 'USD' },
      },
      profile: {
        first_name: 'Alex',
        last_name: 'Rivera',
        email: 'alex@example.com',
      },
    })

    expect(sale).toEqual(expect.objectContaining({
      order_id: 'order-1:attendee-1',
      is_refund: true,
      ticket_quantity: -1,
      total_amount_cents: -4000,
      fees_cents: -400,
      purchase_timestamp: '2026-07-05T18:00:00.000Z',
    }))
  })
})
