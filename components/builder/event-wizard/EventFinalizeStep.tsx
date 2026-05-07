'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Calendar, Clock, MapPin, Users, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUpdateEvent } from '@/lib/hooks/useEvents'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useRouter } from 'next/navigation'
import type { Event, Vendor, VendorBooking, Venue } from '@/lib/types'

interface EventFinalizeStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

type VenueSummary = Pick<Venue, 'name' | 'city' | 'state'>
type VendorSummary = Pick<Vendor, 'name'>
type VendorBookingWithProfile = VendorBooking & {
  vendor_profiles?: VendorSummary | null
}
type RunOfShowItem = {
  time: Date
  label: string
  type: 'setup' | 'event'
}

export function EventFinalizeStep({ event }: EventFinalizeStepProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const updateEvent = useUpdateEvent()
  const [venue, setVenue] = useState<VenueSummary | null>(null)
  const [vendors, setVendors] = useState<VendorBookingWithProfile[]>([])

  useEffect(() => {
    let isCancelled = false

    async function fetchReviewData() {
      try {
        if (event.venue_id) {
          const { data } = await supabase
            .from('venues')
            .select('name, city, state')
            .eq('id', event.venue_id)
            .single()

          if (!isCancelled) {
            setVenue(data as VenueSummary | null)
          }
        } else {
          setVenue(null)
        }

        if (event.id) {
          const { data } = await supabase
            .from('vendor_bookings')
            .select('*, vendor_profiles(name)')
            .eq('event_id', event.id)

          if (!isCancelled) {
            setVendors((data || []) as VendorBookingWithProfile[])
          }
        }
      } catch (error) {
        console.error('Error loading finalize review data:', error)
      }
    }

    fetchReviewData()

    return () => {
      isCancelled = true
    }
  }, [event.id, event.venue_id])

  const runOfShow = useMemo<RunOfShowItem[]>(() => {
    const eventWithLegacyTime = event as Event & { event_time?: string | null }
    const startTime = event.start_time || eventWithLegacyTime.event_time
    if (!event.event_date || !startTime || vendors.length === 0) return []

    const eventStart = new Date(`${event.event_date}T${startTime}`)
    if (Number.isNaN(eventStart.getTime())) return []

    const items: RunOfShowItem[] = vendors.map((booking) => {
      const setupTime = new Date(eventStart.getTime() - 60 * 60000)
      return {
        time: setupTime,
        label: `${booking.vendor_profiles?.name || 'Vendor'} Setup`,
        type: 'setup',
      }
    })

    items.push({ time: eventStart, label: 'Event Start', type: 'event' })

    return items.sort((a, b) => a.time.getTime() - b.time.getTime())
  }, [event, vendors])

  const handleFinalize = async () => {
    try {
      await updateEvent.mutateAsync({ id: event.id, updates: { status: 'confirmed' } })
      addToast({ title: 'Event finalized!', description: 'Your event has been confirmed and booking requests have been sent.' })
      router.push('/planner')
    } catch {
      addToast({ title: 'Error', description: 'Failed to finalize event', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Run of Show */}
      <div className="rounded-xl border border-border bg-card/20 p-5">
        <h3 className="mb-4 font-display font-semibold text-foreground">Run of Show</h3>
        {runOfShow.length > 0 ? (
          <div className="space-y-3">
            {runOfShow.map((item, index) => (
              <div
                key={`${item.type}-${item.time.toISOString()}-${index}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card/20 p-4 transition-smooth hover:bg-card/40"
              >
                <div className="shrink-0">
                  {item.type === 'event' ? (
                    <CheckCircle className="h-5 w-5 text-primary" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground/60" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-sidebar-accent/20 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">Add vendors and an event time to generate your run of show</p>
          </div>
        )}
      </div>

      {/* Event Details */}
      <div className="rounded-xl border border-border bg-card/20 p-5">
        <h3 className="mb-4 font-display font-semibold text-foreground">Event Details</h3>
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground/60" />
            <span className="text-muted-foreground">Name:</span>
            <span className="font-medium text-foreground">{event.title || (event as { name?: string }).name}</span>
          </div>
          {event.event_date && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground/60" />
              <span className="text-muted-foreground">Date:</span>
              <span className="font-medium text-foreground">
                {new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
          )}
          {event.expected_attendees && (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground/60" />
              <span className="text-muted-foreground">Expected Attendance:</span>
              <span className="font-medium text-foreground">{event.expected_attendees}</span>
            </div>
          )}
          {event.budget && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground/60" />
              <span className="text-muted-foreground">Budget:</span>
              <span className="font-medium text-foreground">${event.budget.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Venue */}
      {venue && (
        <div className="rounded-xl border border-border bg-card/20 p-5">
          <h3 className="mb-3 font-display font-semibold text-foreground">Venue</h3>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground/60" />
            <span className="font-medium text-foreground">{venue.name}</span>
            <span className="text-muted-foreground">· {venue.city}, {venue.state}</span>
          </div>
        </div>
      )}

      {/* Vendors */}
      {vendors.length > 0 && (
        <div className="rounded-xl border border-border bg-card/20 p-5">
          <h3 className="mb-3 font-display font-semibold text-foreground">Vendors ({vendors.length})</h3>
          <div className="space-y-2">
            {vendors.map((booking) => (
              <div key={booking.id} className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="text-foreground">{booking.vendor_profiles?.name || 'Vendor'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border pt-5">
        <Button variant="hero" onClick={handleFinalize} className="w-full" size="lg">
          Confirm & Finalize Event
        </Button>
      </div>
    </div>
  )
}
