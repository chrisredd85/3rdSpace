import 'server-only'

import { checkStripeReadinessForAuthorization } from '@/lib/planner/stripeReadinessGate'

type PlannerDb = { from: (table: string) => any }

type ControlledPaymentRecommendationFields = {
  execution_mode: 'controlled_payment' | null
  has_controlled_payment_account: boolean
  payment_required: boolean
}

/**
 * Adds only a boolean execution capability signal to recommendation payloads.
 * Local Stripe-account readiness is used for presentation; the authorize route
 * still retrieves fresh Stripe truth before any PaymentIntent is created.
 * Lookup failures fail closed to the existing hold/contact action.
 */
export async function attachControlledPaymentRecommendationReadiness<T extends object>(input: {
  db: PlannerDb
  entityType: 'venue' | 'vendor'
  recommendations: T[]
  getEntityId: (recommendation: T) => string | null
  getPriceCents: (recommendation: T) => number | null
}): Promise<Array<T & ControlledPaymentRecommendationFields>> {
  return Promise.all(input.recommendations.map(async (recommendation) => {
    const entityId = input.getEntityId(recommendation)
    const priceCents = input.getPriceCents(recommendation)
    let ready = false

    if (entityId && typeof priceCents === 'number' && priceCents > 0) {
      try {
        const gate = await checkStripeReadinessForAuthorization({
          supabase: input.db,
          entityType: input.entityType,
          entityId,
        })
        ready = gate.ready
      } catch (error) {
        console.error('[planner.recommend] Stripe readiness lookup failed closed', {
          entityType: input.entityType,
          entityId,
          error: error instanceof Error ? error.message : 'unknown error',
        })
      }
    }

    return {
      ...recommendation,
      execution_mode: ready ? 'controlled_payment' as const : null,
      has_controlled_payment_account: ready,
      payment_required: ready,
    }
  }))
}
