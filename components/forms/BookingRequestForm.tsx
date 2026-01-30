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

const bookingRequestSchema = z.object({
  requested_date: z.string().min(1, 'Date is required').refine(
    (date) => {
      const selectedDate = new Date(date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return selectedDate >= today
    },
    { message: 'Date must be in the future' }
  ),
  requested_start_time: z.string().min(1, 'Start time is required'),
  requested_end_time: z.string().optional(),
  expected_attendees: z
    .number()
    .min(1, 'Expected attendance must be at least 1')
    .int('Expected attendance must be a whole number'),
  min_attendees: z
    .number()
    .int()
    .optional()
    .refine((val) => !val || val > 0, { message: 'Min attendance must be greater than 0' }),
  max_attendees: z
    .number()
    .int()
    .optional()
    .refine((val) => !val || val > 0, { message: 'Max attendance must be greater than 0' }),
  notes: z.string().max(1000, 'Notes must be less than 1000 characters').optional(),
}).refine(
  (data) => {
    if (data.requested_end_time && data.requested_start_time) {
      return data.requested_end_time > data.requested_start_time
    }
    return true
  },
  {
    message: 'End time must be after start time',
    path: ['requested_end_time'],
  }
)

export type BookingRequestFormData = z.infer<typeof bookingRequestSchema>

export interface BookingRequestFormProps {
  /**
   * Type of booking (venue or vendor)
   */
  type: 'venue' | 'vendor'
  /**
   * Default values for the form
   */
  defaultValues?: Partial<BookingRequestFormData>
  /**
   * Submit handler
   */
  onSubmit: (data: BookingRequestFormData) => Promise<void> | void
  /**
   * Cancel handler
   */
  onCancel?: () => void
  /**
   * Whether form is in loading state
   */
  isLoading?: boolean
  /**
   * Additional requirements to display
   */
  requirements?: Array<{ id: string; label: string; required: boolean }>
}

/**
 * BookingRequestForm component for requesting venue or vendor bookings
 * 
 * @example
 * ```tsx
 * <BookingRequestForm
 *   type="venue"
 *   onSubmit={async (data) => {
 *     await createVenueBooking(data)
 *   }}
 *   requirements={venueRequirements}
 * />
 * ```
 */
export function BookingRequestForm({
  type,
  defaultValues,
  onSubmit,
  onCancel,
  isLoading = false,
  requirements = [],
}: BookingRequestFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<BookingRequestFormData>({
    resolver: zodResolver(bookingRequestSchema),
    defaultValues: defaultValues || {
      requested_date: '',
      requested_start_time: '',
      requested_end_time: '',
      expected_attendees: 0,
      notes: '',
    },
  })

  const notes = watch('notes')
  const notesLength = notes?.length || 0
  const minDate = new Date().toISOString().split('T')[0]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          label="Requested Date"
          required
          error={errors.requested_date?.message}
        >
          <DatePicker
            {...register('requested_date')}
            minDate={minDate}
          />
        </FormField>

        <FormField
          label="Start Time"
          required
          error={errors.requested_start_time?.message}
        >
          <TimePicker {...register('requested_start_time')} />
        </FormField>
      </div>

      <FormField
        label="End Time (Optional)"
        error={errors.requested_end_time?.message}
        helperText="Leave blank if duration is flexible"
      >
        <TimePicker {...register('requested_end_time')} />
      </FormField>

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

      {requirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
            <CardDescription>
              Please ensure you can provide the following
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {requirements.map((req) => (
                <div key={req.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-forest-500"
                    disabled
                    checked={req.required}
                  />
                  <span className={req.required ? 'font-medium text-gray-900' : 'text-gray-600'}>
                    {req.label}
                    {req.required && <span className="text-red-500 ml-1">*</span>}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <FormField
        label="Special Requests / Notes"
        error={errors.notes?.message}
        helperText={`${notesLength}/1000 characters`}
      >
        <textarea
          {...register('notes')}
          rows={4}
          maxLength={1000}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
          placeholder="Any special requests, setup needs, or additional information..."
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
          {isLoading ? 'Submitting...' : 'Submit Request'}
        </Button>
      </div>
    </form>
  )
}
