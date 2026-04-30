import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type {
  Venue,
  VenueAmenity,
  VenuePhoto,
  VenueRequirement,
  VenueBooking,
  VenueType,
  SavedVenue,
} from '@/lib/types'
import {
  normalizeVenue,
  normalizeVenues,
  toVenueRowInsert,
  toVenueRowUpdate,
  VENUE_DETAIL_SELECT_COLUMNS,
  VENUE_SELECT_COLUMNS,
} from '@/lib/venues/venue-adapter'

// Query keys
const venueKeys = {
  all: ['venues'] as const,
  lists: () => [...venueKeys.all, 'list'] as const,
  list: (filters: VenueFilters & { page?: number; pageSize?: number }) => [...venueKeys.lists(), filters] as const,
  details: () => [...venueKeys.all, 'detail'] as const,
  detail: (id: string) => [...venueKeys.details(), id] as const,
  bookings: (venueId: string) => [...venueKeys.all, 'bookings', venueId] as const,
  availability: (venueId: string, month: string) =>
    [...venueKeys.all, 'availability', venueId, month] as const,
  ownerOptions: (userId: string) => [...venueKeys.all, 'owner-options', userId] as const,
  saved: (userId: string) => [...venueKeys.all, 'saved', userId] as const,
}

interface VenueFilters {
  venue_type?: VenueType
  city?: string
  state?: string
  min_capacity?: number
  max_capacity?: number
  min_price?: number
  max_price?: number
  is_verified?: boolean
  unique_feature_tags?: string[]
}

interface VenueWithRelations extends Venue {
  amenities: VenueAmenity[]
  photos: VenuePhoto[]
  requirements: VenueRequirement[]
}

/**
 * Fetch all published venues with optional filters and pagination
 */
export function useVenues(
  filters?: VenueFilters,
  options?: {
    page?: number
    pageSize?: number
    enabled?: boolean
  }
) {
  const page = options?.page ?? 0
  const pageSize = options?.pageSize ?? 20

  return useQuery({
    queryKey: venueKeys.list({ ...filters, page, pageSize }),
    enabled: options?.enabled !== false, // Default to true, can be disabled
    queryFn: async () => {
      // Only select needed columns for list view (optimize query)
      let query = supabase
        .from('venues')
        .select(VENUE_SELECT_COLUMNS)
        .eq('is_published', true)
        .order('created_at', { ascending: false })

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
        query = query.gte('standing_capacity', filters.min_capacity)
      }
      if (filters?.max_capacity) {
        query = query.lte('standing_capacity', filters.max_capacity)
      }
      if (filters?.min_price) {
        query = query.gte('hourly_rate', filters.min_price)
      }
      if (filters?.max_price) {
        query = query.lte('hourly_rate', filters.max_price)
      }
      if (filters?.is_verified !== undefined) {
        query = query.eq('is_published', filters.is_verified)
      }
      if (filters?.unique_feature_tags && filters.unique_feature_tags.length > 0) {
        query = query.overlaps('unique_features_tags', filters.unique_feature_tags)
      }

      // Add pagination
      const from = page * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data, error } = await query

      if (error) throw error
      
      // If pagination is used, return paginated result
      if (options?.page !== undefined) {
        const hasMore = (data || []).length === pageSize
        return {
          data: normalizeVenues(data as any[]),
          total: null, // Would need separate count query
          page,
          pageSize,
          hasMore,
        }
      }

      // Otherwise return simple array for backward compatibility
      return normalizeVenues(data as any[])
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
}

/**
 * Fetch single venue by ID with amenities, photos, and requirements
 */
export function useVenue(id: string | null) {
  return useQuery({
    queryKey: venueKeys.detail(id || ''),
    queryFn: async () => {
      if (!id) return null

      // Fetch venue
      const { data: venue, error: venueError } = await supabase
        .from('venues')
        .select(VENUE_DETAIL_SELECT_COLUMNS)
        .eq('id', id)
        .single()

      if (venueError) throw venueError
      if (!venue) return null

      // Fetch related data in parallel
      const [amenitiesResult, photosResult, requirementsResult] =
        await Promise.all([
          supabase
            .from('venue_amenities')
            .select('*')
            .eq('venue_id', id)
            .order('created_at', { ascending: true }),
          supabase
            .from('venue_photos')
            .select('*')
            .eq('venue_id', id)
            .order('display_order', { ascending: true }),
          supabase
            .from('venue_requirements')
            .select('*')
            .eq('venue_id', id)
            .order('created_at', { ascending: true }),
        ])

      const result: VenueWithRelations = {
        ...normalizeVenue(venue as Record<string, any>),
        amenities: (amenitiesResult.data || []) as VenueAmenity[],
        photos: (photosResult.data || []) as VenuePhoto[],
        requirements: (requirementsResult.data || []) as VenueRequirement[],
      }

      return result
    },
    enabled: !!id,
  })
}

/**
 * Fetch all bookings for a venue
 */
export function useVenueBookings(venueId: string | null) {
  return useQuery({
    queryKey: venueKeys.bookings(venueId || ''),
    queryFn: async () => {
      if (!venueId) return []

      const { data, error } = await supabase
        .from('venue_bookings')
        .select('*')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as VenueBooking[]
    },
    enabled: !!venueId,
  })
}

/**
 * Fetch venues owned by the current user for compact selector controls.
 */
export function useVenueOwnerOptions(userId: string | null) {
  return useQuery({
    queryKey: venueKeys.ownerOptions(userId || ''),
    queryFn: async () => {
      if (!userId) return []

      const { data, error } = await supabase
        .from('venues')
        .select(VENUE_SELECT_COLUMNS)
        .eq('owner_id', userId)
        .order('venue_name', { ascending: true })

      if (error) throw error

      return normalizeVenues(data as any[]).map((venue) => ({
        id: venue.id,
        name: venue.name,
      }))
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Mutation to create a new venue
 */
export function useCreateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (venue: Omit<Venue, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('venues')
        .insert(toVenueRowInsert(venue) as never)
        .select()
        .single()

      if (error) throw error
      return normalizeVenue(data as Record<string, any>)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: venueKeys.lists() })
    },
  })
}

/**
 * Mutation to update a venue
 */
export function useUpdateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<Venue, 'id' | 'created_at'>> & { updated_at?: string }
    }) => {
      const { data, error } = await supabase
        .from('venues')
        .update({ ...toVenueRowUpdate(updates), updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return normalizeVenue(data as Record<string, any>)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: venueKeys.lists() })
      queryClient.invalidateQueries({ queryKey: venueKeys.detail(data.id) })
    },
  })
}

/**
 * Check venue availability for a specific month
 */
export function useVenueAvailability(venueId: string | null, month: string) {
  return useQuery({
    queryKey: venueKeys.availability(venueId || '', month),
    queryFn: async () => {
      if (!venueId || !month) return []

      // Parse month (format: YYYY-MM)
      const [year, monthNum] = month.split('-').map(Number)
      const startDate = new Date(year, monthNum - 1, 1).toISOString()
      const endDate = new Date(year, monthNum, 0, 23, 59, 59).toISOString()

      // Fetch availability blocks
      const { data: blocks, error: blocksError } = await supabase
        .from('availability_blocks')
        .select('*')
        .eq('blockable_type', 'venue')
        .eq('blockable_id', venueId)
        .gte('start_date', startDate)
        .lte('end_date', endDate)

      if (blocksError) throw blocksError

      // Fetch confirmed bookings
      const { data: bookings, error: bookingsError } = await supabase
        .from('venue_bookings')
        .select('booking_date, start_time, end_time')
        .eq('venue_id', venueId)
        .eq('status', 'confirmed')
        .gte('booking_date', startDate)
        .lte('booking_date', endDate)

      if (bookingsError) throw bookingsError

      type BookingRow = { booking_date: string; start_time: string | null; end_time: string | null }
      return {
        unavailableBlocks: blocks || [],
        confirmedBookings: (bookings || []).map((b: BookingRow) => ({
          date: b.booking_date,
          startTime: b.start_time,
          endTime: b.end_time,
        })),
      }
    },
    enabled: !!venueId && !!month,
  })
}

/**
 * Fetch user's saved venues
 */
export function useSavedVenues(userId: string | null) {
  return useQuery({
    queryKey: venueKeys.saved(userId || ''),
    queryFn: async () => {
      if (!userId) return []

      const { data, error } = await supabase
        .from('saved_venues')
        .select('*, venues(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return ((data || []) as Array<SavedVenue & { venues?: Record<string, any> | null }>).map((savedVenue) => ({
        ...savedVenue,
        venues: savedVenue.venues ? normalizeVenue(savedVenue.venues) : null,
      })) as (SavedVenue & { venues: Venue | null })[]
    },
    enabled: !!userId,
  })
}

/**
 * Mutation to save/unsave a venue
 */
export function useToggleSavedVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      venueId,
      isSaved,
    }: {
      userId: string
      venueId: string
      isSaved: boolean
    }) => {
      if (isSaved) {
        // Remove from saved
        const { error } = await supabase
          .from('saved_venues')
          .delete()
          .eq('user_id', userId)
          .eq('venue_id', venueId)

        if (error) throw error
        return { saved: false }
      } else {
        // Add to saved
        const { error } = await supabase.from('saved_venues').insert({
          user_id: userId,
          venue_id: venueId,
        })

        if (error) throw error
        return { saved: true }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: venueKeys.saved(variables.userId),
      })
    },
  })
}
