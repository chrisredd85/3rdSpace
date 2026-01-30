'use client'

import { lazy, Suspense } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

// Lazy load the calendar component (heavy component with date calculations)
const VenueCalendarPage = lazy(() => 
  import('@/app/(dashboard)/venue/calendar/page').then((mod) => ({ default: mod.default }))
)

export default function VenueCalendarLazy() {
  return (
    <Suspense fallback={<LoadingSpinner size="lg" text="Loading calendar..." />}>
      <VenueCalendarPage />
    </Suspense>
  )
}
