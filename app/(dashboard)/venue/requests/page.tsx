'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  Calendar,
  Users,
  DollarSign,
  MessageSquare,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useVenueBookingRequests, useVenueOwnerBookings } from '@/lib/hooks/useBookings'
import { useUser } from '@/lib/hooks/useUser'
import { BookingDetailModal } from '@/components/venue/BookingDetailModal'
import type { VenueBooking, BookingStatus } from '@/lib/types'

type TabType = 'pending' | 'confirmed'

export default function VenueRequestsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [activeTab, setActiveTab] = useState<TabType>('pending')
  const [selectedBooking, setSelectedBooking] = useState<VenueBooking | null>(null)
  const userId = user?.id || null
  const { data: pendingRequests = [], isLoading: pendingLoading } = useVenueBookingRequests(userId)
  const { data: allBookings = [], isLoading: allLoading } = useVenueOwnerBookings(userId)

  // Loading and error handling
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

  // Get confirmed bookings
  const confirmedBookings = useMemo(() => {
    return allBookings.filter((b) => b.status === 'confirmed')
  }, [allBookings])

  // Filter bookings by tab
  const displayedBookings = activeTab === 'pending' ? pendingRequests : confirmedBookings

  // Count requests older than 24 hours
  const oldRequestsCount = useMemo(() => {
    const now = new Date()
    return pendingRequests.filter((req) => {
      const requestDate = new Date(req.created_at)
      const hoursDiff = (now.getTime() - requestDate.getTime()) / (1000 * 60 * 60)
      return hoursDiff > 24
    }).length
  }, [pendingRequests])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Booking Requests</h1>
        <p className="text-gray-600 mt-1">Manage incoming booking requests for your venues</p>
      </div>

      {/* Warning Banner */}
      {pendingRequests.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-900">
                  {pendingRequests.length} new request{pendingRequests.length !== 1 ? 's' : ''} waiting
                </p>
                <p className="text-sm text-yellow-700 mt-1">
                  {oldRequestsCount > 0 && (
                    <span className="font-semibold">{oldRequestsCount} request{oldRequestsCount !== 1 ? 's' : ''} over 24 hours old. </span>
                  )}
                  Respond within 24 hours to maintain your response rate and keep your venue active.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pending'
              ? 'border-forest-500 text-forest-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending Requests
            {pendingRequests.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold">
                {pendingRequests.length}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab('confirmed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'confirmed'
              ? 'border-forest-500 text-forest-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Confirmed Bookings
            {confirmedBookings.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-forest-100 text-forest-800 text-xs font-semibold">
                {confirmedBookings.length}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Booking Cards */}
      {(pendingLoading || allLoading) ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
            <p className="text-gray-600">Loading requests...</p>
          </div>
        </div>
      ) : displayedBookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">
              {activeTab === 'pending'
                ? 'No pending requests'
                : 'No confirmed bookings'}
            </p>
            <p className="text-sm text-gray-500">
              {activeTab === 'pending'
                ? 'New booking requests will appear here'
                : 'Confirmed bookings will appear here'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {displayedBookings.map((booking) => (
            <BookingRequestCard
              key={booking.id}
              booking={booking}
              onClick={() => setSelectedBooking(booking)}
            />
          ))}
        </div>
      )}

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          venueOwnerId={userId}
        />
      )}
    </div>
  )
}

interface BookingRequestCardProps {
  booking: VenueBooking & {
    events?: any
    venues?: any
  }
  onClick: () => void
}

function BookingRequestCard({ booking, onClick }: BookingRequestCardProps) {
  const event = booking.events as any
  const venue = booking.venues as any

  // Calculate hours since request
  const hoursSinceRequest = useMemo(() => {
    const now = new Date()
    const requestDate = new Date(booking.created_at)
    return Math.floor((now.getTime() - requestDate.getTime()) / (1000 * 60 * 60))
  }, [booking.created_at])

  const isUrgent = hoursSinceRequest > 24

  // Get organizer info (would come from event.builder_id -> profiles)
  const organizerName = 'Event Organizer' // Mock - would fetch from profiles
  const organizerCompany = 'Company Name' // Mock

  const requestedDate = booking.requested_date
    ? new Date(booking.requested_date)
    : null

  const statusBadge = getStatusBadge(booking.status)

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {event?.title || 'Event Booking Request'}
                </h3>
                <p className="text-sm text-gray-600">
                  {organizerName} • {organizerCompany}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {statusBadge}
                {isUrgent && (
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                    Urgent
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-gray-600">Date</p>
                  <p className="font-medium">
                    {requestedDate
                      ? requestedDate.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'TBD'}
                  </p>
                </div>
              </div>

              {booking.requested_start_time && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-gray-600">Time</p>
                    <p className="font-medium">
                      {new Date(`2000-01-01T${booking.requested_start_time}`).toLocaleTimeString(
                        'en-US',
                        { hour: 'numeric', minute: '2-digit' }
                      )}
                    </p>
                  </div>
                </div>
              )}

              {event?.expected_attendees && (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-gray-600">Guests</p>
                    <p className="font-medium">{event.expected_attendees}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-gray-600">Revenue</p>
                  <p className="font-medium">
                    {booking.quoted_price
                      ? `$${booking.quoted_price.toLocaleString()}`
                      : 'TBD'}
                  </p>
                </div>
              </div>
            </div>

            {booking.notes && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-700 mb-1">Special Requests:</p>
                <p className="text-sm text-gray-600 line-clamp-2">{booking.notes}</p>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              <span>
                Requested {hoursSinceRequest}h ago
                {isUrgent && ' • Response overdue'}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function getStatusBadge(status: BookingStatus) {
  const badges = {
    pending: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
        Pending
      </span>
    ),
    confirmed: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-forest-100 text-forest-800">
        Confirmed
      </span>
    ),
    declined: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
        Declined
      </span>
    ),
    cancelled: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
        Cancelled
      </span>
    ),
  }
  return badges[status] || badges.pending
}
