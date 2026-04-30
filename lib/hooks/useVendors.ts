import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type {
  Vendor,
  VendorOffering,
  VendorPackage,
  VendorBooking,
  SavedVendor,
  ServiceType,
} from '@/lib/types'
import {
  normalizeVendorProfile,
  toVendorProfileInsert,
  toVendorProfileUpdate,
} from '@/lib/vendors/profile-adapter'

// Query keys
const vendorKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorKeys.all, 'list'] as const,
  list: (filters: VendorFilters) => [...vendorKeys.lists(), filters] as const,
  details: () => [...vendorKeys.all, 'detail'] as const,
  detail: (id: string) => [...vendorKeys.details(), id] as const,
  bookings: (vendorId: string) => [...vendorKeys.all, 'bookings', vendorId] as const,
  saved: (userId: string) => [...vendorKeys.all, 'saved', userId] as const,
}

interface VendorFilters {
  service_type?: ServiceType
  city?: string
  state?: string
  is_verified?: boolean
  min_price?: number
  max_price?: number
}

interface VendorWithRelations extends Vendor {
  offerings: VendorOffering[]
  packages: VendorPackage[]
}

/**
 * Fetch all published vendors with optional filters
 */
export function useVendors(
  filters?: VendorFilters,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: vendorKeys.list(filters || {}),
    enabled: options?.enabled !== false, // Default to true, can be disabled
    queryFn: async () => {
      let query = supabase
        .from('vendor_profiles')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false })

      if (filters?.service_type) {
        query = query.eq('service_type', filters.service_type)
      }
      if (filters?.city) {
        query = query.ilike('regions_served', `%${filters.city}%`)
      }
      if (filters?.is_verified !== undefined) {
        query = query.eq('is_published', filters.is_verified)
      }

      const { data, error } = await query

      if (error) throw error
      return ((data || []) as Record<string, any>[]).map(normalizeVendorProfile)
    },
  })
}

/**
 * Fetch single vendor by ID with offerings and packages
 */
export function useVendor(id: string | null) {
  return useQuery({
    queryKey: vendorKeys.detail(id || ''),
    queryFn: async () => {
      if (!id) return null

      // Fetch vendor
      const { data: vendor, error: vendorError } = await supabase
        .from('vendor_profiles')
        .select('*')
        .eq('id', id)
        .single()

      if (vendorError) throw vendorError
      if (!vendor) return null

      // Fetch related data in parallel
      const [offeringsResult, packagesResult] = await Promise.all([
        supabase
          .from('vendor_offerings')
          .select('*')
          .eq('vendor_id', id)
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('vendor_packages')
          .select('*')
          .eq('vendor_id', id)
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])

      const result: VendorWithRelations = {
        ...normalizeVendorProfile(vendor as Record<string, any>),
        offerings: (offeringsResult.data || []) as VendorOffering[],
        packages: (packagesResult.data || []) as VendorPackage[],
      }

      return result
    },
    enabled: !!id,
  })
}

/**
 * Fetch all bookings for a vendor
 */
export function useVendorBookings(vendorId: string | null) {
  return useQuery({
    queryKey: vendorKeys.bookings(vendorId || ''),
    queryFn: async () => {
      if (!vendorId) return []

      const { data, error } = await supabase
        .from('vendor_bookings')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as VendorBooking[]
    },
    enabled: !!vendorId,
  })
}

/**
 * Fetch user's saved vendors
 */
export function useSavedVendors(userId: string | null) {
  return useQuery({
    queryKey: vendorKeys.saved(userId || ''),
    queryFn: async () => {
      if (!userId) return []

      const { data, error } = await supabase
        .from('saved_vendors')
        .select('*, vendor_profiles(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as (SavedVendor & { vendor_profiles: Vendor })[]
    },
    enabled: !!userId,
  })
}

/**
 * Mutation to create a new vendor
 */
export function useCreateVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (vendor: Omit<Vendor, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('vendor_profiles')
        .insert(toVendorProfileInsert(vendor) as never)
        .select()
        .single()

      if (error) throw error
      return normalizeVendorProfile(data as Record<string, any>)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() })
    },
  })
}

/**
 * Mutation to update a vendor
 */
export function useUpdateVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<Vendor, 'id' | 'created_at'>> & { updated_at?: string }
    }) => {
      const { data, error } = await supabase
        .from('vendor_profiles')
        .update({ ...toVendorProfileUpdate(updates), updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return normalizeVendorProfile(data as Record<string, any>)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() })
      queryClient.invalidateQueries({ queryKey: vendorKeys.detail(data.id) })
    },
  })
}

/**
 * Mutation to save/unsave a vendor
 */
export function useToggleSavedVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      vendorId,
      isSaved,
    }: {
      userId: string
      vendorId: string
      isSaved: boolean
    }) => {
      if (isSaved) {
        // Remove from saved
        const { error } = await supabase
          .from('saved_vendors')
          .delete()
          .eq('user_id', userId)
          .eq('vendor_id', vendorId)

        if (error) throw error
        return { saved: false }
      } else {
        // Add to saved
        const { error } = await supabase.from('saved_vendors').insert({
          user_id: userId,
          vendor_id: vendorId,
        })

        if (error) throw error
        return { saved: true }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: vendorKeys.saved(variables.userId),
      })
    },
  })
}
