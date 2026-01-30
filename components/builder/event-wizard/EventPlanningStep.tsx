'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
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
}

export function EventPlanningStep({
  event,
  onNext,
  onSave,
}: EventPlanningStepProps) {
  const { addToast } = useToast()
  const updateEvent = useUpdateEvent()

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PlanningFormData>({
    resolver: zodResolver(planningSchema),
  })

  useEffect(() => {
    if (event) {
      const eventDate = event.event_date ? new Date(event.event_date).toISOString().split('T')[0] : ''
      const eventTime = event.event_time || ''

      reset({
        name: event.name || '',
        event_type: event.event_type || '',
        expected_attendees: event.expected_attendees || 0,
        min_attendees: event.min_attendees || undefined,
        max_attendees: event.max_attendees || undefined,
        event_date: eventDate,
        event_time: eventTime,
        budget: event.budget || 0,
      })
    }
  }, [event, reset])

  const onSubmit = async (data: PlanningFormData) => {
    try {
      const eventDate = new Date(`${data.event_date}T${data.event_time}`)

      await updateEvent.mutateAsync({
        id: event.id,
        updates: {
          name: data.name,
          event_type: data.event_type,
          expected_attendees: data.expected_attendees,
          min_attendees: data.min_attendees || null,
          max_attendees: data.max_attendees || null,
          event_date: eventDate.toISOString(),
          event_time: data.event_time,
          budget: data.budget,
          status: 'planning',
        },
      })

      addToast({
        title: 'Planning details saved',
        description: 'Your event planning information has been saved.',
      })

      onNext()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to save planning details',
        variant: 'destructive',
      })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Event Name */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-slate-700">
          Event Name
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          type="text"
          {...register('name')}
          placeholder="e.g., Annual Tech Summit 2026"
          className="
            w-full px-4 py-3 
            bg-white border-2 border-slate-200 
            rounded-xl 
            text-slate-900 placeholder-slate-400
            focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
            transition-all duration-200
            hover:border-slate-300
          "
        />
        {errors.name && (
          <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>
        )}
        <p className="text-xs text-slate-500">
          Choose a clear, descriptive name for your event
        </p>
      </div>

      {/* Event Type */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-slate-700">
          Event Type
          <span className="text-red-500 ml-1">*</span>
        </label>
        <select
          {...register('event_type')}
          className="
            w-full px-4 py-3 
            bg-white border-2 border-slate-200 
            rounded-xl 
            text-slate-900
            focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
            transition-all duration-200
            hover:border-slate-300
            appearance-none
            bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23334155%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]
            bg-no-repeat bg-right-4 bg-[length:20px]
          "
        >
          <option value="">Select type...</option>
          <option value="networking">Networking Event</option>
          <option value="conference">Conference</option>
          <option value="workshop">Workshop</option>
          <option value="party">Party</option>
          <option value="meeting">Meeting</option>
          <option value="other">Other</option>
        </select>
        {errors.event_type && (
          <p className="text-sm text-red-500 mt-1">{errors.event_type.message}</p>
        )}
      </div>

      {/* Attendance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Expected Attendance
            <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="number"
            {...register('expected_attendees', { valueAsNumber: true })}
            placeholder="100"
            className="
              w-full px-4 py-3 
              bg-white border-2 border-slate-200 
              rounded-xl 
              text-slate-900 placeholder-slate-400
              focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
              transition-all duration-200
              hover:border-slate-300
            "
          />
          {errors.expected_attendees && (
            <p className="text-sm text-red-500 mt-1">{errors.expected_attendees.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Min Attendance
          </label>
          <input
            type="number"
            {...register('min_attendees', { valueAsNumber: true })}
            placeholder="50"
            className="
              w-full px-4 py-3 
              bg-white border-2 border-slate-200 
              rounded-xl 
              text-slate-900 placeholder-slate-400
              focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
              transition-all duration-200
              hover:border-slate-300
            "
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Max Attendance
          </label>
          <input
            type="number"
            {...register('max_attendees', { valueAsNumber: true })}
            placeholder="150"
            className="
              w-full px-4 py-3 
              bg-white border-2 border-slate-200 
              rounded-xl 
              text-slate-900 placeholder-slate-400
              focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
              transition-all duration-200
              hover:border-slate-300
            "
          />
        </div>
      </div>

      {/* Date & Time */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Event Date
            <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="date"
            {...register('event_date')}
            className="
              w-full px-4 py-3 
              bg-white border-2 border-slate-200 
              rounded-xl 
              text-slate-900
              focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
              transition-all duration-200
              hover:border-slate-300
            "
          />
          {errors.event_date && (
            <p className="text-sm text-red-500 mt-1">{errors.event_date.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Event Time
            <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="time"
            {...register('event_time')}
            className="
              w-full px-4 py-3 
              bg-white border-2 border-slate-200 
              rounded-xl 
              text-slate-900
              focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
              transition-all duration-200
              hover:border-slate-300
            "
          />
          {errors.event_time && (
            <p className="text-sm text-red-500 mt-1">{errors.event_time.message}</p>
          )}
        </div>
      </div>

      {/* Budget */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-slate-700">
          Total Budget ($)
          <span className="text-red-500 ml-1">*</span>
        </label>
        <input
          type="number"
          {...register('budget', { valueAsNumber: true })}
          placeholder="10000"
          className="
            w-full px-4 py-3 
            bg-white border-2 border-slate-200 
            rounded-xl 
            text-slate-900 placeholder-slate-400
            focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
            transition-all duration-200
            hover:border-slate-300
          "
        />
        {errors.budget && (
          <p className="text-sm text-red-500 mt-1">{errors.budget.message}</p>
        )}
        <p className="text-xs text-slate-500">
          Estimate your total event budget including venue, vendors, and other expenses
        </p>
      </div>
    </form>
  )
}
