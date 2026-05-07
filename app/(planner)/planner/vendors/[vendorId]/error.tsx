'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Error boundary for builder-facing vendor profile pages.
 */
export default function BuilderVendorProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor profile unavailable</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We could not load this vendor profile. {error.message || 'Please try again.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>Try again</Button>
          <Button asChild type="button" variant="outline">
            <Link href="/planner/vendors/marketplace">Back to vendors</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
