'use client'

import { Calendar, CheckCircle, Clock, DollarSign, MapPin, Package, Users, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StripeIntegrationNotice } from '@/components/shared/StripeIntegrationNotice'
import {
  formatBookingDate,
  formatBookingMoney,
  formatBookingTime,
  getVendorBookingDate,
  getVendorBookingServiceName,
  getVendorBookingTitle,
  type VendorBookingDashboardItem,
} from '@/lib/vendors/booking-dashboard'

interface BookingDetailsModalProps {
  booking: VendorBookingDashboardItem
  onClose: () => void
  onApprove: (booking: VendorBookingDashboardItem) => void
  onReject: (booking: VendorBookingDashboardItem) => void
  processing?: boolean
}

/**
 * Full vendor booking detail modal.
 *
 * @param props - Booking detail and action handlers.
 * @returns Booking details modal.
 */
export function BookingDetailsModal({
  booking,
  onClose,
  onApprove,
  onReject,
  processing = false,
}: BookingDetailsModalProps) {
  const date = getVendorBookingDate(booking)
  const startTime = formatBookingTime(booking.confirmed_start_time || booking.requested_start_time || booking.start_time)
  const endTime = formatBookingTime(booking.confirmed_end_time || booking.requested_end_time || booking.end_time)
  const venue = booking.events?.venues
  const organizer = booking.events?.profiles
  const service = booking.vendor_offerings
  const pkg = booking.vendor_packages
  const fee = booking.final_price ?? booking.quoted_price

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="max-h-[90vh] w-full max-w-4xl overflow-y-auto">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{getVendorBookingTitle(booking)}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">{getVendorBookingServiceName(booking)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Event Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground/60" />
                  <span>{formatBookingDate(date)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground/60" />
                  <span>{startTime ? `${startTime}${endTime ? ` - ${endTime}` : ''}` : 'Time TBD'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground/60" />
                  <span>{booking.events?.expected_attendees || booking.guest_count || 'Guests TBD'}</span>
                </div>
                {venue?.name ? (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground/60" />
                    <span>
                      {venue.name}
                      {venue.address ? `, ${venue.address}` : ''}
                      {venue.city ? `, ${venue.city}` : ''}
                    </span>
                  </div>
                ) : null}
              </div>
              {booking.events?.description ? (
                <p className="mt-4 text-sm text-muted-foreground">{booking.events.description}</p>
              ) : null}
            </section>

            <section className="rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Organizer</h3>
              <div className="space-y-2 text-sm">
                <p className="font-medium text-foreground">{organizer?.name || 'Organizer TBD'}</p>
                <p className="text-muted-foreground">{organizer?.email || 'Email unavailable'}</p>
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-border p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Package className="h-4 w-4" />
              Service Scope
            </h3>
            <p className="text-sm font-medium text-foreground">{service?.offering_name || pkg?.package_name || 'Custom service request'}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {booking.notes || service?.description || pkg?.description || 'No additional service notes were provided.'}
            </p>
            {service?.equipment_included?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {service.equipment_included.map((item) => (
                  <span key={item} className="rounded-md bg-background px-2 py-1 text-xs text-foreground">{item}</span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Payment Status</h3>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Quoted Fee</p>
                <p className="font-semibold text-foreground">{formatBookingMoney(booking.quoted_price)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Final Fee</p>
                <p className="font-semibold text-foreground">{formatBookingMoney(fee)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Deposit</p>
                <p className="font-semibold text-foreground">
                  {booking.deposit_amount ? `${formatBookingMoney(booking.deposit_amount)} ${booking.deposit_paid ? 'paid' : 'pending'}` : 'Not set'}
                </p>
              </div>
            </div>
            <StripeIntegrationNotice context="inline" className="mt-4" />
          </section>

          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            {booking.status === 'pending' ? (
              <>
                <Button type="button" variant="outline" onClick={() => onReject(booking)} disabled={processing}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
                <Button type="button" onClick={() => onApprove(booking)} disabled={processing}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
