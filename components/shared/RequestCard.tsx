'use client'

import { Calendar, Clock, MapPin, Users, DollarSign, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from './Badge'
import { cn } from '@/lib/utils'
import type { BookingStatus } from '@/lib/types'

export interface RequestCardProps {
  /**
   * Event title
   */
  title: string
  /**
   * Organizer name
   */
  organizerName: string
  /**
   * Organizer company (optional)
   */
  organizerCompany?: string
  /**
   * Event date
   */
  date: string
  /**
   * Event time (optional)
   */
  time?: string
  /**
   * Guest count (optional)
   */
  guestCount?: number
  /**
   * Venue name (optional)
   */
  venueName?: string
  /**
   * Revenue amount
   */
  revenue?: number
  /**
   * Booking status
   */
  status: BookingStatus
  /**
   * Click handler
   */
  onClick?: () => void
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * RequestCard component for displaying booking requests
 */
export function RequestCard({
  title,
  organizerName,
  organizerCompany,
  date,
  time,
  guestCount,
  venueName,
  revenue,
  status,
  onClick,
  className,
}: RequestCardProps) {
  const dateObj = new Date(date)

  return (
    <Card
      className={cn(
        'border border-tan hover:border-clay hover:shadow-md transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-2 truncate">
              {title}
            </h3>
            <div className="flex items-center gap-2 text-sm text-ink-soft mb-1">
              <span className="font-medium">{organizerName}</span>
              {organizerCompany && (
                <>
                  <span>•</span>
                  <span>{organizerCompany}</span>
                </>
              )}
            </div>
          </div>
          <Badge status={status} size="sm" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2 text-ink-soft">
            <Calendar className="h-4 w-4 flex-shrink-0 text-ink-soft/60" />
            <span>{dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          {time && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Clock className="h-4 w-4 flex-shrink-0 text-ink-soft/60" />
              <span>{new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          )}
          {guestCount && (
            <div className="flex items-center gap-2 text-ink-soft">
              <Users className="h-4 w-4 flex-shrink-0 text-ink-soft/60" />
              <span>{guestCount} guests</span>
            </div>
          )}
          {venueName && (
            <div className="flex items-center gap-2 text-ink-soft">
              <MapPin className="h-4 w-4 flex-shrink-0 text-ink-soft/60" />
              <span className="truncate">{venueName}</span>
            </div>
          )}
          {revenue !== undefined && (
            <div className="flex items-center gap-2 text-ink font-bold">
              <DollarSign className="h-4 w-4 flex-shrink-0 text-clay" />
              <span>${revenue.toLocaleString()}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
