'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Clock,
  DollarSign,
  Edit,
  Layers,
  Percent,
  Plus,
  Save,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVendor, useUpdateVendor } from '@/lib/hooks/useVendors'
import { useVendorPackages, useDeleteVendorPackage } from '@/lib/hooks/useVendorPackages'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { PackageModal } from '@/components/vendor/PackageModal'
import { VendorDepositSettings } from '@/components/vendor/VendorDepositSettings'
import { cn } from '@/lib/utils'
import type { PricingModel, VendorPackage } from '@/lib/types'

const optionalMoney = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined
  const numericValue = Number(value)
  return Number.isNaN(numericValue) ? undefined : numericValue
}, z.number().min(0).optional())

const pricingSchema = z.object({
  pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid']),
  base_rate: optionalMoney,
  headcount_kickback: z.boolean().optional(),
  per_person_rate: optionalMoney,
})

type PricingFormData = z.infer<typeof pricingSchema>

type ModelOption = {
  value: PricingModel
  label: string
  description: string
  icon: React.ElementType
}

const modelOptions: ModelOption[] = [
  {
    value: 'flat_rate',
    label: 'Flat Rate',
    description: 'Fixed price per event',
    icon: DollarSign,
  },
  {
    value: 'per_person',
    label: 'Per Person',
    description: 'Price per attendee',
    icon: Users,
  },
  {
    value: 'hourly',
    label: 'Hourly',
    description: 'Price per hour',
    icon: Clock,
  },
  {
    value: 'revenue_share',
    label: 'Revenue Share',
    description: 'Percentage of event revenue',
    icon: TrendingUp,
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Base rate + revenue share',
    icon: Layers,
  },
]

export default function VendorPricingPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [showPackageModal, setShowPackageModal] = useState(false)
  const [editingPackage, setEditingPackage] = useState<VendorPackage | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

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

  useEffect(() => {
    if (user) {
      supabase
        .from('vendor_profiles')
        .select('id')
        .eq('user_id', user.id)
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
      const storedPerHeadRate = vendor.per_head_kickback ?? 0
      reset({
        pricing_model: vendor.pricing_model,
        base_rate:
          vendor.pricing_model === 'hourly'
            ? vendor.hourly_rate ?? vendor.base_rate ?? undefined
            : vendor.base_rate ?? vendor.hourly_rate ?? undefined,
        headcount_kickback: storedPerHeadRate > 0,
        per_person_rate: (vendor.per_person_rate ?? storedPerHeadRate) || undefined,
      })
    }
  }, [vendor, reset])

  if (isUserLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-ink-soft">Loading…</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-brick">Please log in to continue</div>
      </div>
    )
  }

  const handleSave = async (data: PricingFormData) => {
    if (!vendorId || !vendor) return
    try {
      await updateVendor.mutateAsync({
        id: vendorId,
        updates: {
          pricing_model: data.pricing_model,
          base_rate: data.base_rate ?? null,
          hourly_rate:
            data.pricing_model === 'hourly'
              ? data.base_rate ?? null
              : vendor.hourly_rate ?? null,
          per_person_rate: data.per_person_rate ?? null,
          per_head_kickback: data.headcount_kickback ? (data.per_person_rate ?? 0) : 0,
        },
      })
      addToast({ title: 'Pricing updated', description: 'Your pricing settings have been saved.' })
      reset(data)
    } catch {
      addToast({ title: 'Error', description: 'Failed to update pricing', variant: 'destructive' })
    }
  }

  const handleDeletePackage = async (packageId: string) => {
    if (!confirm('Delete this package?')) return
    try {
      await deletePackage.mutateAsync(packageId)
      addToast({ title: 'Package deleted', description: 'The package has been removed.' })
    } catch {
      addToast({ title: 'Error', description: 'Failed to delete package', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          <p className="text-ink-soft">Loading pricing…</p>
        </div>
      </div>
    )
  }

  if (!vendor) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-soft">No vendor profile found.</p>
      </div>
    )
  }

  const showBaseRate = pricingModel === 'flat_rate' || pricingModel === 'hourly' || pricingModel === 'hybrid'
  const showPerPerson = pricingModel === 'per_person'
  const showRevenueShare = pricingModel === 'revenue_share' || pricingModel === 'hybrid'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Pricing &amp; Packages</h1>
        <p className="mt-1 text-ink-soft">Configure your pricing model and service packages</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">

        {/* Pricing Model */}
        <Card>
          <CardHeader>
            <CardTitle>Pricing Model</CardTitle>
            <CardDescription>Choose how you charge for your services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {modelOptions.map((option) => {
                const Icon = option.icon
                const active = pricingModel === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('pricing_model', option.value, { shouldDirty: true })}
                    className={cn(
                      'flex flex-col items-start rounded-lg border-2 p-4 text-left transition-smooth',
                      active
                        ? 'border-clay bg-clay/10'
                        : 'border-tan hover:border-clay/40'
                    )}
                  >
                    <div
                      className={cn(
                        'mb-2 flex h-8 w-8 items-center justify-center rounded-lg',
                        active ? 'bg-clay/20' : 'bg-cream-deep/40'
                      )}
                    >
                      <Icon className={cn('h-4 w-4', active ? 'text-clay' : 'text-ink')} />
                    </div>
                    <p className="font-semibold text-ink text-sm">{option.label}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{option.description}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Base Rate (flat, hourly, hybrid) */}
        {showBaseRate && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {pricingModel === 'hourly' ? (
                  <Clock className="h-5 w-5" />
                ) : (
                  <DollarSign className="h-5 w-5" />
                )}
                {pricingModel === 'hourly' ? 'Hourly Rate' : 'Base Rate'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <label className="mb-2 block text-sm font-medium text-ink">
                {pricingModel === 'hourly' ? 'Hourly Rate ($)' : 'Base Rate ($)'}
              </label>
              <div className="relative max-w-xs">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                <Input
                  type="number"
                  {...register('base_rate', { valueAsNumber: true })}
                  className="pl-10"
                  placeholder={pricingModel === 'hourly' ? '150' : '1500'}
                />
              </div>
              {errors.base_rate && (
                <p className="mt-1 text-xs text-brick">{errors.base_rate.message}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Per-Person Rate */}
        {showPerPerson && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Per-Person Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-ink">
                  Rate per attendee ($)
                </label>
                <div className="relative max-w-xs">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                  <Input
                    type="number"
                    {...register('per_person_rate', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder="25"
                  />
                </div>
              </div>
              <div className="rounded-lg bg-cream/60 p-4">
                <p className="mb-1 text-sm text-ink-soft">Example (100 guests)</p>
                <p className="text-lg font-semibold text-ink">
                  ${perPersonRate.toLocaleString()} × 100 = ${(perPersonRate * 100).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Revenue Share / Headcount Kickback */}
        {(showRevenueShare || (!showPerPerson && !showBaseRate)) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" />
                Revenue Share &amp; Kickback
              </CardTitle>
              <CardDescription>
                Earn a percentage of event revenue or a fixed amount per verified attendee
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="headcount_kickback"
                  {...register('headcount_kickback')}
                  className="h-4 w-4 rounded text-clay"
                />
                <label htmlFor="headcount_kickback" className="text-sm font-medium text-ink">
                  Enable per-head kickback
                </label>
              </div>

              {headcountKickback && (
                <div className="space-y-3 pl-7">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink">
                      Per-person rate ($)
                    </label>
                    <div className="relative max-w-xs">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                      <Input
                        type="number"
                        {...register('per_person_rate', { valueAsNumber: true })}
                        className="pl-10"
                        placeholder="5"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg bg-cream/60 p-4">
                    <p className="mb-1 text-sm text-ink-soft">Example (100 guests)</p>
                    <p className="text-lg font-semibold text-ink">
                      ${perPersonRate.toLocaleString()} × 100 = ${(perPersonRate * 100).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Deposit Policy */}
        <Card>
          <CardHeader>
            <CardTitle>Deposit Policy</CardTitle>
            <CardDescription>
              Set the up-front payment required before a booking is secured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vendorId ? <VendorDepositSettings vendorId={vendorId} /> : null}
          </CardContent>
        </Card>

        {/* Service Packages */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Service Packages</CardTitle>
                <CardDescription>Bundled services with fixed pricing</CardDescription>
              </div>
              <Button type="button" onClick={() => { setEditingPackage(null); setShowPackageModal(true) }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Package
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {packages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-tan py-10 text-center">
                <p className="mb-4 text-sm text-ink-soft">No packages yet</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setEditingPackage(null); setShowPackageModal(true) }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first package
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {packages.map((pkg) => {
                  const inclusions: string[] = pkg.includes || []
                  return (
                    <Card key={pkg.id} className={cn(!pkg.is_active && 'opacity-60')}>
                      <CardContent className="p-4">
                        <div className="mb-3 flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="font-semibold text-ink">{pkg.package_name}</h3>
                            {pkg.description && (
                              <p className="mt-0.5 text-sm text-ink-soft">{pkg.description}</p>
                            )}
                            <div className="mt-2 flex items-center gap-4 text-sm">
                              <span className="font-semibold text-clay">
                                ${pkg.base_price?.toLocaleString()}
                              </span>
                              {pkg.duration_hours && (
                                <span className="text-ink-soft">{pkg.duration_hours} hrs</span>
                              )}
                            </div>
                          </div>
                          {!pkg.is_active && (
                            <span className="rounded-full bg-cream-deep/40 px-2 py-0.5 text-xs text-ink">
                              Inactive
                            </span>
                          )}
                        </div>

                        {inclusions.length > 0 && (
                          <ul className="mb-3 space-y-0.5 text-xs text-ink-soft">
                            {inclusions.slice(0, 3).map((inc, idx) => (
                              <li key={idx}>• {inc}</li>
                            ))}
                            {inclusions.length > 3 && (
                              <li>+{inclusions.length - 3} more</li>
                            )}
                          </ul>
                        )}

                        <div className="flex items-center gap-2 border-t pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => { setEditingPackage(pkg); setShowPackageModal(true) }}
                          >
                            <Edit className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1 text-brick hover:bg-brick/10 hover:text-brick"
                            onClick={() => handleDeletePackage(pkg.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
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

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={updateVendor.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={updateVendor.isPending || !isDirty}>
            {updateVendor.isPending ? (
              'Saving…'
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Pricing
              </>
            )}
          </Button>
        </div>
      </form>

      {showPackageModal && (
        <PackageModal
          package={editingPackage}
          vendorId={vendorId}
          onClose={() => { setShowPackageModal(false); setEditingPackage(null) }}
          onSuccess={() => {}}
        />
      )}
    </div>
  )
}
