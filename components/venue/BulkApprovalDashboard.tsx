'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calendar, Check, DollarSign, Loader2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface BulkApprovalDashboardProps {
  venueId?: string
}

interface PendingBooking {
  id: string
  event_id: string
  venue_id: string
  requested_date: string | null
  requested_start_time: string | null
  quoted_price: number | null
  final_price: number | null
  created_at: string
  notes: string | null
  events?: {
    title?: string | null
    event_date?: string | null
    expected_attendees?: number | null
    expected_attendance_min?: number | null
    expected_attendance_max?: number | null
    profiles?: {
      name?: string | null
      email?: string | null
    } | null
  } | null
  venues?: {
    name?: string | null
  } | null
  auto_approval?: {
    eligible: boolean
    reasons: string[]
  }
}

/**
 * Formats money for pending booking cards.
 *
 * @param value - Numeric amount, when available.
 * @returns Currency string or TBD.
 */
function formatMoney(value: number | null | undefined) {
  if (value == null) return 'TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Formats an ISO date for compact booking cards.
 *
 * @param value - Date string, when available.
 * @returns Human-readable date or TBD.
 */
function formatDate(value: string | null | undefined) {
  if (!value) return 'TBD'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Displays pending venue bookings with batch approval and rejection actions.
 *
 * @param props - Optional venue id. When omitted, loads all venues owned by the current user.
 * @returns Bulk approval dashboard UI.
 */
export function BulkApprovalDashboard({ venueId }: BulkApprovalDashboardProps) {
  const { addToast } = useToast()
  const [bookings, setBookings] = useState<PendingBooking[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  const selectedBookings = useMemo(
    () => bookings.filter((booking) => selected.has(booking.id)),
    [bookings, selected]
  )

  const autoEligibleIds = useMemo(
    () => bookings.filter((booking) => booking.auto_approval?.eligible).map((booking) => booking.id),
    [bookings]
  )

  /**
   * Loads pending bookings for the configured venue scope.
   */
  async function loadPendingBookings() {
    setLoading(true)
    try {
      const query = venueId ? `?venueId=${venueId}` : ''
      const response = await fetch(`/api/venue/bulk-approval/pending${query}`, {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load pending bookings')
      }

      setBookings((data.bookings || []) as PendingBooking[])
      setSelected(new Set())
    } catch (error) {
      console.error('[BulkApprovalDashboard] Error loading pending bookings', error)
      addToast({
        title: 'Could not load pending bookings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPendingBookings()
  }, [venueId])

  /**
   * Toggles a booking's selected state.
   *
   * @param bookingId - Booking id to toggle.
   */
  function toggleSelection(bookingId: string) {
    const nextSelected = new Set(selected)
    if (nextSelected.has(bookingId)) {
      nextSelected.delete(bookingId)
    } else {
      nextSelected.add(bookingId)
    }
    setSelected(nextSelected)
  }

  /**
   * Selects every pending booking currently displayed.
   */
  function selectAll() {
    setSelected(new Set(bookings.map((booking) => booking.id)))
  }

  /**
   * Selects only bookings that match the venue's auto-approval rules.
   */
  function selectAutoEligible() {
    setSelected(new Set(autoEligibleIds))
  }

  /**
   * Clears the current selection.
   */
  function clearSelection() {
    setSelected(new Set())
  }

  /**
   * Approves selected pending bookings after confirmation.
   */
  async function bulkApprove() {
    if (selected.size === 0) return

    const confirmed = window.confirm(`Approve ${selected.size} selected booking${selected.size === 1 ? '' : 's'}?`)
    if (!confirmed) return

    setProcessing(true)
    try {
      const response = await fetch('/api/venue/bulk-approval/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ bookingIds: Array.from(selected) }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve bookings')
      }

      addToast({
        title: 'Bookings approved',
        description: `${data.approved || 0} booking${data.approved === 1 ? '' : 's'} approved.`,
        variant: 'success',
      })
      await loadPendingBookings()
    } catch (error) {
      console.error('[BulkApprovalDashboard] Error approving bookings', error)
      addToast({
        title: 'Could not approve bookings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setProcessing(false)
    }
  }

  /**
   * Rejects selected pending bookings after collecting and confirming a reason.
   */
  async function bulkReject() {
    if (selected.size === 0) return

    const reason = window.prompt('Reason for rejection:')
    if (!reason?.trim()) return

    const confirmed = window.confirm(`Reject ${selected.size} selected booking${selected.size === 1 ? '' : 's'}?`)
    if (!confirmed) return

    setProcessing(true)
    try {
      const response = await fetch('/api/venue/bulk-approval/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          bookingIds: Array.from(selected),
          reason,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject bookings')
      }

      addToast({
        title: 'Bookings rejected',
        description: `${data.rejected || 0} booking${data.rejected === 1 ? '' : 's'} rejected.`,
        variant: 'success',
      })
      await loadPendingBookings()
    } catch (error) {
      console.error('[BulkApprovalDashboard] Error rejecting bookings', error)
      addToast({
        title: 'Could not reject bookings',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pending bookings...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-bold text-foreground">Pending Bookings</h3>
          <p className="text-sm text-muted-foreground">
            {bookings.length} pending · {selected.size} selected
          </p>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={bulkApprove} disabled={processing}>
              {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Approve ({selected.size})
            </Button>
            <Button type="button" variant="destructive" onClick={bulkReject} disabled={processing}>
              {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
              Reject ({selected.size})
            </Button>
          </div>
        ) : null}
      </div>

      {bookings.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={selectAutoEligible} disabled={autoEligibleIds.length === 0}>
            Select Auto-Eligible ({autoEligibleIds.length})
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={loadPendingBookings}>
            Refresh
          </Button>
        </div>
      ) : null}

      {bookings.length === 0 ? (
        <div className="rounded-lg bg-background py-12 text-center">
          <p className="font-medium text-foreground">No pending bookings</p>
          <p className="mt-1 text-sm text-muted-foreground">New venue requests will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const event = booking.events
            const builderName = event?.profiles?.name || event?.profiles?.email || 'Event organizer'
            const amount = booking.final_price ?? booking.quoted_price
            const isSelected = selected.has(booking.id)
            const expectedAttendees =
              event?.expected_attendees ?? event?.expected_attendance_min ?? event?.expected_attendance_max

            return (
              <button
                type="button"
                key={booking.id}
                onClick={() => toggleSelection(booking.id)}
                className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card/40 hover:border-border'
                }`}
              >
                <div className="flex gap-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(booking.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="mt-1 h-5 w-5 rounded border-border text-primary"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h4 className="font-bold text-foreground">{event?.title || 'Event Booking Request'}</h4>
                        <p className="text-sm text-muted-foreground">
                          by {builderName} · {booking.venues?.name || 'Venue'}
                        </p>
                      </div>

                      {booking.auto_approval?.eligible ? (
                        <span className="w-fit rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                          Auto-eligible
                        </span>
                      ) : booking.auto_approval?.reasons?.length ? (
                        <span className="w-fit rounded-full bg-sidebar-accent/40 px-2.5 py-1 text-xs font-semibold text-foreground">
                          Manual review
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{formatDate(booking.requested_date || event?.event_date)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{expectedAttendees || 'TBD'} guests</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span>{formatMoney(amount)}</span>
                      </div>
                    </div>

                    {booking.auto_approval?.reasons?.length ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {booking.auto_approval.reasons.join(' · ')}
                      </p>
                    ) : null}

                    {booking.notes ? (
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{booking.notes}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
