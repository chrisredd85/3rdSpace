'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type RefundCalculation = {
  platform_fee_refund: number
  vendor_service_refund: number
  total_refund: number
  days_until_event: number
  refund_breakdown: {
    platform_fee: {
      reason: string
    }
    vendor_service: {
      reason: string
      terms?: string | null
    }
  }
}

interface CancelBookingModalProps {
  bookingId: string
  onCancel: () => void
  onComplete: () => void
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`
}

/**
 * Presents cancellation policy details and processes a booking refund after builder confirmation.
 */
export function CancelBookingModal({ bookingId, onCancel, onComplete }: CancelBookingModalProps) {
  const [step, setStep] = useState<'calculate' | 'confirm' | 'processing'>('calculate')
  const [refundCalc, setRefundCalc] = useState<RefundCalculation | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads the server-side refund estimate for this booking.
     */
    async function calculateRefund() {
      setError(null)

      try {
        const res = await fetch('/api/payments/refund/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        })
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Failed to calculate refund')
        if (!isMounted) return

        setRefundCalc(data)
        setStep('confirm')
      } catch (refundError) {
        if (!isMounted) return
        setError(refundError instanceof Error ? refundError.message : 'Failed to calculate refund')
        setStep('confirm')
      }
    }

    calculateRefund()

    return () => {
      isMounted = false
    }
  }, [bookingId])

  /**
   * Confirms cancellation and asks the server to process all eligible refunds.
   */
  async function processRefund() {
    setError(null)
    setStep('processing')

    try {
      const res = await fetch('/api/payments/refund/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, reason }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Refund failed')

      onComplete()
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : 'Failed to process refund')
      setStep('confirm')
    }
  }

  if (step === 'calculate') {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Calculating refund...</span>
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div className="py-8 text-center">
        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
        <p className="font-semibold text-foreground">Processing your cancellation...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-yellow-500/30 bg-yellow-500/10 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-6 w-6 flex-shrink-0 text-yellow-200" />
          <div>
            <h3 className="font-bold text-yellow-100">Cancel This Booking?</h3>
            <p className="mt-1 text-sm text-yellow-200">
              Refunds will be processed according to the platform and vendor cancellation policies.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      ) : null}

      {refundCalc ? (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Refund Breakdown</h4>

          <div className="space-y-3 rounded-lg bg-background p-4">
            <div>
              <div className="flex justify-between gap-4">
                <span>Platform Fee Refund</span>
                <span className="font-semibold">{formatCurrency(refundCalc.platform_fee_refund)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{refundCalc.refund_breakdown.platform_fee.reason}</p>
            </div>

            <div>
              <div className="flex justify-between gap-4">
                <span>Vendor Service Refund</span>
                <span className="font-semibold">{formatCurrency(refundCalc.vendor_service_refund)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{refundCalc.refund_breakdown.vendor_service.reason}</p>
              {refundCalc.refund_breakdown.vendor_service.terms ? (
                <p className="mt-1 text-xs text-muted-foreground">{refundCalc.refund_breakdown.vendor_service.terms}</p>
              ) : null}
            </div>

            <div className="flex justify-between gap-4 border-t border-border pt-3 text-lg">
              <span className="font-bold">Total Refund</span>
              <span className="font-bold text-emerald-300">{formatCurrency(refundCalc.total_refund)}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{refundCalc.days_until_event} days until event</p>
        </div>
      ) : null}

      <div>
        <label htmlFor="cancellation-reason" className="mb-2 block font-semibold text-foreground">
          Cancellation Reason
        </label>
        <textarea
          id="cancellation-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Please explain why you are cancelling..."
          rows={3}
          className="w-full rounded-xl border border-border bg-card/40 px-4 py-2 text-foreground outline-none transition-smooth placeholder:text-muted-foreground hover:bg-card focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button onClick={onCancel} variant="secondary" type="button">
          Keep Booking
        </Button>
        <Button
          onClick={processRefund}
          variant="destructive"
          disabled={!reason.trim() || !refundCalc}
          type="button"
        >
          Cancel & Refund {formatCurrency(refundCalc?.total_refund || 0)}
        </Button>
      </div>
    </div>
  )
}
