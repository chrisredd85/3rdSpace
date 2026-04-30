'use client'

import { CreditCard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StripeConnectButtonProps {
  disabled?: boolean
  isLoading?: boolean
  isConnected?: boolean
  onConnect: () => void
}

/**
 * Starts or resumes Stripe Connect onboarding.
 */
export function StripeConnectButton({
  disabled = false,
  isLoading = false,
  isConnected = false,
  onConnect,
}: StripeConnectButtonProps) {
  return (
    <Button type="button" onClick={onConnect} disabled={disabled || isLoading}>
      {isLoading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CreditCard className="mr-2 h-4 w-4" />
      )}
      {isConnected ? 'Continue Stripe setup' : 'Connect Stripe'}
    </Button>
  )
}
