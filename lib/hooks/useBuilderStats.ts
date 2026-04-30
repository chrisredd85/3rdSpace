import { useQuery } from '@tanstack/react-query'

export interface BuilderStats {
  upcomingEvents: number
  activeVendors: number
  savedVendors: number
  savedVenues: number
  ytdSpend: number
  eventsThisYear: number
  totalEvents: number
}

/**
 * Fetch builder dashboard stats
 *
 * @param initialStats - Optional server-loaded stats for the first dashboard render
 */
export function useBuilderStats(initialStats?: BuilderStats) {
  return useQuery<BuilderStats>({
    queryKey: ['builder', 'stats'],
    networkMode: 'always',
    queryFn: async () => {
      const response = await fetch('/api/builder/stats', {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch stats')
      }

      return response.json()
    },
    initialData: initialStats,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}
