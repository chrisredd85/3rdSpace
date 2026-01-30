'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save, Plus, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVendor, useUpdateVendor } from '@/lib/hooks/useVendors'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import type { ServiceType, VendorOffering } from '@/lib/types'

const vendorSchema = z.object({
  business_name: z.string().min(2, 'Business name must be at least 2 characters'),
  description: z.string().optional(),
  service_type: z.enum([
    'dj',
    'catering',
    'bartending',
    'photography',
    'videography',
    'av_tech',
    'event_planning',
    'florist',
    'other',
  ]),
  service_area: z.string().min(2, 'Service area is required'),
  setup_time: z.string().optional(),
})

type VendorFormData = z.infer<typeof vendorSchema>

const standardOfferings = [
  { id: 'dj_services', label: 'DJ Services', description: 'Music mixing and playlist curation' },
  { id: 'mc', label: 'MC Services', description: 'Master of ceremonies and announcements' },
  { id: 'sound', label: 'Sound System', description: 'Professional audio equipment' },
  { id: 'lighting', label: 'Lighting', description: 'Stage and ambient lighting' },
  { id: 'photography', label: 'Photography', description: 'Event photography services' },
  { id: 'videography', label: 'Videography', description: 'Event video production' },
  { id: 'live_streaming', label: 'Live Streaming', description: 'Real-time event streaming' },
  { id: 'backup_equipment', label: 'Backup Equipment', description: 'Redundant equipment for reliability' },
]

export default function VendorServicesPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [selectedOfferings, setSelectedOfferings] = useState<string[]>([])
  const [customOfferings, setCustomOfferings] = useState<Array<{ id: string; name: string; description: string }>>([])
  const router = useRouter()
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: vendor, isLoading: vendorLoading } = useVendor(vendorId)
  const updateVendor = useUpdateVendor()

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
  })

  // Loading and error handling
  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Please log in to continue</div>
      </div>
    )
  }

  useEffect(() => {
    if (user) {
      // Get user's vendor profile
      supabase
        .from('vendors')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: vendors }) => {
          if (vendors && vendors.length > 0) {
            setVendorId(vendors[0].id)
          }
        })
    }
  }, [user])

  // Populate form when vendor loads
  useEffect(() => {
    if (vendor) {
      reset({
        business_name: vendor.business_name || vendor.name,
        description: vendor.description || '',
        service_type: vendor.service_type,
        service_area: vendor.city || '',
        setup_time: '60', // Would come from vendor settings
      })

      // Load offerings
      if (vendorId) {
        supabase
          .from('vendor_offerings')
          .select('offering_name, description')
          .eq('vendor_id', vendorId)
          .then(({ data }) => {
            if (data) {
              const standardIds = data
                .map((o) => standardOfferings.find((so) => so.label === o.offering_name)?.id)
                .filter((id): id is string => !!id)
              setSelectedOfferings(standardIds)

              const custom = data
                .filter((o) => !standardOfferings.find((so) => so.label === o.offering_name))
                .map((o, idx) => ({
                  id: `custom-${idx}`,
                  name: o.offering_name,
                  description: o.description || '',
                }))
              setCustomOfferings(custom)
            }
          })
      }
    }
  }, [vendor, vendorId, reset])

  const handleSave = async (data: VendorFormData) => {
    if (!vendorId) return

    try {
      await updateVendor.mutateAsync({
        id: vendorId,
        updates: {
          business_name: data.business_name,
          description: data.description || null,
          service_type: data.service_type,
          city: data.service_area,
        },
      })

      // Update offerings
      // First, delete existing offerings
      await supabase
        .from('vendor_offerings')
        .delete()
        .eq('vendor_id', vendorId)

      // Then, insert new ones
      const offeringsToInsert: any[] = []

      // Standard offerings
      selectedOfferings.forEach((offeringId) => {
        const offering = standardOfferings.find((o) => o.id === offeringId)
        if (offering) {
          offeringsToInsert.push({
            vendor_id: vendorId,
            offering_name: offering.label,
            description: offering.description,
            base_price: 0, // Would be set separately
            pricing_model: 'flat_rate',
            is_active: true,
          })
        }
      })

      // Custom offerings
      customOfferings.forEach((custom) => {
        offeringsToInsert.push({
          vendor_id: vendorId,
          offering_name: custom.name,
          description: custom.description,
          base_price: 0,
          pricing_model: 'flat_rate',
          is_active: true,
        })
      })

      if (offeringsToInsert.length > 0) {
        await supabase.from('vendor_offerings').insert(offeringsToInsert)
      }

      addToast({
        title: 'Services updated',
        description: 'Your service information has been saved successfully.',
      })

      reset(data)
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update services',
        variant: 'destructive',
      })
    }
  }

  const handleAddCustomOffering = () => {
    setCustomOfferings([
      ...customOfferings,
      { id: `custom-${Date.now()}`, name: '', description: '' },
    ])
  }

  const handleRemoveCustomOffering = (id: string) => {
    setCustomOfferings(customOfferings.filter((o) => o.id !== id))
  }

  const handleUpdateCustomOffering = (id: string, field: 'name' | 'description', value: string) => {
    setCustomOfferings(
      customOfferings.map((o) => (o.id === id ? { ...o, [field]: value } : o))
    )
  }

  if (vendorLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading services...</p>
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No vendor profile found. Please create a vendor profile first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Service Listing</h1>
        <p className="text-gray-600 mt-1">Manage your service details and offerings</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        {/* Basic Information Card */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Essential details about your service business
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Business Name *
              </label>
              <Input
                {...register('business_name')}
                placeholder="DJ Services Co."
              />
              {errors.business_name && (
                <p className="text-sm text-red-500 mt-1">{errors.business_name.message}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Description
              </label>
              <textarea
                {...register('description')}
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
                placeholder="Describe your services, experience, and what makes you unique..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Service Type *
                </label>
                <select
                  {...register('service_type')}
                  className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="dj">DJ</option>
                  <option value="catering">Catering</option>
                  <option value="bartending">Bartending</option>
                  <option value="photography">Photography</option>
                  <option value="videography">Videography</option>
                  <option value="av_tech">AV Tech</option>
                  <option value="event_planning">Event Planning</option>
                  <option value="florist">Florist</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Service Area *
                </label>
                <Input
                  {...register('service_area')}
                  placeholder="San Francisco, CA"
                />
                {errors.service_area && (
                  <p className="text-sm text-red-500 mt-1">{errors.service_area.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Setup Time Required
              </label>
              <select
                {...register('setup_time')}
                className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="30">30 minutes</option>
                <option value="60">60 minutes (1 hour)</option>
                <option value="90">90 minutes (1.5 hours)</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Service Offerings Card */}
        <Card>
          <CardHeader>
            <CardTitle>Service Offerings</CardTitle>
            <CardDescription>
              Select the services you offer and add custom offerings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {standardOfferings.map((offering) => (
                <label
                  key={offering.id}
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedOfferings.includes(offering.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedOfferings([...selectedOfferings, offering.id])
                      } else {
                        setSelectedOfferings(
                          selectedOfferings.filter((id) => id !== offering.id)
                        )
                      }
                    }}
                    className="mt-1 h-4 w-4 text-forest-500 focus:ring-forest-500"
                  />
                  <div>
                    <div className="font-medium text-sm text-gray-900">
                      {offering.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {offering.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Custom Offerings */}
            {customOfferings.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900">Custom Offerings</h4>
                {customOfferings.map((offering) => (
                  <div key={offering.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Offering name"
                        value={offering.name}
                        onChange={(e) =>
                          handleUpdateCustomOffering(offering.id, 'name', e.target.value)
                        }
                      />
                      <Input
                        placeholder="Description"
                        value={offering.description}
                        onChange={(e) =>
                          handleUpdateCustomOffering(offering.id, 'description', e.target.value)
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCustomOffering(offering.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleAddCustomOffering}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Custom Offering
            </Button>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={updateVendor.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={updateVendor.isPending || !isDirty}
          >
            {updateVendor.isPending ? (
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
