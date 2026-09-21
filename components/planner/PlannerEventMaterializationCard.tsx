'use client'

import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck2, CheckCircle2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invalidatePlannerEventQueries } from '@/lib/planner/queryInvalidation'

const DEFAULT_START_TIME = '18:00'
const DEFAULT_DURATION_MINUTES = '180'
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

export interface PlannerEventMaterializationCardProps {
  planId: string
  planStatus: string
  materializedEventId?: string | null
  dateWindowStart: string | null
  dateWindowEnd: string | null
  onMaterialized?: () => Promise<void> | void
  compact?: boolean
}

type MaterializationPayload = {
  error?: string
  code?: string
  event_id?: string
  existing?: boolean
  booking_resume?: BookingResumeState
}

type BookingResumeResult = {
  disposition?: 'executing' | 'complete' | 'waiting'
  metadata?: Record<string, unknown>
}

type BookingResumeState = {
  status: 'complete' | 'failed' | 'reapproval_required'
  results: BookingResumeResult[]
  error: string | null
  reapproval?: {
    approval_ids: string[]
    review_href: string
  }
  recovery?: {
    action_ids: string[]
    review_href: string
    reason: 'action_failed' | 'plan_status_ineligible'
    plan_statuses?: string[]
  }
}

/**
 * Explicit host confirmation for converting an approved plan into its one
 * canonical event. Afterward, already-approved quote handoffs may resume; this
 * step never sends an outbound message or initiates payment.
 */
export function PlannerEventMaterializationCard({
  planId,
  planStatus,
  materializedEventId = null,
  dateWindowStart,
  dateWindowEnd,
  onMaterialized,
  compact = false,
}: PlannerEventMaterializationCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [eventDate, setEventDate] = useState(dateWindowStart ?? dateWindowEnd ?? '')
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME)
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES)
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canonicalEventId, setCanonicalEventId] = useState(materializedEventId)
  const [wasExisting, setWasExisting] = useState(false)
  const [bookingResume, setBookingResume] = useState<BookingResumeState | null>(null)
  const [isResumingBookings, setIsResumingBookings] = useState(false)

  if (canonicalEventId) {
    const resumeFailed = bookingResume?.status === 'failed'
    const resumeBlocked = bookingResume?.recovery?.reason === 'plan_status_ineligible'
    const reapprovalRequired = bookingResume?.status === 'reapproval_required'
    const approvalReviewHref = bookingResume?.reapproval?.review_href ??
      `/planner?plan=${encodeURIComponent(planId)}&tab=approvals`
    const failedActionReviewHref = bookingResume?.recovery?.review_href
    return (
      <section className="rounded-lg border border-forest/25 bg-forest/10 p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-forest" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              {wasExisting ? 'Canonical event already confirmed' : 'Exact event schedule confirmed'}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              {describeBookingResume(bookingResume)}
            </p>
            {resumeFailed ? (
              <p className="mt-2 text-sm font-semibold text-brick" role="alert">
                {resumeBlocked
                  ? 'The event is safe, but this plan is no longer executable and an approved booking handoff needs review.'
                  : 'The event is safe, but an approved booking handoff still needs attention.'}
              </p>
            ) : null}
            {reapprovalRequired ? (
              <p className="mt-2 text-sm font-semibold text-brick" role="alert">
                The event is safe, but the booking terms expired or changed before execution started.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="border-forest/30 bg-cream text-forest">
                <Link href={`/planner/analytics?eventId=${encodeURIComponent(canonicalEventId)}`}>
                  Open event analytics
                </Link>
              </Button>
              {reapprovalRequired ? (
                <Button asChild size="sm">
                  <Link href={approvalReviewHref}>Review approval</Link>
                </Button>
              ) : failedActionReviewHref ? (
                <Button asChild size="sm">
                  <Link href={failedActionReviewHref}>
                    {resumeBlocked ? 'Review blocked handoff' : 'Review failed handoff'}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant={resumeFailed ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => void handleResumeBookings()}
                  disabled={isResumingBookings}
                >
                  {isResumingBookings ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {resumeFailed ? 'Retry approved booking handoffs' : 'Sync approved booking handoffs'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (planStatus !== 'approved') return null

  const duration = Number(durationMinutes)
  const scheduleError = validateSchedule({
    eventDate,
    startTime,
    durationMinutes: duration,
    timeZone,
    dateWindowStart,
    dateWindowEnd,
  })
  const visibleError = error ?? scheduleError

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isConfirmed) {
      setError('Confirm the exact schedule before creating the canonical event.')
      return
    }
    if (scheduleError) {
      setError(scheduleError)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${planId}/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventDate,
          startTime,
          durationMinutes: duration,
          timeZone: timeZone.trim(),
          confirmed: true,
        }),
      })
      const payload = await response.json().catch(() => ({} as MaterializationPayload)) as MaterializationPayload

      if (!response.ok) {
        throw new Error(payload.error ?? 'Could not create the canonical event.')
      }
      if (!payload.event_id) {
        throw new Error('The canonical event response was incomplete.')
      }

      setWasExisting(Boolean(payload.existing))
      setBookingResume(payload.booking_resume ?? null)
      setCanonicalEventId(payload.event_id)
      try {
        await invalidatePlannerEventQueries(queryClient)
      } catch (invalidationError) {
        console.warn('[planner.materialize] Event created but query invalidation failed', invalidationError)
      }
      router.refresh()

      try {
        await onMaterialized?.()
      } catch (refreshError) {
        console.warn('[planner.materialize] Event created but plan refresh failed', refreshError)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create the canonical event.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResumeBookings() {
    setIsResumingBookings(true)
    try {
      const response = await fetch(`/api/planner/plans/${planId}/materialize`, {
        method: 'PATCH',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({} as MaterializationPayload)) as MaterializationPayload
      if (!response.ok) {
        throw new Error(payload.error ?? 'Approved booking handoffs could not be resumed.')
      }

      setBookingResume(payload.booking_resume ?? { status: 'complete', results: [], error: null })
      await invalidatePlannerEventQueries(queryClient).catch((invalidationError) => {
        console.warn('[planner.materialize] Booking resume succeeded but query invalidation failed', invalidationError)
      })
      router.refresh()
      await onMaterialized?.()
    } catch (resumeError) {
      setBookingResume({
        status: 'failed',
        results: [],
        error: resumeError instanceof Error ? resumeError.message : 'Approved booking handoffs could not be resumed.',
      })
    } finally {
      setIsResumingBookings(false)
    }
  }

  function updateConfirmedField(update: () => void) {
    update()
    setIsConfirmed(false)
    setError(null)
  }

  return (
    <section className="rounded-lg border border-clay/30 bg-cream-deep/75 p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-clay-tint text-clay">
          <CalendarCheck2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="label-caps text-clay">Exact schedule</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-ink">Confirm the event record</h3>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Choose the exact local start and duration. This creates the event used by Experiences and Analytics, then safely resumes any booking request you already approved. It never pays or contacts anyone automatically.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className={compact ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
          <label className="block text-sm font-semibold text-ink">
            Event date
            <Input
              type="date"
              value={eventDate}
              min={dateWindowStart ?? undefined}
              max={dateWindowEnd ?? undefined}
              onChange={(event) => updateConfirmedField(() => setEventDate(event.target.value))}
              className="mt-2 min-h-11 rounded-md border-tan bg-cream text-sm"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Local start time
            <Input
              type="time"
              value={startTime}
              onChange={(event) => updateConfirmedField(() => setStartTime(event.target.value))}
              className="mt-2 min-h-11 rounded-md border-tan bg-cream text-sm"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Duration in minutes
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              step={1}
              value={durationMinutes}
              onChange={(event) => updateConfirmedField(() => setDurationMinutes(event.target.value))}
              className="mt-2 min-h-11 rounded-md border-tan bg-cream text-sm"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            IANA timezone
            <Input
              type="text"
              value={timeZone}
              onChange={(event) => updateConfirmedField(() => setTimeZone(event.target.value))}
              className="mt-2 min-h-11 rounded-md border-tan bg-cream text-sm"
              spellCheck={false}
              required
            />
          </label>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-tan bg-cream p-3 text-sm leading-6 text-ink-soft">
          <input
            type="checkbox"
            checked={isConfirmed}
            onChange={(event) => {
              setIsConfirmed(event.target.checked)
              setError(null)
            }}
            className="mt-1 h-4 w-4 rounded border-tan text-clay focus:ring-clay"
          />
          <span>
            I confirm this exact date, local start time, duration, and timezone. I understand this creates the canonical event and may resume an already-approved booking request—not a purchase, payment, or outbound message.
          </span>
        </label>

        {visibleError ? (
          <p role="alert" className="rounded-md border border-brick/30 bg-brick/10 px-3 py-2 text-sm text-brick">
            {visibleError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-ink-faint">
            Allowed date window: {formatDateWindow(dateWindowStart, dateWindowEnd)}
          </p>
          <Button type="submit" disabled={isSubmitting || !isConfirmed || Boolean(scheduleError)}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck2 className="h-4 w-4" />}
            {isSubmitting ? 'Creating event record…' : 'Confirm exact schedule'}
          </Button>
        </div>
      </form>
    </section>
  )
}

function describeBookingResume(state: BookingResumeState | null): string {
  if (!state) {
    return 'This event now feeds Experiences and Analytics. Approved quote handoffs remain separate and can be synchronized safely; 3rdPlace never sends or pays from this step.'
  }
  if (state.status === 'failed') {
    if (state.recovery?.reason === 'plan_status_ineligible') {
      return 'The exact event schedule is confirmed, but approved booking work cannot resume after this plan left an executable state.'
    }
    return 'The exact event schedule is confirmed, but one or more approved booking handoffs did not resume.'
  }
  if (state.status === 'reapproval_required') {
    return 'The exact event schedule is confirmed. One or more booking approvals must be reviewed again before 3rdPlace can start those handoffs.'
  }

  const bookingCount = state.results.filter((result) => {
    const metadata = result.metadata
    return metadata && typeof metadata.booking_id === 'string' && metadata.booking_id.length > 0
  }).length
  if (bookingCount > 0) {
    return `${bookingCount} approved booking request${bookingCount === 1 ? ' is' : 's are'} now linked to this canonical event. No payment or outbound send occurred.`
  }
  if (state.results.length > 0) {
    return `${state.results.length} approved booking handoff${state.results.length === 1 ? ' was' : 's were'} synchronized. No payment or outbound send occurred.`
  }
  return 'This event now feeds Experiences and Analytics. No approved booking handoff needed recovery, and no payment or outbound send occurred.'
}

function validateSchedule(input: {
  eventDate: string
  startTime: string
  durationMinutes: number
  timeZone: string
  dateWindowStart: string | null
  dateWindowEnd: string | null
}) {
  if (!input.dateWindowStart || !input.dateWindowEnd) return 'Confirm an approved date window before creating the event record.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) return 'Choose an exact event date.'
  if (input.dateWindowStart && input.eventDate < input.dateWindowStart) return 'Choose a date inside the approved window.'
  if (input.dateWindowEnd && input.eventDate > input.dateWindowEnd) return 'Choose a date inside the approved window.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) return 'Choose an exact local start time.'
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) {
    return 'Duration must be between 1 minute and 24 hours.'
  }
  if (!isIanaTimeZone(input.timeZone.trim())) return 'Enter a valid IANA timezone, such as America/Los_Angeles.'
  return null
}

function isIanaTimeZone(value: string) {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return 'exact plan dates required'
  if (!end || start === end) return start ?? end
  return `${start ?? end} through ${end}`
}
