'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InviteVenueForm, type InviteVenueFormPrefill } from './InviteVenueForm'

interface InviteVenueModalProps {
  isOpen: boolean
  activePlanId: string | null
  prefill?: InviteVenueFormPrefill
  onClose: () => void
  onSuccess?: () => void
}

export function InviteVenueModal({ isOpen, activePlanId, prefill, onClose, onSuccess }: InviteVenueModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Invite a venue"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-tan bg-cream p-5 shadow-card"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Known venue</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">Invite a venue you know</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Add a private venue relationship to this plan. Holds and payments stay approval-gated.
            </p>
          </div>
          <Button type="button" variant="glass" size="icon" aria-label="Close invite venue modal" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <InviteVenueForm
          activePlanId={activePlanId}
          prefill={prefill}
          onCancel={onClose}
          onSuccess={() => {
            onSuccess?.()
            onClose()
          }}
        />
      </section>
    </div>
  )
}
