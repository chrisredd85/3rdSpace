import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Event,
  Venue,
  Vendor,
  VenueBooking,
  VendorBooking,
  EventStatus,
} from '@/lib/types'

// Query keys
const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  list: (organizerId: string | null) =>
    [...eventKeys.lists(), organizerId] as const,
  details: () => [...eventKeys.all, 'detail'] as const,
  detail: (id: string) => [...eventKeys.details(), id] as const,
  progress: (id: string) => [...eventKeys.all, 'progress', id] as const,
}

export interface EventWithRelations extends Event {
  /** Legacy/display name (prefer title) */
  name?: string | null
  venue?: Venue | null
  venue_booking?: VenueBooking | null
  vendor_bookings?: VendorBooking[]
  vendors?: Vendor[]
}

/**
 * Fetch user's events
 */
export function useEvents(organizerId: string | null, filters?: { status?: EventStatus; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [...eventKeys.list(organizerId), filters],
    queryFn: async () => {
      if (!organizerId) return []

      const params = new URLSearchParams()
      if (filters?.status) params.append('status', filters.status)
      if (filters?.limit) params.append('limit', filters.limit.toString())
      if (filters?.offset) params.append('offset', filters.offset.toString())

      const response = await fetch(`/api/builder/events?${params.toString()}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch events')
      }

      const data = await response.json()
      return (data.events || []) as Event[]
    },
    enabled: !!organizerId,
  })
}

/**
 * Fetch single event with venue and vendors
 */
export function useEvent(id: string | null) {
  return useQuery({
    queryKey: eventKeys.detail(id || ''),
    queryFn: async () => {
      if (!id) return null

      const response = await fetch(`/api/builder/events/${id}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 404) return null
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch event')
      }

      const data = await response.json()
      return data.event as EventWithRelations
    },
    enabled: !!id,
  })
}

/**
 * Calculate event completion percentage
 */
export function useEventProgress(id: string | null) {
  return useQuery({
    queryKey: eventKeys.progress(id || ''),
    queryFn: async () => {
      if (!id) return 0

      // Fetch event with relations
      const response = await fetch(`/api/builder/events/${id}`, {
        credentials: 'include',
      })

      if (!response.ok) return 0

      const data = await response.json()
      const event = data.event

      if (!event) return 0

      let completedSteps = 0
      const totalSteps = 5

      // Step 1: Event details (title, description, date)
      if (event.title && event.description && event.event_date) {
        completedSteps++
      }

      // Step 2: Venue booked
      if (event.venue_booking && event.venue_booking.status === 'confirmed') {
        completedSteps++
      }

      // Step 3: At least one vendor booked
      if (event.vendor_bookings && event.vendor_bookings.some((vb: any) => vb.status === 'confirmed')) {
        completedSteps++
      }

      // Step 4: Budget set
      if (event.budget) {
        completedSteps++
      }

      // Step 5: Event confirmed
      if (event.status === 'confirmed' || event.status === 'completed') {
        completedSteps++
      }

      return Math.round((completedSteps / totalSteps) * 100)
    },
    enabled: !!id,
  })
}

/**
 * Mutation to create a new event
 */
export function useCreateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      event: Omit<Event, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const response = await fetch('/api/builder/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(event),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create event')
      }

      const data = await response.json()
      return data.event as Event
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(data.id) })
      queryClient.invalidateQueries({ queryKey: ['builder', 'stats'] })
    },
  })
}

/**
 * Mutation to update an event
 */
export function useUpdateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<Event, 'id' | 'created_at'>> & { updated_at?: string }
    }) => {
      const response = await fetch(`/api/builder/events/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update event')
      }

      const data = await response.json()
      return data.event as Event
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(data.id) })
      queryClient.invalidateQueries({ queryKey: eventKeys.progress(data.id) })
    },
  })
}

/**
 * Mutation to delete an event
 */
export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/builder/events/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete event')
      }

      return { id }
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
      queryClient.removeQueries({ queryKey: eventKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ['builder', 'stats'] })
    },
  })
}
