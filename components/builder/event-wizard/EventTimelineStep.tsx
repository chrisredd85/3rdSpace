'use client'

import { useState, useMemo } from 'react'
import { Clock, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export function EventTimelineStep({ event, onNext }: EventTimelineStepProps) {
  const [vendorBookings, setVendorBookings] = useState<any[]>([])

  useMemo(() => {
    if (event?.id) {
      supabase.from('vendor_bookings').select('*, vendor_profiles(*)').eq('event_id', event.id)
        .then(({ data }: { data: unknown }) => {
          if (data) setVendorBookings(Array.isArray(data) ? data : data ? [data] : [])
        })
    }
  }, [event?.id])

  const timeline = useMemo(() => {
    if (!event?.event_date || !(event.start_time || (event as { event_time?: string }).event_time)) return []
    const eventStart = new Date(`${event.event_date}T${event.start_time || (event as { event_time?: string }).event_time}`)
    const items: { time: Date; label: string; type: string }[] = []
    vendorBookings.forEach((booking) => {
      const vendor = booking.vendor_profiles
      const arrivalTime = new Date(eventStart.getTime() - 60 * 60000)
      items.push({ time: arrivalTime, label: `${vendor?.name || 'Vendor'} Setup`, type: 'setup' })
    })
    items.push({ time: eventStart, label: 'Event Start', type: 'event' })
    return items.sort((a, b) => a.time.getTime() - b.time.getTime())
  }, [event, vendorBookings])

  return (
    <div className="space-y-5">
      {timeline.length > 0 ? (
        <div className="space-y-3">
          {timeline.map((item, index) => (
            <div key={index} className="flex items-center gap-4 rounded-xl border border-border bg-card/20 p-4 transition-smooth hover:bg-card/40">
              <div className="shrink-0">
                {item.type === 'event'
                  ? <CheckCircle className="h-5 w-5 text-primary" />
                  : <Clock className="h-5 w-5 text-muted-foreground/60" />
                }
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
        <div className="rounded-xl border border-border bg-sidebar-accent/20 py-12 text-center">
          <p className="text-muted-foreground">Timeline will be generated once vendors are selected</p>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button variant="hero" onClick={onNext}>Next: Checklist</Button>
      </div>
    </div>
  )
}
