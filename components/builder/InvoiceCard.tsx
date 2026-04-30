'use client'

import { Download, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface InvoiceCardProps {
  invoice: {
    invoice_number: string
    total: number
    status: string
    created_at: string
    pdf_url: string | null
  }
}

/**
 * Formats a dollar amount for invoice cards.
 *
 * @param amount - Numeric invoice amount.
 * @returns Formatted USD amount.
 */
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

/**
 * Formats an invoice creation date for compact display.
 *
 * @param value - ISO timestamp or date string.
 * @returns Localized date string.
 */
function formatDate(value: string) {
  return new Date(value).toLocaleDateString()
}

/**
 * Displays a builder-facing invoice summary with view and download actions.
 *
 * @param props - Invoice row to display.
 * @returns Invoice card UI.
 */
export function InvoiceCard({ invoice }: InvoiceCardProps) {
  const canOpenPdf = Boolean(invoice.pdf_url)

  /**
   * Downloads the invoice PDF using the browser's anchor download flow.
   */
  function downloadInvoice() {
    if (!invoice.pdf_url) return

    const link = document.createElement('a')
    link.href = invoice.pdf_url
    link.download = `${invoice.invoice_number}.pdf`
    link.click()
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border-2 border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h4 className="font-bold text-foreground">{invoice.invoice_number}</h4>
        <p className="text-sm text-muted-foreground">{formatDate(invoice.created_at)}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">{formatCurrency(invoice.total)}</p>
        <span
          className={`mt-2 inline-block rounded px-2 py-1 text-xs font-semibold ${
            invoice.status === 'paid'
              ? 'bg-accent/15 text-accent'
              : invoice.status === 'sent'
                ? 'bg-primary/15 text-foreground'
                : 'bg-sidebar-accent/40 text-foreground'
          }`}
        >
          {invoice.status.toUpperCase()}
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canOpenPdf}
          onClick={() => invoice.pdf_url && window.open(invoice.pdf_url, '_blank')}
        >
          <Eye className="mr-2 h-4 w-4" />
          View
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canOpenPdf}
          onClick={downloadInvoice}
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </Button>
      </div>
    </div>
  )
}
