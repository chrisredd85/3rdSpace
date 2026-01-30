import { useQuery } from '@tanstack/react-query'

interface BuilderStats {
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
 */
export function useBuilderStats() {
  return useQuery<BuilderStats>({
    queryKey: ['builder', 'stats'],
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
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}
