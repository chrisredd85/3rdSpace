'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Calendar,
  Download,
  Clock,
  Users,
  DollarSign,
  MapPin,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useVenueOwnerBookings } from '@/lib/hooks/useBookings'
import { useUser } from '@/lib/hooks/useUser'
import type { VenueBooking, VenueBookingWithEvent } from '@/lib/types'

type ViewMode = 'list' | 'calendar'

export default function ConfirmedBookingsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const userId = user?.id || null
  const { data: allBookings = [], isLoading: isLoadingBookings } = useVenueOwnerBookings(userId)

  const confirmedBookings = useMemo(() => {
    return allBookings
      .filter((b) => b.status === 'confirmed')
      .filter((b) => {
        if (!b.confirmed_date) return false
        const bookingDate = new Date(b.confirmed_date)
        return bookingDate >= new Date()
      })
      .sort((a, b) => {
        const dateA = new Date(a.confirmed_date || a.requested_date)
        const dateB = new Date(b.confirmed_date || b.requested_date)
        return dateA.getTime() - dateB.getTime()
      })
  }, [allBookings])

  const handleExportCalendar = () => {
    // Generate ICS file
    const icsContent = generateICS(confirmedBookings)
    const blob = new Blob([icsContent], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'venue-bookings.ics'
    link.click()
    URL.revokeObjectURL(url)
  }

  // Loading and error handling (after all hooks)
  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-ink-soft">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-brick">Please log in to continue</div>
      </div>
    )
  }

  if (isLoadingBookings) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent mx-auto mb-4" />
          <p className="text-ink-soft">Loading bookings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">Confirmed Bookings</h1>
          <p className="text-ink-soft mt-1">Track your upcoming confirmed bookings</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border border-tan rounded-md">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 text-sm font-medium ${
                viewMode === 'list'
                  ? 'bg-clay text-cream'
                  : 'text-ink hover:bg-cream-deep/40'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-4 py-2 text-sm font-medium rounded-r-md ${
                viewMode === 'calendar'
                  ? 'bg-clay text-cream'
                  : 'text-ink hover:bg-cream-deep/40'
              }`}
            >
              Calendar
            </button>
          </div>
          <Button variant="outline" onClick={handleExportCalendar}>
            <Download className="h-4 w-4 mr-2" />
            Export to Calendar
          </Button>
        </div>
      </div>

      {confirmedBookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-ink-soft/60 mb-4" />
            <p className="text-ink-soft mb-2">No confirmed bookings</p>
            <p className="text-sm text-ink-soft">
              Confirmed bookings will appear here once you accept booking requests
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'list' ? (
        <div className="grid grid-cols-1 gap-4">
          {confirmedBookings.map((booking) => (
            <ConfirmedBookingCard key={booking.id} booking={booking} />
          ))}
        </div>
      ) : (
        <CalendarView
          bookings={confirmedBookings}
          currentMonth={currentMonth}
          onMonthChange={setCurrentMonth}
        />
      )}
    </div>
  )
}

interface ConfirmedBookingCardProps {
  booking: VenueBooking & {
    events?: any
    venues?: any
  }
}

function ConfirmedBookingCard({ booking }: ConfirmedBookingCardProps) {
  const event = (booking as VenueBookingWithEvent).events
  const venue = booking.venues as any

  const confirmedDate = booking.confirmed_date
    ? new Date(booking.confirmed_date)
    : null

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-ink mb-2">
              {event?.title || 'Event'}
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-ink-soft/60" />
                <div>
                  <p className="text-ink-soft">Date</p>
                  <p className="font-medium">
                    {confirmedDate
                      ? confirmedDate.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'TBD'}
                  </p>
                </div>
              </div>

              {booking.confirmed_start_time && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-ink-soft/60" />
                  <div>
                    <p className="text-ink-soft">Time</p>
                    <p className="font-medium">
                      {new Date(`2000-01-01T${booking.confirmed_start_time}`).toLocaleTimeString(
                        'en-US',
                        { hour: 'numeric', minute: '2-digit' }
                      )}
                    </p>
                  </div>
                </div>
              )}

              {event?.expected_attendees && (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-ink-soft/60" />
                  <div>
                    <p className="text-ink-soft">Guests</p>
                    <p className="font-medium">{event.expected_attendees}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-ink-soft/60" />
                <div>
                  <p className="text-ink-soft">Revenue</p>
                  <p className="font-medium">
                    ${booking.final_price?.toLocaleString() || booking.quoted_price?.toLocaleString() || 'TBD'}
                  </p>
                </div>
              </div>
            </div>

            {venue && (
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <MapPin className="h-4 w-4" />
                <span>{venue.name}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface CalendarViewProps {
  bookings: VenueBooking[]
  currentMonth: Date
  onMonthChange: (date: Date) => void
}

function CalendarView({ bookings, currentMonth, onMonthChange }: CalendarViewProps) {
  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const getBookingsForDate = (date: Date) => {
    return bookings.filter((booking) => {
      if (!booking.confirmed_date) return false
      const bookingDate = new Date(booking.confirmed_date)
      return (
        bookingDate.getDate() === date.getDate() &&
        bookingDate.getMonth() === date.getMonth() &&
        bookingDate.getFullYear() === date.getFullYear()
      )
    })
  }

  const days = []
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null)
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{monthName}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const prevMonth = new Date(year, month - 1, 1)
                onMonthChange(prevMonth)
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextMonth = new Date(year, month + 1, 1)
                onMonthChange(nextMonth)
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center text-sm font-medium text-ink p-2">
              {day}
            </div>
          ))}
          {days.map((date, index) => {
            if (!date) {
              return <div key={index} className="aspect-square" />
            }

            const dayBookings = getBookingsForDate(date)
            const isToday =
              date.getDate() === new Date().getDate() &&
              date.getMonth() === new Date().getMonth() &&
              date.getFullYear() === new Date().getFullYear()

            return (
              <div
                key={index}
                className={`aspect-square border border-tan p-1 ${
                  isToday ? 'bg-clay/10' : ''
                }`}
              >
                <div className="text-xs font-medium text-ink mb-1">
                  {date.getDate()}
                </div>
                {dayBookings.length > 0 && (
                  <div className="space-y-1">
                    {dayBookings.slice(0, 2).map((booking) => (
                      <div
                        key={booking.id}
                        className="bg-clay text-cream text-xs px-1 py-0.5 rounded truncate"
                        title={(booking as VenueBookingWithEvent).events?.title || 'Event'}
                      >
                        {(booking as VenueBookingWithEvent).events?.title || 'Event'}
                      </div>
                    ))}
                    {dayBookings.length > 2 && (
                      <div className="text-xs text-ink-soft">
                        +{dayBookings.length - 2} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function generateICS(bookings: VenueBooking[]): string {
  const formatDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  let ics = 'BEGIN:VCALENDAR\n'
  ics += 'VERSION:2.0\n'
  ics += 'PRODID:-//3rdPlace//Venue Bookings//EN\n'
  ics += 'CALSCALE:GREGORIAN\n'
  ics += 'METHOD:PUBLISH\n'

  bookings.forEach((booking) => {
    if (!booking.confirmed_date) return

    const startDate = new Date(booking.confirmed_date)
    if (booking.confirmed_start_time) {
      const [hours, minutes] = booking.confirmed_start_time.split(':')
      startDate.setHours(parseInt(hours), parseInt(minutes))
    }

    const endDate = new Date(startDate)
    if (booking.confirmed_end_time) {
      const [hours, minutes] = booking.confirmed_end_time.split(':')
      endDate.setHours(parseInt(hours), parseInt(minutes))
    } else {
      endDate.setHours(startDate.getHours() + 4) // Default 4 hours
    }

    const event = (booking as VenueBookingWithEvent).events

    ics += 'BEGIN:VEVENT\n'
    ics += `UID:${booking.id}@3rdspace.com\n`
    ics += `DTSTART:${formatDate(startDate)}\n`
    ics += `DTEND:${formatDate(endDate)}\n`
    ics += `SUMMARY:${event?.title || 'Event'}\n`
    ics += `DESCRIPTION:Venue booking confirmed\n`
    ics += 'STATUS:CONFIRMED\n'
    ics += 'END:VEVENT\n'
  })

  ics += 'END:VCALENDAR\n'
  return ics
}
