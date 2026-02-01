'use client'

import { useState, useMemo } from 'react'
import { CheckCircle, Calendar, MapPin, Users, DollarSign } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useEvent } from '@/lib/hooks/useEvents'
import { useUpdateEvent } from '@/lib/hooks/useEvents'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useRouter } from 'next/navigation'
import type { Event } from '@/lib/types'

interface EventFinalizeStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

export function EventFinalizeStep({
  event,
}: EventFinalizeStepProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const updateEvent = useUpdateEvent()
  const { data: eventData } = useEvent(event.id)

  const [venue, setVenue] = useState<any>(null)
  const [vendors, setVendors] = useState<any[]>([])

  useMemo(() => {
    if (event?.venue_id) {
      supabase
        .from('venues')
        .select('*')
        .eq('id', event.venue_id)
        .single()
        .then(({ data }: { data: unknown }) => setVenue(data))
    }

    if (event?.id) {
      supabase
        .from('vendor_bookings')
        .select('*, vendors(*)')
        .eq('event_id', event.id)
        .then(({ data }: { data: unknown }) => setVendors(Array.isArray(data) ? data : data ? [data] : []))
    }
  }, [event])

  const handleFinalize = async () => {
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        updates: {
          status: 'confirmed',
        },
      })

      addToast({
        title: 'Event finalized!',
        description: 'Your event has been confirmed and booking requests have been sent.',
      })

      router.push('/builder')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to finalize event',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Step 8: Finalize</CardTitle>
          <CardDescription>
            Review all details before confirming your event
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Event Details */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Event Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span className="text-gray-600">Name:</span>
                <span className="font-medium">{event.title || (event as { name?: string }).name}</span>
              </div>
              {event.event_date && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">Date:</span>
                  <span className="font-medium">
                    {new Date(event.event_date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
              {event.expected_attendees && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">Expected Attendance:</span>
                  <span className="font-medium">{event.expected_attendees}</span>
                </div>
              )}
              {event.budget && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-600">Budget:</span>
                  <span className="font-medium">${event.budget.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Venue */}
          {venue && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Venue</h3>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-gray-400" />
                <span className="font-medium">{venue.name}</span>
                <span className="text-gray-600">• {venue.city}, {venue.state}</span>
              </div>
            </div>
          )}

          {/* Vendors */}
          {vendors.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Vendors ({vendors.length})</h3>
              <div className="space-y-2">
                {vendors.map((booking) => (
                  <div key={booking.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-forest-500" />
                    <span>{booking.vendors?.name || 'Vendor'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 border-t">
            <Button onClick={handleFinalize} className="w-full" size="lg">
              Confirm & Finalize Event
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
