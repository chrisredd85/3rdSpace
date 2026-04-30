'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, LayoutList, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { StripeIntegrationNotice } from '@/components/shared/StripeIntegrationNotice'
import { BookingDetailsModal } from '@/components/vendor/BookingDetailsModal'
import { BookingRequestCard } from '@/components/vendor/BookingRequestCard'
import { UpcomingBookingsWidget } from '@/components/vendor/UpcomingBookingsWidget'
import {
  formatBookingDate,
  formatBookingMoney,
  getVendorBookingDate,
  getVendorBookingTitle,
  toCsvCell,
  type VendorBookingDashboardItem,
  type VendorBookingDashboardStatus,
} from '@/lib/vendors/booking-dashboard'

type DashboardView = 'list' | 'calendar'

interface VendorBookingsDashboardProps {
  vendorId: string
}

interface BookingsResponse {
  bookings?: VendorBookingDashboardItem[]
  error?: string
}

const FILTERS: Array<{ value: VendorBookingDashboardStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
]

/**
 * Builds month grid dates for the calendar view.
 *
 * @param currentMonth - Date in the visible month.
 * @returns Dates plus leading empty cells.
 */
function buildMonthGrid(currentMonth: Date) {
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
  const last = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
  const dates: Array<Date | null> = []

  for (let index = 0; index < first.getDay(); index += 1) dates.push(null)
  for (let day = 1; day <= last.getDate(); day += 1) {
    dates.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))
  }

  return dates
}

/**
 * Formats date as YYYY-MM-DD using local date parts.
 *
 * @param date - Date object.
 * @returns ISO-like date string.
 */
function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Downloads bookings as CSV.
 *
 * @param bookings - Rows to export.
 */
function exportBookingsToCsv(bookings: VendorBookingDashboardItem[]) {
  const header = ['Event', 'Status', 'Date', 'Fee', 'Deposit Paid', 'Payment Status', 'Venue']
  const rows = bookings.map((booking) => [
    getVendorBookingTitle(booking),
    booking.status,
    getVendorBookingDate(booking) || '',
    booking.final_price ?? booking.quoted_price ?? '',
    booking.deposit_paid ? 'yes' : 'no',
    booking.payment_status || 'pending',
    booking.events?.venues?.name || '',
  ])

  const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `vendor-bookings-${new Date().toISOString().split('T')[0]}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Vendor booking dashboard with filters, list/calendar views, actions, and CSV export.
 *
 * @param props - Vendor profile id.
 * @returns Vendor bookings dashboard.
 */
export function VendorBookingsDashboard({ vendorId }: VendorBookingsDashboardProps) {
  const { addToast } = useToast()
  const [status, setStatus] = useState<VendorBookingDashboardStatus>('pending')
  const [view, setView] = useState<DashboardView>('list')
  const [bookings, setBookings] = useState<VendorBookingDashboardItem[]>([])
  const [allBookings, setAllBookings] = useState<VendorBookingDashboardItem[]>([])
  const [selectedBooking, setSelectedBooking] = useState<VendorBookingDashboardItem | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [filteredResponse, allResponse] = await Promise.all([
        fetch(`/api/vendor/bookings?vendorId=${vendorId}&status=${status}`, { credentials: 'include' }),
        fetch(`/api/vendor/bookings?vendorId=${vendorId}&status=all`, { credentials: 'include' }),
      ])

      const filteredData = (await filteredResponse.json()) as BookingsResponse
      const allData = (await allResponse.json()) as BookingsResponse

      if (!filteredResponse.ok) throw new Error(filteredData.error || 'Failed to load bookings')
      if (!allResponse.ok) throw new Error(allData.error || 'Failed to load booking summary')

      setBookings(filteredData.bookings || [])
      setAllBookings(allData.bookings || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load bookings')
    } finally {
      setLoading(false)
    }
  }, [status, vendorId])

  useEffect(() => {
    loadBookings()
  }, [loadBookings])

  const counts = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const completed = allBookings.filter((booking) => {
      const date = getVendorBookingDate(booking)
      return booking.status === 'confirmed' && (booking.events?.status === 'completed' || Boolean(date && date < today))
    }).length

    return {
      all: allBookings.length,
      pending: allBookings.filter((booking) => booking.status === 'pending').length,
      confirmed: allBookings.filter((booking) => booking.status === 'confirmed').length - completed,
      completed,
      declined: allBookings.filter((booking) => booking.status === 'declined').length,
    }
  }, [allBookings])

  const monthDates = useMemo(() => buildMonthGrid(currentMonth), [currentMonth])
  const bookingsByDate = useMemo(() => {
    const map = new Map<string, VendorBookingDashboardItem[]>()
    bookings.forEach((booking) => {
      const date = getVendorBookingDate(booking)
      if (!date) return
      const items = map.get(date) || []
      items.push(booking)
      map.set(date, items)
    })
    return map
  }, [bookings])

  const handleViewDetails = async (booking: VendorBookingDashboardItem) => {
    setLoadingDetails(true)
    try {
      const response = await fetch(`/api/vendor/bookings/${booking.id}/details`, { credentials: 'include' })
      const data = (await response.json()) as { booking?: VendorBookingDashboardItem; error?: string }

      if (!response.ok) throw new Error(data.error || 'Failed to load booking details')
      setSelectedBooking(data.booking || booking)
    } catch (detailError) {
      addToast({
        title: 'Could not load details',
        description: detailError instanceof Error ? detailError.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleApprove = async (booking: VendorBookingDashboardItem) => {
    setProcessingId(booking.id)
    try {
      const response = await fetch(`/api/vendor/bookings/${booking.id}/approve`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Failed to approve booking')
      addToast({ title: 'Booking approved', description: 'The booking is now confirmed.' })
      setSelectedBooking(null)
      await loadBookings()
    } catch (approveError) {
      addToast({
        title: 'Could not approve booking',
        description: approveError instanceof Error ? approveError.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (booking: VendorBookingDashboardItem) => {
    const reason = window.prompt('Reason for rejecting this booking?') || ''
    setProcessingId(booking.id)
    try {
      const response = await fetch(`/api/vendor/bookings/${booking.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Failed to reject booking')
      addToast({ title: 'Booking rejected', description: 'The request has been declined.' })
      setSelectedBooking(null)
      await loadBookings()
    } catch (rejectError) {
      addToast({
        title: 'Could not reject booking',
        description: rejectError instanceof Error ? rejectError.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Vendor Bookings</h1>
          <p className="mt-1 text-muted-foreground">Review requests, manage confirmed jobs, and track payment readiness.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => exportBookingsToCsv(bookings)} disabled={bookings.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <StripeIntegrationNotice context="inline" />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                className={`rounded-lg border p-3 text-left transition ${
                  status === filter.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card/40 text-foreground hover:border-border'
                }`}
              >
                <span className="block text-sm font-semibold">{filter.label}</span>
                <span className="mt-1 block text-2xl font-bold">{counts[filter.value as keyof typeof counts] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button type="button" variant={view === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setView('list')}>
                <LayoutList className="mr-2 h-4 w-4" />
                List
              </Button>
              <Button type="button" variant={view === 'calendar' ? 'default' : 'outline'} size="sm" onClick={() => setView('calendar')}>
                <CalendarDays className="mr-2 h-4 w-4" />
                Calendar
              </Button>
            </div>

            {view === 'calendar' ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>Prev</Button>
                <span className="min-w-[140px] text-center text-sm font-semibold">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>Next</Button>
              </div>
            ) : null}
          </div>

          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading bookings...
            </div>
          ) : bookings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <CalendarDays className="mb-3 h-12 w-12 text-muted-foreground/60" />
                <p className="font-semibold text-foreground">No {status === 'all' ? '' : status} bookings</p>
                <p className="mt-1 text-sm text-muted-foreground">Bookings matching this filter will appear here.</p>
              </CardContent>
            </Card>
          ) : view === 'list' ? (
            <div className="space-y-3">
              {bookings.map((booking) => (
                <BookingRequestCard
                  key={booking.id}
                  booking={booking}
                  onView={handleViewDetails}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  processing={processingId === booking.id || loadingDetails}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-7 gap-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="p-2 text-center text-xs font-semibold text-muted-foreground">{day}</div>
                  ))}
                  {monthDates.map((date, index) => {
                    if (!date) return <div key={`empty-${index}`} className="min-h-[108px] rounded-md bg-background" />
                    const key = toDateKey(date)
                    const dayBookings = bookingsByDate.get(key) || []

                    return (
                      <div key={key} className="min-h-[108px] rounded-md border border-border p-2">
                        <p className="text-sm font-semibold text-foreground">{date.getDate()}</p>
                        <div className="mt-2 space-y-1">
                          {dayBookings.slice(0, 2).map((booking) => (
                            <button
                              key={booking.id}
                              type="button"
                              onClick={() => handleViewDetails(booking)}
                              className="block w-full truncate rounded bg-primary/10 px-2 py-1 text-left text-xs text-primary hover:bg-primary/15"
                            >
                              {getVendorBookingTitle(booking)}
                            </button>
                          ))}
                          {dayBookings.length > 2 ? (
                            <span className="block text-xs text-muted-foreground">+{dayBookings.length - 2} more</span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <UpcomingBookingsWidget bookings={allBookings} onSelect={handleViewDetails} />
      </div>

      {selectedBooking ? (
        <BookingDetailsModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          processing={processingId === selectedBooking.id}
        />
      ) : null}
    </div>
  )
}
