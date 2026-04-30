'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { memoize } from '@/lib/utils/performance'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useVenueOwnerBookings } from '@/lib/hooks/useBookings'
import { useAvailabilityBlocks } from '@/lib/hooks/useAvailabilityBlocks'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { BookingDetailModal } from '@/components/venue/BookingDetailModal'
import { BlockDatesModal } from '@/components/venue/BlockDatesModal'
import { EditBlockModal } from '@/components/venue/EditBlockModal'
import type { VenueBooking, AvailabilityBlock } from '@/lib/types'

export default function VenueCalendarPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<VenueBooking | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<AvailabilityBlock | null>(null)
  const [showEditBlockModal, setShowEditBlockModal] = useState(false)
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  const userId = user?.id || null

  useEffect(() => {
    const handleResize = () => {
      setViewMode(window.innerWidth < 768 ? 'week' : 'month')
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Set view mode based on screen size (above) - fetch venue id below
  useEffect(() => {
    if (user) {
      // Get user's first venue (in real app, would have venue selection)
      supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: venues }: { data: { id: string }[] | null }) => {
          if (venues && venues.length > 0) {
            setVenueId(venues[0].id)
          }
        })
    }
  }, [user])

  const monthString = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }, [currentMonth])

  const { data: allBookings = [] } = useVenueOwnerBookings(userId)
  const { data: availabilityBlocks = [] } = useAvailabilityBlocks(venueId, monthString)

  // Set up real-time subscriptions
  useEffect(() => {
    if (!venueId) return

    // Subscribe to venue bookings changes
    const bookingsChannel = supabase
      .channel(`venue-bookings:${venueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'venue_bookings',
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['bookings'] })
        }
      )
      .subscribe()

    // Subscribe to availability blocks changes
    const blocksChannel = supabase
      .channel(`availability-blocks:${venueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability_blocks',
          filter: `blockable_id=eq.${venueId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['availability-blocks'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(bookingsChannel)
      supabase.removeChannel(blocksChannel)
    }
  }, [venueId, queryClient])

  // Calculate booking percentage for current month
  const bookingPercentage = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const confirmedBookings = allBookings.filter((b) => {
      if (b.status !== 'confirmed' || !b.confirmed_date) return false
      const bookingDate = new Date(b.confirmed_date)
      return (
        bookingDate.getFullYear() === year &&
        bookingDate.getMonth() === month
      )
    })

    const bookedDays = new Set()
    confirmedBookings.forEach((b) => {
      if (b.confirmed_date) {
        const date = new Date(b.confirmed_date)
        bookedDays.add(date.getDate())
      }
    })

    const blocks = availabilityBlocks.filter((b) => {
      const blockStart = new Date(b.start_date)
      const blockEnd = new Date(b.end_date)
      return (
        (blockStart.getFullYear() === year && blockStart.getMonth() === month) ||
        (blockEnd.getFullYear() === year && blockEnd.getMonth() === month)
      )
    })

    blocks.forEach((block) => {
      const start = new Date(block.start_date)
      const end = new Date(block.end_date)
      const current = new Date(start)

      while (current <= end) {
        if (
          current.getFullYear() === year &&
          current.getMonth() === month
        ) {
          bookedDays.add(current.getDate())
        }
        current.setDate(current.getDate() + 1)
      }
    })

    return Math.round((bookedDays.size / daysInMonth) * 100)
  }, [allBookings, availabilityBlocks, currentMonth])

  // Get bookings and blocks for current month
  const monthData = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()

    const bookingsByDate: Record<string, VenueBooking[]> = {}
    const blocksByDate: Record<string, AvailabilityBlock[]> = {}

    // Process bookings
    allBookings.forEach((booking) => {
      if (booking.confirmed_date) {
        const date = new Date(booking.confirmed_date)
        if (
          date.getFullYear() === year &&
          date.getMonth() === month
        ) {
          const dateKey = date.getDate().toString()
          if (!bookingsByDate[dateKey]) {
            bookingsByDate[dateKey] = []
          }
          bookingsByDate[dateKey].push(booking)
        }
      } else if (booking.requested_date && booking.status === 'pending') {
        const date = new Date(booking.requested_date)
        if (
          date.getFullYear() === year &&
          date.getMonth() === month
        ) {
          const dateKey = date.getDate().toString()
          if (!bookingsByDate[dateKey]) {
            bookingsByDate[dateKey] = []
          }
          bookingsByDate[dateKey].push(booking)
        }
      }
    })

    // Process blocks
    availabilityBlocks.forEach((block) => {
      const start = new Date(block.start_date)
      const end = new Date(block.end_date)
      const current = new Date(start)

      while (current <= end) {
        if (
          current.getFullYear() === year &&
          current.getMonth() === month
        ) {
          const dateKey = current.getDate().toString()
          if (!blocksByDate[dateKey]) {
            blocksByDate[dateKey] = []
          }
          blocksByDate[dateKey].push(block)
          current.setDate(current.getDate() + 1)
        } else {
          current.setDate(current.getDate() + 1)
        }
      }
    })

    return { bookingsByDate, blocksByDate }
  }, [allBookings, availabilityBlocks, currentMonth])

  const handleDayClick = (date: Date) => {
    setSelectedDate(date)
    const dateKey = date.getDate().toString()
    const bookings = monthData.bookingsByDate[dateKey] || []
    const blocks = monthData.blocksByDate[dateKey] || []

    // Priority: confirmed booking > pending booking > block > available
    const confirmedBooking = bookings.find((b) => b.status === 'confirmed')
    const pendingBooking = bookings.find((b) => b.status === 'pending')
    const block = blocks[0]

    if (confirmedBooking) {
      setSelectedBooking(confirmedBooking)
      setShowBookingModal(true)
    } else if (pendingBooking) {
      setSelectedBooking(pendingBooking)
      setShowBookingModal(true)
    } else if (block) {
      setSelectedBlock(block)
      setShowEditBlockModal(true)
    } else {
      // Available - quick create block
      setShowBlockModal(true)
    }
  }


  const handleToday = () => {
    setCurrentMonth(new Date())
  }

  const handlePreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Memoize week days calculation
  const getWeekDays = useCallback(() => {
    const weekStart = new Date(currentWeek)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Start from Sunday
    const weekDays = []
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart)
      day.setDate(weekStart.getDate() + i)
      weekDays.push(day)
    }
    return weekDays
  }, [currentWeek])

  // Memoize calendar days calculation
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days = []
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i))
    }
    return days
  }, [currentMonth])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">Please log in to continue</div>
      </div>
    )
  }

  const handlePreviousWeek = () => {
    const newWeek = new Date(currentWeek)
    newWeek.setDate(newWeek.getDate() - 7)
    setCurrentWeek(newWeek)
  }

  const handleNextWeek = () => {
    const newWeek = new Date(currentWeek)
    newWeek.setDate(newWeek.getDate() + 7)
    setCurrentWeek(newWeek)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Calendar</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">Manage your venue availability and bookings</p>
        </div>
        <Button onClick={() => setShowBlockModal(true)} className="min-h-[44px] w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Block Dates
        </Button>
      </div>

      {/* Booking Percentage Banner */}
      <Card className="bg-gradient-to-r from-primary/10 to-primary/20 border-primary/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary">
                Booking Percentage - {monthName}
              </p>
              <p className="text-2xl font-bold text-primary mt-1">
                {bookingPercentage}%
              </p>
            </div>
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <CalendarIcon className="h-8 w-8 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Navigation */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <CardTitle className="text-lg sm:text-xl">
              {viewMode === 'week' 
                ? `Week of ${getWeekDays()[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : monthName}
            </CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {viewMode === 'week' ? (
                <>
                  <Button variant="outline" size="sm" onClick={handlePreviousWeek} className="min-h-[44px] flex-1 sm:flex-initial">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCurrentWeek(new Date())} className="min-h-[44px] flex-1 sm:flex-initial">
                    Today
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleNextWeek} className="min-h-[44px] flex-1 sm:flex-initial">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={handlePreviousMonth} className="min-h-[44px]">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleToday} className="min-h-[44px]">
                    Today
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleNextMonth} className="min-h-[44px]">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-2 sm:p-6">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 text-xs sm:text-sm">
            <span className="font-medium text-foreground">Legend:</span>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-yellow-400" />
              <span className="text-muted-foreground">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-primary" />
              <span className="text-muted-foreground">Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-destructive/100" />
              <span className="text-muted-foreground">Blocked</span>
            </div>
          </div>

          {/* Calendar Grid */}
          {viewMode === 'week' ? (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {/* Day Headers */}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div
                  key={day}
                  className="text-center text-xs sm:text-sm font-medium text-foreground p-1 sm:p-2"
                >
                  {day}
                </div>
              ))}

              {/* Week Days */}
              {getWeekDays().map((date, index) => {
                const dateKey = date.getDate().toString()
                const bookings = monthData.bookingsByDate[dateKey] || []
                const blocks = monthData.blocksByDate[dateKey] || []
                const confirmedBooking = bookings.find((b) => b.status === 'confirmed')
                const pendingBooking = bookings.find((b) => b.status === 'pending')
                const block = blocks[0]

                const isToday =
                  date.getDate() === new Date().getDate() &&
                  date.getMonth() === new Date().getMonth() &&
                  date.getFullYear() === new Date().getFullYear()

                let dayColor = 'bg-card/40'
                let dayText = 'text-foreground'
                let eventTag = null

                if (confirmedBooking) {
                  dayColor = 'bg-primary/10'
                  eventTag = (
                    <div className="bg-primary text-white text-xs px-1 py-0.5 rounded truncate">
                      {(confirmedBooking as import('@/lib/types').VenueBookingWithEvent).events?.title?.substring(0, 10) || 'Event'}
                    </div>
                  )
                } else if (pendingBooking) {
                  dayColor = 'bg-yellow-500/10'
                  eventTag = (
                    <div className="bg-yellow-400 text-yellow-100 text-xs px-1 py-0.5 rounded truncate">
                      {(pendingBooking as import('@/lib/types').VenueBookingWithEvent).events?.title?.substring(0, 10) || 'Pending'}
                    </div>
                  )
                } else if (block) {
                  dayColor = 'bg-destructive/10'
                  eventTag = (
                    <div className="bg-destructive/100 text-white text-xs px-1 py-0.5 rounded truncate">
                      {block.reason?.substring(0, 10) || 'Blocked'}
                    </div>
                  )
                }

                return (
                  <div
                    key={index}
                    onClick={() => handleDayClick(date)}
                    className={`min-h-[80px] sm:min-h-[100px] border border-border p-1 sm:p-2 cursor-pointer hover:bg-background transition-colors ${dayColor} ${
                      isToday ? 'ring-2 ring-primary' : ''
                    }`}
                  >
                    <div className={`text-sm sm:text-base font-medium mb-1 ${dayText}`}>
                      {date.getDate()}
                    </div>
                    {eventTag}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
            {/* Day Headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="text-center text-sm font-medium text-foreground p-2"
              >
                {day}
              </div>
            ))}

            {/* Calendar Days */}
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={index} className="aspect-square" />
              }

              const dateKey = date.getDate().toString()
              const bookings = monthData.bookingsByDate[dateKey] || []
              const blocks = monthData.blocksByDate[dateKey] || []
              const confirmedBooking = bookings.find((b) => b.status === 'confirmed')
              const pendingBooking = bookings.find((b) => b.status === 'pending')
              const block = blocks[0]

              const isToday =
                date.getDate() === new Date().getDate() &&
                date.getMonth() === new Date().getMonth() &&
                date.getFullYear() === new Date().getFullYear()

              let dayColor = 'bg-card/40'
              let dayText = 'text-foreground'
              let eventTag = null

              if (confirmedBooking) {
                dayColor = 'bg-primary/10'
                eventTag = (
                  <div className="bg-primary text-white text-xs px-1 py-0.5 rounded truncate">
                    {(confirmedBooking as import('@/lib/types').VenueBookingWithEvent).events?.title || 'Event'}
                  </div>
                )
              } else if (pendingBooking) {
                dayColor = 'bg-yellow-500/10'
                eventTag = (
                  <div className="bg-yellow-400 text-yellow-100 text-xs px-1 py-0.5 rounded truncate">
                    {(pendingBooking as import('@/lib/types').VenueBookingWithEvent).events?.title || 'Pending'}
                  </div>
                )
              } else if (block) {
                dayColor = 'bg-destructive/10'
                eventTag = (
                  <div className="bg-destructive/100 text-white text-xs px-1 py-0.5 rounded truncate">
                    {block.reason || 'Blocked'}
                  </div>
                )
              }

              return (
                <div
                  key={index}
                  onClick={() => handleDayClick(date)}
                  className={`aspect-square border border-border p-1 cursor-pointer hover:bg-background transition-colors ${dayColor} ${
                    isToday ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className={`text-xs font-medium mb-1 ${dayText}`}>
                    {date.getDate()}
                  </div>
                  {eventTag}
                  {bookings.length > 1 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      +{bookings.length - 1} more
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      {showBlockModal && (
        <BlockDatesModal
          venueId={venueId}
          initialStartDate={selectedDate || undefined}
          initialEndDate={selectedDate || undefined}
          onClose={() => {
            setShowBlockModal(false)
            setSelectedDate(null)
          }}
          onSuccess={() => {
            // Calendar will auto-refresh via React Query
          }}
        />
      )}

      {showBookingModal && selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => {
            setShowBookingModal(false)
            setSelectedBooking(null)
          }}
          venueOwnerId={userId}
        />
      )}

      {showEditBlockModal && selectedBlock && (
        <EditBlockModal
          block={selectedBlock}
          onClose={() => {
            setShowEditBlockModal(false)
            setSelectedBlock(null)
          }}
          onSuccess={() => {
            // Calendar will auto-refresh via React Query
          }}
        />
      )}
    </div>
  )
}
