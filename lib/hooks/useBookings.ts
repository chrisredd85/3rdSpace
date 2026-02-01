import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  VenueBooking,
  VendorBooking,
  BookingStatus,
} from '@/lib/types'

// Query keys
const bookingKeys = {
  all: ['bookings'] as const,
  venueRequests: (venueOwnerId: string) =>
    [...bookingKeys.all, 'venue-requests', venueOwnerId] as const,
  vendorRequests: (vendorId: string) =>
    [...bookingKeys.all, 'vendor-requests', vendorId] as const,
}

/**
 * Fetch venue booking requests for a venue owner
 */
export function useVenueBookingRequests(venueOwnerId: string | null, status?: BookingStatus | 'all') {
  return useQuery({
    queryKey: [...bookingKeys.venueRequests(venueOwnerId || ''), status],
    queryFn: async () => {
      if (!venueOwnerId) return []

      const params = new URLSearchParams()
      if (status) params.append('status', status)

      const response = await fetch(`/api/venue/requests?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch booking requests')
      }

      const data = await response.json()
      return (data.bookings || []) as VenueBooking[]
    },
    enabled: !!venueOwnerId,
  })
}

/**
 * Fetch all venue bookings for a venue owner (all statuses)
 */
export function useVenueOwnerBookings(venueOwnerId: string | null) {
  return useVenueBookingRequests(venueOwnerId, 'all')
}

/**
 * Fetch vendor booking requests
 */
export function useVendorBookingRequests(vendorId: string | null, status?: BookingStatus | 'all') {
  return useQuery({
    queryKey: [...bookingKeys.vendorRequests(vendorId || ''), status],
    queryFn: async () => {
      if (!vendorId) return []

      const params = new URLSearchParams()
      if (status) params.append('status', status)

      const response = await fetch(`/api/vendor/bookings?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch booking requests')
      }

      const data = await response.json()
      return (data.bookings || []) as VendorBooking[]
    },
    enabled: !!vendorId,
  })
}

/**
 * Mutation to create a venue booking request
 */
export function useCreateVenueBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      booking: Omit<VenueBooking, 'id' | 'created_at' | 'updated_at'>
    ) => {
      // This would need its own API route if needed
      // For now, keeping direct Supabase call for creating bookings
      // as this is typically done from the builder side
      throw new Error('Use API route for creating bookings')
    },
    onSuccess: (data: VenueBooking) => {
      queryClient.invalidateQueries({
        queryKey: bookingKeys.venueRequests(data.venue_id),
      })
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })
}

/**
 * Mutation to create a vendor booking request
 */
export function useCreateVendorBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      booking: Omit<VendorBooking, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('vendor_bookings')
        .insert({
          ...booking,
          status: 'pending',
        } as never)
        .select()
        .single()

      if (error) throw error
      return data as VendorBooking
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: bookingKeys.vendorRequests(data.vendor_id),
      })
      // Invalidate event queries to refresh vendor bookings
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })
}

/**
 * Mutation to update booking status (accept/decline) - for venue bookings
 */
export function useUpdateVenueBookingStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      bookingId,
      status,
      confirmedDate,
      confirmedStartTime,
      confirmedEndTime,
      finalPrice,
      quotedPrice,
      notes,
    }: {
      bookingId: string
      status: BookingStatus
      confirmedDate?: string
      confirmedStartTime?: string
      confirmedEndTime?: string
      finalPrice?: number
      quotedPrice?: number
      notes?: string
    }) => {
      const response = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          status,
          confirmed_date: confirmedDate,
          confirmed_start_time: confirmedStartTime,
          confirmed_end_time: confirmedEndTime,
          final_price: finalPrice,
          quoted_price: quotedPrice,
          notes,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update booking')
      }

      const data = await response.json()
      return data.booking as VenueBooking
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: bookingKeys.venueRequests((data as any).venue_id),
      })
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })
}

/**
 * Legacy function for backward compatibility
 */
export function useUpdateBookingStatus() {
  return useUpdateVenueBookingStatus()
}

/**
 * Mutation to cancel a booking
 */
export function useCancelBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      bookingId,
      bookingType,
    }: {
      bookingId: string
      bookingType: 'venue' | 'vendor'
    }) => {
      const supabase = createClient()
      const table = bookingType === 'venue' ? 'venue_bookings' : 'vendor_bookings'

      const { data, error } = await supabase
        .from(table)
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', bookingId)
        .select()
        .single()

      if (error) throw error
      return data as VenueBooking | VendorBooking
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.all })
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })
}
