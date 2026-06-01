'use client'

import { Calendar, Clock, MapPin, DollarSign, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from './Badge'
import { cn } from '@/lib/utils'
import type { VenueBooking, VendorBooking, BookingStatus } from '@/lib/types'

export interface BookingCardProps {
  /**
   * Booking object (either VenueBooking or VendorBooking)
   */
  booking: VenueBooking | VendorBooking
  /**
   * Type of booking (venue or vendor)
   */
  type: 'venue' | 'vendor'
  /**
   * Click handler for opening detail modal
   */
  onClick?: () => void
  /**
   * Optional event data attached to booking
   */
  event?: any
  /**
   * Optional venue/vendor data attached to booking
   */
  relatedData?: any
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * BookingCard component for displaying booking requests and confirmations
 * 
 * @example
 * ```tsx
 * <BookingCard
 *   booking={venueBooking}
 *   type="venue"
 *   onClick={() => setSelectedBooking(venueBooking)}
 *   event={event}
 *   relatedData={venue}
 * />
 * ```
 */
export function BookingCard({
  booking,
  type,
  onClick,
  event,
  relatedData,
  className,
}: BookingCardProps) {
  const requestedDate = booking.requested_date
    ? new Date(booking.requested_date)
    : null
  const confirmedDate = booking.confirmed_date
    ? new Date(booking.confirmed_date)
    : null

  const displayDate = confirmedDate || requestedDate
  const eventTitle = event?.title || 'Event Booking'
  const relatedName = relatedData?.name || (type === 'venue' ? 'Venue' : 'Vendor')

  return (
    <Card
      className={cn(
        'hover:shadow-md transition-all',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-ink mb-1">
              {eventTitle}
            </h3>
            <p className="text-sm text-ink-soft">
              {type === 'venue' ? 'Venue' : 'Vendor'}: {relatedName}
            </p>
          </div>
          <Badge status={booking.status as BookingStatus} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {displayDate && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Calendar className="h-4 w-4 text-ink-soft/60" />
              <div>
                <p className="text-ink-soft">Date</p>
                <p className="font-medium text-ink">
                  {displayDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          )}

          {booking.requested_start_time && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Clock className="h-4 w-4 text-ink-soft/60" />
              <div>
                <p className="text-ink-soft">Time</p>
                <p className="font-medium text-ink">
                  {new Date(`2000-01-01T${booking.requested_start_time}`).toLocaleTimeString(
                    'en-US',
                    { hour: 'numeric', minute: '2-digit' }
                  )}
                </p>
              </div>
            </div>
          )}

          {type === 'vendor' && (booking as import('@/lib/types').VendorBookingWithEvent).setup_time && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Clock className="h-4 w-4 text-ink-soft/60" />
              <div>
                <p className="text-ink-soft">Setup</p>
                <p className="font-medium text-ink">
                  {(booking as import('@/lib/types').VendorBookingWithEvent).setup_time} min
                </p>
              </div>
            </div>
          )}

          {event?.expected_attendees && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Users className="h-4 w-4 text-ink-soft/60" />
              <div>
                <p className="text-ink-soft">Guests</p>
                <p className="font-medium text-ink">
                  {event.expected_attendees}
                </p>
              </div>
            </div>
          )}

          {(booking.quoted_price || booking.final_price) && (
            <div className="flex items-center gap-2 text-ink-soft">
              <DollarSign className="h-4 w-4 text-ink-soft/60" />
              <div>
                <p className="text-ink-soft">Price</p>
                <p className="font-medium text-ink">
                  ${(booking.final_price || booking.quoted_price || 0).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>

        {booking.notes && (
          <div className="mt-4 pt-4 border-t border-tan">
            <p className="text-xs font-medium text-ink mb-1">Notes</p>
            <p className="text-sm text-ink-soft line-clamp-2">{booking.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
