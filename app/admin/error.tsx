'use client'

import { useEffect } from 'react'

interface AdminErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for admin operations pages.
 */
export default function AdminError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    console.error('Admin route error:', error)
    void fetch('/api/errors/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'admin_error_boundary',
        message: error.message,
        stack: error.stack,
        metadata: { digest: error.digest },
      }),
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-card">
        <p className="text-sm font-semibold uppercase text-primary">Admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Admin console unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The admin error was logged. Retry when ready.
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
