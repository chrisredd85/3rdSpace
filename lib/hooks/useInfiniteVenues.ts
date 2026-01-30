import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Venue, VenueType } from '@/lib/types'

interface VenueFilters {
  venue_type?: VenueType
  city?: string
  state?: string
  min_capacity?: number
  max_capacity?: number
  min_price?: number
  max_price?: number
  is_verified?: boolean
}

/**
 * Infinite query hook for venues with pagination
 * 
 * Implements infinite scroll for better performance with large lists
 * 
 * @example
 * ```tsx
 * const {
 *   data,
 *   fetchNextPage,
 *   hasNextPage,
 *   isFetchingNextPage,
 * } = useInfiniteVenues(filters)
 * 
 * // Render venues
 * {data?.pages.map((page) =>
 *   page.data.map((venue) => <VenueCard key={venue.id} venue={venue} />)
 * )}
 * 
 * // Load more
 * {hasNextPage && (
 *   <Button onClick={() => fetchNextPage()}>
 *     {isFetchingNextPage ? 'Loading...' : 'Load More'}
 *   </Button>
 * )}
 * ```
 */
export function useInfiniteVenues(
  filters?: VenueFilters,
  pageSize = 20
) {
  return useInfiniteQuery({
    queryKey: ['venues', 'infinite', filters, pageSize],
    queryFn: async ({ pageParam = 0 }) => {
      // Only select needed columns for list view
      let query = supabase
        .from('venues')
        .select('id, name, venue_type, city, state, capacity, hourly_rate, photo_url, is_verified, created_at', {
          count: 'exact',
        })
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      // Apply filters
      if (filters?.venue_type) {
        query = query.eq('venue_type', filters.venue_type)
      }
      if (filters?.city) {
        query = query.eq('city', filters.city)
      }
      if (filters?.state) {
        query = query.eq('state', filters.state)
      }
      if (filters?.min_capacity) {
        query = query.gte('capacity', filters.min_capacity)
      }
      if (filters?.max_capacity) {
        query = query.lte('capacity', filters.max_capacity)
      }
      if (filters?.min_price) {
        query = query.gte('hourly_rate', filters.min_price)
      }
      if (filters?.max_price) {
        query = query.lte('hourly_rate', filters.max_price)
      }
      if (filters?.is_verified !== undefined) {
        query = query.eq('is_verified', filters.is_verified)
      }

      // Add pagination
      const from = pageParam * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error, count } = await query

      if (error) throw error

      return {
        data: (data || []) as Venue[],
        nextCursor: (data || []).length === pageSize ? pageParam + 1 : undefined,
        total: count || 0,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}
