'use client'

import { useState } from 'react'
import { AlertCircle, Loader2, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type RefundRequestModalProps = {
  isOpen: boolean
  bookingId?: string
  transactionId?: string
  maxAmount?: number
  onClose: () => void
  onRefunded?: (transaction: unknown) => void
}

/**
 * Processes a cancellation refund against a vendor booking transaction.
 */
export function RefundRequestModal({
  isOpen,
  bookingId,
  transactionId,
  maxAmount,
  onClose,
  onRefunded,
}: RefundRequestModalProps) {
  const [amount, setAmount] = useState(maxAmount?.toString() || '')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const submitRefund = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const parsedAmount = amount ? Number(amount) : undefined
      const response = await fetch('/api/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bookingId,
          transactionId,
          amount: Number.isFinite(parsedAmount) ? parsedAmount : undefined,
          reason,
        }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Refund could not be processed.')

      onRefunded?.(data.transaction)
      onClose()
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : 'Refund could not be processed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card/40 shadow-xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">Process refund</h2>
            <p className="mt-1 text-sm text-muted-foreground">Refund policy should be reviewed before returning funds.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-foreground">
            Refund amount
            <Input
              className="mt-2"
              type="number"
              min="0"
              max={maxAmount}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={maxAmount ? maxAmount.toFixed(2) : '0.00'}
            />
          </label>

          <label className="block text-sm font-semibold text-foreground">
            Reason
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          </label>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submitRefund} disabled={isSubmitting || (!bookingId && !transactionId)}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Refund
          </Button>
        </div>
      </div>
    </div>
  )
}
