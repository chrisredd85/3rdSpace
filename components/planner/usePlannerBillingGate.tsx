'use client'

import { useCallback, useMemo, useState } from 'react'
import { BillingGateModal } from '@/components/planner/BillingGateModal'

export type PlannerBillingRequiredPayload = {
  error?: string
  message?: string
  billingRequired?: boolean
}

interface UsePlannerBillingGateOptions {
  onPlanArchived?: (planId: string) => void
}

export function usePlannerBillingGate(options: UsePlannerBillingGateOptions = {}) {
  const { onPlanArchived } = options
  const [billingGate, setBillingGate] = useState<{ isOpen: boolean; message: string | null }>({
    isOpen: false,
    message: null,
  })

  const openBillingGate = useCallback((message?: string | null) => {
    setBillingGate({
      isOpen: true,
      message: message ?? "You've used your free events. Choose how to keep planning.",
    })
  }, [])

  const closeBillingGate = useCallback(() => {
    setBillingGate({ isOpen: false, message: null })
  }, [])

  const handleBillingRequiredResponse = useCallback((
    response: Response,
    payload?: PlannerBillingRequiredPayload | null
  ) => {
    if (response.status !== 402) return false
    openBillingGate(payload?.error ?? payload?.message)
    return true
  }, [openBillingGate])

  const modal = useMemo(() => (
    <BillingGateModal
      isOpen={billingGate.isOpen}
      message={billingGate.message}
      onClose={closeBillingGate}
      onPlanArchived={onPlanArchived}
    />
  ), [billingGate.isOpen, billingGate.message, closeBillingGate, onPlanArchived])

  return {
    billingGate,
    openBillingGate,
    closeBillingGate,
    handleBillingRequiredResponse,
    modal,
  }
}
