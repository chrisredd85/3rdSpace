import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

      const response = await fetch(
        `/api/venue/photos?venueId=${encodeURIComponent(venueId)}`,
        { credentials: 'include' }
      )
      const body = await response.json().catch(() => null) as {
        photos?: VenuePhoto[]
        error?: string
      } | null

      if (!response.ok || !body?.photos) {
        throw new Error(body?.error || 'Failed to load venue photos')
      }
      return body.photos
    },
    enabled: !!venueId,
  })
}

/**
 * Uploads a photo through the authenticated server validation boundary.
 */
export async function uploadVenuePhoto(
  venueId: string,
  file: File
): Promise<VenuePhoto> {
  const formData = new FormData()
  formData.set('venueId', venueId)
  formData.set('photo', file)

  const response = await fetch('/api/venue/photos', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const body = await response.json().catch(() => null) as { photo?: VenuePhoto; error?: string } | null

  if (!response.ok || !body?.photo) {
    throw new Error(body?.error || 'Failed to upload photo')
  }

  return body.photo
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
      if (updates.is_primary !== true) {
        throw new Error('Only setting a primary venue photo is supported')
      }

      const response = await fetch('/api/venue/photos', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: id, isPrimary: true }),
      })
      const body = await response.json().catch(() => null) as {
        photo?: VenuePhoto
        error?: string
      } | null

      if (!response.ok || !body?.photo) {
        throw new Error(body?.error || 'Failed to update venue photo')
      }
      return body.photo
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
      const response = await fetch('/api/venue/photos', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: id }),
      })
      const body = await response.json().catch(() => null) as {
        id?: string
        venueId?: string
        error?: string
      } | null

      if (!response.ok || !body?.id || !body.venueId) {
        throw new Error(body?.error || 'Failed to delete venue photo')
      }
      return { id: body.id, venueId: body.venueId }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: photoKeys.venue(data.venueId),
      })
    },
  })
}
