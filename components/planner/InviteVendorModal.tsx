'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InviteVendorForm, type InviteVendorFormPrefill } from './InviteVendorForm'

interface InviteVendorModalProps {
  isOpen: boolean
  activePlanId: string | null
  prefill?: InviteVendorFormPrefill
  onClose: () => void
  onSuccess?: () => void
}

export function InviteVendorModal({ isOpen, activePlanId, prefill, onClose, onSuccess }: InviteVendorModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Invite a vendor"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-tan bg-cream p-5 shadow-card"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Your people</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">Invite a vendor you know</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Add a trusted vendor to this plan. They still claim the listing before payments can happen.
            </p>
          </div>
          <Button type="button" variant="glass" size="icon" aria-label="Close invite vendor modal" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <InviteVendorForm
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
