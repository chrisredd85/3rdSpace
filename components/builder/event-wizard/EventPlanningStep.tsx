'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { EventbriteImportPanel } from '@/components/builder/event-wizard/EventbriteImportPanel'
import { useUpdateEvent } from '@/lib/hooks/useEvents'
import { useToast } from '@/components/ui/toast'
import type { Event } from '@/lib/types'

const planningSchema = z.object({
  name: z.string().min(2, 'Event name must be at least 2 characters'),
  event_type: z.string().min(1, 'Event type is required'),
  expected_attendees: z.number().min(1, 'Expected attendance is required'),
  min_attendees: z.number().optional(),
  max_attendees: z.number().optional(),
  event_date: z.string().min(1, 'Event date is required'),
  event_time: z.string().min(1, 'Event time is required'),
  budget: z.number().min(0, 'Budget must be at least 0'),
})

type PlanningFormData = z.infer<typeof planningSchema>

interface EventPlanningStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
  ensureEventReady?: (data: PlanningFormData) => Promise<string | null>
}

const inputCls = `
  w-full px-4 py-3 rounded-xl
  border border-border bg-card/40 text-foreground placeholder:text-muted-foreground
  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
  transition-smooth hover:border-border/80 hover:bg-card
`

const selectCls = `
  w-full px-4 py-3 rounded-xl
  border border-border bg-card/40 text-foreground
  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
  transition-smooth hover:border-border/80 hover:bg-card
  appearance-none
  bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23a1a1aa%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]
  bg-no-repeat bg-right-4 bg-[length:18px]
`

export function EventPlanningStep({
  event,
  onNext,
  onSave,
  ensureEventReady,
}: EventPlanningStepProps) {
  const { addToast } = useToast()
  const updateEvent = useUpdateEvent()

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
    reset,
  } = useForm<PlanningFormData>({ resolver: zodResolver(planningSchema) })

  useEffect(() => {
    if (event) {
      const eventDate = event.event_date ? new Date(event.event_date).toISOString().split('T')[0] : ''
      const eventTime = event.start_time || (event as { event_time?: string }).event_time || ''
      reset({
        name: event.title || (event as { name?: string }).name || '',
        event_type: event.event_type || '',
        expected_attendees: event.expected_attendees ?? 0,
        min_attendees: undefined,
        max_attendees: undefined,
        event_date: eventDate,
        event_time: eventTime,
        budget: event.budget ?? 0,
      })
    }
  }, [event, reset])

  const onSubmit = async (data: PlanningFormData) => {
    try {
      const eventDate = new Date(`${data.event_date}T${data.event_time}`)
      await updateEvent.mutateAsync({
        id: event.id,
        updates: {
          title: data.name,
          event_type: data.event_type,
          expected_attendees: data.expected_attendees,
          event_date: eventDate.toISOString().slice(0, 10),
          start_time: data.event_time,
          end_time: data.event_time,
          budget: data.budget,
          status: 'planning',
        },
      })
      addToast({ title: 'Planning details saved', description: 'Your event planning information has been saved.' })
      onNext()
    } catch {
      addToast({ title: 'Error', description: 'Failed to save planning details', variant: 'destructive' })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-7">
      {/* Event Name */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          Event Name <span className="text-destructive">*</span>
        </label>
        <input type="text" {...register('name')} placeholder="e.g., Annual Tech Summit 2026" className={inputCls} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        <p className="text-xs text-muted-foreground">Choose a clear, descriptive name for your event</p>
      </div>

      {/* Event Type */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          Event Type <span className="text-destructive">*</span>
        </label>
        <select {...register('event_type')} className={selectCls}>
          <option value="">Select type...</option>
          <option value="networking">Networking Event</option>
          <option value="conference">Conference</option>
          <option value="workshop">Workshop</option>
          <option value="social_mixer">Party / Social Mixer</option>
          <option value="all_hands">Meeting / All-Hands</option>
          <option value="product_launch">Product Launch</option>
          <option value="other">Other</option>
        </select>
        {errors.event_type && <p className="text-xs text-destructive">{errors.event_type.message}</p>}
      </div>

      {/* Attendance */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            Expected Attendance <span className="text-destructive">*</span>
          </label>
          <input type="number" {...register('expected_attendees', { valueAsNumber: true })} placeholder="100" className={inputCls} />
          {errors.expected_attendees && <p className="text-xs text-destructive">{errors.expected_attendees.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">Min Attendance</label>
          <input type="number" {...register('min_attendees', { valueAsNumber: true })} placeholder="50" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">Max Attendance</label>
          <input type="number" {...register('max_attendees', { valueAsNumber: true })} placeholder="150" className={inputCls} />
        </div>
      </div>

      {/* Date & Time */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            Event Date <span className="text-destructive">*</span>
          </label>
          <input type="date" {...register('event_date')} className={inputCls} />
          {errors.event_date && <p className="text-xs text-destructive">{errors.event_date.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            Event Time <span className="text-destructive">*</span>
          </label>
          <input type="time" {...register('event_time')} className={inputCls} />
          {errors.event_time && <p className="text-xs text-destructive">{errors.event_time.message}</p>}
        </div>
      </div>

      {/* Budget */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          Total Budget ($) <span className="text-destructive">*</span>
        </label>
        <input type="number" {...register('budget', { valueAsNumber: true })} placeholder="10000" className={inputCls} />
        {errors.budget && <p className="text-xs text-destructive">{errors.budget.message}</p>}
        <p className="text-xs text-muted-foreground">Estimate your total event budget including venue, vendors, and other expenses</p>
      </div>

      <EventbriteImportPanel
        eventId={event.id}
        ensureEventReady={() => ensureEventReady?.(getValues()) ?? Promise.resolve(null)}
      />
    </form>
  )
}
