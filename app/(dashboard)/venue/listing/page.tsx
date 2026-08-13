'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Save,
  X,
  Upload,
  Trash2,
  Eye,
  GripVertical,
  Star,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useVenue, useUpdateVenue } from '@/lib/hooks/useVenues'
import {
  useVenuePhotos,
  useUpdateVenuePhoto,
  useDeleteVenuePhoto,
  uploadVenuePhoto,
} from '@/lib/hooks/useVenuePhotos'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { AmenitiesSelector } from '@/components/venue/AmenitiesSelector'
import { UniqueFeaturesEditor } from '@/components/venue/UniqueFeaturesEditor'
import type { VenueType } from '@/lib/types'

const venueSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
  venue_type: z.enum([
    'loft_warehouse',
    'gallery',
    'restaurant',
    'rooftop',
    'conference_center',
    'other',
  ]),
  square_footage: z.number().optional(),
  capacity: z.number().min(1, 'Capacity must be at least 1'),
  min_capacity: z.number().optional(),
  max_capacity: z.number().optional(),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  neighborhood: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  zip_code: z.string().min(5, 'ZIP code is required'),
  country: z.string().default('United States'),
})

type VenueFormData = z.infer<typeof venueSchema>

export default function VenueListingPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const router = useRouter()
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: venue, isLoading: venueLoading } = useVenue(venueId)
  const { data: photos = [], refetch: refetchPhotos } = useVenuePhotos(venueId)
  const updateVenue = useUpdateVenue()
  const updatePhoto = useUpdateVenuePhoto()
  const deletePhoto = useDeleteVenuePhoto()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<VenueFormData>({
    resolver: zodResolver(venueSchema),
  })

  useEffect(() => {
    if (user) {
      supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: venues }: { data: { id: string }[] | null }) => {
          if (venues && venues.length > 0) {
            setVenueId(venues[0].id)
          }
        })
    }
  }, [user])

  useEffect(() => {
    if (venue) {
      reset({
        name: venue.name,
        description: venue.description || '',
        venue_type: venue.venue_type,
        square_footage: venue.square_footage || undefined,
        capacity: venue.capacity,
        min_capacity: venue.min_capacity || undefined,
        max_capacity: venue.max_capacity || undefined,
        address: venue.address,
        city: venue.city,
        neighborhood: venue.neighborhood || '',
        state: venue.state,
        zip_code: venue.zip_code,
        country: venue.country,
      })
    }
  }, [venue, reset])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-ink-soft">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-brick">Please log in to continue</div>
      </div>
    )
  }

  const handleSave = async (data: VenueFormData) => {
    const currentVenue = venue
    if (!venueId || !currentVenue) return

    try {
      await updateVenue.mutateAsync({
        id: venueId,
        updates: {
          ...data,
          square_footage: data.square_footage || null,
          min_capacity: data.min_capacity || null,
          max_capacity: data.max_capacity || null,
          auto_approve_conditions: {
            ...(
              currentVenue.auto_approve_conditions &&
              typeof currentVenue.auto_approve_conditions === 'object' &&
              !Array.isArray(currentVenue.auto_approve_conditions)
                ? currentVenue.auto_approve_conditions
                : {}
            ),
            neighborhood: data.neighborhood || null,
          },
        },
      })

      addToast({
        title: 'Venue updated',
        description: 'Your venue listing has been saved successfully.',
      })

      reset(data)
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update venue',
        variant: 'destructive',
      })
    }
  }

  const handleVisibilityChange = async (isActive: boolean) => {
    if (!venueId) return

    try {
      await updateVenue.mutateAsync({
        id: venueId,
        updates: { is_active: isActive },
      })

      addToast({
        title: isActive ? 'Listing visible' : 'Listing hidden',
        description: isActive
          ? 'Your venue can now appear in the 3rdPlace event planner.'
          : 'Your venue is hidden from event planner results.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update listing visibility',
        variant: 'destructive',
      })
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !venueId) return

    setUploading(true)
    try {
      await uploadVenuePhoto(venueId, file)
      await refetchPhotos()
      addToast({
        title: 'Photo uploaded',
        description: 'Photo has been added to your venue listing.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to upload photo',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleSetPrimary = async (photoId: string) => {
    try {
      await updatePhoto.mutateAsync({
        id: photoId,
        updates: { is_primary: true },
      })
      addToast({
        title: 'Primary photo set',
        description: 'This photo is now the primary image for your venue.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to set primary photo',
        variant: 'destructive',
      })
    }
  }

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return

    try {
      await deletePhoto.mutateAsync(photoId)
      addToast({
        title: 'Photo deleted',
        description: 'Photo has been removed from your listing.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to delete photo',
        variant: 'destructive',
      })
    }
  }

  if (venueLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent mx-auto mb-4" />
          <p className="text-ink-soft">Loading venue...</p>
        </div>
      </div>
    )
  }

  if (!venue) {
    return (
      <div className="text-center py-12">
        <p className="text-ink-soft">No venue found. Please create a venue first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">Venue Listing</h1>
          <p className="text-ink-soft mt-1">Keep venue details and the public listing current</p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push(`/venues/${venueId}`)}
        >
          <Eye className="h-4 w-4 mr-2" />
          Preview Listing
        </Button>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Planner Visibility</CardTitle>
            <CardDescription>
              Control whether event planners can discover this venue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 rounded-lg border border-tan bg-cream/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">Make listing visible to event planners</p>
                <p className="text-sm text-ink-soft">Visible listings appear in the 3rdPlace event planner</p>
              </div>
              <Switch
                checked={Boolean(venue.is_active)}
                disabled={updateVenue.isPending}
                onCheckedChange={handleVisibilityChange}
              />
            </div>
          </CardContent>
        </Card>

        {/* Basic Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Essential details about your venue
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Venue Name *
              </label>
              <Input
                {...register('name')}
                placeholder="The Grand Hall"
              />
              {errors.name && (
                <p className="text-sm text-brick mt-1">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Description
              </label>
              <textarea
                {...register('description')}
                rows={4}
                className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
                placeholder="Describe your venue, its atmosphere, and what makes it special..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Venue Type *
                </label>
                <select
                  {...register('venue_type')}
                  className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
                >
                  <option value="loft_warehouse">Loft/Warehouse</option>
                  <option value="gallery">Gallery</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="rooftop">Rooftop</option>
                  <option value="conference_center">Conference Center</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Square Footage
                </label>
                <Input
                  type="number"
                  {...register('square_footage', { valueAsNumber: true })}
                  placeholder="5000"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Standing Capacity *
                </label>
                <Input
                  type="number"
                  {...register('capacity', { valueAsNumber: true })}
                  placeholder="200"
                />
                {errors.capacity && (
                  <p className="text-sm text-brick mt-1">{errors.capacity.message}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Min Capacity
                </label>
                <Input
                  type="number"
                  {...register('min_capacity', { valueAsNumber: true })}
                  placeholder="50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Max Capacity
                </label>
                <Input
                  type="number"
                  {...register('max_capacity', { valueAsNumber: true })}
                  placeholder="300"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Address *
              </label>
              <Input
                {...register('address')}
                placeholder="123 Main Street"
              />
              {errors.address && (
                <p className="text-sm text-brick mt-1">{errors.address.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  City *
                </label>
                <Input {...register('city')} placeholder="San Francisco" />
                {errors.city && (
                  <p className="text-sm text-brick mt-1">{errors.city.message}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Neighborhood
                </label>
                <Input {...register('neighborhood')} placeholder="SOMA" />
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  State *
                </label>
                <Input {...register('state')} placeholder="CA" />
                {errors.state && (
                  <p className="text-sm text-brick mt-1">{errors.state.message}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  ZIP Code *
                </label>
                <Input {...register('zip_code')} placeholder="94102" />
                {errors.zip_code && (
                  <p className="text-sm text-brick mt-1">{errors.zip_code.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unique Features Card */}
        <Card>
          <CardHeader>
            <CardTitle>Unique Features</CardTitle>
            <CardDescription>
              Highlight the details that make your venue memorable and searchable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {venueId ? <UniqueFeaturesEditor venueId={venueId} /> : null}
          </CardContent>
        </Card>

        {/* Amenities Card */}
        <Card>
          <CardHeader>
            <CardTitle>Amenities</CardTitle>
            <CardDescription>
              Select all amenities available at your venue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {venueId ? <AmenitiesSelector venueId={venueId} /> : null}
          </CardContent>
        </Card>

        {/* Photos Card */}
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <CardDescription>
              Upload photos of your venue. Drag to reorder, click star to set primary.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block">
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  onChange={handlePhotoUpload}
                  disabled={uploading}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  asChild
                >
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading ? 'Uploading...' : 'Upload Photo'}
                  </span>
                </Button>
              </label>
              <p className="mt-2 text-xs text-ink-soft">
                PNG, JPEG, or WebP. Maximum 4 MB, 4096 × 4096 pixels, and 16 megapixels.
              </p>
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-tan"
                  >
                    <Image
                      src={photo.photo_url}
                      alt={photo.caption || `Photo ${index + 1}`}
                      fill
                      unoptimized
                      sizes="(min-width: 768px) 25vw, 50vw"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-ink/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {!photo.is_primary && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(photo.id)}
                          className="text-cream hover:text-cream hover:bg-cream/20"
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      {photo.is_primary && (
                        <div className="absolute top-2 right-2">
                          <Star className="h-5 w-5 fill-ochre text-ochre" />
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePhoto(photo.id)}
                        className="text-cream hover:text-cream hover:bg-brick/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {photos.length === 0 && (
              <div className="text-center py-8 border-2 border-dashed border-tan rounded-lg">
                <Upload className="h-12 w-12 text-ink-soft/60 mx-auto mb-4" />
                <p className="text-sm text-ink-soft">No photos uploaded yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={updateVenue.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={updateVenue.isPending || !isDirty}
          >
            {updateVenue.isPending ? (
              'Saving...'
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
