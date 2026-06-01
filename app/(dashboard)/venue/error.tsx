'use client'

import { useEffect } from 'react'

interface VenueDashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for the venue dashboard.
 */
export default function VenueDashboardError({ error, reset }: VenueDashboardErrorProps) {
  useEffect(() => {
    console.error('Venue dashboard error:', error)
    void fetch('/api/errors/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'venue_dashboard_error_boundary',
        message: error.message,
        stack: error.stack,
        metadata: { digest: error.digest },
      }),
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-6 text-center text-ink">
      <div className="max-w-md rounded-lg border border-tan bg-cream p-8 shadow-card">
        <p className="text-sm font-semibold uppercase text-clay">Venue dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Could not load this page</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Retry the dashboard load. The error was logged for review.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-clay px-5 py-2 text-sm font-semibold text-cream"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
