'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SendInvoiceModal } from '@/components/invoices/SendInvoiceModal'

type InvoiceHistoryItem = {
  id: string
  invoice_number: string
  total: number
  status: string
  created_at: string
  sent_at?: string | null
  pdf_url?: string | null
}

type InvoiceHistoryProps = {
  vendorId?: string
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0)
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Lists generated vendor invoices with download and send actions.
 */
export function InvoiceHistory({ vendorId }: InvoiceHistoryProps) {
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sendingInvoice, setSendingInvoice] = useState<InvoiceHistoryItem | null>(null)

  useEffect(() => {
    async function loadInvoices() {
      setLoading(true)
      setError(null)

      try {
        const query = vendorId ? `?vendorId=${vendorId}` : ''
        const response = await fetch(`/api/vendor/invoices${query}`, {
          credentials: 'include',
        })
        const data = await response.json()

        if (!response.ok) throw new Error(data.error || 'Unable to load invoices')

        setInvoices(data.invoices || [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load invoices')
      } finally {
        setLoading(false)
      }
    }

    loadInvoices()
  }, [vendorId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invoices...
      </div>
    )
  }

  if (error) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
  }

  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-8 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-3 font-semibold text-foreground">No invoices yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Generated booking invoices will appear here.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="divide-y divide-border">
        {invoices.map((invoice) => (
          <div key={invoice.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-foreground">{invoice.invoice_number}</p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(invoice.total)} · {invoice.status} · {formatDate(invoice.created_at)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.assign(invoice.pdf_url || `/api/vendor/invoices/${invoice.id}/pdf`)}>
                <Download className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button type="button" size="sm" onClick={() => setSendingInvoice(invoice)}>
                <Send className="mr-2 h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        ))}
      </div>

      {sendingInvoice ? (
        <SendInvoiceModal
          invoiceId={sendingInvoice.id}
          invoiceNumber={sendingInvoice.invoice_number}
          isOpen={Boolean(sendingInvoice)}
          onClose={() => setSendingInvoice(null)}
          onSent={() => setSendingInvoice(null)}
        />
      ) : null}
    </div>
  )
}
