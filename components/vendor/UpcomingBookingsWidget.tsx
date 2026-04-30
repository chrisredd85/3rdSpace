'use client'

import { CalendarDays } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatBookingDate,
  formatBookingMoney,
  getVendorBookingDate,
  getVendorBookingTitle,
  type VendorBookingDashboardItem,
} from '@/lib/vendors/booking-dashboard'

interface UpcomingBookingsWidgetProps {
  bookings: VendorBookingDashboardItem[]
  onSelect?: (booking: VendorBookingDashboardItem) => void
}

/**
 * Shows a compact overview of upcoming confirmed vendor bookings.
 *
 * @param props - Booking rows and optional select handler.
 * @returns Upcoming bookings widget.
 */
export function UpcomingBookingsWidget({ bookings, onSelect }: UpcomingBookingsWidgetProps) {
  const today = new Date().toISOString().split('T')[0]
  const upcoming = bookings
    .filter((booking) => booking.status === 'confirmed')
    .filter((booking) => {
      const date = getVendorBookingDate(booking)
      return Boolean(date && date >= today)
    })
    .sort((a, b) => String(getVendorBookingDate(a)).localeCompare(String(getVendorBookingDate(b))))
    .slice(0, 3)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="h-5 w-5 text-primary" />
          Upcoming Bookings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No confirmed upcoming bookings yet.</p>
        ) : (
          <div className="space-y-3">
            {upcoming.map((booking) => (
              <button
                key={booking.id}
                type="button"
                onClick={() => onSelect?.(booking)}
                className="w-full rounded-lg border border-border p-3 text-left transition hover:border-primary/40 hover:bg-primary/10"
              >
                <p className="font-semibold text-foreground">{getVendorBookingTitle(booking)}</p>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>{formatBookingDate(getVendorBookingDate(booking))}</span>
                  <span>{formatBookingMoney(booking.final_price ?? booking.quoted_price)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
