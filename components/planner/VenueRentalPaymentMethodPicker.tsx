'use client'

import { Banknote, CreditCard, Loader2 } from 'lucide-react'
import { centsToDollars } from '@/lib/money'
import {
  calculateVenueRentalAchProcessingFeeCents,
  calculateVenueRentalCardProcessingFeeCents,
  type VenueRentalPaymentMethodType,
} from '@/lib/payments/venue-rental'
import { cn } from '@/lib/utils'

interface VenueRentalPaymentMethodPickerProps {
  venuePaymentTransactionId: string | null
  amountCents: number
  onSelect: (method: VenueRentalPaymentMethodType) => void
  isSubmitting: boolean
  error?: string | null
}

const METHOD_OPTIONS: Array<{
  method: VenueRentalPaymentMethodType
  label: string
  description: string
  settlementCopy: string
  icon: typeof CreditCard
}> = [
  {
    method: 'card',
    label: 'Pay by card',
    description: '2.9% + $0.30 processing fee',
    settlementCopy: 'Settles instantly',
    icon: CreditCard,
  },
  {
    method: 'us_bank_account',
    label: 'Pay by ACH',
    description: '0.8% capped at $5 processing fee',
    settlementCopy: 'Settles in 2-3 business days',
    icon: Banknote,
  },
]

export function VenueRentalPaymentMethodPicker({
  venuePaymentTransactionId,
  amountCents,
  onSelect,
  isSubmitting,
  error,
}: VenueRentalPaymentMethodPickerProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Select payment method</p>
        <h3 className="mt-2 font-display text-xl font-bold text-foreground">Choose the exact processing fee</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          The venue receives {formatCents(amountCents)}. The processing fee is itemized and matched to the method you pick before Checkout opens.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {METHOD_OPTIONS.map((option) => {
          const feeCents = option.method === 'card'
            ? calculateVenueRentalCardProcessingFeeCents(amountCents)
            : calculateVenueRentalAchProcessingFeeCents(amountCents)
          const totalCents = amountCents + feeCents
          const Icon = option.icon

          return (
            <button
              key={option.method}
              type="button"
              disabled={isSubmitting}
              onClick={() => onSelect(option.method)}
              className={cn(
                'group rounded-3xl border border-border bg-gradient-card p-4 text-left shadow-card transition-smooth',
                'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                isSubmitting && 'cursor-not-allowed opacity-60'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {option.settlementCopy}
                </span>
              </div>

              <p className="mt-4 font-display text-lg font-bold text-foreground">{option.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>

              <div className="mt-4 rounded-2xl border border-border bg-background/50 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Processing fee</span>
                  <span className="font-semibold text-gradient-brand">{formatCents(feeCents)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Checkout total</span>
                  <span className="font-display text-lg font-bold text-foreground">{formatCents(totalCents)}</span>
                </div>
              </div>

              <div className="glass mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground transition-smooth group-hover:bg-card/80">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue with {option.method === 'card' ? 'card' : 'ACH'}
              </div>
            </button>
          )
        })}
      </div>

      {venuePaymentTransactionId ? (
        <p className="text-xs text-muted-foreground">Continuing existing payment row {venuePaymentTransactionId.slice(0, 8)}.</p>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(centsToDollars(value))
}
