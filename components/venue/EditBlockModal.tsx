'use client'

import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUpdateAvailabilityBlock, useDeleteAvailabilityBlock } from '@/lib/hooks/useAvailabilityBlocks'
import { useToast } from '@/components/ui/toast'
import type { AvailabilityBlock } from '@/lib/types'

interface EditBlockModalProps {
  block: AvailabilityBlock
  onClose: () => void
  onSuccess?: () => void
}

export function EditBlockModal({ block, onClose, onSuccess }: EditBlockModalProps) {
  const { addToast } = useToast()
  const updateBlock = useUpdateAvailabilityBlock()
  const deleteBlock = useDeleteAvailabilityBlock()

  const [startDate, setStartDate] = useState(
    new Date(block.start_date).toISOString().split('T')[0]
  )
  const [endDate, setEndDate] = useState(
    new Date(block.end_date).toISOString().split('T')[0]
  )
  const [reason, setReason] = useState(block.reason || '')
  const [notes, setNotes] = useState('')

  const handleUpdate = async () => {
    try {
      await updateBlock.mutateAsync({
        id: block.id,
        updates: {
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
          reason,
        },
      })

      addToast({
        title: 'Block updated',
        description: 'The date block has been updated successfully.',
      })

      onSuccess?.()
      onClose()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update block',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this block?')) return

    try {
      await deleteBlock.mutateAsync({ id: block.id, isVenue: true })
      addToast({
        title: 'Block deleted',
        description: 'The date block has been removed.',
      })

      onSuccess?.()
      onClose()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to delete block',
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
              <CardTitle>Edit Block</CardTitle>
              <CardDescription>Update or delete this date block</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="private_event">Private Event</option>
              <option value="maintenance">Maintenance</option>
              <option value="renovation">Renovation</option>
              <option value="personal">Personal</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-4 border-t">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteBlock.isPending}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={updateBlock.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateBlock.isPending}
              className="flex-1"
            >
              {updateBlock.isPending ? 'Updating...' : 'Update'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
