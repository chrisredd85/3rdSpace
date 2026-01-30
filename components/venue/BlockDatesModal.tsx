'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateAvailabilityBlock } from '@/lib/hooks/useAvailabilityBlocks'
import { useToast } from '@/components/ui/toast'
import type { AvailabilityBlock } from '@/lib/types'

interface BlockDatesModalProps {
  venueId?: string | null
  vendorId?: string | null
  initialStartDate?: Date
  initialEndDate?: Date
  onClose: () => void
  onSuccess?: () => void
}

export function BlockDatesModal({
  venueId,
  vendorId,
  initialStartDate,
  initialEndDate,
  onClose,
  onSuccess,
}: BlockDatesModalProps) {
  const { addToast } = useToast()
  const createBlock = useCreateAvailabilityBlock()

  const [startDate, setStartDate] = useState(
    initialStartDate?.toISOString().split('T')[0] || ''
  )
  const [endDate, setEndDate] = useState(
    initialEndDate?.toISOString().split('T')[0] || ''
  )
  const [reason, setReason] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    // Validation
    if (!startDate) {
      setErrors({ startDate: 'Start date is required' })
      return
    }
    if (!endDate) {
      setErrors({ endDate: 'End date is required' })
      return
    }
    if (!reason) {
      setErrors({ reason: 'Reason is required' })
      return
    }

    const start = new Date(startDate)
    const end = new Date(endDate)

    if (end < start) {
      setErrors({ endDate: 'End date must be after start date' })
      return
    }

    if (!venueId && !vendorId) {
      addToast({
        title: 'Error',
        description: 'Venue or Vendor ID is required',
        variant: 'destructive',
      })
      return
    }

    try {
      await createBlock.mutateAsync({
        venue_id: venueId || null,
        vendor_id: vendorId || null,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        start_time: null,
        end_time: null,
        is_available: false,
        reason,
      })

      addToast({
        title: 'Dates blocked',
        description: 'The selected dates have been blocked successfully.',
      })

      onSuccess?.()
      onClose()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to block dates',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Block Dates</CardTitle>
              <CardDescription>
                Mark dates as unavailable for bookings
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="startDate" className="text-sm font-medium text-gray-700 mb-2 block">
                Start Date *
              </label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={errors.startDate ? 'border-red-500' : ''}
              />
              {errors.startDate && (
                <p className="text-sm text-red-500 mt-1">{errors.startDate}</p>
              )}
            </div>

            <div>
              <label htmlFor="endDate" className="text-sm font-medium text-gray-700 mb-2 block">
                End Date *
              </label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className={errors.endDate ? 'border-red-500' : ''}
              />
              {errors.endDate && (
                <p className="text-sm text-red-500 mt-1">{errors.endDate}</p>
              )}
            </div>

            <div>
              <label htmlFor="reason" className="text-sm font-medium text-gray-700 mb-2 block">
                Reason *
              </label>
              <select
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm ${
                  errors.reason ? 'border-red-500' : ''
                }`}
              >
                <option value="">Select a reason</option>
                <option value="private_event">Private Event</option>
                <option value="maintenance">Maintenance</option>
                <option value="renovation">Renovation</option>
                <option value="personal">Personal</option>
                <option value="other">Other</option>
              </select>
              {errors.reason && (
                <p className="text-sm text-red-500 mt-1">{errors.reason}</p>
              )}
            </div>

            <div>
              <label htmlFor="notes" className="text-sm font-medium text-gray-700 mb-2 block">
                Notes (Optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add any additional details..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
                disabled={createBlock.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={createBlock.isPending}
              >
                {createBlock.isPending ? 'Blocking...' : 'Block Dates'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
