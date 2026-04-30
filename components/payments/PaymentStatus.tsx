'use client'

import { AlertCircle, CheckCircle2, Clock, RotateCcw } from 'lucide-react'

type PaymentStatusProps = {
  status?: 'pending' | 'processing' | 'succeeded' | 'fully_paid' | 'failed' | 'refunded' | string | null
  depositPaid?: boolean | null
}

function getStatusMeta(status: string, depositPaid?: boolean | null) {
  if (status === 'fully_paid') {
    return {
      icon: CheckCircle2,
      label: 'Fully paid',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    }
  }

  if (status === 'succeeded' || depositPaid) {
    return {
      icon: CheckCircle2,
      label: depositPaid ? 'Deposit paid' : 'Paid',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    }
  }

  if (status === 'refunded') {
    return {
      icon: RotateCcw,
      label: 'Refunded',
      className: 'border-primary/30 bg-primary/10 text-foreground',
    }
  }

  if (status === 'failed') {
    return {
      icon: AlertCircle,
      label: 'Payment failed',
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
    }
  }

  return {
    icon: Clock,
    label: status === 'processing' ? 'Processing' : 'Payment pending',
    className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  }
}

/**
 * Compact payment status badge for booking cards and modals.
 */
export function PaymentStatus({ status = 'pending', depositPaid = false }: PaymentStatusProps) {
  const meta = getStatusMeta(status || 'pending', depositPaid)
  const Icon = meta.icon

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${meta.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  )
}
