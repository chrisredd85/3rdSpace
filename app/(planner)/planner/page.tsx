'use client'

import { Suspense } from 'react'
import { PlannerWorkspace } from '@/components/planner/planner-page/PlannerWorkspace'

/**
 * Planner route with empty-state creation and API-backed active-plan chat.
 */
export default function PlannerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PlannerWorkspace />
    </Suspense>
  )
}
