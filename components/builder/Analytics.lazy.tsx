'use client'

import { lazy, Suspense } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

// Lazy load analytics page (heavy component with charts)
const AnalyticsPage = lazy(() => 
  import('@/app/(planner)/planner/analytics/page').then((mod) => ({ default: mod.default }))
)

export default function AnalyticsLazy() {
  return (
    <Suspense fallback={<LoadingSpinner size="lg" text="Loading analytics..." />}>
      <AnalyticsPage />
    </Suspense>
  )
}
