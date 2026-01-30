import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AvailabilityBlock } from '@/lib/types'

// Query keys
const availabilityKeys = {
  all: ['availability'] as const,
  venue: (year: number, month: number) =>
    [...availabilityKeys.all, 'venue', year, month] as const,
  vendor: (year: number, month: number) =>
    [...availabilityKeys.all, 'vendor', year, month] as const,
  blocks: () => [...availabilityKeys.all, 'blocks'] as const,
}

interface AvailabilityResponse {
  bookings: any[]
  blocks: AvailabilityBlock[]
  availableDates: string[]
  bookedDates: string[]
  blockedDates: string[]
  month: { year: number; month: number }
}

/**
 * Fetch venue availability for a month
 */
export function useVenueAvailability(year: number, month: number) {
  return useQuery<AvailabilityResponse>({
    queryKey: availabilityKeys.venue(year, month),
    queryFn: async () => {
      const params = new URLSearchParams({
        year: year.toString(),
        month: month.toString(),
      })

      const response = await fetch(`/api/venue/availability?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch availability')
      }

      return response.json()
    },
    enabled: !!year && !!month && month >= 1 && month <= 12,
    staleTime: 30 * 1000, // Cache for 30 seconds
  })
}

/**
 * Fetch vendor availability for a month
 */
export function useVendorAvailability(year: number, month: number) {
  return useQuery<AvailabilityResponse>({
    queryKey: availabilityKeys.vendor(year, month),
    queryFn: async () => {
      const params = new URLSearchParams({
        year: year.toString(),
        month: month.toString(),
      })

      const response = await fetch(`/api/vendor/availability?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch availability')
      }

      return response.json()
    },
    enabled: !!year && !!month && month >= 1 && month <= 12,
    staleTime: 30 * 1000, // Cache for 30 seconds
  })
}

/**
 * Fetch availability blocks for a venue or vendor in a specific month
 * @deprecated Use useVenueAvailability or useVendorAvailability instead
 * This is kept for backward compatibility with existing calendar components
 */
export function useAvailabilityBlocks(
  venueId: string | null,
  month: string,
  vendorId?: string | null
) {
  const [year, monthNum] = month.split('-').map(Number)
  
  if (venueId) {
    const { data, isLoading, error } = useVenueAvailability(year, monthNum)
    return {
      data: data?.blocks || [],
      isLoading,
      error,
    }
  } else if (vendorId) {
    const { data, isLoading, error } = useVendorAvailability(year, monthNum)
    return {
      data: data?.blocks || [],
      isLoading,
      error,
    }
  }
  
  return { data: [], isLoading: false, error: null }
}

/**
 * Mutation to create an availability block
 */
export function useCreateAvailabilityBlock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      block: Omit<AvailabilityBlock, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const endpoint = block.venue_id
        ? '/api/venue/blocks'
        : '/api/vendor/blocks'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          ...block,
          is_available: false, // Blocks are unavailable by default
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create block')
      }

      const data = await response.json()
      return data.block as AvailabilityBlock
    },
    onSuccess: (data) => {
      // Invalidate all availability queries
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all })
      queryClient.invalidateQueries({ queryKey: availabilityKeys.blocks() })
    },
  })
}

/**
 * Mutation to update an availability block
 */
export function useUpdateAvailabilityBlock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
      isVenue = true,
    }: {
      id: string
      updates: Partial<Omit<AvailabilityBlock, 'id' | 'created_at'>> & {
        updated_at?: string
      }
      isVenue?: boolean
    }) => {
      const endpoint = isVenue
        ? `/api/venue/blocks/${id}`
        : `/api/vendor/blocks/${id}`

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update block')
      }

      const data = await response.json()
      return data.block as AvailabilityBlock
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all })
      queryClient.invalidateQueries({ queryKey: availabilityKeys.blocks() })
    },
  })
}

/**
 * Mutation to delete an availability block
 */
export function useDeleteAvailabilityBlock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, isVenue = true }: { id: string; isVenue?: boolean }) => {
      const endpoint = isVenue
        ? `/api/venue/blocks/${id}`
        : `/api/vendor/blocks/${id}`

      const response = await fetch(endpoint, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete block')
      }

      return { id }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all })
      queryClient.invalidateQueries({ queryKey: availabilityKeys.blocks() })
    },
  })
}
