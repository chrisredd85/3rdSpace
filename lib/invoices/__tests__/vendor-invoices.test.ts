jest.mock('server-only', () => ({}))

jest.mock('@/lib/billing/builder-billing', () => ({
  BUILDER_BILLING_PRICES: {
    payPerEventAmount: 30,
  },
}))

import {
  buildDefaultLineItems,
  buildInvoiceLineItemsWithPlatformFee,
  calculateInvoiceTotals,
  formatCurrency,
  getInvoiceStatus,
  normalizeLineItems,
  renderInvoiceHtml,
  type VendorInvoice,
} from '@/lib/invoices/vendor-invoices'

describe('vendor invoice helpers', () => {
  it('builds default vendor service line items from booking price', () => {
    const [lineItem] = buildDefaultLineItems(
      { final_price: '500' },
      { offering_name: 'Photography', duration_hours: 4 }
    )

    expect(lineItem).toEqual({
      description: 'Photography (4 hours)',
      quantity: 1,
      unit_price: 500,
      total: 500,
    })
  })

  it('adds pay-per-event or Pro platform fee line items', () => {
    expect(
      buildInvoiceLineItemsWithPlatformFee({
        booking: { quoted_price: 1000 },
        platformFee: 30,
        isPro: false,
      })
    ).toContainEqual({
      description: '3rdSpace Booking Fee',
      quantity: 1,
      unit_price: 30,
      total: 30,
    })

    expect(
      buildInvoiceLineItemsWithPlatformFee({
        booking: { quoted_price: 1000 },
        platformFee: 0,
        isPro: true,
      })
    ).toContainEqual({
      description: '3rdSpace Booking Fee (Pro - Free)',
      quantity: 1,
      unit_price: 0,
      total: 0,
    })
  })

  it('normalizes line items and calculates rounded totals', () => {
    const items = normalizeLineItems([
      { description: 'Catering', quantity: '2', unit_price: '125.255' },
      { description: 'Setup', quantity: 1, unit_price: 50, total: 49.999 },
    ])

    expect(items).toEqual([
      { description: 'Catering', quantity: 2, unit_price: 125.255, total: 250.51 },
      { description: 'Setup', quantity: 1, unit_price: 50, total: 50 },
    ])
    expect(calculateInvoiceTotals(items, 8.5)).toEqual({
      subtotal: 300.51,
      taxAmount: 25.54,
      total: 326.05,
    })
  })

  it('computes invoice status from paid and due state', () => {
    expect(getInvoiceStatus({ depositPaid: true, finalPaid: true })).toBe('paid')
    expect(getInvoiceStatus({ depositPaid: false, finalPaid: false, sentAt: '2026-01-01T00:00:00Z' })).toBe('sent')
    expect(getInvoiceStatus({ depositPaid: false, finalPaid: false, finalDueDate: '2020-01-01' })).toBe('overdue')
    expect(getInvoiceStatus({ depositPaid: false, finalPaid: false })).toBe('draft')
  })

  it('escapes user-provided values in rendered invoice HTML', () => {
    const invoice = {
      id: 'invoice-1',
      booking_id: 'booking-1',
      vendor_id: 'vendor-1',
      event_id: 'event-1',
      builder_id: 'builder-1',
      invoice_number: 'INV-001',
      line_items: [{ description: '<script>alert(1)</script>', quantity: 1, unit_price: 100, total: 100 }],
      subtotal: 100,
      tax_rate: 0,
      tax_amount: 0,
      total: 100,
      deposit_amount: 25,
      deposit_due_date: '2026-05-01',
      deposit_paid: false,
      deposit_paid_at: null,
      final_amount: 75,
      final_due_date: '2026-05-15',
      final_paid: false,
      final_paid_at: null,
      status: 'sent',
      pdf_url: null,
      sent_at: '2026-04-29T00:00:00Z',
      created_at: '2026-04-29T00:00:00Z',
      updated_at: '2026-04-29T00:00:00Z',
    } satisfies VendorInvoice

    const html = renderInvoiceHtml({
      invoice,
      vendor: { name: '<Vendor>' },
      event: { event_name: '<Launch>' },
      builder: { name: '<Builder>' },
    })

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;Vendor&gt;')
    expect(html).toContain(formatCurrency(100))
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
