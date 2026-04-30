'use client'

import { Calendar, CheckCircle, Clock, DollarSign, Eye, MapPin, Users, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  formatBookingDate,
  formatBookingMoney,
  formatBookingTime,
  getVendorBookingDate,
  getVendorBookingServiceName,
  getVendorBookingTitle,
  type VendorBookingDashboardItem,
} from '@/lib/vendors/booking-dashboard'

interface BookingRequestCardProps {
  booking: VendorBookingDashboardItem
  onView: (booking: VendorBookingDashboardItem) => void
  onApprove: (booking: VendorBookingDashboardItem) => void
  onReject: (booking: VendorBookingDashboardItem) => void
  processing?: boolean
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-200',
  confirmed: 'bg-primary/15 text-primary',
  declined: 'bg-sidebar-accent/40 text-foreground',
  cancelled: 'bg-destructive/15 text-destructive',
}

/**
 * Displays a vendor booking request with quick approve/reject actions.
 *
 * @param props - Booking and action handlers.
 * @returns Vendor booking request card.
 */
export function BookingRequestCard({
  booking,
  onView,
  onApprove,
  onReject,
  processing = false,
}: BookingRequestCardProps) {
  const date = getVendorBookingDate(booking)
  const startTime = formatBookingTime(booking.confirmed_start_time || booking.requested_start_time || booking.start_time)
  const endTime = formatBookingTime(booking.confirmed_end_time || booking.requested_end_time || booking.end_time)
  const venue = booking.events?.venues
  const organizer = booking.events?.profiles
  const fee = booking.final_price ?? booking.quoted_price
  const paymentStatus = booking.payment_status || 'pending'
  const isPending = booking.status === 'pending'

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <button
            type="button"
            onClick={() => onView(booking)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{getVendorBookingTitle(booking)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getVendorBookingServiceName(booking)}
                  {organizer?.name ? ` by ${organizer.name}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[booking.status] || STATUS_STYLES.pending}`}>
                  {booking.status}
                </span>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary/80">
                  Payment: {paymentStatus}
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground/60" />
                <span>{formatBookingDate(date)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground/60" />
                <span>{startTime ? `${startTime}${endTime ? ` - ${endTime}` : ''}` : 'Time TBD'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground/60" />
                <span>{booking.events?.expected_attendees || booking.guest_count || 'Guests TBD'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-muted-foreground/60" />
                <span>{formatBookingMoney(fee)}</span>
              </div>
            </div>

            {venue?.name ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 text-muted-foreground/60" />
                <span>{venue.name}{venue.city ? `, ${venue.city}` : ''}</span>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md bg-background px-2 py-1">
                Deposit {booking.deposit_paid ? 'paid' : 'pending'}
              </span>
              <span className="rounded-md bg-background px-2 py-1">
                Final payment {paymentStatus === 'succeeded' ? 'paid' : 'pending'}
              </span>
            </div>
          </button>

          <div className="flex flex-wrap gap-2 lg:flex-col">
            <Button type="button" variant="outline" size="sm" onClick={() => onView(booking)}>
              <Eye className="mr-2 h-4 w-4" />
              Details
            </Button>
            {isPending ? (
              <>
                <Button type="button" size="sm" onClick={() => onApprove(booking)} disabled={processing}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onReject(booking)} disabled={processing}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
