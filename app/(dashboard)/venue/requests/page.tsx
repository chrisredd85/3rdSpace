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
import { useVenueOwnerOptions } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { BookingDetailModal } from '@/components/venue/BookingDetailModal'
import { BulkApprovalDashboard } from '@/components/venue/BulkApprovalDashboard'
import { BulkApprovalSettings } from '@/components/venue/BulkApprovalSettings'
import type { VenueBooking, BookingStatus } from '@/lib/types'

type TabType = 'pending' | 'confirmed'

export default function VenueRequestsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [activeTab, setActiveTab] = useState<TabType>('pending')
  const [selectedBooking, setSelectedBooking] = useState<VenueBooking | null>(null)
  const [selectedBulkVenueId, setSelectedBulkVenueId] = useState('')
  const userId = user?.id || null
  const { data: pendingRequests = [] } = useVenueBookingRequests(userId)
  const { data: allBookings = [], isLoading: allLoading } = useVenueOwnerBookings(userId)
  const { data: venueOptions = [] } = useVenueOwnerOptions(userId)

  const confirmedBookings = useMemo(() => {
    return allBookings.filter((b) => b.status === 'confirmed')
  }, [allBookings])

  const displayedBookings = activeTab === 'pending' ? pendingRequests : confirmedBookings

  const oldRequestsCount = useMemo(() => {
    const now = new Date()
    return pendingRequests.filter((req) => {
      const requestDate = new Date(req.created_at)
      const hoursDiff = (now.getTime() - requestDate.getTime()) / (1000 * 60 * 60)
      return hoursDiff > 24
    }).length
  }, [pendingRequests])

  useEffect(() => {
    if (venueOptions.length === 0) {
      if (selectedBulkVenueId) setSelectedBulkVenueId('')
      return
    }

    const selectedVenueStillExists = venueOptions.some((venue) => venue.id === selectedBulkVenueId)
    if (!selectedBulkVenueId || !selectedVenueStillExists) {
      setSelectedBulkVenueId(venueOptions[0].id)
    }
  }, [venueOptions, selectedBulkVenueId])

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Booking Requests</h1>
        <p className="text-muted-foreground mt-1">Manage incoming booking requests for your venues</p>
      </div>

      {/* Warning Banner */}
      {pendingRequests.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/10">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-200 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-100">
                  {pendingRequests.length} new request{pendingRequests.length !== 1 ? 's' : ''} waiting
                </p>
                <p className="text-sm text-yellow-200 mt-1">
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

      {venueOptions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Approval Tools</CardTitle>
                <CardDescription>
                  Configure auto-approval rules and batch actions for one venue at a time.
                </CardDescription>
              </div>
              <select
                value={selectedBulkVenueId}
                onChange={(event) => setSelectedBulkVenueId(event.target.value)}
                className="h-11 rounded-md border border-border px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {venueOptions.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {selectedBulkVenueId ? (
              <BulkApprovalSettings venueId={selectedBulkVenueId} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a venue to manage approval settings.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'pending'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending Requests
            {pendingRequests.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-200 text-xs font-semibold">
                {pendingRequests.length}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab('confirmed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'confirmed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Confirmed Bookings
            {confirmedBookings.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-semibold">
                {confirmedBookings.length}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Booking Cards */}
      {activeTab === 'pending' ? (
        <Card>
          <CardContent className="p-6">
            <BulkApprovalDashboard venueId={selectedBulkVenueId || undefined} />
          </CardContent>
        </Card>
      ) : allLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading requests...</p>
          </div>
        </div>
      ) : displayedBookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground/60 mb-4" />
            <p className="text-muted-foreground mb-2">No confirmed bookings</p>
            <p className="text-sm text-muted-foreground">Confirmed bookings will appear here</p>
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

  const organizerName = event?.profiles?.name || 'Event Organizer'
  const organizerCompany = event?.profiles?.email || event?.profiles?.phone || 'Builder account'

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
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  {event?.title || 'Event Booking Request'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {organizerName} • {organizerCompany}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {statusBadge}
                {isUrgent && (
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-destructive/15 text-destructive">
                    Urgent
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground/60" />
                <div>
                  <p className="text-muted-foreground">Date</p>
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
                  <Clock className="h-4 w-4 text-muted-foreground/60" />
                  <div>
                    <p className="text-muted-foreground">Time</p>
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
                  <Users className="h-4 w-4 text-muted-foreground/60" />
                  <div>
                    <p className="text-muted-foreground">Guests</p>
                    <p className="font-medium">{event.expected_attendees}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4 text-muted-foreground/60" />
                <div>
                  <p className="text-muted-foreground">Revenue</p>
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
                <p className="text-xs font-medium text-foreground mb-1">Special Requests:</p>
                <p className="text-sm text-muted-foreground line-clamp-2">{booking.notes}</p>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-500/15 text-yellow-200">
        Pending
      </span>
    ),
    confirmed: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-primary/15 text-primary">
        Confirmed
      </span>
    ),
    declined: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-sidebar-accent/40 text-foreground">
        Declined
      </span>
    ),
    cancelled: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-destructive/15 text-destructive">
        Cancelled
      </span>
    ),
    completed: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-primary/15 text-foreground">
        Completed
      </span>
    ),
  }
  return badges[status] || badges.pending
}
