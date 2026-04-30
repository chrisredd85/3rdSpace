'use client'

import { useMemo, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'

type InvoiceLineItem = {
  description: string
  quantity: number
  unit_price: number
  total: number
}

type InvoicePreviewProps = {
  bookingId: string
  vendorName?: string | null
  clientName?: string | null
  eventName?: string | null
  lineItems: InvoiceLineItem[]
  taxRate?: number
  depositAmount?: number
  onGenerated?: (invoice: unknown) => void
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Shows an invoice draft before generating the persistent invoice.
 */
export function InvoicePreview({
  bookingId,
  vendorName,
  clientName,
  eventName,
  lineItems,
  taxRate = 0,
  depositAmount = 0,
  onGenerated,
}: InvoicePreviewProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invoice = useMemo(() => {
    const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.total, 0))
    const taxAmount = roundMoney(subtotal * (taxRate / 100))
    const total = roundMoney(subtotal + taxAmount)

    return {
      invoice_number: 'Draft',
      line_items: lineItems,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      deposit_amount: Math.min(depositAmount, total),
      final_amount: Math.max(total - depositAmount, 0),
      status: 'draft',
      created_at: new Date().toISOString(),
    }
  }, [depositAmount, lineItems, taxRate])

  const generateInvoice = async () => {
    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/vendor/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bookingId, lineItems, taxRate }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to generate invoice')

      onGenerated?.(data.invoice)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Unable to generate invoice')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <InvoicePDF
        invoice={invoice}
        vendorName={vendorName}
        clientName={clientName}
        eventName={eventName}
      />

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <Button type="button" onClick={generateInvoice} disabled={isGenerating}>
        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
        Generate invoice
      </Button>
    </div>
  )
}
