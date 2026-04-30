'use client'

type InvoiceLineItem = {
  description: string
  quantity: number
  unit_price: number
  total: number
}

type InvoicePDFProps = {
  invoice: {
    invoice_number: string
    line_items: InvoiceLineItem[]
    subtotal: number
    tax_rate: number
    tax_amount: number
    total: number
    deposit_amount: number
    deposit_due_date?: string | null
    final_amount: number
    final_due_date?: string | null
    status: string
    created_at?: string
  }
  vendorName?: string | null
  vendorAddress?: string | null
  clientName?: string | null
  clientEmail?: string | null
  eventName?: string | null
  paymentTerms?: string | null
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value || 0))
}

function formatDate(value?: string | null) {
  if (!value) return 'TBD'
  const date = value.includes('T') ? value : `${value}T00:00:00`
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Styled invoice template used for previews and PDF parity.
 */
export function InvoicePDF({
  invoice,
  vendorName,
  vendorAddress,
  clientName,
  clientEmail,
  eventName,
  paymentTerms,
}: InvoicePDFProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40 shadow-sm">
      <div className="flex flex-col gap-4 bg-sidebar p-6 text-white sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">INVOICE</h1>
          <p className="mt-2 text-sm text-muted-foreground/80">Invoice #: {invoice.invoice_number}</p>
          <p className="text-sm text-muted-foreground/80">Date: {formatDate(invoice.created_at)}</p>
        </div>
        <div className="text-left sm:text-right">
          <span className="inline-flex rounded-md bg-primary-foreground/10 px-2 py-1 text-xs font-bold uppercase">
            {invoice.status}
          </span>
          <p className="mt-3 font-semibold">{vendorName || 'Vendor'}</p>
          {vendorAddress ? <p className="text-sm text-muted-foreground/80">{vendorAddress}</p> : null}
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-border p-4">
            <h2 className="text-sm font-bold text-foreground">Vendor</h2>
            <p className="mt-2 font-semibold text-foreground">{vendorName || 'Vendor'}</p>
            {vendorAddress ? <p className="text-sm text-muted-foreground">{vendorAddress}</p> : null}
          </section>
          <section className="rounded-lg border border-border p-4">
            <h2 className="text-sm font-bold text-foreground">Bill To</h2>
            <p className="mt-2 font-semibold text-foreground">{clientName || 'Client'}</p>
            {clientEmail ? <p className="text-sm text-muted-foreground">{clientEmail}</p> : null}
            {eventName ? <p className="text-sm text-muted-foreground">{eventName}</p> : null}
          </section>
        </div>

        <section>
          <h2 className="text-sm font-bold text-foreground">Line Items</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="py-2 pl-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((item) => (
                  <tr key={`${item.description}-${item.total}`} className="border-b border-border">
                    <td className="py-3 pr-3 text-foreground">{item.description}</td>
                    <td className="px-3 py-3 text-right text-muted-foreground">{item.quantity}</td>
                    <td className="px-3 py-3 text-right text-muted-foreground">{formatCurrency(item.unit_price)}</td>
                    <td className="py-3 pl-3 text-right font-semibold text-foreground">{formatCurrency(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="ml-auto max-w-sm space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold">{formatCurrency(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Tax ({invoice.tax_rate}%)</span>
            <span className="font-semibold">{formatCurrency(invoice.tax_amount)}</span>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-3 text-lg font-bold">
            <span>Total</span>
            <span>{formatCurrency(invoice.total)}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg bg-background p-4">
            <h2 className="text-sm font-bold text-foreground">Deposit Due</h2>
            <p className="mt-2 text-xl font-bold text-foreground">{formatCurrency(invoice.deposit_amount)}</p>
            <p className="text-sm text-muted-foreground">Due: {formatDate(invoice.deposit_due_date)}</p>
          </section>
          <section className="rounded-lg bg-background p-4">
            <h2 className="text-sm font-bold text-foreground">Balance Due</h2>
            <p className="mt-2 text-xl font-bold text-foreground">{formatCurrency(invoice.final_amount)}</p>
            <p className="text-sm text-muted-foreground">Due: {formatDate(invoice.final_due_date)}</p>
          </section>
        </div>

        {paymentTerms ? (
          <section className="border-t border-border pt-4">
            <h2 className="text-sm font-bold text-foreground">Payment Terms</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{paymentTerms}</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
