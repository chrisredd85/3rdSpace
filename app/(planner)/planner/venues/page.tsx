'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Building2, CheckCircle2, MapPin, Search, SlidersHorizontal, Users } from 'lucide-react'
import { BookedPartnersWorkspace } from '@/components/planner/BookedPartnersWorkspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { centsToDollars } from '@/lib/money'
import { cn } from '@/lib/utils'

interface CatalogVenue {
  id: string
  name?: string | null
  venue_name?: string | null
  neighborhood?: string | null
  city?: string | null
  description?: string | null
  venue_type?: string | null
  standing_capacity?: number | null
  capacity?: number | null
  min_capacity?: number | null
  max_capacity?: number | null
  hourly_rate?: number | null
  pricing_model?: string | null
  ticket_sales_share_enabled?: boolean | null
  bar_revenue_share_enabled?: boolean | null
  per_head_kickback_amount?: number | null
  unique_features_tags?: string[] | null
  requires_deposit?: boolean | null
  deposit_amount?: number | null
  is_claimed?: boolean | null
  is_admin_seeded?: boolean | null
}

interface VenuesApiResponse {
  venues?: CatalogVenue[]
  error?: string
}

async function fetchPlannerVenueCatalog(): Promise<CatalogVenue[]> {
  const response = await fetch(`/api/venues?planner_catalog=1&ts=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
  const payload = (await response.json()) as VenuesApiResponse

  if (!response.ok) {
    throw new Error(payload.error || 'Catalog temporarily unavailable')
  }

  return (payload.venues || []).sort((first, second) => Number(second.is_admin_seeded === true) - Number(first.is_admin_seeded === true))
}

/**
 * Planner catalog page for browsing planner-visible venues.
 *
 * Fetches the same public venue catalog used by recommendations and exposes
 * lightweight search for planner users without relying on saved venues.
 */
export default function PlannerVenuesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState('All')
  const {
    data: venues = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['planner-venue-catalog'],
    queryFn: fetchPlannerVenueCatalog,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const filteredVenues = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    return venues.filter((venue) => {
      const venueName = getVenueName(venue).toLowerCase()
      const location = getVenueLocation(venue).toLowerCase()
      const venueType = formatVenueType(venue.venue_type).toLowerCase()
      const tags = (venue.unique_features_tags || []).join(' ').toLowerCase()
      const matchesSearch =
        !normalizedQuery ||
        venueName.includes(normalizedQuery) ||
        location.includes(normalizedQuery) ||
        venueType.includes(normalizedQuery) ||
        tags.includes(normalizedQuery)
      const matchesArea = selectedArea === 'All' || location === selectedArea.toLowerCase()
      return matchesSearch && matchesArea
    })
  }, [venues, searchQuery, selectedArea])

  const areaOptions = useMemo(() => {
    const options = Array.from(new Set(venues.map(getVenueLocation).filter(Boolean)))
    return ['All', ...options.slice(0, 7)]
  }, [venues])

  const catalogStats = useMemo(() => {
    const unclaimed = venues.filter((venue) => venue.is_claimed === false).length
    const revShareReady = venues.filter((venue) => venue.ticket_sales_share_enabled || venue.bar_revenue_share_enabled || venue.per_head_kickback_amount).length
    const capacityReady = venues.filter((venue) => (venue.standing_capacity ?? venue.capacity ?? venue.max_capacity ?? 0) > 0).length

    return [
      { label: 'Catalog spaces', value: venues.length.toLocaleString() },
      { label: 'Capacity-ready', value: capacityReady.toLocaleString() },
      { label: 'Flexible terms', value: revShareReady.toLocaleString() },
      { label: 'Team fallback', value: unclaimed.toLocaleString() },
    ]
  }, [venues])

  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Venues</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Bay Area venues available for your events.
        </p>
      </div>

      <div className="space-y-6 px-6 py-6">
        <BookedPartnersWorkspace
          title="Booked Venues"
          description="Coordinate with venues after the deposit is approved. Keep partner messages, due dates, and day-of logistics attached to the booking."
          emptyMessage="Venue bookings will appear here once a deposit or hold is authorized."
          partnerKind="venue"
        />

        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Venue Catalog</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">Find the right room before outreach</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                Search capacity, neighborhood, terms, and amenities. Holds and deposits stay approval-gated until the organizer confirms.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">Plan with agent</Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalogStats.map((stat) => (
              <div key={stat.label} className="rounded-md border border-tan bg-cream-deep/60 p-4">
                <p className="text-xs font-semibold text-ink-soft">{stat.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-lg border border-tan bg-cream p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search name, neighborhood, type, or amenities..."
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-ink-soft" />
              {areaOptions.map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => setSelectedArea(area)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-smooth',
                    selectedArea === area
                      ? 'border-clay/40 bg-clay text-cream'
                      : 'border-tan bg-cream-deep text-ink-soft hover:text-ink'
                  )}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? <VenueSkeletonGrid /> : null}

        {!isLoading && isError ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            <p className="font-semibold text-ink">Catalog temporarily unavailable</p>
            <p className="mt-1">Venue listings could not be loaded right now.</p>
            <Button className="mt-4" variant="glass" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </Button>
          </div>
        ) : null}

        {!isLoading && !isError && venues.length === 0 ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            No venues in the catalog yet.
          </div>
        ) : null}

        {!isLoading && !isError && venues.length > 0 && filteredVenues.length === 0 ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            No venues match that search.
          </div>
        ) : null}

        {!isLoading && !isError && filteredVenues.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredVenues.map((venue) => (
              <VenueCard key={venue.id} venue={venue} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Loading skeleton for the venue catalog.
 */
function VenueSkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-tan bg-cream p-5">
          <div className="h-5 w-2/3 rounded bg-cream-deep" />
          <div className="mt-4 h-4 w-1/2 rounded bg-cream-deep" />
          <div className="mt-6 h-10 rounded bg-cream-deep" />
        </div>
      ))}
    </div>
  )
}

interface VenueCardProps {
  venue: CatalogVenue
}

/**
 * Compact public venue catalog card for planner users.
 */
function VenueCard({ venue }: VenueCardProps) {
  const venueName = getVenueName(venue)
  const location = getVenueLocation(venue)
  const capacity = venue.standing_capacity ?? venue.capacity ?? venue.max_capacity ?? null
  const minCapacity = venue.min_capacity ?? null
  const hourlyRate = formatVenueHourlyRate(venue.hourly_rate)
  const venueType = formatVenueType(venue.venue_type)
  const terms = getVenueTerms(venue)
  const description = venue.description ? truncateText(venue.description, 118) : 'Details will fill in as this venue claims the listing or the 3rdPlace team verifies terms.'
  const tags = (venue.unique_features_tags || []).slice(0, 3)

  return (
    <article className={cn('flex min-h-full flex-col rounded-lg border border-tan bg-cream p-5 shadow-card')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ink">{venueName}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
              <MapPin className="h-3.5 w-3.5" />
              {location}
            </p>
          </div>
        </div>
        {venue.is_claimed === false ? (
          <span className="shrink-0 rounded-full border border-tan bg-cream-deep px-2 py-1 text-xs font-semibold text-ink-soft">
            Unclaimed
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-soft">{description}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Capacity fit</p>
          <p className="mt-1 flex items-center gap-1.5 font-semibold text-ink">
            <Users className="h-3.5 w-3.5 text-ink-soft" />
            {formatCapacityRange(minCapacity, capacity)}
          </p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Starting rate</p>
          <p className="mt-1 font-semibold text-ink">{hourlyRate}</p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Type</p>
          <p className="mt-1 truncate font-semibold text-ink" title={venueType}>{venueType}</p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Terms</p>
          <p className="mt-1 truncate font-semibold text-ink" title={terms}>{terms}</p>
        </div>
      </div>

      {tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-tan bg-cream-deep px-2.5 py-1 text-xs font-semibold text-ink-soft">
              <CheckCircle2 className="h-3 w-3 text-clay" />
              {formatVenueType(tag)}
            </span>
          ))}
        </div>
      ) : null}

      <Button variant="outline" size="sm" className="mt-5 w-full" asChild>
        <Link href={`/planner/venues/${venue.id}`}>View details</Link>
      </Button>
    </article>
  )
}

/**
 * Returns the best available venue display name.
 */
function getVenueName(venue: CatalogVenue) {
  return venue.venue_name || venue.name || 'Untitled venue'
}

/**
 * Returns neighborhood first, then city as the venue location label.
 */
function getVenueLocation(venue: CatalogVenue) {
  return venue.neighborhood || venue.city || 'Bay Area'
}

/**
 * Formats venue_type and tag values for display.
 */
function formatVenueType(value: string | null | undefined) {
  if (!value) return 'Flexible space'

  return value
    .split('_')
    .map((part) => (part.toLowerCase() === 'sf' ? 'SF' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * Formats capacity using min/max when both are available.
 */
function formatCapacityRange(minCapacity: number | null, maxCapacity: number | null) {
  if (minCapacity && maxCapacity && minCapacity !== maxCapacity) {
    return `${minCapacity.toLocaleString()}-${maxCapacity.toLocaleString()}`
  }

  return maxCapacity ? maxCapacity.toLocaleString() : 'TBD'
}

/**
 * Returns the most planner-relevant venue deal term.
 */
function getVenueTerms(venue: CatalogVenue) {
  if (venue.ticket_sales_share_enabled) return 'Ticket share'
  if (venue.bar_revenue_share_enabled) return 'Bar share'
  if (venue.per_head_kickback_amount && venue.per_head_kickback_amount > 0) return 'Per-head'
  if (venue.requires_deposit || venue.deposit_amount) return 'Deposit'
  return venue.pricing_model ? formatVenueType(venue.pricing_model) : 'Quote needed'
}

function formatVenueHourlyRate(rate: number | null | undefined) {
  if (typeof rate !== 'number') return 'TBD'

  const dollars = centsToDollars(rate)
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars)

  return `${formatted}/hr`
}

/**
 * Truncates long venue copy for compact cards.
 */
function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
