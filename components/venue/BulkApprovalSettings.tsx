'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, DollarSign, Loader2, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface BulkApprovalSettingsProps {
  venueId: string
}

interface BulkApprovalSettingsResponse {
  bulk_approval_enabled?: boolean
  auto_approve_threshold?: number | null
  auto_approve_conditions?: {
    minNotice?: number | null
    maxCapacity?: number | null
  }
  error?: string
}

/**
 * Converts optional numeric form input into a number or null.
 *
 * @param value - Current input value.
 * @returns Parsed number, or null for blank input.
 */
function parseOptionalNumber(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Manages bulk approval and auto-approval rules for a venue.
 *
 * @param props - Venue id to manage.
 * @returns Settings form for venue owners.
 */
export function BulkApprovalSettings({ venueId }: BulkApprovalSettingsProps) {
  const { addToast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [minNotice, setMinNotice] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  /**
   * Loads current bulk approval settings for this venue.
   */
  async function loadSettings() {
    setLoading(true)
    try {
      const response = await fetch(`/api/venue/bulk-approval/settings?venueId=${venueId}`, {
        credentials: 'include',
      })
      const data = (await response.json()) as BulkApprovalSettingsResponse

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load settings')
      }

      setEnabled(Boolean(data.bulk_approval_enabled))
      setThreshold(data.auto_approve_threshold?.toString() || '')
      setMinNotice(data.auto_approve_conditions?.minNotice?.toString() || '')
      setMaxCapacity(data.auto_approve_conditions?.maxCapacity?.toString() || '')
    } catch (error) {
      console.error('[BulkApprovalSettings] Error loading settings', error)
      addToast({
        title: 'Could not load bulk approval settings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [venueId])

  /**
   * Validates settings before sending them to the API.
   *
   * @returns Error message when invalid, otherwise null.
   */
  function validateSettings() {
    const parsedThreshold = parseOptionalNumber(threshold)
    const parsedNotice = parseOptionalNumber(minNotice)
    const parsedCapacity = parseOptionalNumber(maxCapacity)

    if (threshold.trim() && (parsedThreshold === null || parsedThreshold < 0)) {
      return 'Auto-approve threshold must be zero or greater.'
    }

    if (minNotice.trim() && (parsedNotice === null || parsedNotice < 0 || !Number.isInteger(parsedNotice))) {
      return 'Minimum notice must be a whole number of days.'
    }

    if (maxCapacity.trim() && (parsedCapacity === null || parsedCapacity < 1 || !Number.isInteger(parsedCapacity))) {
      return 'Maximum capacity must be a whole number greater than zero.'
    }

    return null
  }

  /**
   * Saves current bulk approval and auto-approval settings.
   */
  async function handleSave() {
    const validationError = validateSettings()
    if (validationError) {
      addToast({
        title: 'Settings need attention',
        description: validationError,
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/venue/bulk-approval/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          venueId,
          bulkApprovalEnabled: enabled,
          autoApproveThreshold: parseOptionalNumber(threshold),
          autoApproveConditions: {
            minNotice: parseOptionalNumber(minNotice),
            maxCapacity: parseOptionalNumber(maxCapacity),
          },
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings')
      }

      addToast({
        title: 'Bulk approval settings saved',
        description: 'Your approval rules are ready for new and pending requests.',
      })
    } catch (error) {
      console.error('[BulkApprovalSettings] Error saving settings', error)
      addToast({
        title: 'Could not save settings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading bulk approval settings...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold text-foreground">Bulk Booking Approval</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve groups of requests and optionally auto-confirm simple bookings.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg bg-background p-4">
        <input
          type="checkbox"
          id="bulk-enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-0.5 h-5 w-5 rounded border-border text-primary"
        />
        <span>
          <span className="block font-semibold text-foreground">Enable bulk approval for bookings</span>
          <span className="block text-sm text-muted-foreground">Turns on batch tools and auto-approval rule checks.</span>
        </span>
      </label>

      {enabled ? (
        <>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-foreground">Auto-Approve Threshold</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="number"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                placeholder="2000"
                min={0}
                className="h-11 w-full rounded-md border border-border pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to ignore cost. Otherwise, only bookings at or below this amount auto-approve.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">Minimum Notice</label>
              <input
                type="number"
                value={minNotice}
                onChange={(event) => setMinNotice(event.target.value)}
                placeholder="7"
                min={0}
                className="h-11 w-full rounded-md border border-border px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground">Only auto-approve if booked at least this many days ahead.</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">Max Event Capacity</label>
              <input
                type="number"
                value={maxCapacity}
                onChange={(event) => setMaxCapacity(event.target.value)}
                placeholder="100"
                min={1}
                className="h-11 w-full rounded-md border border-border px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground">Only auto-approve events at or below this guest count.</p>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">Auto-Approve Preview</p>
            </div>
            <ul className="space-y-1 text-sm text-foreground">
              {threshold ? <li>Total cost is at or below ${Number(threshold).toLocaleString()}</li> : null}
              {minNotice ? <li>Booked at least {minNotice} days in advance</li> : null}
              {maxCapacity ? <li>Event has {maxCapacity} guests or fewer</li> : null}
              {!threshold && !minNotice && !maxCapacity ? (
                <li>No conditions set. New pending bookings can auto-approve whenever bulk approval is enabled.</li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={loadSettings} disabled={saving}>
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  )
}
