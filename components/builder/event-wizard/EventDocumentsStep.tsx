'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { DocumentFileLibrary } from '@/components/documents/DocumentFileLibrary'
import type { Event } from '@/lib/types'

interface EventDocumentsStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

export function EventDocumentsStep({ event, onNext }: EventDocumentsStepProps) {
  const canUpload = useMemo(() => !!event?.id && event.id !== 'new', [event?.id])

  return (
    <div className="space-y-5">
      {canUpload ? (
        <DocumentFileLibrary
          bucket="event-documents"
          folderPath={event.id}
          relatedType="event"
          relatedId={event.id}
          emptyLabel="No event documents uploaded yet."
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-sidebar-accent/20 p-6 text-sm text-yellow-400">
          Finish creating the event before adding files.
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button variant="hero" onClick={onNext}>Next: Finalize</Button>
      </div>
    </div>
  )
}
