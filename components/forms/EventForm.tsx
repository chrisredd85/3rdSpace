'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from './FormField'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const eventSchema = z.object({
  name: z.string().min(2, 'Event name must be at least 2 characters'),
  event_type: z.string().min(1, 'Event type is required'),
  event_date: z.string().min(1, 'Event date is required').refine(
    (date) => {
      const selectedDate = new Date(date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return selectedDate >= today
    },
    { message: 'Event date must be in the future' }
  ),
  event_time: z.string().min(1, 'Event time is required'),
  expected_attendees: z
    .number()
    .min(1, 'Expected attendance must be at least 1')
    .int('Expected attendance must be a whole number'),
  min_attendees: z
    .number()
    .int('Min attendance must be a whole number')
    .optional()
    .refine(
      (val) => !val || val > 0,
      { message: 'Min attendance must be greater than 0' }
    ),
  max_attendees: z
    .number()
    .int('Max attendance must be a whole number')
    .optional()
    .refine(
      (val) => !val || val > 0,
      { message: 'Max attendance must be greater than 0' }
    ),
  budget: z
    .number()
    .min(0.01, 'Budget must be greater than 0')
    .refine((val) => val > 0, { message: 'Budget must be greater than 0' }),
}).refine(
  (data) => {
    if (data.min_attendees && data.max_attendees) {
      return data.min_attendees <= data.max_attendees
    }
    if (data.min_attendees) {
      return data.min_attendees <= data.expected_attendees
    }
    if (data.max_attendees) {
      return data.max_attendees >= data.expected_attendees
    }
    return true
  },
  {
    message: 'Min attendance must be less than or equal to max attendance',
    path: ['max_attendees'],
  }
)

export type EventFormData = z.infer<typeof eventSchema>

export interface EventFormProps {
  /**
   * Initial form values (for editing)
   */
  defaultValues?: Partial<EventFormData>
  /**
   * Submit handler
   */
  onSubmit: (data: EventFormData) => Promise<void> | void
  /**
   * Cancel handler
   */
  onCancel?: () => void
  /**
   * Whether form is in loading state
   */
  isLoading?: boolean
  /**
   * Submit button text
   * @default 'Save Event'
   */
  submitLabel?: string
}

/**
 * EventForm component for creating and editing events
 * 
 * @example
 * ```tsx
 * <EventForm
 *   onSubmit={async (data) => {
 *     await createEvent(data)
 *   }}
 *   isLoading={isCreating}
 * />
 * ```
 */
export function EventForm({
  defaultValues,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel = 'Save Event',
}: EventFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: defaultValues || {
      name: '',
      event_type: '',
      event_date: '',
      event_time: '',
      expected_attendees: 0,
      budget: 0,
    },
  })

  const eventDate = watch('event_date')
  const minDate = new Date().toISOString().split('T')[0]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <FormField
        label="Event Name"
        required
        error={errors.name?.message}
      >
        <Input
          {...register('name')}
          placeholder="Summer Networking Mixer"
        />
      </FormField>

      <FormField
        label="Event Type"
        required
        error={errors.event_type?.message}
      >
        <select
          {...register('event_type')}
          className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select event type</option>
          <option value="networking">Networking</option>
          <option value="conference">Conference</option>
          <option value="workshop">Workshop</option>
          <option value="social_mixer">Party / Social Mixer</option>
          <option value="all_hands">Meeting / All-Hands</option>
          <option value="product_launch">Product Launch</option>
          <option value="other">Other</option>
        </select>
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          label="Event Date"
          required
          error={errors.event_date?.message}
        >
          <DatePicker
            {...register('event_date')}
            minDate={minDate}
          />
        </FormField>

        <FormField
          label="Event Time"
          required
          error={errors.event_time?.message}
        >
          <TimePicker {...register('event_time')} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField
          label="Expected Attendance"
          required
          error={errors.expected_attendees?.message}
        >
          <Input
            type="number"
            {...register('expected_attendees', { valueAsNumber: true })}
            placeholder="100"
            min={1}
          />
        </FormField>

        <FormField
          label="Min Attendance"
          error={errors.min_attendees?.message}
        >
          <Input
            type="number"
            {...register('min_attendees', { valueAsNumber: true })}
            placeholder="50"
            min={1}
          />
        </FormField>

        <FormField
          label="Max Attendance"
          error={errors.max_attendees?.message}
        >
          <Input
            type="number"
            {...register('max_attendees', { valueAsNumber: true })}
            placeholder="150"
            min={1}
          />
        </FormField>
      </div>

      <FormField
        label="Total Budget ($)"
        required
        error={errors.budget?.message}
        helperText="Total budget for this event"
      >
        <Input
          type="number"
          step="0.01"
          {...register('budget', { valueAsNumber: true })}
          placeholder="10000"
          min={0.01}
        />
      </FormField>

      <div className="flex items-center justify-end gap-3 pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
