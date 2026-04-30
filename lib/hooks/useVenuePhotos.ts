import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { VenuePhoto } from '@/lib/types'

// Query keys
const photoKeys = {
  all: ['venue-photos'] as const,
  venue: (venueId: string) => [...photoKeys.all, venueId] as const,
}

/**
 * Fetch photos for a venue
 */
export function useVenuePhotos(venueId: string | null) {
  return useQuery({
    queryKey: photoKeys.venue(venueId || ''),
    queryFn: async () => {
      if (!venueId) return []

      const { data, error } = await supabase
        .from('venue_photos')
        .select('*')
        .eq('venue_id', venueId)
        .order('display_order', { ascending: true })

      if (error) throw error
      return (data || []) as VenuePhoto[]
    },
    enabled: !!venueId,
  })
}

/**
 * Upload photo to Supabase Storage
 */
export async function uploadVenuePhoto(
  venueId: string,
  file: File
): Promise<string> {
  const fileExt = file.name.split('.').pop()
  const filePath = `${venueId}/${Date.now()}.${fileExt}`

  const { error: uploadError } = await supabase.storage
    .from('venue-photos')
    .upload(filePath, file)

  if (uploadError) throw uploadError

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('venue-photos').getPublicUrl(filePath)

  return publicUrl
}

/**
 * Mutation to create a venue photo record
 */
export function useCreateVenuePhoto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      venueId,
      photoUrl,
      caption,
      isPrimary,
      displayOrder,
    }: {
      venueId: string
      photoUrl: string
      caption?: string
      isPrimary?: boolean
      displayOrder?: number
    }) => {
      // If setting as primary, unset other primary photos first
      if (isPrimary) {
        await supabase
          .from('venue_photos')
          .update({ is_primary: false })
          .eq('venue_id', venueId)
      }

      const { data, error } = await supabase
        .from('venue_photos')
        .insert({
          venue_id: venueId,
          photo_url: photoUrl,
          caption: caption || null,
          is_primary: isPrimary || false,
          display_order: displayOrder || 0,
        })
        .select()
        .single()

      if (error) throw error
      return data as VenuePhoto
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: photoKeys.venue(data.venue_id),
      })
    },
  })
}

/**
 * Mutation to update a venue photo
 */
export function useUpdateVenuePhoto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<VenuePhoto, 'id' | 'created_at'>>
    }) => {
      // If setting as primary, unset other primary photos
      if (updates.is_primary) {
        const { data: photo } = await supabase
          .from('venue_photos')
          .select('venue_id')
          .eq('id', id)
          .single()

        if (photo) {
          await supabase
            .from('venue_photos')
            .update({ is_primary: false })
            .eq('venue_id', photo.venue_id)
            .neq('id', id)
        }
      }

      const { data, error } = await supabase
        .from('venue_photos')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as VenuePhoto
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: photoKeys.venue(data.venue_id),
      })
    },
  })
}

/**
 * Mutation to delete a venue photo
 */
export function useDeleteVenuePhoto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { data: photo, error: fetchError } = await supabase
        .from('venue_photos')
        .select('venue_id, photo_url')
        .eq('id', id)
        .single()

      if (fetchError) throw fetchError

      // Delete from storage
      const filePath = photo.photo_url.split('/venue-photos/')[1]
      if (filePath) {
        await supabase.storage
          .from('venue-photos')
          .remove([filePath])
      }

      // Delete from database
      const { error } = await supabase.from('venue_photos').delete().eq('id', id)

      if (error) throw error
      return { id, venueId: photo.venue_id }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: photoKeys.venue(data.venueId),
      })
    },
  })
}
