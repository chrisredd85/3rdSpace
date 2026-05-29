'use client'

import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StripeDashboardLinkProps {
  disabled?: boolean
  isLoading?: boolean
  onOpen: () => void
}

/**
 * Opens the vendor's Stripe Express Dashboard.
 */
export function StripeDashboardLink({
  disabled = false,
  isLoading = false,
  onOpen,
}: StripeDashboardLinkProps) {
  return (
    <Button type="button" variant="glass" onClick={onOpen} disabled={disabled || isLoading}>
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <ExternalLink className="mr-2 h-4 w-4" />
      )}
      Open Stripe dashboard
    </Button>
  )
}
