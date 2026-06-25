'use client'

import type { FormEvent } from 'react'
import { useState, useTransition } from 'react'
import { Link2, Mail } from 'lucide-react'
import { inviteVenue, type InviteVenueResult } from '@/app/actions/venueInvites'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { updatePlannerLivePlanPayload } from './plannerLivePlanStorage'

export interface InviteVenueFormPrefill {
  venueName?: string
  contactEmail?: string
  contactName?: string
  contactRole?: string
  venueType?: 'loft_warehouse' | 'gallery' | 'restaurant' | 'rooftop' | 'conference_center' | 'other'
  city?: string
  state?: string
  standingCapacity?: number | string
  seatedCapacity?: number | string
  termType?: 'flat_rental' | 'minimum_spend' | 'per_head_chi' | 'bar_chi' | 'no_charge' | 'tbd'
  proposedAmount?: number | string
}

interface InviteVenueFormProps {
  activePlanId: string | null
  onSuccess?: (result: InviteVenueResult) => void
  onCancel?: () => void
  prefill?: InviteVenueFormPrefill
}

export function InviteVenueForm({ activePlanId, onSuccess, onCancel, prefill }: InviteVenueFormProps) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{
    ok: boolean
    message: string
    claimUrl?: string
    existing?: boolean
    emailSent?: boolean
  } | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    startTransition(async () => {
      const response = await inviteVenue({
        venueName: String(formData.get('venueName') || ''),
        contactEmail: String(formData.get('contactEmail') || ''),
        contactName: String(formData.get('contactName') || ''),
        contactRole: String(formData.get('contactRole') || ''),
        venueType: String(formData.get('venueType') || 'other') as any,
        city: String(formData.get('city') || ''),
        state: String(formData.get('state') || 'CA'),
        standingCapacity: toOptionalNumber(formData.get('standingCapacity')),
        seatedCapacity: toOptionalNumber(formData.get('seatedCapacity')),
        termType: String(formData.get('termType') || 'tbd') as any,
        proposedAmount: toOptionalNumber(formData.get('proposedAmount')),
        planId: activePlanId,
      })

      if (!response.ok) {
        setResult({ ok: false, message: response.error || 'Could not send this invite.' })
        return
      }

      updatePlannerLivePlanPayload(response.plan)
      setResult({
        ok: true,
        existing: response.existing,
        emailSent: response.emailSent,
        claimUrl: response.claimUrl,
        message: response.existing
          ? 'This venue was already in your people. I reused the existing invite record.'
          : 'Invite created. The venue can claim this private listing, confirm terms, and complete payout setup before any payment approval.',
      })
      form.reset()
      onSuccess?.(response)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-tan bg-cream-deep/60 p-4 lg:grid-cols-6">
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Venue name</span>
        <Input name="venueName" required placeholder="Moongate Lounge" defaultValue={prefill?.venueName ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Booking email</span>
        <Input name="contactEmail" required type="email" placeholder="events@example.com" defaultValue={prefill?.contactEmail ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Contact name optional</span>
        <Input name="contactName" placeholder="Sam" defaultValue={prefill?.contactName ?? ''} />
      </label>

      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Contact role optional</span>
        <Input name="contactRole" placeholder="Events manager" defaultValue={prefill?.contactRole ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Venue type</span>
        <select
          name="venueType"
          className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
          defaultValue={prefill?.venueType ?? 'restaurant'}
        >
          <option value="restaurant">Restaurant / bar</option>
          <option value="rooftop">Rooftop</option>
          <option value="gallery">Gallery</option>
          <option value="loft_warehouse">Loft / warehouse</option>
          <option value="conference_center">Conference center</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="space-y-1 lg:col-span-1">
        <span className="text-xs font-semibold text-ink-soft">City</span>
        <Input name="city" placeholder="Oakland" defaultValue={prefill?.city ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-1">
        <span className="text-xs font-semibold text-ink-soft">State</span>
        <Input name="state" placeholder="CA" defaultValue={prefill?.state ?? 'CA'} />
      </label>

      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Standing capacity optional</span>
        <Input name="standingCapacity" min="1" step="1" type="number" placeholder="75" defaultValue={prefill?.standingCapacity ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Seated capacity optional</span>
        <Input name="seatedCapacity" min="1" step="1" type="number" placeholder="40" defaultValue={prefill?.seatedCapacity ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Private terms</span>
        <select
          name="termType"
          className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
          defaultValue={prefill?.termType ?? 'flat_rental'}
        >
          <option value="flat_rental">Flat rental</option>
          <option value="minimum_spend">Minimum spend</option>
          <option value="per_head_chi">Per-head CHI</option>
          <option value="bar_chi">Bar consumption CHI</option>
          <option value="no_charge">No charge</option>
          <option value="tbd">To confirm</option>
        </select>
      </label>

      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Amount if known</span>
        <Input name="proposedAmount" min="0" step="1" type="number" placeholder="1800" defaultValue={prefill?.proposedAmount ?? ''} />
      </label>

      <div className="flex flex-col gap-3 lg:col-span-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-ink-soft">
          Invited venues stay private. Holds, bookings, and payments still require organizer approval after terms are confirmed.
        </p>
        <div className="flex gap-2">
          {onCancel ? (
            <Button type="button" variant="glass" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" variant="hero" size="sm" disabled={isPending}>
            {isPending ? 'Sending invite...' : 'Send invite'}
          </Button>
        </div>
      </div>

      {result ? (
        <div
          className={cn(
            'rounded-md border px-4 py-3 text-sm lg:col-span-6',
            result.ok
              ? 'border-accent/30 bg-accent/10 text-ink'
              : 'border-brick/30 bg-brick-tint text-ink'
          )}
        >
          <p className="font-semibold">{result.message}</p>
          {result.ok && result.claimUrl ? (
            <div className="mt-2 flex flex-col gap-2 text-xs text-ink-soft sm:flex-row sm:items-center">
              {result.emailSent ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  Email sent
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="h-3.5 w-3.5" />
                  Email provider is not configured; use this local claim link:
                </span>
              )}
              {!result.emailSent ? (
                <a className="break-all font-semibold text-clay underline" href={result.claimUrl}>
                  {result.claimUrl}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

function toOptionalNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}
