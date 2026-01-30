import { useQuery } from '@tanstack/react-query'
import type { VendorBooking, BookingStatus } from '@/lib/types'

// Query keys
const vendorBookingKeys = {
  all: ['vendor-bookings'] as const,
  vendor: (vendorId: string) => [...vendorBookingKeys.all, vendorId] as const,
  allForVendor: (vendorId: string) => [...vendorBookingKeys.vendor(vendorId), 'all'] as const,
}

/**
 * Fetch all vendor bookings for a vendor (all statuses)
 */
export function useVendorOwnerBookings(vendorId: string | null, status?: BookingStatus | 'all') {
  return useQuery({
    queryKey: [...vendorBookingKeys.allForVendor(vendorId || ''), status],
    queryFn: async () => {
      if (!vendorId) return []

      const params = new URLSearchParams()
      if (status) params.append('status', status)

      const response = await fetch(`/api/vendor/bookings?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch bookings')
      }

      const data = await response.json()
      return (data.bookings || []) as VendorBooking[]
    },
    enabled: !!vendorId,
  })
}
