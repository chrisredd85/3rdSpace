'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useVendorOwnerBookings } from '@/lib/hooks/useVendorBookings'
import { useAvailabilityBlocks } from '@/lib/hooks/useAvailabilityBlocks'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { BlockDatesModal } from '@/components/venue/BlockDatesModal'
import { BookingDetailModal } from '@/components/vendor/BookingDetailModal'
import type { VendorBooking, AvailabilityBlock } from '@/lib/types'

export default function VendorCalendarPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<VendorBooking | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<AvailabilityBlock | null>(null)
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  const userId = user?.id || null

  useEffect(() => {
    if (user) {
      supabase
        .from('vendors')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: vendors }: { data: { id: string }[] | null }) => {
          if (vendors && vendors.length > 0) {
            setVendorId(vendors[0].id)
          }
        })
    }
  }, [user])

  const monthString = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }, [currentMonth])

  const { data: allBookings = [] } = useVendorOwnerBookings(vendorId)
  const { data: availabilityBlocks = [] } = useAvailabilityBlocks(null, monthString, vendorId)

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

    const bookingsByDate: Record<string, VendorBooking[]> = {}
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
      // Show edit/delete block modal (simplified - just delete for now)
      if (confirm('Delete this block?')) {
        // Would call delete mutation
      }
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

  // Set up real-time subscriptions
  useEffect(() => {
    if (!vendorId) return

    // Subscribe to vendor bookings changes
    const bookingsChannel = supabase
      .channel(`vendor-bookings:${vendorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vendor_bookings',
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['vendor-bookings'] })
        }
      )
      .subscribe()

    // Subscribe to availability blocks changes
    const blocksChannel = supabase
      .channel(`availability-blocks:${vendorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability_blocks',
          filter: `vendor_id=eq.${vendorId}`,
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
  }, [vendorId, queryClient])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Please log in to continue</div>
      </div>
    )
  }

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const days = []
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null)
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-600 mt-1">Manage your availability and bookings</p>
        </div>
        <Button onClick={() => setShowBlockModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Block Dates
        </Button>
      </div>

      {/* Booking Percentage Banner */}
      <Card className="bg-gradient-to-r from-forest-50 to-forest-100 border-forest-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-forest-900">
                Booking Percentage - {monthName}
              </p>
              <p className="text-2xl font-bold text-forest-600 mt-1">
                {bookingPercentage}%
              </p>
            </div>
            <div className="h-16 w-16 rounded-full bg-forest-500 flex items-center justify-center">
              <CalendarIcon className="h-8 w-8 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Navigation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{monthName}</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePreviousMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleToday}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="font-medium text-gray-700">Legend:</span>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-yellow-400" />
              <span className="text-gray-600">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-forest-500" />
              <span className="text-gray-600">Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-red-500" />
              <span className="text-gray-600">Blocked</span>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Day Headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="text-center text-sm font-medium text-gray-700 p-2"
              >
                {day}
              </div>
            ))}

            {/* Calendar Days */}
            {days.map((date, index) => {
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

              let dayColor = 'bg-white'
              let eventTag = null

              if (confirmedBooking) {
                dayColor = 'bg-forest-50'
                eventTag = (
                  <div className="bg-forest-500 text-white text-xs px-1 py-0.5 rounded truncate">
                    {(confirmedBooking as import('@/lib/types').VendorBookingWithEvent).events?.title || 'Event'}
                  </div>
                )
              } else if (pendingBooking) {
                dayColor = 'bg-yellow-50'
                eventTag = (
                  <div className="bg-yellow-400 text-yellow-900 text-xs px-1 py-0.5 rounded truncate">
                    {(pendingBooking as import('@/lib/types').VendorBookingWithEvent).events?.title || 'Pending'}
                  </div>
                )
              } else if (block) {
                dayColor = 'bg-red-50'
                eventTag = (
                  <div className="bg-red-500 text-white text-xs px-1 py-0.5 rounded truncate">
                    {block.reason || 'Blocked'}
                  </div>
                )
              }

              return (
                <div
                  key={index}
                  onClick={() => handleDayClick(date)}
                  className={`aspect-square border border-gray-200 p-1 cursor-pointer hover:bg-gray-50 transition-colors ${dayColor} ${
                    isToday ? 'ring-2 ring-forest-500' : ''
                  }`}
                >
                  <div className="text-xs font-medium text-gray-700 mb-1">
                    {date.getDate()}
                  </div>
                  {eventTag}
                  {bookings.length > 1 && (
                    <div className="text-xs text-gray-500 mt-1">
                      +{bookings.length - 1} more
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      {showBlockModal && (
        <BlockDatesModal
          venueId={null}
          vendorId={vendorId}
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
          vendorId={vendorId}
        />
      )}
    </div>
  )
}
