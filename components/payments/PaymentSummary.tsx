'use client'

type PaymentSummaryProps = {
  subtotal: number
  depositAmount?: number
  amountDue: number
  platformFee?: number
  paymentType?: 'deposit' | 'final_payment'
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

/**
 * Shows builder-facing payment totals before card confirmation.
 */
export function PaymentSummary({
  subtotal,
  depositAmount = 0,
  amountDue,
  platformFee = 0,
  paymentType = 'deposit',
}: PaymentSummaryProps) {
  const remainingBalance = Math.max(subtotal - depositAmount, 0)

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <h3 className="text-base font-bold text-foreground">Payment summary</h3>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Booking total</span>
          <span className="font-semibold text-foreground">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Deposit</span>
          <span className="font-semibold text-foreground">{formatCurrency(depositAmount)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Remaining balance</span>
          <span className="font-semibold text-foreground">{formatCurrency(remainingBalance)}</span>
        </div>
        {platformFee > 0 ? (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Platform fee</span>
            <span className="font-semibold text-foreground">{formatCurrency(platformFee)}</span>
          </div>
        ) : null}
        <div className="border-t border-border pt-3">
          <div className="flex justify-between gap-4">
            <span className="font-bold text-foreground">
              {paymentType === 'deposit' ? 'Due now' : 'Final payment due'}
            </span>
            <span className="text-lg font-bold text-primary">{formatCurrency(amountDue)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
