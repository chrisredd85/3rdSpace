import { Suspense } from 'react'
import { permanentRedirect } from 'next/navigation'
import { PlannerWorkspace } from '@/components/planner/planner-page/PlannerWorkspace'

type PlannerPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Planner route with empty-state creation and API-backed active-plan chat.
 */
export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const params = await searchParams
  const legacyRedirect = buildLegacyEventPlanRedirect(params)
  if (legacyRedirect) permanentRedirect(legacyRedirect)

  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PlannerWorkspace />
    </Suspense>
  )
}

function buildLegacyEventPlanRedirect(params?: Record<string, string | string[] | undefined>) {
  if (readFirstParam(params?.tab) !== 'event_plan') return null

  const planId = readFirstParam(params?.plan)
  const preserved = new URLSearchParams()
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (key === 'tab' || key === 'plan') return
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item) preserved.append(key, item)
        })
        return
      }
      if (value) preserved.set(key, value)
    })
  }
  const query = preserved.toString()

  if (!planId) {
    return query ? `/planner?${query}` : '/planner'
  }

  const target = `/planner/experiences/${encodeURIComponent(planId)}`
  return query ? `${target}?${query}` : target
}

function readFirstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
