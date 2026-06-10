'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock, DollarSign, Layers, Percent, Save, TrendingUp, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenue, useUpdateVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { DepositSettings } from '@/components/venue/DepositSettings'
import { centsToDollars, dollarsToCents } from '@/lib/money'
import type { PricingModel } from '@/lib/types'

const pricingSchema = z.object({
  pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid']),
  hourly_rate: z.number().optional(),
  daily_rate: z.number().optional(),
  flat_rate: z.number().optional(),
  per_person_rate: z.number().optional(),
  min_hours: z.number().optional(),
  ticket_sales_share: z.boolean().optional(),
  ticket_sales_share_percent: z.number().min(0).max(100).optional(),
  bar_revenue_share: z.boolean().optional(),
  bar_revenue_percent: z.number().min(0).max(100).optional(),
  per_head_kickback: z.number().optional(),
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
    description: 'Rate per attendee',
    icon: Users,
  },
  {
    value: 'hourly',
    label: 'Hourly',
    description: 'Charge per hour',
    icon: Clock,
  },
  {
    value: 'revenue_share',
    label: 'Community Host Incentive',
    description: 'Share verified event upside',
    icon: TrendingUp,
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Hourly + incentive',
    icon: Layers,
  },
]

export default function VenuePricingPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const router = useRouter()
  const { addToast } = useToast()

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
  const ticketSalesShare = watch('ticket_sales_share')
  const ticketSalesSharePercent = watch('ticket_sales_share_percent') || 0
  const barRevenueShare = watch('bar_revenue_share')
  const barRevenuePercent = watch('bar_revenue_percent') || 0
  const perHeadKickback = watch('per_head_kickback') || 0
  const hourlyRate = watch('hourly_rate') || 0
  const minHours = watch('min_hours') || 2
  const flatRate = watch('flat_rate') || 0
  const perPersonRate = watch('per_person_rate') || 0

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
        pricing_model: venue.pricing_model,
        hourly_rate: venue.hourly_rate ? centsToDollars(venue.hourly_rate) : undefined,
        daily_rate: venue.daily_rate ? centsToDollars(venue.daily_rate) : undefined,
        flat_rate: venue.daily_rate ? centsToDollars(venue.daily_rate) : undefined,
        per_person_rate: venue.per_head_kickback_amount ? centsToDollars(venue.per_head_kickback_amount) : undefined,
        min_hours: 2,
        ticket_sales_share: venue.ticket_sales_share_enabled || false,
        ticket_sales_share_percent: venue.ticket_sales_share_percent ?? 10,
        bar_revenue_share: venue.bar_revenue_share_enabled || false,
        bar_revenue_percent: venue.bar_revenue_share_percent ?? 15,
        per_head_kickback: venue.per_head_kickback_amount ? centsToDollars(venue.per_head_kickback_amount) : 0,
      })
    }
  }, [venue, reset])

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
    if (!venueId) return
    try {
      await updateVenue.mutateAsync({
        id: venueId,
        updates: {
          pricing_model: data.pricing_model,
          hourly_rate_cents: data.hourly_rate ? dollarsToCents(data.hourly_rate) : null,
          daily_rate_cents: data.flat_rate || data.daily_rate ? dollarsToCents(data.flat_rate || data.daily_rate) : null,
          ticket_sales_share_enabled: Boolean(data.ticket_sales_share),
          ticket_sales_share_percent: data.ticket_sales_share ? (data.ticket_sales_share_percent || 0) : 0,
          bar_revenue_share_enabled: Boolean(data.bar_revenue_share),
          bar_revenue_share_percent: data.bar_revenue_share ? (data.bar_revenue_percent || 0) : 0,
          per_head_kickback_cents: data.per_head_kickback ? dollarsToCents(data.per_head_kickback) : 0,
        },
      })
      addToast({ title: 'Pricing updated', description: 'Your venue pricing has been saved.' })
      reset(data)
    } catch {
      addToast({ title: 'Error', description: 'Failed to update pricing', variant: 'destructive' })
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

  if (!venue) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-soft">No venue found.</p>
      </div>
    )
  }

  const showHourly = pricingModel === 'hourly' || pricingModel === 'hybrid'
  const showFlatRate = pricingModel === 'flat_rate'
  const showPerPerson = pricingModel === 'per_person'
  const showRevenueShare = pricingModel === 'revenue_share' || pricingModel === 'hybrid'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Pricing &amp; Revenue</h1>
        <p className="mt-1 text-ink-soft">Configure how you charge for your venue</p>
      </div>

      <form onSubmit={handleSubmit(handleSave)} className="space-y-6">

        {/* Pricing Model */}
        <Card>
          <CardHeader>
            <CardTitle>Pricing Model</CardTitle>
            <CardDescription>Choose how you want to charge for your venue</CardDescription>
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
                    <p className="text-sm font-semibold text-ink">{option.label}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{option.description}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Flat Rate */}
        {showFlatRate && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Flat Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <label className="mb-2 block text-sm font-medium text-ink">
                Rate per event ($)
              </label>
              <div className="relative max-w-xs">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                <Input
                  type="number"
                  {...register('flat_rate', { valueAsNumber: true })}
                  className="pl-10"
                  placeholder="2500"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Per Person */}
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
                    placeholder="20"
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

        {/* Hourly Rate */}
        {showHourly && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Hourly Rate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-ink">
                    Hourly rate ($)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                    <Input
                      type="number"
                      {...register('hourly_rate', { valueAsNumber: true })}
                      className="pl-10"
                      placeholder="500"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-ink">
                    Minimum hours
                  </label>
                  <select
                    {...register('min_hours', { valueAsNumber: true })}
                    className="flex h-10 w-full rounded-md border border-tan bg-cream px-3 py-2 text-sm"
                  >
                    <option value={2}>2 hours</option>
                    <option value={3}>3 hours</option>
                    <option value={4}>4 hours</option>
                    <option value={6}>6 hours</option>
                    <option value={8}>8 hours</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg bg-cream/60 p-4">
                <p className="mb-1 text-sm text-ink-soft">Minimum booking</p>
                <p className="text-lg font-semibold text-ink">
                  ${hourlyRate.toLocaleString()}/hr × {minHours} hrs = ${(hourlyRate * minHours).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Community Host Incentive */}
        {showRevenueShare && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" />
                Community Host Incentive
              </CardTitle>
              <CardDescription>
                Set optional upside from ticket sales, bar revenue, or verified attendance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Ticket sales share */}
              <div className="rounded-lg border border-tan bg-cream/40 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">Ticket sales share</p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      Receive a percentage of tracked Posh, Luma, or Eventbrite ticket revenue.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    id="ticket_sales_share"
                    {...register('ticket_sales_share')}
                    className="mt-1 h-4 w-4"
                  />
                </div>

                {ticketSalesShare && (
                  <div className="mt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-ink">Share percentage</label>
                      <span className="rounded-full bg-clay/10 px-3 py-1 text-sm font-semibold text-clay">
                        {ticketSalesSharePercent}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={ticketSalesSharePercent}
                      onChange={(e) =>
                        setValue('ticket_sales_share_percent', Number(e.target.value), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-ink-soft">
                      <span>0%</span><span>25%</span><span>50%</span>
                    </div>
                    <div className="rounded-lg bg-cream/60 p-3 text-sm text-ink">
                      On $5,000 ticket sales: ${(5000 * (ticketSalesSharePercent / 100)).toLocaleString()}
                    </div>
                    {errors.ticket_sales_share_percent && (
                      <p className="text-sm text-brick">{errors.ticket_sales_share_percent.message}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Bar share */}
              <div className="rounded-lg border border-tan bg-cream/40 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-ink">Bar sales incentive</p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      Earn a percentage of bar sales during the event.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    id="bar_revenue_share"
                    {...register('bar_revenue_share')}
                    className="h-4 w-4"
                  />
                </div>

                {barRevenueShare && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-ink">Share percentage</label>
                      <span className="rounded-full bg-clay/10 px-3 py-1 text-sm font-semibold text-clay">
                        {barRevenuePercent}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={barRevenuePercent}
                      onChange={(e) =>
                        setValue('bar_revenue_percent', Number(e.target.value), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-ink-soft">
                      <span>0%</span><span>25%</span><span>50%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-head incentive */}
              <div>
                <label className="mb-2 block text-sm font-medium text-ink">
                  Per-head incentive ($)
                </label>
                <p className="mb-3 text-sm text-ink-soft">
                  Fixed amount earned per verified attendee, regardless of ticket or bar sales.
                </p>
                <div className="relative max-w-xs">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                  <Input
                    type="number"
                    {...register('per_head_kickback', { valueAsNumber: true })}
                    className="pl-10"
                    placeholder="5"
                  />
                </div>
              </div>

              {/* Combined example */}
              <div className="rounded-lg bg-cream/60 p-4">
                <p className="mb-2 text-sm font-medium text-ink">Example (100 guests)</p>
                <div className="space-y-1 text-sm text-ink-soft">
                  {ticketSalesShare && (
                    <div className="flex justify-between">
                      <span>Ticket sales share ({ticketSalesSharePercent}%)</span>
                      <span className="font-medium text-ink">
                        ${(5000 * (ticketSalesSharePercent / 100)).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {barRevenueShare && (
                    <div className="flex justify-between">
                      <span>Bar sales incentive ({barRevenuePercent}%)</span>
                      <span className="font-medium text-ink">
                        ${(100 * 50 * (barRevenuePercent / 100)).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Per-head incentive</span>
                    <span className="font-medium text-ink">
                      ${(100 * perHeadKickback).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-semibold text-ink">
                    <span>Total</span>
                    <span>
                      ${(
                        (ticketSalesShare ? 5000 * (ticketSalesSharePercent / 100) : 0) +
                        (barRevenueShare ? 100 * 50 * (barRevenuePercent / 100) : 0) +
                        100 * perHeadKickback
                      ).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
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
            <DepositSettings venueId={venueId ?? undefined} />
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={updateVenue.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={updateVenue.isPending || !isDirty}>
            {updateVenue.isPending ? (
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
    </div>
  )
}
