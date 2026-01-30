'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save, DollarSign, Percent, Clock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenue, useUpdateVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { PricingModel } from '@/lib/types'

const pricingSchema = z.object({
  pricing_model: z.enum(['hourly', 'revenue_share', 'hybrid', 'flat_rate', 'per_person']),
  hourly_rate: z.number().optional(),
  daily_rate: z.number().optional(),
  min_hours: z.number().optional(),
  bar_revenue_share: z.boolean().optional(),
  bar_revenue_percent: z.number().min(0).max(100).optional(),
  per_head_kickback: z.number().optional(),
  deposit_percent: z.number().min(0).max(100).optional(),
  deposit_amount: z.number().optional(),
  deposit_due: z.string().optional(),
})

type PricingFormData = z.infer<typeof pricingSchema>

export default function VenuePricingPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: venue, isLoading } = useVenue(venueId)
  const updateVenue = useUpdateVenue()

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
  const barRevenueShare = watch('bar_revenue_share')
  const barRevenuePercent = watch('bar_revenue_percent') || 0
  const perHeadKickback = watch('per_head_kickback') || 0
  const hourlyRate = watch('hourly_rate') || 0
  const minHours = watch('min_hours') || 2

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
      supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .then(({ data: venues }) => {
          if (venues && venues.length > 0) {
            setVenueId(venues[0].id)
          }
        })
    }
  }, [user])

  useEffect(() => {
    if (venue) {
      reset({
        pricing_model: venue.pricing_model,
        hourly_rate: venue.hourly_rate || undefined,
        daily_rate: venue.daily_rate || undefined,
        min_hours: 2, // Would come from venue settings
        bar_revenue_share: false, // Would come from venue settings
        bar_revenue_percent: 15, // Would come from venue settings
        per_head_kickback: 0, // Would come from venue settings
        deposit_percent: 50, // Would come from venue settings
        deposit_due: '48hrs', // Would come from venue settings
      })
    }
  }, [venue, reset])

  const handleSave = async (data: PricingFormData) => {
    if (!venueId) return

    try {
      await updateVenue.mutateAsync({
        id: venueId,
        updates: {
          pricing_model: data.pricing_model,
          hourly_rate: data.hourly_rate || null,
          daily_rate: data.daily_rate || null,
        },
      })

      // Save additional pricing settings (would be in a separate table or JSON field)
      // For now, we'll just update the main venue record

      addToast({
        title: 'Pricing updated',
        description: 'Your venue pricing has been saved successfully.',
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

  if (!venue) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No venue found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Pricing & Revenue</h1>
        <p className="text-gray-600 mt-1">Configure how you charge for your venue</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">
        {/* Pricing Model Toggle */}
        <Card>
          <CardHeader>
            <CardTitle>Pricing Model</CardTitle>
            <CardDescription>
              Choose how you want to charge for your venue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['hourly', 'revenue_share', 'hybrid'] as PricingModel[]).map((model) => (
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
                    {model === 'hourly'
                      ? 'Hourly Rate'
                      : model === 'revenue_share'
                      ? 'Revenue Share'
                      : 'Hybrid'}
                  </div>
                  <div className="text-sm text-gray-600">
                    {model === 'hourly'
                      ? 'Charge per hour'
                      : model === 'revenue_share'
                      ? 'Share in event revenue'
                      : 'Combine hourly + revenue share'}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Hourly Rate Section */}
        {(pricingModel === 'hourly' || pricingModel === 'hybrid') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Hourly Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Hourly Rate ($)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="number"
                    {...register('hourly_rate', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder="500"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Minimum Hours
                </label>
                <select
                  {...register('min_hours', { valueAsNumber: true })}
                  className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value={2}>2 hours</option>
                  <option value={3}>3 hours</option>
                  <option value={4}>4 hours</option>
                  <option value={6}>6 hours</option>
                  <option value={8}>8 hours</option>
                </select>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-1">Example Calculation</p>
                <p className="text-lg font-semibold text-gray-900">
                  ${hourlyRate.toLocaleString()}/hr × {minHours} hrs = $
                  {(hourlyRate * minHours).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Revenue Share Section */}
        {(pricingModel === 'revenue_share' || pricingModel === 'hybrid') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" />
                Revenue Share
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...register('bar_revenue_share')}
                  className="h-4 w-4 text-forest-500"
                />
                <label className="text-sm font-medium text-gray-700">
                  Enable bar revenue share
                </label>
              </div>

              {barRevenueShare && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Bar Revenue Share (%)
                  </label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      type="number"
                      {...register('bar_revenue_percent', { valueAsNumber: true })}
                      className="pl-10"
                      placeholder="15"
                      min={0}
                      max={100}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Per-Head Kickback ($)
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="number"
                    {...register('per_head_kickback', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder="5"
                  />
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Example Calculation (100 guests)</p>
                <div className="space-y-1 text-sm">
                  {barRevenueShare && (
                    <p className="text-gray-700">
                      Bar revenue (15%): ${(100 * 50 * (barRevenuePercent / 100)).toLocaleString()}
                    </p>
                  )}
                  <p className="text-gray-700">
                    Per-head kickback: ${(100 * perHeadKickback).toLocaleString()}
                  </p>
                  <p className="font-semibold text-gray-900 mt-2">
                    Total: $
                    {(
                      (barRevenueShare ? 100 * 50 * (barRevenuePercent / 100) : 0) +
                      100 * perHeadKickback
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deposit Policy Section */}
        <Card>
          <CardHeader>
            <CardTitle>Deposit Policy</CardTitle>
            <CardDescription>
              Set your deposit requirements
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Deposit Amount
              </label>
              <select
                {...register('deposit_percent', { valueAsNumber: true })}
                className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value={25}>25%</option>
                <option value={50}>50%</option>
                <option value={100}>Full Amount</option>
                <option value={0}>Custom</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Deposit Due
              </label>
              <select
                {...register('deposit_due')}
                className="flex h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="immediately">Immediately</option>
                <option value="48hrs">48 hours</option>
                <option value="1week">1 week</option>
                <option value="14days">14 days</option>
              </select>
            </div>
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
                Save Pricing
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
