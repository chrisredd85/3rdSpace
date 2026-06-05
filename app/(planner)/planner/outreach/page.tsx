'use client'

import { Suspense } from 'react'
import { PlannerWorkspace } from '@/components/planner/planner-page/PlannerWorkspace'

export default function PlannerOutreachPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PlannerWorkspace />
    </Suspense>
  )
}
