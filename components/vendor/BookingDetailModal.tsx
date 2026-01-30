'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Calendar,
  Clock,
  Users,
  DollarSign,
  Mail,
  Phone,
  MapPin,
  FileText,
  CheckCircle,
  XCircle,
  MessageSquare,
  Package,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useUpdateBookingStatus,
} from '@/lib/hooks/useBookings'
import { useCreateOrGetThread } from '@/lib/hooks/useMessages'
import { useToast } from '@/components/ui/toast'
import { supabase } from '@/lib/supabase/client'
import type { VendorBooking, BookingStatus } from '@/lib/types'

interface BookingDetailModalProps {
  booking: VendorBooking & {
    events?: any
    vendors?: any
  }
  onClose: () => void
  vendorId: string | null
}

export function BookingDetailModal({
  booking,
  onClose,
  vendorId,
}: BookingDetailModalProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [note, setNote] = useState('')
  const [counterOfferPrice, setCounterOfferPrice] = useState<string>(
    booking.quoted_price?.toString() || ''
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateStatus = useUpdateBookingStatus()
  const createThread = useCreateOrGetThread()

  const event = booking.events as any
  const vendor = booking.vendors as any

  // Get organizer info (would fetch from profiles table)
  const organizerId = event?.builder_id
  const organizerName = 'Event Organizer' // Mock
  const organizerEmail = 'organizer@example.com' // Mock
  const organizerPhone = '(555) 123-4567' // Mock

  const handleAccept = async () => {
    if (!vendorId || !organizerId) return

    setIsSubmitting(true)
    try {
      // Update booking status
      await updateStatus.mutateAsync({
        bookingId: booking.id,
        bookingType: 'vendor',
        status: 'confirmed',
        confirmedDate: booking.requested_date,
        confirmedStartTime: booking.requested_start_time,
        confirmedEndTime: booking.requested_end_time,
        finalPrice: booking.quoted_price || undefined,
      })

      // Create message thread (if it doesn't exist)
      try {
        await createThread.mutateAsync({
          participant1Id: vendorId,
          participant2Id: organizerId,
          eventId: event?.id || null,
          venueBookingId: null,
          vendorBookingId: booking.id,
        })
      } catch (error) {
        // Thread might already exist, that's okay
        console.log('Thread creation:', error)
      }

      addToast({
        title: 'Booking confirmed!',
        description: 'The organizer has been notified and a message thread has been created.',
      })

      onClose()
      router.refresh()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to confirm booking',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDecline = async () => {
    if (!vendorId || !organizerId) return

    setIsSubmitting(true)
    try {
      // Update booking status
      await updateStatus.mutateAsync({
        bookingId: booking.id,
        bookingType: 'vendor',
        status: 'declined',
      })

      // Create message thread (if it doesn't exist)
      let thread
      try {
        thread = await createThread.mutateAsync({
          participant1Id: vendorId,
          participant2Id: organizerId,
          eventId: event?.id || null,
          venueBookingId: null,
          vendorBookingId: booking.id,
        })
      } catch (error) {
        // Thread might already exist, try to get it
        const { data: existingThread } = await supabase
          .from('message_threads')
          .select('*')
          .or(
            `and(participant_1_id.eq.${vendorId},participant_2_id.eq.${organizerId}),and(participant_1_id.eq.${organizerId},participant_2_id.eq.${vendorId})`
          )
          .maybeSingle()
        thread = existingThread
      }

      // Send message with decline note if provided
      if (note.trim() && thread) {
        await supabase.from('messages').insert({
          thread_id: thread.id,
          sender_id: vendorId,
          content: note.trim(),
          is_read: false,
        })
      }

      addToast({
        title: 'Booking declined',
        description: 'The organizer has been notified.',
      })

      onClose()
      router.refresh()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to decline booking',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCounterOffer = async () => {
    if (!vendorId || !organizerId || !counterOfferPrice) return

    setIsSubmitting(true)
    try {
      // Update booking with counter offer price
      await updateStatus.mutateAsync({
        bookingId: booking.id,
        bookingType: 'vendor',
        status: 'pending', // Keep as pending for counter offer
        finalPrice: parseFloat(counterOfferPrice),
      })

      // Create message thread (if it doesn't exist)
      let thread
      try {
        thread = await createThread.mutateAsync({
          participant1Id: vendorId,
          participant2Id: organizerId,
          eventId: event?.id || null,
          venueBookingId: null,
          vendorBookingId: booking.id,
        })
      } catch (error) {
        // Thread might already exist, try to get it
        const { data: existingThread } = await supabase
          .from('message_threads')
          .select('*')
          .or(
            `and(participant_1_id.eq.${vendorId},participant_2_id.eq.${organizerId}),and(participant_1_id.eq.${organizerId},participant_2_id.eq.${vendorId})`
          )
          .maybeSingle()
        thread = existingThread
      }

      // Send counter offer message
      if (thread) {
        const messageContent = note.trim()
          ? `Counter offer: $${parseFloat(counterOfferPrice).toLocaleString()}\n\n${note.trim()}`
          : `Counter offer: $${parseFloat(counterOfferPrice).toLocaleString()}`

        await supabase.from('messages').insert({
          thread_id: thread.id,
          sender_id: vendorId,
          content: messageContent,
          is_read: false,
        })
      }

      addToast({
        title: 'Counter offer sent',
        description: 'The organizer has been notified of your counter offer.',
      })

      onClose()
      router.refresh()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to send counter offer',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestedDate = booking.requested_date
    ? new Date(booking.requested_date)
    : null

  // Calculate timeline
  const eventStartTime = booking.requested_start_time
    ? new Date(`2000-01-01T${booking.requested_start_time}`)
    : null
  const setupTime = booking.setup_time || 60 // Default 60 minutes
  const arrivalTime = eventStartTime
    ? new Date(eventStartTime.getTime() - setupTime * 60000)
    : null
  const eventEndTime = booking.requested_end_time
    ? new Date(`2000-01-01T${booking.requested_end_time}`)
    : null
  const loadOutTime = eventEndTime
    ? new Date(eventEndTime.getTime() + 30 * 60000) // 30 min load-out
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{event?.title || 'Booking Request'}</CardTitle>
              <CardDescription className="mt-1">
                Review booking details and respond to the request
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Event Information */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Event Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-gray-600">Date</p>
                  <p className="font-medium">
                    {requestedDate
                      ? requestedDate.toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'TBD'}
                  </p>
                </div>
              </div>

              {event?.expected_attendees && (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-gray-600">Expected Guests</p>
                    <p className="font-medium">{event.expected_attendees}</p>
                  </div>
                </div>
              )}

              {event?.venue_name && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-gray-600">Venue</p>
                    <p className="font-medium">{event.venue_name}</p>
                  </div>
                </div>
              )}

              {booking.duration && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-gray-600">Duration</p>
                    <p className="font-medium">{booking.duration} hours</p>
                  </div>
                </div>
              )}
            </div>

            {event?.description && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-1">Event Description</p>
                <p className="text-sm text-gray-600">{event.description}</p>
              </div>
            )}
          </section>

          {/* Setup & Timeline */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Setup & Timeline</h3>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              {arrivalTime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Arrival Time</span>
                  </div>
                  <span className="text-sm text-gray-900">
                    {arrivalTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {eventStartTime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-forest-500" />
                    <span className="text-sm font-medium text-gray-700">Event Start</span>
                  </div>
                  <span className="text-sm text-gray-900">
                    {eventStartTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {eventEndTime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Event End</span>
                  </div>
                  <span className="text-sm text-gray-900">
                    {eventEndTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {loadOutTime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Load-Out Complete</span>
                  </div>
                  <span className="text-sm text-gray-900">
                    {loadOutTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {booking.setup_time && (
                <div className="pt-2 border-t border-gray-200">
                  <span className="text-xs text-gray-600">
                    Setup time: {booking.setup_time} minutes
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Venue Information */}
          {event?.venue_name && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Venue Information</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-900 mb-1">{event.venue_name}</p>
                {event?.venue_address && (
                  <p className="text-sm text-gray-600">{event.venue_address}</p>
                )}
              </div>
            </section>
          )}

          {/* Service Details */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Service Details
            </h3>
            {booking.notes ? (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{booking.notes}</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No specific service details provided</p>
            )}
          </section>

          {/* Organizer Contact */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Organizer Contact</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-gray-400" />
                <span className="font-medium">{organizerName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{organizerEmail}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="h-4 w-4 text-gray-400" />
                <span>{organizerPhone}</span>
              </div>
            </div>
          </section>

          {/* Fee Breakdown */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Fee Breakdown</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-900">Your Fee</span>
                <span className="font-bold text-lg text-forest-600">
                  ${booking.quoted_price?.toLocaleString() || 'TBD'}
                </span>
              </div>
            </div>
          </section>

          {/* Add Note */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Add Note to Client (Optional)</h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a message to the organizer..."
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </section>

          {/* Counter Offer Section */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Counter Offer</h3>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-gray-400" />
              <Input
                type="number"
                placeholder="Enter counter offer amount"
                value={counterOfferPrice}
                onChange={(e) => setCounterOfferPrice(e.target.value)}
                className="flex-1"
              />
            </div>
          </section>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={handleDecline}
              disabled={isSubmitting}
              className="flex-1"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Decline
            </Button>
            <Button
              variant="outline"
              onClick={handleCounterOffer}
              disabled={isSubmitting || !counterOfferPrice}
              className="flex-1"
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Counter Offer
            </Button>
            <Button
              onClick={handleAccept}
              disabled={isSubmitting}
              className="flex-1"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Accept Booking
            </Button>
          </div>

          {isSubmitting && (
            <div className="text-center text-sm text-gray-600">
              Processing...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
