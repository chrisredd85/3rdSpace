'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, Loader2 } from 'lucide-react'
import { parseDollarsToCents } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type OutcomeReason =
  | 'canonical_event_required'
  | 'outcome_recorded'
  | 'plan_not_booked'
  | 'event_not_ended'
  | null

type OutcomeState = {
  plan: { id: string; status: string }
  event: {
    id: string
    event_name: string
    ends_at: string | null
    outcome_recorded_at: string | null
    outcome_summary: Record<string, unknown> | null
  } | null
  canRecord: boolean
  reason: OutcomeReason
  templateEligible: boolean
}

interface PlannerOutcomeCardProps {
  planId: string | null | undefined
  onCompleted?: () => void | Promise<void>
}

type OutcomePayload = {
  actualAttendance?: number
  grossRevenueCents?: number
  totalCostCents?: number
  notes?: string
}

export function PlannerOutcomeCard({ planId, onCompleted }: PlannerOutcomeCardProps) {
  const queryClient = useQueryClient()
  const [attendance, setAttendance] = useState('')
  const [revenueDollars, setRevenueDollars] = useState('')
  const [costDollars, setCostDollars] = useState('')
  const [notes, setNotes] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const outcomeQuery = useQuery({
    queryKey: ['planner', 'outcome', planId],
    enabled: Boolean(planId),
    queryFn: () => fetchOutcomeState(planId as string),
  })

  const outcomeMutation = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error('Canonical plan is missing')
      const payload = buildOutcomePayload({ attendance, revenueDollars, costDollars, notes })
      if ('error' in payload) throw new Error(payload.error)

      const response = await fetch(`/api/planner/plans/${planId}/outcome`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Event outcome could not be recorded')
      return result
    },
    onSuccess: async () => {
      setValidationError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['planner', 'outcome', planId] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
      ])
      await onCompleted?.()
    },
  })

  if (!planId || outcomeQuery.isLoading) return null
  if (outcomeQuery.isError) {
    return (
      <Card className="border-brick/30 bg-brick-tint">
        <CardHeader>
          <CardTitle className="text-base">Outcome status unavailable</CardTitle>
          <CardDescription>{readErrorMessage(outcomeQuery.error)}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const state = outcomeQuery.data
  if (!state?.event || state.reason === 'plan_not_booked') return null

  if (state.reason === 'outcome_recorded') {
    return (
      <Card className="border-forest/25 bg-forest/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-forest" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">Event complete</CardTitle>
              <CardDescription>
                Outcome evidence is recorded. Analytics and template/rebook workflows can use this event.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-ink-soft">
          Recorded {formatTimestamp(state.event.outcome_recorded_at)}
        </CardContent>
      </Card>
    )
  }

  if (state.reason === 'event_not_ended') {
    return (
      <Card className="border-tan bg-cream-deep">
        <CardHeader>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-ochre" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">Outcome entry opens after the event</CardTitle>
              <CardDescription>
                3rdPlace will use the exact canonical end time: {formatTimestamp(state.event.ends_at)}.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    )
  }

  if (!state.canRecord) return null

  const submitError = validationError ?? (outcomeMutation.error ? readErrorMessage(outcomeMutation.error) : null)

  return (
    <Card className="border-clay/25 bg-cream">
      <CardHeader>
        <CardTitle className="font-display text-xl">Record the event outcome</CardTitle>
        <CardDescription>
          Add at least one measured result or substantive note. Saving completes the canonical event and plan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const candidate = buildOutcomePayload({ attendance, revenueDollars, costDollars, notes })
            if ('error' in candidate) {
              setValidationError(candidate.error)
              return
            }
            setValidationError(null)
            outcomeMutation.mutate()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-ink">
              Actual attendance
              <Input
                className="mt-1"
                inputMode="numeric"
                min="0"
                step="1"
                type="number"
                value={attendance}
                onChange={(event) => setAttendance(event.target.value)}
                placeholder="84"
              />
            </label>
            <label className="text-sm font-semibold text-ink">
              Gross revenue ($)
              <Input
                className="mt-1"
                inputMode="decimal"
                value={revenueDollars}
                onChange={(event) => setRevenueDollars(event.target.value)}
                placeholder="2450.00"
              />
            </label>
            <label className="text-sm font-semibold text-ink">
              Total cost ($)
              <Input
                className="mt-1"
                inputMode="decimal"
                value={costDollars}
                onChange={(event) => setCostDollars(event.target.value)}
                placeholder="1725.00"
              />
            </label>
          </div>
          <label className="text-sm font-semibold text-ink">
            Outcome notes
            <Textarea
              className="mt-1 min-h-24"
              maxLength={4_000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What worked, what changed, and what should the next event repeat?"
            />
          </label>
          {submitError ? (
            <p className="text-sm font-semibold text-brick" role="alert">{submitError}</p>
          ) : null}
          <div>
            <Button type="submit" disabled={outcomeMutation.isPending}>
              {outcomeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Record outcome and complete event
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function buildOutcomePayload(input: {
  attendance: string
  revenueDollars: string
  costDollars: string
  notes: string
}): OutcomePayload | { error: string } {
  const payload: OutcomePayload = {}

  if (input.attendance.trim()) {
    if (!/^\d+$/.test(input.attendance.trim())) {
      return { error: 'Actual attendance must be a whole number.' }
    }
    const actualAttendance = Number(input.attendance)
    if (!Number.isSafeInteger(actualAttendance)) return { error: 'Actual attendance is too large.' }
    payload.actualAttendance = actualAttendance
  }

  const revenue = parseOptionalDollars(input.revenueDollars, 'Gross revenue')
  if ('error' in revenue) return revenue
  if (revenue.cents !== null) payload.grossRevenueCents = revenue.cents

  const cost = parseOptionalDollars(input.costDollars, 'Total cost')
  if ('error' in cost) return cost
  if (cost.cents !== null) payload.totalCostCents = cost.cents

  const trimmedNotes = input.notes.trim()
  if (trimmedNotes) payload.notes = trimmedNotes

  if (Object.keys(payload).length === 0) {
    return { error: 'Record attendance, revenue, cost, or an outcome note.' }
  }

  return payload
}

async function fetchOutcomeState(planId: string): Promise<OutcomeState> {
  const response = await fetch(`/api/planner/plans/${planId}/outcome`, { credentials: 'include' })
  const payload = await response.json().catch(() => ({})) as OutcomeState & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Unable to load event outcome state')
  return payload
}

function parseOptionalDollars(value: string, label: string): { cents: number | null } | { error: string } {
  const trimmed = value.trim()
  if (!trimmed) return { cents: null }
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return { error: `${label} must use dollars with no more than two decimal places.` }
  }
  const cents = parseDollarsToCents(trimmed)
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) {
    return { error: `${label} is invalid.` }
  }
  return { cents }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to update the event outcome.'
}

function formatTimestamp(value: string | null) {
  if (!value) return 'after the event ends'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
