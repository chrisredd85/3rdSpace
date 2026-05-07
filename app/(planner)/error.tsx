'use client'

import { useEffect } from 'react'

interface PlannerErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for the planner route group.
 */
export default function PlannerError({ error, reset }: PlannerErrorProps) {
  useEffect(() => {
    console.error('Planner route error:', error)
    void fetch('/api/errors/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'planner_error_boundary',
        message: error.message,
        stack: error.stack,
        metadata: { digest: error.digest },
      }),
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-card">
        <p className="text-sm font-semibold uppercase text-primary">Planner</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The planner hit an error while loading this workspace.
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
