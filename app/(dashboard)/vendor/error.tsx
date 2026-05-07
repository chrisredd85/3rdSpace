'use client'

import { useEffect } from 'react'

interface VendorDashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for the vendor dashboard.
 */
export default function VendorDashboardError({ error, reset }: VendorDashboardErrorProps) {
  useEffect(() => {
    console.error('Vendor dashboard error:', error)
    void fetch('/api/errors/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'vendor_dashboard_error_boundary',
        message: error.message,
        stack: error.stack,
        metadata: { digest: error.digest },
      }),
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-card">
        <p className="text-sm font-semibold uppercase text-primary">Vendor dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Could not load this page</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Retry the dashboard load. The error was logged for review.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
