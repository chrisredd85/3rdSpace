import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { VendorPackage } from '@/lib/types'

// Query keys
const packageKeys = {
  all: ['vendor-packages'] as const,
  vendor: (vendorId: string) => [...packageKeys.all, vendorId] as const,
}

/**
 * Fetch packages for a vendor
 */
export function useVendorPackages(vendorId: string | null) {
  return useQuery({
    queryKey: packageKeys.vendor(vendorId || ''),
    queryFn: async () => {
      if (!vendorId) return []

      const { data, error } = await supabase
        .from('vendor_packages')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as VendorPackage[]
    },
    enabled: !!vendorId,
  })
}

/**
 * Mutation to create a vendor package
 */
export function useCreateVendorPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      pkg: Omit<VendorPackage, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const { data, error } = await supabase
        .from('vendor_packages')
        .insert(pkg)
        .select()
        .single()

      if (error) throw error
      return data as VendorPackage
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: packageKeys.vendor(data.vendor_id),
      })
    },
  })
}

/**
 * Mutation to update a vendor package
 */
export function useUpdateVendorPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<VendorPackage, 'id' | 'created_at'>> & {
        updated_at?: string
      }
    }) => {
      const { data, error } = await supabase
        .from('vendor_packages')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as VendorPackage
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: packageKeys.vendor(data.vendor_id),
      })
    },
  })
}

/**
 * Mutation to delete a vendor package
 */
export function useDeleteVendorPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { data: pkg } = await supabase
        .from('vendor_packages')
        .select('vendor_id')
        .eq('id', id)
        .single()

      const { error } = await supabase
        .from('vendor_packages')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { id, vendorId: pkg?.vendor_id }
    },
    onSuccess: (data) => {
      if (data.vendorId) {
        queryClient.invalidateQueries({
          queryKey: packageKeys.vendor(data.vendorId),
        })
      }
    },
  })
}
