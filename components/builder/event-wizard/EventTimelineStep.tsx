'use client'

import { useState, useMemo } from 'react'
import { Clock, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useEvent } from '@/lib/hooks/useEvents'
import { supabase } from '@/lib/supabase/client'
import type { Event } from '@/lib/types'

interface EventTimelineStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

export function EventTimelineStep({
  event,
  onNext,
}: EventTimelineStepProps) {
  const [vendorBookings, setVendorBookings] = useState<any[]>([])

  useMemo(() => {
    if (event?.id) {
      supabase
        .from('vendor_bookings')
        .select('*, vendors(*)')
        .eq('event_id', event.id)
        .then(({ data }) => {
          if (data) setVendorBookings(data)
        })
    }
  }, [event?.id])

  // Auto-generate timeline based on vendor setup times
  const timeline = useMemo(() => {
    if (!event?.event_date || !event?.event_time) return []

    const eventStart = new Date(`${event.event_date}T${event.event_time}`)
    const timelineItems = []

    // Vendor setup times (would fetch from vendor_bookings)
    vendorBookings.forEach((booking) => {
      const vendor = booking.vendors
      const setupTime = 60 // Default, would come from vendor settings
      const arrivalTime = new Date(eventStart.getTime() - setupTime * 60000)

      timelineItems.push({
        time: arrivalTime,
        label: `${vendor?.name || 'Vendor'} Setup`,
        type: 'setup',
      })
    })

    timelineItems.push({
      time: eventStart,
      label: 'Event Start',
      type: 'event',
    })

    return timelineItems.sort((a, b) => a.time.getTime() - b.time.getTime())
  }, [event, vendorBookings])

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Step 5: Timeline</CardTitle>
          <CardDescription>
            Auto-generated timeline based on your vendors and event details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {timeline.length > 0 ? (
            <div className="space-y-3">
              {timeline.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex-shrink-0">
                    {item.type === 'event' ? (
                      <CheckCircle className="h-5 w-5 text-forest-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.label}</p>
                    <p className="text-sm text-gray-600">
                      {item.time.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-center py-8">
              Timeline will be generated once vendors are selected
            </p>
          )}

          <div className="flex justify-end pt-4">
            <Button onClick={onNext}>Next: Checklist</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
