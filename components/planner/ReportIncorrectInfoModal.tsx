'use client'

import { useEffect, useId, useState } from 'react'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const reportCategories = [
  { value: 'wrong_contact', label: 'Wrong contact' },
  { value: 'wrong_address', label: 'Wrong address' },
  { value: 'wrong_capacity', label: 'Wrong capacity' },
  { value: 'rates_outdated', label: 'Rates outdated' },
  { value: 'closed', label: 'Closed or unavailable' },
  { value: 'other', label: 'Something else' },
] as const

export type ReportIncorrectInfoEntity = {
  kind: 'venue' | 'vendor'
  id: string
  name: string
}

type ReportState =
  | { status: 'idle'; message: null }
  | { status: 'submitting'; message: null }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

export function ReportIncorrectInfoModal({
  entity,
  isOpen,
  onClose,
}: {
  entity: ReportIncorrectInfoEntity | null
  isOpen: boolean
  onClose: () => void
}) {
  const titleId = useId()
  const [category, setCategory] = useState<typeof reportCategories[number]['value']>('wrong_contact')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<ReportState>({ status: 'idle', message: null })

  useEffect(() => {
    if (!isOpen) return
    setCategory('wrong_contact')
    setDetails('')
    setState({ status: 'idle', message: null })
  }, [isOpen, entity?.id])

  if (!isOpen || !entity) return null

  const canSubmit = details.trim().length > 0 && state.status !== 'submitting'

  async function handleSubmit() {
    if (!entity || !canSubmit) return

    setState({ status: 'submitting', message: null })
    try {
      const response = await fetch(
        entity.kind === 'venue'
          ? `/api/planner/discovery-venues/${encodeURIComponent(entity.id)}/report`
          : `/api/planner/discovery-vendors/${encodeURIComponent(entity.id)}/report`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ category, details: details.trim() }),
        }
      )
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; ticket_id?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not send report')
      setState({
        status: 'success',
        message: payload.message ?? 'Thanks, our team will review within 24 hours',
      })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not send report',
      })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/35 px-3 py-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-lg rounded-xl border border-tan bg-cream p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-caps text-clay">Report incorrect info</p>
            <h2 id={titleId} className="mt-2 font-display text-2xl font-semibold leading-tight text-ink">
              {entity.name}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              This creates a review ticket for the 3rdPlace team. It will not change the record until reviewed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-tan text-ink-soft transition-colors hover:border-clay hover:text-clay"
            aria-label="Close report dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-ink">What looks wrong?</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
              disabled={state.status === 'submitting' || state.status === 'success'}
              className="mt-2 h-11 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm font-semibold text-ink outline-none transition-colors focus:border-clay"
            >
              {reportCategories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Details</span>
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              disabled={state.status === 'submitting' || state.status === 'success'}
              maxLength={2000}
              rows={5}
              placeholder="Tell us what should be corrected."
              className="mt-2 w-full rounded-md border border-tan bg-cream-deep px-3 py-2 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay"
            />
          </label>

          {state.message ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border px-3 py-2 text-sm font-semibold leading-6',
                state.status === 'success'
                  ? 'border-forest/20 bg-forest-tint text-forest'
                  : 'border-brick/20 bg-brick-tint text-brick'
              )}
            >
              {state.status === 'success' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{state.message}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-tan bg-cream px-4 text-sm font-bold text-ink-soft transition-colors hover:border-clay hover:text-clay"
          >
            {state.status === 'success' ? 'Done' : 'Cancel'}
          </button>
          {state.status !== 'success' ? (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-4 text-sm font-bold text-cream transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {state.status === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send report
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
