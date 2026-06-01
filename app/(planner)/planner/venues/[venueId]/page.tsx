'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarPlus, DollarSign, MapPin, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useVenue } from '@/lib/hooks/useVenues'
import { BookingRequestForm, type BookingRequestFormData } from '@/components/forms/BookingRequestForm'
import { VenueAmenitiesBadges } from '@/components/builder/VenueAmenitiesBadges'
import { VenueUniqueFeatures } from '@/components/builder/VenueUniqueFeatures'
import { VenueRulesDisplay } from '@/components/builder/VenueRulesDisplay'
import { DepositDisplay } from '@/components/builder/DepositDisplay'
import { centsToDollars } from '@/lib/money'

interface BuilderVenueDetailPageProps {
  params: {
    venueId: string
  }
}

/**
 * Estimates a venue booking cost for previewing deposits on the detail page.
 *
 * @param hourlyRate - Venue hourly rate.
 * @param dailyRate - Venue daily rate.
 * @returns Four-hour hourly estimate or daily rate fallback.
 */
function estimatePreviewCost(hourlyRate?: number | null, dailyRate?: number | null) {
  if (hourlyRate && hourlyRate > 0) return hourlyRate * 4
  if (dailyRate && dailyRate > 0) return dailyRate
  return 0
}

function formatRate(cents?: number | null, suffix = '') {
  if (!cents || cents <= 0) return null
  return `$${centsToDollars(cents).toLocaleString()}${suffix}`
}

/**
 * Venue detail page for builders, including highlights, amenities, rules, deposits, and booking request form.
 *
 * @param props - Dynamic venue route params.
 * @returns Builder-facing venue detail page.
 */
export default function BuilderVenueDetailPage({ params }: BuilderVenueDetailPageProps) {
  const { data: venue, isLoading } = useVenue(params.venueId)
  const { addToast } = useToast()
  const [submitting, setSubmitting] = useState(false)

  const bookingCost = useMemo(
    () => estimatePreviewCost(venue?.hourly_rate, venue?.daily_rate),
    [venue?.hourly_rate, venue?.daily_rate]
  )
  const bookingCostDollars = centsToDollars(bookingCost)

  /**
   * Submits a pending venue booking request.
   *
   * @param formData - Booking form values.
   */
  async function handleBookingSubmit(formData: BookingRequestFormData) {
    setSubmitting(true)
    try {
      const response = await fetch('/api/builder/venue-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          venueId: params.venueId,
          ...formData,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit booking request')
      }

      addToast({
        title: 'Booking request submitted',
        description: 'The venue owner can now review it from bulk approval.',
      })
    } catch (error) {
      addToast({
        title: 'Could not submit booking request',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
      </div>
    )
  }

  if (!venue) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-soft">Venue not found.</CardContent>
      </Card>
    )
  }

  const location = venue.city && venue.state ? `${venue.city}, ${venue.state}` : venue.address

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href="/planner/venues">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to venues
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="h-64 bg-gradient-to-br from-clay/80 to-clay" />
            <CardHeader>
              <CardTitle className="text-3xl">{venue.name}</CardTitle>
              <CardDescription className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {location}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-ink-soft" />
                  <span>{venue.capacity || 'Capacity TBD'} capacity</span>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-ink-soft" />
                  <span>
                    {formatRate(venue.hourly_rate, '/hr') ?? formatRate(venue.daily_rate, '/day') ?? 'Rate TBD'}
                  </span>
                </div>
              </div>
              {venue.description ? <p className="text-ink">{venue.description}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <VenueUniqueFeatures venueId={venue.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Amenities</CardTitle>
              <CardDescription>Selected venue amenities and custom features.</CardDescription>
            </CardHeader>
            <CardContent>
              <VenueAmenitiesBadges venueId={venue.id} maxDisplay={8} />
            </CardContent>
          </Card>

          <VenueRulesDisplay venueId={venue.id} audience="builders" />

          <DepositDisplay venueId={venue.id} bookingCost={bookingCostDollars} />
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5" />
              Request This Venue
            </CardTitle>
            <CardDescription>Submit a pending request for the venue owner to review.</CardDescription>
          </CardHeader>
          <CardContent>
            <BookingRequestForm
              type="venue"
              venueId={venue.id}
              bookingCost={bookingCost}
              onSubmit={handleBookingSubmit}
              isLoading={submitting}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
