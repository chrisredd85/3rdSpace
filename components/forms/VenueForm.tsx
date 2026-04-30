'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from './FormField'
import { FileUpload } from './FileUpload'
import { MultiSelect } from './MultiSelect'
import type { VenueType } from '@/lib/types'

const venueSchema = z.object({
  name: z.string().min(2, 'Venue name must be at least 2 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  venue_type: z.enum([
    'loft_warehouse',
    'gallery',
    'restaurant',
    'rooftop',
    'conference_center',
    'other',
  ]),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  zip_code: z.string().min(5, 'ZIP code is required'),
  capacity: z.number().min(1, 'Capacity must be at least 1'),
  square_footage: z.number().min(0).optional(),
})

export type VenueFormData = z.infer<typeof venueSchema>

export interface VenueFormProps {
  defaultValues?: Partial<VenueFormData>
  onSubmit: (data: VenueFormData & { amenities: string[]; photos: string[] }) => Promise<void> | void
  onCancel?: () => void
  isLoading?: boolean
  submitLabel?: string
}

const amenityOptions = [
  { id: 'av_equipment', label: 'A/V Equipment', description: 'Projector, sound system, microphones' },
  { id: 'wifi', label: 'WiFi', description: 'High-speed internet access' },
  { id: 'bar', label: 'Bar', description: 'Full bar service available' },
  { id: 'parking', label: 'Parking', description: 'On-site or nearby parking' },
  { id: 'bart', label: 'BART Access', description: 'Near public transit' },
  { id: 'kitchen', label: 'Kitchen', description: 'Full kitchen facilities' },
  { id: 'outdoor_space', label: 'Outdoor Space', description: 'Patio, rooftop, or garden area' },
  { id: 'stage', label: 'Stage', description: 'Performance stage available' },
  { id: 'dance_floor', label: 'Dance Floor', description: 'Dedicated dance floor space' },
  { id: 'coat_check', label: 'Coat Check', description: 'Coat check service' },
]

/**
 * VenueForm component for creating and editing venue listings
 * 
 * @example
 * ```tsx
 * <VenueForm
 *   onSubmit={async (data) => {
 *     await updateVenue(data)
 *   }}
 *   isLoading={isUpdating}
 * />
 * ```
 */
export function VenueForm({
  defaultValues,
  onSubmit,
  onCancel,
  isLoading = false,
  submitLabel = 'Save Venue',
}: VenueFormProps) {
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<VenueFormData>({
    resolver: zodResolver(venueSchema),
    defaultValues: defaultValues || {
      name: '',
      description: '',
      venue_type: 'other',
      address: '',
      city: '',
      state: '',
      zip_code: '',
      capacity: 0,
    },
  })

  const description = watch('description')
  const descriptionLength = description?.length || 0
  const maxDescriptionLength = 1000

  const handleFormSubmit = async (data: VenueFormData) => {
    await onSubmit({
      ...data,
      amenities: selectedAmenities,
      photos: photoUrls,
    })
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Essential details about your venue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Venue Name" required error={errors.name?.message}>
            <Input {...register('name')} placeholder="The Grand Hall" />
          </FormField>

          <FormField
            label="Description"
            error={errors.description?.message}
            helperText={`${descriptionLength}/${maxDescriptionLength} characters`}
          >
            <textarea
              {...register('description')}
              rows={4}
              maxLength={maxDescriptionLength}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Describe your venue, its atmosphere, and what makes it special..."
            />
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Venue Type" required error={errors.venue_type?.message}>
              <select
                {...register('venue_type')}
                className="flex h-10 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="loft_warehouse">Loft/Warehouse</option>
                <option value="gallery">Gallery</option>
                <option value="restaurant">Restaurant</option>
                <option value="rooftop">Rooftop</option>
                <option value="conference_center">Conference Center</option>
                <option value="other">Other</option>
              </select>
            </FormField>

            <FormField label="Square Footage" error={errors.square_footage?.message}>
              <Input
                type="number"
                {...register('square_footage', { valueAsNumber: true })}
                placeholder="5000"
              />
            </FormField>
          </div>

          <FormField label="Capacity" required error={errors.capacity?.message}>
            <Input
              type="number"
              {...register('capacity', { valueAsNumber: true })}
              placeholder="200"
              min={1}
            />
          </FormField>

          <FormField label="Address" required error={errors.address?.message}>
            <Input {...register('address')} placeholder="123 Main Street" />
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="City" required error={errors.city?.message}>
              <Input {...register('city')} placeholder="San Francisco" />
            </FormField>

            <FormField label="State" required error={errors.state?.message}>
              <Input {...register('state')} placeholder="CA" />
            </FormField>

            <FormField label="ZIP Code" required error={errors.zip_code?.message}>
              <Input {...register('zip_code')} placeholder="94102" />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Amenities Section */}
      <Card>
        <CardHeader>
          <CardTitle>Amenities</CardTitle>
          <CardDescription>
            Select all amenities available at your venue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MultiSelect
            options={amenityOptions}
            value={selectedAmenities}
            onChange={setSelectedAmenities}
          />
        </CardContent>
      </Card>

      {/* Photos Section */}
      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
          <CardDescription>
            Upload photos of your venue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FileUpload
            bucket="venue-photos"
            folderPath="venue-photos"
            accept="image/*"
            multiple
            existingFiles={photoUrls}
            onUploadComplete={(url) => setPhotoUrls((prev) => [...prev, url])}
            onRemove={(url) => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
          />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
