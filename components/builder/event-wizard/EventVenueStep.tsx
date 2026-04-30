'use client'

import { useState, useMemo } from 'react'
import { Search, MapPin, Users, DollarSign, Check, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenues } from '@/lib/hooks/useVenues'
import { useCreateVenueBooking } from '@/lib/hooks/useBookings'
import { useUpdateEvent } from '@/lib/hooks/useEvents'
import { useToast } from '@/components/ui/toast'
import { DepositDisplay } from '@/components/builder/DepositDisplay'
import type { Event, Venue } from '@/lib/types'

interface EventVenueStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

/**
 * Calculates the deposit due for a venue booking request.
 *
 * @param venue - Venue with optional deposit configuration.
 * @param bookingCost - Current quoted venue cost.
 * @returns Deposit amount to store on the booking, or null when not required.
 */
function calculateVenueDeposit(venue: Venue, bookingCost: number | null) {
  if (!venue.requires_deposit) return null

  if (venue.deposit_type === 'percentage') {
    return bookingCost && venue.deposit_percentage
      ? bookingCost * (venue.deposit_percentage / 100)
      : null
  }

  return venue.deposit_amount || null
}

export function EventVenueStep({
  event,
  onNext,
  currentStep,
}: EventVenueStepProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<string[]>([])
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const { addToast } = useToast()
  const createVenueBooking = useCreateVenueBooking()
  const updateEvent = useUpdateEvent()

  // Only fetch venues when this step is active (Step 3)
  const { data: venuesResult, isLoading: venuesLoading, error: venuesError } = useVenues(
    undefined,
    { enabled: currentStep === 3 }
  )
  // Handle both paginated and non-paginated responses
  const venues = Array.isArray(venuesResult) 
    ? venuesResult 
    : venuesResult?.data || []

  // All hooks must be called before any conditional returns
  const filteredVenues = useMemo(() => {
    return venues.filter((venue) => {
      if (searchQuery && !venue.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (selectedNeighborhoods.length > 0 && !selectedNeighborhoods.includes(venue.city)) {
        return false
      }
      return true
    })
  }, [venues, searchQuery, selectedNeighborhoods])

  const neighborhoods = useMemo(() => {
    const unique = new Set(venues.map((v) => v.city).filter(Boolean))
    return Array.from(unique).sort()
  }, [venues])

  // Show loading state (after all hooks)
  if (venuesLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Loading venues...</p>
        </div>
      </div>
    )
  }

  // Show error state gracefully
  if (venuesError) {
    return (
      <div className="text-center py-16">
        <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-sidebar-accent rounded-2xl">
          <Building2 className="w-10 h-10 text-muted-foreground/60" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">Unable to load venues</h3>
        <p className="text-muted-foreground mb-6">You can continue to the next step and add a venue later.</p>
        <button
          onClick={onNext}
          className="px-6 py-3 bg-gradient-brand text-primary-foreground font-semibold rounded-xl transition-smooth shadow-glow hover:shadow-coral hover:-translate-y-0.5 min-h-[44px]"
        >
          Continue Without Venue
        </button>
      </div>
    )
  }

  const handleSelectVenue = async (venue: Venue) => {
    if (!event) return

    try {
      const quotedPrice = venue.hourly_rate || venue.daily_rate || null
      // Create venue booking
      await createVenueBooking.mutateAsync({
        event_id: event.id,
        venue_id: venue.id,
        requested_date: event.event_date,
        requested_start_time: event.start_time || (event as { event_time?: string }).event_time || null,
        requested_end_time: null,
        status: 'pending',
        quoted_price: quotedPrice,
        confirmed_date: null,
        confirmed_start_time: null,
        confirmed_end_time: null,
        final_price: null,
        deposit_amount: calculateVenueDeposit(venue, quotedPrice),
        deposit_paid: false,
        notes: null,
      })

      // Update event with venue_id
      await updateEvent.mutateAsync({
        id: event.id,
        updates: {
          venue_id: venue.id,
        },
      })

      setSelectedVenue(venue)
      addToast({
        title: 'Venue selected',
        description: 'Venue booking request has been created.',
      })

      onNext()
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to select venue',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-foreground">
          Search Venues
        </label>
        <input
          type="text"
          placeholder="Search by name, location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md rounded-xl border border-border bg-card/40 px-4 py-3 text-foreground placeholder:text-muted-foreground transition-smooth focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 hover:bg-card"
        />
      </div>

      {/* Neighborhood Filters */}
      {neighborhoods.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-foreground">
            Filter by Location
          </label>
          <div className="flex flex-wrap gap-2">
            {neighborhoods.map((neighborhood) => (
              <button
                key={neighborhood}
                onClick={() => {
                  if (selectedNeighborhoods.includes(neighborhood)) {
                    setSelectedNeighborhoods(
                      selectedNeighborhoods.filter((n) => n !== neighborhood)
                    )
                  } else {
                    setSelectedNeighborhoods([...selectedNeighborhoods, neighborhood])
                  }
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-smooth ${
                  selectedNeighborhoods.includes(neighborhood)
                    ? 'bg-gradient-brand text-primary-foreground border-transparent shadow-glow'
                    : 'border-border bg-card/40 text-foreground hover:border-primary/40 hover:bg-card'
                }`}
              >
                {neighborhood}
              </button>
            ))}
          </div>
        </div>
      )}

          {/* Venue Results */}
      {/* Results */}
      {filteredVenues.length === 0 && venues.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-sidebar-accent rounded-2xl">
            <Building2 className="w-10 h-10 text-muted-foreground/60" />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-2">No venues available yet</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            We&apos;re still building our venue network. You can continue planning your event and add a venue later.
          </p>
          <button
            onClick={onNext}
            className="px-6 py-3 bg-gradient-brand text-primary-foreground font-semibold rounded-xl transition-smooth shadow-glow hover:shadow-coral hover:-translate-y-0.5 min-h-[44px]"
          >
            Continue Without Venue
          </button>
        </div>
      ) : filteredVenues.length === 0 && venues.length > 0 ? (
        <div className="rounded-xl border border-border bg-sidebar-accent/20 py-12 text-center">
          <p className="text-foreground font-medium mb-1">No venues match your search</p>
          <p className="text-sm text-muted-foreground">Try adjusting your filters or search terms</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVenues.map((venue) => (
            <button
              key={venue.id}
              onClick={() => handleSelectVenue(venue)}
              className={`group relative text-left rounded-2xl border transition-smooth overflow-hidden hover:scale-[1.02] ${
                selectedVenue?.id === venue.id
                  ? 'border-primary shadow-glow ring-2 ring-primary/20'
                  : 'border-border bg-gradient-card hover:border-primary/50 hover:shadow-glow'
              }`}
            >
              {selectedVenue?.id === venue.id && (
                <div className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-brand shadow-glow">
                  <Check className="h-5 w-5 text-primary-foreground" />
                </div>
              )}

              <div className="aspect-[16/10] bg-sidebar-accent overflow-hidden">
                {(venue as { photo_url?: string }).photo_url ? (
                  <img
                    src={(venue as unknown as { photo_url: string }).photo_url}
                    alt={venue.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Building2 className="h-12 w-12 text-muted-foreground/30" />
                  </div>
                )}
              </div>

              <div className="p-5">
                <h3 className="mb-2 font-display text-lg font-bold text-foreground transition-smooth group-hover:text-primary">
                  {venue.name}
                </h3>
                <div className="mb-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 text-muted-foreground/60" />
                    <span>{venue.city}, {venue.state}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-muted-foreground/60" />
                    <span>Capacity: {venue.capacity}</span>
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-2xl font-bold text-foreground">
                    ${venue.hourly_rate || venue.daily_rate || '—'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {venue.hourly_rate ? '/hour' : venue.daily_rate ? '/day' : ''}
                  </span>
                </div>
                <div className="mt-4">
                  <DepositDisplay venueId={venue.id} bookingCost={venue.hourly_rate || venue.daily_rate || 0} compact />
                </div>
                {venue.description && (
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{venue.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
