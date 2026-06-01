'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Error boundary for the vendor service/profile manager.
 */
export default function VendorServicesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Service listing unavailable</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-soft">
          We could not load your vendor profile tools. {error.message || 'Please try again.'}
        </p>
        <Button type="button" onClick={reset}>Try again</Button>
      </CardContent>
    </Card>
  )
}
