'use client'

import { lazy, Suspense } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

// Lazy load the dashboard component
const BuilderDashboard = lazy(() => import('./page').then((mod) => ({ default: mod.default })))

export default function BuilderDashboardLazy() {
  return (
    <Suspense fallback={<LoadingSpinner size="lg" text="Loading dashboard..." />}>
      <BuilderDashboard />
    </Suspense>
  )
}
