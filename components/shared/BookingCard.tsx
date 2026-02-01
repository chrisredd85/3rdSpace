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
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {eventTitle}
            </h3>
            <p className="text-sm text-gray-600">
              {type === 'venue' ? 'Venue' : 'Vendor'}: {relatedName}
            </p>
          </div>
          <Badge status={booking.status as BookingStatus} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {displayDate && (
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-600">Date</p>
                <p className="font-medium text-gray-900">
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
            <div className="flex items-center gap-2 text-gray-600">
              <Clock className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-600">Time</p>
                <p className="font-medium text-gray-900">
                  {new Date(`2000-01-01T${booking.requested_start_time}`).toLocaleTimeString(
                    'en-US',
                    { hour: 'numeric', minute: '2-digit' }
                  )}
                </p>
              </div>
            </div>
          )}

          {type === 'vendor' && (booking as import('@/lib/types').VendorBookingWithEvent).setup_time && (
            <div className="flex items-center gap-2 text-gray-600">
              <Clock className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-600">Setup</p>
                <p className="font-medium text-gray-900">
                  {(booking as import('@/lib/types').VendorBookingWithEvent).setup_time} min
                </p>
              </div>
            </div>
          )}

          {event?.expected_attendees && (
            <div className="flex items-center gap-2 text-gray-600">
              <Users className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-600">Guests</p>
                <p className="font-medium text-gray-900">
                  {event.expected_attendees}
                </p>
              </div>
            </div>
          )}

          {(booking.quoted_price || booking.final_price) && (
            <div className="flex items-center gap-2 text-gray-600">
              <DollarSign className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-600">Price</p>
                <p className="font-medium text-gray-900">
                  ${(booking.final_price || booking.quoted_price || 0).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>

        {booking.notes && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-medium text-gray-700 mb-1">Notes</p>
            <p className="text-sm text-gray-600 line-clamp-2">{booking.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
