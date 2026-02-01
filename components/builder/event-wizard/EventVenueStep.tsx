'use client'

import { useState, useMemo } from 'react'
import { Search, MapPin, Users, DollarSign, Check, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenues } from '@/lib/hooks/useVenues'
import { useCreateVenueBooking } from '@/lib/hooks/useBookings'
import { useUpdateEvent } from '@/lib/hooks/useEvents'
import { useToast } from '@/components/ui/toast'
import type { Event, Venue } from '@/lib/types'

interface EventVenueStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
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
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading venues...</p>
        </div>
      </div>
    )
  }

  // Show error state gracefully
  if (venuesError) {
    return (
      <div className="text-center py-16">
        <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
          <Building2 className="w-10 h-10 text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Unable to load venues</h3>
        <p className="text-slate-600 mb-6">You can continue to the next step and add a venue later.</p>
        <button
          onClick={onNext}
          className="px-6 py-3 bg-forest-500 hover:bg-forest-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-forest-500/20 hover:shadow-xl hover:shadow-forest-500/30 hover:scale-105 min-h-[44px]"
        >
          Continue Without Venue
        </button>
      </div>
    )
  }

  const handleSelectVenue = async (venue: Venue) => {
    if (!event) return

    try {
      // Create venue booking
      await createVenueBooking.mutateAsync({
        event_id: event.id,
        venue_id: venue.id,
        requested_date: event.event_date,
        requested_start_time: event.start_time || (event as { event_time?: string }).event_time || null,
        requested_end_time: null,
        status: 'pending',
        quoted_price: venue.hourly_rate || venue.daily_rate || null,
        confirmed_date: null,
        confirmed_start_time: null,
        confirmed_end_time: null,
        final_price: null,
        deposit_amount: null,
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
        <label className="block text-sm font-semibold text-slate-700">
          Search Venues
        </label>
        <input
          type="text"
          placeholder="Search by name, location..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="
            w-full max-w-md px-4 py-3 
            bg-white border-2 border-slate-200 
            rounded-xl 
            text-slate-900 placeholder-slate-400
            focus:border-forest-500 focus:ring-4 focus:ring-forest-500/10
            transition-all duration-200
            hover:border-slate-300
          "
        />
      </div>

      {/* Neighborhood Filters */}
      {neighborhoods.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
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
                className={`
                  px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all duration-200
                  ${selectedNeighborhoods.includes(neighborhood)
                    ? 'bg-forest-500 text-white border-forest-500 shadow-lg shadow-forest-500/20'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-forest-300 hover:bg-forest-50/50'
                  }
                `}
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
          <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
            <Building2 className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            No venues available yet
          </h3>
          <p className="text-slate-600 mb-6 max-w-md mx-auto">
            We&apos;re still building our venue network. You can continue planning your event and add a venue later, or reach out to suggest a venue.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onNext}
              className="px-6 py-3 bg-forest-500 hover:bg-forest-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-forest-500/20 hover:shadow-xl hover:shadow-forest-500/30 hover:scale-105 min-h-[44px]"
            >
              Continue Without Venue
            </button>
          </div>
        </div>
      ) : filteredVenues.length === 0 && venues.length > 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-600 mb-2 font-medium">No venues found matching your search criteria</p>
          <p className="text-sm text-slate-500">Try adjusting your filters or search terms</p>
        </div>
      ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredVenues.map((venue) => (
                <button
                  key={venue.id}
                  onClick={() => handleSelectVenue(venue)}
                  className={`
                    group relative text-left bg-white rounded-2xl border-2 
                    transition-all duration-300 overflow-hidden
                    hover:shadow-2xl hover:scale-[1.02]
                    ${selectedVenue?.id === venue.id 
                      ? 'border-forest-500 shadow-xl shadow-forest-500/20 ring-4 ring-forest-500/10' 
                      : 'border-slate-200 hover:border-forest-300'
                    }
                  `}
                >
                  {/* Selected indicator */}
                  {selectedVenue?.id === venue.id && (
                    <div className="absolute -top-3 -right-3 w-10 h-10 bg-forest-500 rounded-full flex items-center justify-center shadow-lg shadow-forest-500/50 z-10">
                      <Check className="w-6 h-6 text-white" />
                    </div>
                  )}

                  {/* Image placeholder */}
                  <div className="aspect-[16/10] bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
                    {(venue as { photo_url?: string }).photo_url ? (
                      <img 
                        src={(venue as unknown as { photo_url: string }).photo_url} 
                        alt={venue.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="w-12 h-12 text-slate-300" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-5">
                    <h3 className="font-bold text-lg text-slate-900 mb-2 group-hover:text-forest-600 transition-colors">
                      {venue.name}
                    </h3>
                    
                    {/* Metadata */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="w-4 h-4 text-slate-400" />
                        <span>{venue.city}, {venue.state}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span>Capacity: {venue.capacity}</span>
                      </div>
                    </div>

                    {/* Price tag */}
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-slate-900">
                        ${venue.hourly_rate || venue.daily_rate || '—'}
                      </span>
                      <span className="text-sm text-slate-500">
                        {venue.hourly_rate ? '/hour' : venue.daily_rate ? '/day' : ''}
                      </span>
                    </div>

                    {/* Description */}
                    {venue.description && (
                      <p className="text-xs text-slate-500 mt-3 line-clamp-2">
                        {venue.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
    </div>
  )
}
