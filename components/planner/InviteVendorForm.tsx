'use client'

import type { FormEvent } from 'react'
import { useState, useTransition } from 'react'
import { Link2, Mail } from 'lucide-react'
import { inviteVendor, type InviteVendorResult } from '@/app/actions/vendorInvites'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { updatePlannerLivePlanPayload } from './plannerLivePlanStorage'

export interface InviteVendorFormPrefill {
  vendorName?: string
  email?: string
  phone?: string
  serviceType?: string
  proposedRateAmount?: number | string
  rateType?: 'flat' | 'per_person' | 'hourly'
}

interface InviteVendorFormProps {
  activePlanId: string | null
  onSuccess?: (result: InviteVendorResult) => void
  onCancel?: () => void
  prefill?: InviteVendorFormPrefill
}

export function InviteVendorForm({ activePlanId, onSuccess, onCancel, prefill }: InviteVendorFormProps) {
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
      const proposedRateAmount = Number(formData.get('proposedRateAmount') || 0)
      const rateType = String(formData.get('rateType') || 'flat') as 'flat' | 'per_person' | 'hourly'
      const response = await inviteVendor({
        vendorName: String(formData.get('vendorName') || ''),
        email: String(formData.get('email') || ''),
        phone: String(formData.get('phone') || ''),
        serviceType: String(formData.get('serviceType') || 'other') as any,
        rateType,
        proposedRateAmount,
        planId: activePlanId,
      })

      if (!response.ok) {
        setResult({ ok: false, message: response.error || 'Could not send this invite.' })
        return
      }

      if (activePlanId && response.vendorId) {
        try {
          const payload = await attachVendorToActivePlan({
            planId: activePlanId,
            vendorId: response.vendorId,
            amount: proposedRateAmount,
            rateType,
            commitAgreement: false,
          })
          updatePlannerLivePlanPayload(payload.plan)
        } catch (error) {
          console.error('Could not attach invited vendor to active plan:', error)
        }
      }

      setResult({
        ok: true,
        existing: response.existing,
        emailSent: response.emailSent,
        claimUrl: response.claimUrl,
        message: response.existing
          ? 'This vendor was already in your people. I reused the existing invite record.'
          : 'Invite created. They can claim the private listing, confirm the private rate, and add a public catalog rate later if they want to be discoverable.',
      })
      form.reset()
      onSuccess?.(response)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-tan bg-cream-deep/60 p-4 lg:grid-cols-6">
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Vendor name</span>
        <Input name="vendorName" required placeholder="DJ Maya" defaultValue={prefill?.vendorName ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Email</span>
        <Input name="email" required type="email" placeholder="maya@example.com" defaultValue={prefill?.email ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Phone optional</span>
        <Input name="phone" type="tel" placeholder="(415) 555-0100" defaultValue={prefill?.phone ?? ''} />
      </label>

      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Service</span>
        <select
          name="serviceType"
          className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
          defaultValue={prefill?.serviceType ?? 'dj'}
        >
          <option value="dj">DJ / music</option>
          <option value="catering">Catering</option>
          <option value="bartending">Bartending</option>
          <option value="photography">Photography</option>
          <option value="videography">Videography</option>
          <option value="av_tech">AV tech</option>
          <option value="event_planning">Event staff</option>
          <option value="florist">Florals / decor</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Private agreed rate</span>
        <Input name="proposedRateAmount" required min="1" step="1" type="number" placeholder="450" defaultValue={prefill?.proposedRateAmount ?? ''} />
      </label>
      <label className="space-y-1 lg:col-span-2">
        <span className="text-xs font-semibold text-ink-soft">Rate type</span>
        <select
          name="rateType"
          className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
          defaultValue={prefill?.rateType ?? 'flat'}
        >
          <option value="flat">Flat</option>
          <option value="per_person">Per person</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>

      <div className="flex flex-col gap-3 lg:col-span-6 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-ink-soft">
          Private rates are scoped to you and this vendor. Public catalog rates are set by the vendor after claim.
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

async function attachVendorToActivePlan(input: {
  planId: string
  vendorId: string
  amount: number
  rateType: 'flat' | 'per_person' | 'hourly'
  commitAgreement: boolean
}): Promise<{ plan?: unknown; rate_commit?: { warning?: string | null } | null }> {
  const response = await fetch(`/api/planner/plans/${input.planId}/vendors/${input.vendorId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amount,
      rate_type: input.rateType,
      commit_agreement: input.commitAgreement,
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    plan?: unknown
    rate_commit?: { warning?: string | null } | null
    error?: string
  }
  if (!response.ok) throw new Error(payload.error || 'Could not attach vendor to plan.')
  return payload
}
