'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Route-level recovery UI for vendor analytics render errors.
 */
export default function VendorAnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h1 className="font-display text-xl font-semibold">Analytics could not load</h1>
          <p className="mt-1 text-sm">
            {error.message || 'Refresh the page or try again in a moment.'}
          </p>
          <Button type="button" className="mt-4" variant="outline" onClick={reset}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
