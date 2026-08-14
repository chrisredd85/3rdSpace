'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { PlannerLivePlanPanel, type PlannerDateChangeRequestInput } from '@/components/planner/PlannerLivePlanPanel'
import { Button } from '@/components/ui/button'
import { publishLivePlan } from '@/components/planner/planner-page/plannerState'
import type { Plan, PlanMessage, PlannerFullPlanResponse } from '@/lib/types'

type PlannerExperienceBriefDetailProps = {
  planId: string
}

type DetailState =
  | { status: 'loading'; payload: PlannerFullPlanResponse | null; error: null }
  | { status: 'loaded'; payload: PlannerFullPlanResponse; error: null }
  | { status: 'error'; payload: null; error: string }

export function PlannerExperienceBriefDetail({ planId }: PlannerExperienceBriefDetailProps) {
  const router = useRouter()
  const [state, setState] = useState<DetailState>({ status: 'loading', payload: null, error: null })

  const loadBrief = useCallback(async () => {
    setState((current) => ({ status: 'loading', payload: current.payload, error: null }))
    try {
      const response = await fetch(`/api/planner/plans/${planId}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      })
      const payload = await response.json().catch(() => ({} as Partial<PlannerFullPlanResponse> & { error?: string }))

      if (!response.ok) {
        throw new Error(payload.error ?? 'Could not load this event brief.')
      }
      if (!isPlannerFullPlanResponse(payload)) {
        throw new Error('The event brief response was incomplete.')
      }

      publishLivePlan(payload.plan, payload.messages)
      setState({ status: 'loaded', payload, error: null })
    } catch (error) {
      setState({ status: 'error', payload: null, error: error instanceof Error ? error.message : 'Could not load this event brief.' })
    }
  }, [planId])

  useEffect(() => {
    void loadBrief()
  }, [loadBrief])

  const handleDateChangeRequest = useCallback(async (input: PlannerDateChangeRequestInput) => {
    const currentPayload = state.status === 'loaded' ? state.payload : null
    if (!currentPayload) throw new Error('Load this event brief before creating date-change outreach approvals.')

    const response = await fetch(`/api/planner/plans/${planId}/date-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    })
    const payload = await response.json().catch(() => ({} as {
      error?: string
      plan?: Plan
      messages?: PlanMessage[]
      approval_message_id?: string
    }))

    if (!response.ok) {
      throw new Error(payload.error ?? 'Could not create date-change outreach approval.')
    }
    if (!payload.plan || !Array.isArray(payload.messages)) {
      throw new Error('Date-change approval returned an unexpected response.')
    }

    const nextPayload: PlannerFullPlanResponse = {
      ...currentPayload,
      plan: payload.plan,
      messages: payload.messages,
    }
    publishLivePlan(nextPayload.plan, nextPayload.messages)
    setState({ status: 'loaded', payload: nextPayload, error: null })

    const params = new URLSearchParams({ plan: planId, tab: 'approvals' })
    if (payload.approval_message_id) params.set('msg', payload.approval_message_id)
    router.push(`/planner?${params.toString()}`)
  }, [planId, router, state])

  const handleNavigateToPlannerTab = useCallback((tabId: 'approvals', messageId?: string) => {
    const params = new URLSearchParams({ plan: planId, tab: tabId })
    if (messageId) params.set('msg', messageId)
    router.push(`/planner?${params.toString()}`)
  }, [planId, router])

  if (state.status === 'loading') {
    return (
      <section className="overflow-hidden rounded-2xl border border-tan bg-cream-deep shadow-card">
        <div className="border-b border-tan px-5 py-5">
          <div className="flex items-center gap-3 text-sm font-semibold text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin text-clay" />
            Opening event record...
          </div>
          <div className="mt-4 h-8 w-64 max-w-full rounded-md bg-cream" />
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="h-8 w-24 rounded-full bg-cream" />
            <div className="h-8 w-28 rounded-full bg-cream" />
            <div className="h-8 w-20 rounded-full bg-cream" />
          </div>
        </div>
        <div className="divide-y divide-tan">
          {['Plan', 'Bookings', 'Money', 'Guests'].map((label) => (
            <div key={label} className="grid gap-4 px-5 py-5 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
              <div className="h-5 w-8 rounded bg-cream" />
              <div className="min-w-0">
                <div className="h-6 w-32 rounded bg-cream" />
                <div className="mt-3 h-4 w-full max-w-md rounded bg-cream" />
              </div>
              <div className="h-8 w-28 rounded-full bg-cream" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="rounded-2xl border border-brick/30 bg-brick/10 p-6 shadow-card">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-brick" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-ink">Event record unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{state.error}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="glass" onClick={() => void loadBrief()}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
              <Button asChild variant="ghost">
                <Link href="/planner/experiences">Back to Experiences</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const { plan, messages } = state.payload

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-tan bg-cream-deep p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/planner/experiences" className="inline-flex items-center gap-2 text-sm font-bold text-clay transition-colors hover:text-clay-deep">
            <ArrowLeft className="h-4 w-4" />
            Experiences
          </Link>
          <h1 className="mt-3 break-words font-display text-3xl font-bold leading-tight text-ink">{plan.title}</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Brief and operating context. Changes here still preserve approval gates before any outreach, booking, or payment executes.
          </p>
        </div>
        <Button asChild variant="glass" className="shrink-0">
          <Link href={`/planner?plan=${encodeURIComponent(plan.id)}&tab=chat`}>Open planner chat</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-tan bg-cream shadow-card">
        <PlannerLivePlanPanel
          inline
          planId={plan.id}
          messages={messages}
          onDateChangeRequest={handleDateChangeRequest}
          onEventMaterialized={loadBrief}
          onNavigateToTab={handleNavigateToPlannerTab}
        />
      </div>
    </section>
  )
}

function isPlannerFullPlanResponse(value: unknown): value is PlannerFullPlanResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<PlannerFullPlanResponse>
  return Boolean(record.plan && Array.isArray(record.messages) && Array.isArray(record.recommendations) && Array.isArray(record.approvals))
}
