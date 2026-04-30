'use client'

import { useEffect, useMemo, useState } from 'react'
import { DollarSign, Info, Loader2 } from 'lucide-react'
import { StripeIntegrationNotice } from '@/components/shared/StripeIntegrationNotice'

type DepositType = 'fixed' | 'percentage'
type DepositTargetType = 'venue' | 'vendor'

interface DepositDisplayProps {
  venueId?: string
  vendorId?: string
  targetType?: DepositTargetType
  bookingCost?: number
  compact?: boolean
}

interface DepositConfigResponse {
  requires_deposit?: boolean | null
  deposit_amount?: number | null
  deposit_type?: DepositType | null
  deposit_percentage?: number | null
  deposit_refundable?: boolean | null
  deposit_terms?: string | null
}

/**
 * Formats currency for booking-flow deposit summaries.
 *
 * @param amount - Numeric dollar amount.
 * @returns Currency string.
 */
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Resolves the API endpoint for a venue or vendor deposit lookup.
 *
 * @param props - Display props containing an entity id.
 * @returns Endpoint metadata, or null when no target id is present.
 */
function getTarget(props: Pick<DepositDisplayProps, 'venueId' | 'vendorId' | 'targetType'>) {
  const type = props.targetType ?? (props.vendorId ? 'vendor' : 'venue')
  const id = type === 'vendor' ? props.vendorId : props.venueId

  if (!id) return null

  return {
    id,
    type,
    endpoint: `/api/${type}/deposit`,
    idKey: type === 'vendor' ? 'vendorId' : 'venueId',
    label: type === 'vendor' ? 'vendor' : 'venue',
  }
}

/**
 * Calculates the deposit due based on fixed or percentage configuration.
 *
 * @param config - Deposit config returned by the API.
 * @param bookingCost - Current booking estimate.
 * @returns Deposit amount due now.
 */
function calculateDepositAmount(config: DepositConfigResponse, bookingCost: number) {
  if (config.deposit_type === 'percentage') {
    return bookingCost > 0 ? bookingCost * ((config.deposit_percentage || 0) / 100) : 0
  }

  return config.deposit_amount || 0
}

/**
 * Displays required deposit terms during booking flows.
 *
 * @param props - Venue or vendor id plus optional booking estimate.
 * @returns Deposit summary UI or null when no deposit is required.
 */
export function DepositDisplay({
  venueId,
  vendorId,
  targetType,
  bookingCost = 0,
  compact = false,
}: DepositDisplayProps) {
  const target = useMemo(() => getTarget({ venueId, vendorId, targetType }), [venueId, vendorId, targetType])
  const [config, setConfig] = useState<DepositConfigResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(target))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    /**
     * Loads public deposit terms for the selected venue or vendor.
     */
    async function loadDepositConfig() {
      if (!target) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`${target.endpoint}?${target.idKey}=${target.id}`, {
          credentials: 'include',
        })
        const data = (await response.json()) as DepositConfigResponse & { error?: string }

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load deposit requirements')
        }

        setConfig(data)
      } catch (loadError) {
        console.error('[DepositDisplay] Error loading deposit config', loadError)
        setError(loadError instanceof Error ? loadError.message : 'Deposit requirements unavailable')
      } finally {
        setLoading(false)
      }
    }

    loadDepositConfig()
  }, [target])

  if (!target) return null

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-background p-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading deposit info...
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
        {error}
      </div>
    )
  }

  if (!config?.requires_deposit) return null

  const depositAmount = calculateDepositAmount(config, bookingCost)
  const remainingBalance = Math.max(bookingCost - depositAmount, 0)
  const isPercentageWithoutEstimate = config.deposit_type === 'percentage' && bookingCost <= 0

  return (
    <div className={`rounded-lg border border-yellow-500/30 bg-yellow-500/10 ${compact ? 'p-3' : 'p-4'} text-left`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-yellow-500/15 p-2">
          <DollarSign className="h-5 w-5 text-yellow-200" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-yellow-100">Deposit Required</h4>
          <p className="mt-1 text-sm text-yellow-200">
            This {target.label} requires a deposit to secure the booking.
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-card/40 p-3">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Deposit Amount</span>
          <span className="font-bold text-foreground">
            {isPercentageWithoutEstimate ? `${config.deposit_percentage || 0}%` : formatCurrency(depositAmount)}
          </span>
        </div>

        {config.deposit_type === 'percentage' && bookingCost > 0 ? (
          <div className="mt-2 flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-semibold text-foreground">{config.deposit_percentage}% of booking total</span>
          </div>
        ) : null}

        {bookingCost > 0 ? (
          <>
            <div className="mt-2 flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Due at Booking</span>
              <span className="font-bold text-accent">{formatCurrency(depositAmount)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Payment collection is not active yet.</p>
            <div className="mt-2 flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Remaining Balance</span>
              <span className="font-semibold text-foreground">{formatCurrency(remainingBalance)}</span>
            </div>
          </>
        ) : null}

        <div className="mt-3 flex items-start gap-2 border-t pt-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {config.deposit_refundable ? 'Refundable under the listed terms' : 'Non-refundable deposit'}
          </p>
        </div>
      </div>

      {config.deposit_terms ? (
        <div className="mt-3 rounded-md bg-yellow-500/15 p-3 text-xs text-yellow-100">
          <p className="font-semibold">Deposit Terms</p>
          <p className="mt-1 whitespace-pre-wrap">{config.deposit_terms}</p>
        </div>
      ) : null}

      <StripeIntegrationNotice context={compact ? 'inline' : 'booking'} className="mt-3" />
    </div>
  )
}
