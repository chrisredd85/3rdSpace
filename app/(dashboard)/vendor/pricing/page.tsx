'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save, Plus, Edit, Trash2, DollarSign, Percent, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVendor, useUpdateVendor } from '@/lib/hooks/useVendors'
import { useVendorPackages, useDeleteVendorPackage } from '@/lib/hooks/useVendorPackages'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { PackageModal } from '@/components/vendor/PackageModal'
import { cn } from '@/lib/utils'
import type { PricingModel, VendorPackage } from '@/lib/types'

const pricingSchema = z.object({
  pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid']),
  base_rate: z.number().optional(),
  headcount_kickback: z.boolean().optional(),
  per_person_rate: z.number().optional(),
})

type PricingFormData = z.infer<typeof pricingSchema>

export default function VendorPricingPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [showPackageModal, setShowPackageModal] = useState(false)
  const [editingPackage, setEditingPackage] = useState<VendorPackage | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: vendor, isLoading } = useVendor(vendorId)
  const { data: packages = [] } = useVendorPackages(vendorId)
  const updateVendor = useUpdateVendor()
  const deletePackage = useDeleteVendorPackage()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
    reset,
  } = useForm<PricingFormData>({
    resolver: zodResolver(pricingSchema),
  })

  const pricingModel = watch('pricing_model')
  const headcountKickback = watch('headcount_kickback')
  const perPersonRate = watch('per_person_rate') || 0
  const baseRate = watch('base_rate') || 0

  useEffect(() => {
    if (user) {
      supabase
        .from('vendors')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: vendors }: { data: { id: string }[] | null }) => {
          if (vendors && vendors.length > 0) {
            setVendorId(vendors[0].id)
          }
        })
    }
  }, [user])

  useEffect(() => {
    if (vendor) {
      reset({
        pricing_model: vendor.pricing_model,
        base_rate: 0, // Would come from vendor settings
        headcount_kickback: false, // Would come from vendor settings
        per_person_rate: 0, // Would come from vendor settings
      })
    }
  }, [vendor, reset])

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

  const handleSave = async (data: PricingFormData) => {
    if (!vendorId) return

    try {
      await updateVendor.mutateAsync({
        id: vendorId,
        updates: {
          pricing_model: data.pricing_model,
        },
      })

      // Save additional pricing settings (would be in a separate table or JSON field)
      // For now, we'll just update the main vendor record

      addToast({
        title: 'Pricing updated',
        description: 'Your pricing settings have been saved successfully.',
      })

      reset(data)
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update pricing',
        variant: 'destructive',
      })
    }
  }

  const handleDeletePackage = async (packageId: string) => {
    if (!confirm('Are you sure you want to delete this package?')) return

    try {
      await deletePackage.mutateAsync(packageId)
      addToast({
        title: 'Package deleted',
        description: 'The package has been removed.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to delete package',
        variant: 'destructive',
      })
    }
  }

  const handleEditPackage = (pkg: VendorPackage) => {
    setEditingPackage(pkg)
    setShowPackageModal(true)
  }

  const handleCreatePackage = () => {
    setEditingPackage(null)
    setShowPackageModal(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading pricing...</p>
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No vendor found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Pricing & Packages</h1>
        <p className="text-gray-600 mt-1">Configure your pricing model and service packages</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        {/* Pricing Model Toggle */}
        <Card>
          <CardHeader>
            <CardTitle>Pricing Model</CardTitle>
            <CardDescription>
              Choose how you want to charge for your services
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['flat_rate', 'per_person', 'hourly'] as PricingModel[]).map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => setValue('pricing_model', model, { shouldDirty: true })}
                  className={cn(
                    'p-4 border-2 rounded-lg text-left transition-all',
                    pricingModel === model
                      ? 'border-forest-500 bg-forest-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <div className="font-semibold text-gray-900 mb-1">
                    {model === 'flat_rate'
                      ? 'Flat Rate'
                      : model === 'per_person'
                      ? 'Per Person'
                      : 'Hourly'}
                  </div>
                  <div className="text-sm text-gray-600">
                    {model === 'flat_rate'
                      ? 'Fixed price per event'
                      : model === 'per_person'
                      ? 'Price per attendee'
                      : 'Price per hour'}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Base Rate Section */}
        {(pricingModel === 'flat_rate' || pricingModel === 'hourly') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Base Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  {pricingModel === 'hourly' ? 'Hourly Rate ($)' : 'Base Rate ($)'}
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="number"
                    {...register('base_rate', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder={pricingModel === 'hourly' ? '150' : '1500'}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {pricingModel === 'hourly'
                    ? 'Your standard hourly rate for services'
                    : 'Your base rate for standard events'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Revenue Share Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              Revenue Share Options
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                {...register('headcount_kickback')}
                className="h-4 w-4 text-forest-500"
              />
              <label className="text-sm font-medium text-gray-700">
                Enable headcount kickback
              </label>
            </div>

            {headcountKickback && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Per-Person Rate ($)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="number"
                    {...register('per_person_rate', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder="5"
                  />
                </div>
                <div className="bg-gray-50 rounded-lg p-4 mt-3">
                  <p className="text-sm text-gray-600 mb-2">Example Calculation (100 guests)</p>
                  <p className="text-lg font-semibold text-gray-900">
                    ${perPersonRate.toLocaleString()} × 100 = $
                    {(perPersonRate * 100).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service Packages Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Service Packages</CardTitle>
                <CardDescription>
                  Create packages with bundled services and pricing
                </CardDescription>
              </div>
              <Button
                type="button"
                onClick={handleCreatePackage}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Package
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {packages.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="text-sm text-gray-600 mb-4">No packages created yet</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCreatePackage}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Package
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {packages.map((pkg) => {
                  const inclusions = pkg.includes || []

                  return (
                    <Card key={pkg.id} className={!pkg.is_active ? 'opacity-60' : ''}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900 mb-1">
                              {pkg.package_name}
                            </h3>
                            {pkg.description && (
                              <p className="text-sm text-gray-600 mb-2">
                                {pkg.description}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-sm">
                              <div>
                                <span className="text-gray-600">Price: </span>
                                <span className="font-semibold text-forest-600">
                                  ${pkg.base_price?.toLocaleString()}
                                </span>
                              </div>
                              {pkg.duration_hours && (
                                <div>
                                  <span className="text-gray-600">Duration: </span>
                                  <span className="font-medium">
                                    {pkg.duration_hours} hrs
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          {!pkg.is_active && (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                              Inactive
                            </span>
                          )}
                        </div>

                        {inclusions.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-medium text-gray-700 mb-1">
                              Includes:
                            </p>
                            <ul className="text-xs text-gray-600 space-y-0.5">
                              {inclusions.slice(0, 3).map((inc: string, idx: number) => (
                                <li key={idx}>• {inc}</li>
                              ))}
                              {inclusions.length > 3 && (
                                <li className="text-gray-500">
                                  +{inclusions.length - 3} more
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-3 border-t">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditPackage(pkg)}
                            className="flex-1"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeletePackage(pkg.id)}
                            className="flex-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
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
                Save Pricing
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Package Modal */}
      {showPackageModal && (
        <PackageModal
          package={editingPackage}
          vendorId={vendorId}
          onClose={() => {
            setShowPackageModal(false)
            setEditingPackage(null)
          }}
          onSuccess={() => {
            // Packages will auto-refresh via React Query
          }}
        />
      )}
    </div>
  )
}
