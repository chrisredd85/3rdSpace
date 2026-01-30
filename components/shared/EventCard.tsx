'use client'

import { Calendar, MapPin, DollarSign, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from './Badge'
import { cn } from '@/lib/utils'
import type { Event, EventStatus } from '@/lib/types'

export interface EventCardProps {
  /**
   * Event object containing all event data
   */
  event: Event
  /**
   * Variant determines the card styling and available actions
   * @default 'upcoming'
   */
  variant?: 'upcoming' | 'past' | 'template'
  /**
   * Optional click handler
   */
  onClick?: () => void
  /**
   * Optional progress percentage (0-100)
   */
  progress?: number
  /**
   * Optional actions to display
   */
  actions?: React.ReactNode
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * EventCard component for displaying event information in a card format
 * 
 * @example
 * ```tsx
 * <EventCard
 *   event={event}
 *   variant="upcoming"
 *   progress={75}
 *   onClick={() => router.push(`/builder/event/${event.id}`)}
 * />
 * ```
 */
export function EventCard({
  event,
  variant = 'upcoming',
  onClick,
  progress,
  actions,
  className,
}: EventCardProps) {
  const eventDate = event.event_date ? new Date(event.event_date) : null
  const venueName = (event as any).venue?.name || (event as any).venue_name || null

  // Generate gradient background for event image placeholder
  const gradientColors = [
    'from-blue-500 to-purple-600',
    'from-forest-500 to-blue-600',
    'from-purple-500 to-pink-600',
    'from-yellow-500 to-orange-600',
  ]
  const gradientIndex = event.id.charCodeAt(0) % gradientColors.length

  return (
    <Card
      className={cn(
        'hover:shadow-md transition-all cursor-pointer',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-0">
        {/* Event Image/Placeholder */}
        <div
          className={cn(
            'h-48 w-full bg-gradient-to-br',
            gradientColors[gradientIndex],
            'flex items-center justify-center text-white text-4xl font-bold'
          )}
        >
          {event.name?.charAt(0).toUpperCase() || 'E'}
        </div>

        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {event.name || 'Untitled Event'}
              </h3>
              <Badge status={event.status as EventStatus} size="sm" />
            </div>
          </div>

          {/* Event Details */}
          <div className="space-y-2 text-sm text-gray-600">
            {eventDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span>
                  {eventDate.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  {event.event_time && (
                    <span className="ml-2">
                      {new Date(`2000-01-01T${event.event_time}`).toLocaleTimeString(
                        'en-US',
                        { hour: 'numeric', minute: '2-digit' }
                      )}
                    </span>
                  )}
                </span>
              </div>
            )}

            {venueName && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-gray-400" />
                <span>{venueName}</span>
              </div>
            )}

            {event.budget && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-gray-400" />
                <span>Budget: ${event.budget.toLocaleString()}</span>
              </div>
            )}

            {event.expected_attendees && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400">👥</span>
                <span>{event.expected_attendees} expected guests</span>
              </div>
            )}
          </div>

          {/* Progress Bar (for upcoming events) */}
          {variant === 'upcoming' && progress !== undefined && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-forest-500 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          {actions && <div className="pt-2">{actions}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
