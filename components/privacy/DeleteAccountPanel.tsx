'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, ShieldCheck, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

type DeletionRequest = {
  id: string
  status: string
  cooling_off_ends_at: string
  requested_at?: string | null
  reason?: string | null
}

type DeleteAccountPanelProps = {
  initialRequest: DeletionRequest | null
}

export function DeleteAccountPanel({ initialRequest }: DeleteAccountPanelProps) {
  const { addToast } = useToast()
  const [request, setRequest] = useState<DeletionRequest | null>(initialRequest)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pending = request && ['requested', 'in_review', 'approved'].includes(request.status)

  async function requestDeletion() {
    if (!confirmed) {
      addToast({
        title: 'Confirmation required',
        description: 'Confirm that you understand this starts account deletion review.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/privacy/data-deletion/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() || null }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not request account deletion')
      setRequest(payload.request)
      addToast({
        title: 'Deletion request received',
        description: 'A 7-day cooling-off period has started. You can cancel before it ends.',
      })
    } catch (error) {
      addToast({
        title: 'Request failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelDeletion() {
    setSubmitting(true)
    try {
      const response = await fetch('/api/privacy/data-deletion/request', {
        method: 'PATCH',
        credentials: 'include',
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not cancel deletion request')
      setRequest({ ...request!, status: 'canceled' })
      addToast({ title: 'Deletion canceled', description: 'Your account remains active.' })
    } catch (error) {
      addToast({
        title: 'Cancel failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-clay">Privacy controls</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Delete account data</h1>
        <p className="mt-3 text-ink-soft">
          Start a reviewed deletion request for your 3rdPlace account. We keep required financial and tax
          records, but remove or anonymize personal profile, token, outreach, and account data where allowed.
        </p>
      </div>

      {pending ? (
        <section className="rounded-2xl border border-clay/30 bg-clay-tint p-5">
          <div className="flex gap-3">
            <ShieldCheck className="mt-1 h-5 w-5 text-clay" />
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink">Deletion request pending</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Status: <span className="font-semibold text-ink">{request.status}</span>. Cooling-off ends{' '}
                {formatDate(request.cooling_off_ends_at)}.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                disabled={submitting || request.status !== 'requested'}
                onClick={cancelDeletion}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Cancel deletion request
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-brick/30 bg-brick-tint p-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 text-brick" />
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink">Request account deletion</h2>
              <p className="mt-2 text-sm text-ink-soft">
                This starts a 7-day cooling-off period and admin review. It does not instantly delete financial
                records, settlement records, or tax/accounting records that 3rdPlace must retain.
              </p>

              <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="deletion-reason">
                Reason (optional)
              </label>
              <textarea
                id="deletion-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-2 min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus:border-clay"
                placeholder="Tell us why you are deleting your account."
              />

              <label className="mt-4 flex items-start gap-3 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  I understand this starts a deletion review and that some financial or legal records may be retained
                  or anonymized under the data retention policy.
                </span>
              </label>

              <Button
                type="button"
                className="mt-5"
                variant="destructive"
                disabled={submitting || !confirmed}
                onClick={requestDeletion}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Request account deletion
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
