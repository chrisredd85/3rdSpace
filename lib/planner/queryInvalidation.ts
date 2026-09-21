import type { QueryClient } from '@tanstack/react-query'

const plannerEventQueryKeys = [
  ['events'],
  ['builder', 'stats'],
  ['planner', 'plans'],
  ['planner-analytics'],
  ['planner-ticketing-analytics'],
] as const

/**
 * Invalidates every client-side read model that can consume a newly
 * materialized canonical event.
 */
export async function invalidatePlannerEventQueries(queryClient: QueryClient) {
  await Promise.all(
    plannerEventQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  )
}
