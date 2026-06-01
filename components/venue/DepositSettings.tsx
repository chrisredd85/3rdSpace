'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, DollarSign, Loader2, Percent } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { StripeIntegrationNotice } from '@/components/shared/StripeIntegrationNotice'

type DepositType = 'fixed' | 'percentage'
type DepositTargetType = 'venue' | 'vendor'

interface DepositSettingsProps {
  venueId?: string
  vendorId?: string
  targetType?: DepositTargetType
  onSave?: (config: unknown) => void
}

interface DepositConfigResponse {
  requires_deposit?: boolean | null
  deposit_amount?: number | null
  deposit_type?: DepositType | null
  deposit_percentage?: number | null
  deposit_refundable?: boolean | null
  deposit_terms?: string | null
}

const DEFAULT_TERMS =
  'Deposit is refundable up to 30 days before the event date. Cancellations within 30 days forfeit the deposit. Deposit will be applied toward the final invoice.'

/**
 * Formats a dollar amount for user-facing previews.
 *
 * @param amount - Numeric amount to format.
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
 * Returns the configured endpoint and payload id for venues or vendors.
 *
 * @param props - Component props containing a venue or vendor id.
 * @returns Target metadata, or null when no id is available.
 */
function getTarget(props: Pick<DepositSettingsProps, 'venueId' | 'vendorId' | 'targetType'>) {
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
 * Manages deposit requirements for a venue or vendor profile.
 *
 * @param props - Venue or vendor id plus optional save callback.
 * @returns Editable deposit settings UI.
 */
export function DepositSettings({ venueId, vendorId, targetType, onSave }: DepositSettingsProps) {
  const { addToast } = useToast()
  const target = useMemo(() => getTarget({ venueId, vendorId, targetType }), [venueId, vendorId, targetType])
  const [requiresDeposit, setRequiresDeposit] = useState(false)
  const [depositType, setDepositType] = useState<DepositType>('fixed')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositPercentage, setDepositPercentage] = useState('')
  const [depositRefundable, setDepositRefundable] = useState(true)
  const [depositTerms, setDepositTerms] = useState(DEFAULT_TERMS)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  /**
   * Loads persisted deposit configuration for the current target.
   */
  const loadDepositConfig = useCallback(async () => {
    if (!target) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${target.endpoint}?${target.idKey}=${target.id}`, {
        credentials: 'include',
      })
      const data = (await response.json()) as DepositConfigResponse & { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load deposit settings')
      }

      setRequiresDeposit(Boolean(data.requires_deposit))
      setDepositType(data.deposit_type || 'fixed')
      setDepositAmount(data.deposit_amount?.toString() || '')
      setDepositPercentage(data.deposit_percentage?.toString() || '')
      setDepositRefundable(data.deposit_refundable ?? true)
      setDepositTerms(data.deposit_terms || DEFAULT_TERMS)
    } catch (error) {
      console.error('[DepositSettings] Error loading deposit config', error)
      addToast({
        title: 'Could not load deposit settings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, target])

  useEffect(() => {
    loadDepositConfig()
  }, [loadDepositConfig])

  /**
   * Validates the current form state before saving.
   *
   * @returns Error message when invalid, otherwise null.
   */
  function validateForm() {
    if (!requiresDeposit) return null

    if (depositType === 'fixed') {
      const amount = Number.parseFloat(depositAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        return 'Enter a fixed deposit amount greater than zero.'
      }
    }

    if (depositType === 'percentage') {
      const percentage = Number.parseInt(depositPercentage, 10)
      if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
        return 'Enter a deposit percentage from 1 to 100.'
      }
    }

    return null
  }

  /**
   * Saves deposit requirements to the venue or vendor API.
   */
  async function handleSave() {
    if (!target) return

    const validationError = validateForm()
    if (validationError) {
      addToast({
        title: 'Deposit settings need attention',
        description: validationError,
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch(target.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          [target.idKey]: target.id,
          requiresDeposit,
          depositType,
          depositAmount: depositType === 'fixed' ? Number.parseFloat(depositAmount) : null,
          depositPercentage: depositType === 'percentage' ? Number.parseInt(depositPercentage, 10) : null,
          depositRefundable,
          depositTerms,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save deposit settings')
      }

      onSave?.(data[target.label])
      addToast({
        title: 'Deposit settings saved',
        description: `Your ${target.label} deposit requirements are ready for booking requests.`,
      })
    } catch (error) {
      console.error('[DepositSettings] Error saving deposit config', error)
      addToast({
        title: 'Could not save deposit settings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const previewValue =
    depositType === 'fixed'
      ? formatCurrency(Number.parseFloat(depositAmount) || 0)
      : `${Number.parseInt(depositPercentage, 10) || 0}%`

  if (!target) {
    return <div className="text-sm text-ink-soft">Select a venue or vendor before setting deposits.</div>
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading deposit settings...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-ink">Deposit Requirements</h3>
        <p className="mt-1 text-sm text-ink-soft">
          Require money up front to secure bookings and protect against cancellations.
        </p>
      </div>

      <StripeIntegrationNotice context="settings" />

      <label className="flex items-center gap-3 rounded-lg bg-cream p-4">
        <input
          type="checkbox"
          checked={requiresDeposit}
          onChange={(event) => setRequiresDeposit(event.target.checked)}
          className="h-5 w-5 rounded border-tan text-clay"
        />
        <span className="font-semibold text-ink">Require deposit for bookings</span>
      </label>

      {requiresDeposit ? (
        <>
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-ink">Deposit Type</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDepositType('fixed')}
                className={`flex min-h-[88px] items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                  depositType === 'fixed'
                    ? 'border-clay bg-clay/10'
                    : 'border-tan hover:border-tan'
                }`}
              >
                <span className={`rounded-lg p-2 ${depositType === 'fixed' ? 'bg-clay text-cream' : 'bg-cream-deep/40 text-ink-soft'}`}>
                  <DollarSign className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold text-ink">Fixed Amount</span>
                  <span className="block text-xs text-ink-soft">A specific dollar amount</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDepositType('percentage')}
                className={`flex min-h-[88px] items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                  depositType === 'percentage'
                    ? 'border-clay bg-clay/10'
                    : 'border-tan hover:border-tan'
                }`}
              >
                <span className={`rounded-lg p-2 ${depositType === 'percentage' ? 'bg-clay text-cream' : 'bg-cream-deep/40 text-ink-soft'}`}>
                  <Percent className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold text-ink">Percentage</span>
                  <span className="block text-xs text-ink-soft">A percent of booking total</span>
                </span>
              </button>
            </div>
          </div>

          {depositType === 'fixed' ? (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-ink">Deposit Amount</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="500"
                  min={1}
                  step="50"
                  className="h-11 w-full rounded-md border border-tan pl-10 pr-4 text-sm focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-ink">Deposit Percentage</label>
              <div className="relative">
                <input
                  type="number"
                  value={depositPercentage}
                  onChange={(event) => setDepositPercentage(event.target.value)}
                  placeholder="20"
                  min={1}
                  max={100}
                  className="h-11 w-full rounded-md border border-tan pl-4 pr-12 text-sm focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
                />
                <Percent className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink">Refund Policy</label>
            <label className="flex items-center gap-3 rounded-lg bg-cream p-4">
              <input
                type="checkbox"
                checked={depositRefundable}
                onChange={(event) => setDepositRefundable(event.target.checked)}
                className="h-5 w-5 rounded border-tan text-clay"
              />
              <span className="text-sm text-ink">Deposit is refundable under stated conditions</span>
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink">Deposit Terms</label>
            <textarea
              value={depositTerms}
              onChange={(event) => setDepositTerms(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Explain refund conditions, cancellation windows, and exceptions."
              className="w-full resize-none rounded-md border border-tan px-3 py-2 text-sm focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/20"
            />
          </div>

          <div className="rounded-lg border border-clay/30 bg-clay/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-ink">
              <AlertCircle className="h-5 w-5" />
              <p className="font-semibold">Deposit Preview</p>
            </div>
            <p className="text-sm text-ink">
              Bookings will require a <strong>{previewValue}</strong> deposit that is{' '}
              <strong>{depositRefundable ? 'refundable' : 'non-refundable'}</strong>.
            </p>
          </div>
        </>
      ) : null}

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={loadDepositConfig} disabled={saving}>
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Deposit Settings'
          )}
        </Button>
      </div>
    </div>
  )
}
