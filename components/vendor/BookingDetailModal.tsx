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
  useUpdateVendorBookingStatus,
} from '@/lib/hooks/useBookings'
import { useCreateOrGetThread, useCreateThread } from '@/lib/hooks/useMessages'
import { useToast } from '@/components/ui/toast'
import { StripeIntegrationNotice } from '@/components/shared/StripeIntegrationNotice'
import { supabase } from '@/lib/supabase/client'
import type { VendorBookingWithEvent, BookingStatus } from '@/lib/types'

interface BookingDetailModalProps {
  booking: VendorBookingWithEvent
  onClose: () => void
  vendorId: string | null
}

/**
 * Modal for vendors to review an incoming booking request and respond
 * (accept, decline, or send a counter offer with a custom price).
 */
export function BookingDetailModal({
  booking,
  onClose,
  vendorId,
}: BookingDetailModalProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [note, setNote] = useState('')
  const [counterOfferPrice, setCounterOfferPrice] = useState<string>(
    booking.quoted_price != null ? String(booking.quoted_price) : ''
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateStatus = useUpdateVendorBookingStatus()
  const createThread = useCreateOrGetThread()

  type EventShape = { id?: string; builder_id?: string; title?: string; expected_attendees?: number; venue_name?: string; description?: string; venue_address?: string }
  type VendorShape = { name?: string; business_name?: string; service_type?: string }
  const event = booking.events as EventShape | null | undefined
  const vendor = (booking as VendorBookingWithEvent & { vendors?: VendorShape | null }).vendors

  const organizerId = event?.builder_id
  // TODO: Fetch real organizer contact info from the profiles table using organizerId.
  // These are placeholders until the profile join is implemented.
  const organizerName = 'Event Organizer'
  const organizerEmail = '—'
  const organizerPhone = '—'

  const handleAccept = async () => {
    if (!vendorId || !organizerId) return

    setIsSubmitting(true)
    try {
      // Update booking status
      await updateStatus.mutateAsync({
        bookingId: booking.id,
        status: 'confirmed',
        confirmedDate: booking.requested_date ?? undefined,
        confirmedStartTime: booking.requested_start_time ?? undefined,
        confirmedEndTime: booking.requested_end_time ?? undefined,
        finalPrice: booking.quoted_price ?? undefined,
      })

      // Create message thread (if it doesn't exist)
      try {
        await createThread.mutateAsync({
          participant_2_id: organizerId!,
          event_id: event?.id ?? undefined,
          venue_booking_id: undefined,
          vendor_booking_id: booking.id,
        } as { participant_2_id: string; event_id?: string; venue_booking_id?: string; vendor_booking_id?: string })
      } catch {
        // Thread may already exist — that's expected and safe to ignore
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
        status: 'declined',
      })

      // Create message thread (if it doesn't exist)
      let thread
      try {
        thread = await createThread.mutateAsync({
          participant_2_id: organizerId!,
          event_id: event?.id ?? undefined,
          venue_booking_id: undefined,
          vendor_booking_id: booking.id,
        } as { participant_2_id: string; event_id?: string; venue_booking_id?: string; vendor_booking_id?: string })
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
          vendor_booking_id: booking.id,
          sender_id: vendorId,
          receiver_id: organizerId,
          content: note.trim(),
          read: false,
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
        status: 'pending', // Keep as pending for counter offer
        finalPrice: parseFloat(counterOfferPrice),
      })

      // Create message thread (if it doesn't exist)
      let thread
      try {
        thread = await createThread.mutateAsync({
          participant_2_id: organizerId!,
          event_id: event?.id ?? undefined,
          venue_booking_id: undefined,
          vendor_booking_id: booking.id,
        } as { participant_2_id: string; event_id?: string; venue_booking_id?: string; vendor_booking_id?: string })
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
          vendor_booking_id: booking.id,
          sender_id: vendorId,
          receiver_id: organizerId,
          content: messageContent,
          read: false,
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
  const setupTime = Number(booking.setup_time) || 60 // Default 60 minutes
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/80 backdrop-blur-sm p-4">
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
            <h3 className="text-sm font-semibold text-ink mb-3">Event Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-ink-soft/60" />
                <div>
                  <p className="text-ink-soft">Date</p>
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
                  <Users className="h-4 w-4 text-ink-soft/60" />
                  <div>
                    <p className="text-ink-soft">Expected Guests</p>
                    <p className="font-medium">{event.expected_attendees}</p>
                  </div>
                </div>
              )}

              {event?.venue_name && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-ink-soft/60" />
                  <div>
                    <p className="text-ink-soft">Venue</p>
                    <p className="font-medium">{event.venue_name}</p>
                  </div>
                </div>
              )}

              {booking.duration && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-ink-soft/60" />
                  <div>
                    <p className="text-ink-soft">Duration</p>
                    <p className="font-medium">{booking.duration} hours</p>
                  </div>
                </div>
              )}
            </div>

            {event?.description && (
              <div className="mt-4">
                <p className="text-sm font-medium text-ink mb-1">Event Description</p>
                <p className="text-sm text-ink-soft">{event.description}</p>
              </div>
            )}
          </section>

          {/* Setup & Timeline */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Setup & Timeline</h3>
            <div className="bg-cream rounded-lg p-4 space-y-3">
              {arrivalTime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-ink-soft/60" />
                    <span className="text-sm font-medium text-ink">Arrival Time</span>
                  </div>
                  <span className="text-sm text-ink">
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
                    <CheckCircle className="h-4 w-4 text-clay" />
                    <span className="text-sm font-medium text-ink">Event Start</span>
                  </div>
                  <span className="text-sm text-ink">
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
                    <XCircle className="h-4 w-4 text-ink-soft/60" />
                    <span className="text-sm font-medium text-ink">Event End</span>
                  </div>
                  <span className="text-sm text-ink">
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
                    <Clock className="h-4 w-4 text-ink-soft/60" />
                    <span className="text-sm font-medium text-ink">Load-Out Complete</span>
                  </div>
                  <span className="text-sm text-ink">
                    {loadOutTime.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}

              {booking.setup_time && (
                <div className="pt-2 border-t border-tan">
                  <span className="text-xs text-ink-soft">
                    Setup time: {booking.setup_time} minutes
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Venue Information */}
          {event?.venue_name && (
            <section>
              <h3 className="text-sm font-semibold text-ink mb-3">Venue Information</h3>
              <div className="bg-cream rounded-lg p-4">
                <p className="text-sm font-medium text-ink mb-1">{event.venue_name}</p>
                {event?.venue_address && (
                  <p className="text-sm text-ink-soft">{event.venue_address}</p>
                )}
              </div>
            </section>
          )}

          {/* Service Details */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Service Details
            </h3>
            {booking.notes ? (
              <div className="bg-cream rounded-lg p-4">
                <p className="text-sm text-ink whitespace-pre-wrap">{booking.notes}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">No specific service details provided</p>
            )}
          </section>

          {/* Organizer Contact */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Organizer Contact</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-ink-soft/60" />
                <span className="font-medium">{organizerName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <Mail className="h-4 w-4 text-ink-soft/60" />
                <span>{organizerEmail}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <Phone className="h-4 w-4 text-ink-soft/60" />
                <span>{organizerPhone}</span>
              </div>
            </div>
          </section>

          {/* Fee Breakdown */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Fee Breakdown</h3>
            <div className="bg-cream rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span className="font-semibold text-ink">Your Fee</span>
                <span className="font-bold text-lg text-clay">
                  ${booking.quoted_price?.toLocaleString() || 'TBD'}
                </span>
              </div>
              <StripeIntegrationNotice context="inline" />
            </div>
          </section>

          {/* Add Note */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Add Note to Client (Optional)</h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a message to the organizer..."
              rows={3}
              className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
            />
          </section>

          {/* Counter Offer Section */}
          <section>
            <h3 className="text-sm font-semibold text-ink mb-3">Counter Offer</h3>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-ink-soft/60" />
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
          <div className="flex items-center gap-3 pt-4 border-t border-tan">
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
            <div className="text-center text-sm text-ink-soft">
              Processing...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
