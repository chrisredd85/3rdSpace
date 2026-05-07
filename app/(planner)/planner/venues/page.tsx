'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, CheckCircle2, MapPin, Search, SlidersHorizontal, Users } from 'lucide-react'
import { BookedPartnersWorkspace } from '@/components/planner/BookedPartnersWorkspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

/**
 * Planner catalog page for browsing admin-seeded venues.
 *
 * Fetches the public venue catalog once, filters admin-seeded listings client-side,
 * and exposes lightweight search for planner users without relying on saved venues.
 */
export default function PlannerVenuesPage() {
  const [venues, setVenues] = useState<CatalogVenue[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState('All')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadVenues() {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch('/api/venues')
        const payload = (await response.json()) as VenuesApiResponse

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load venues')
        }

        if (mounted) {
          setVenues((payload.venues || []).filter((venue) => venue.is_admin_seeded === true))
        }
      } catch {
        if (mounted) {
          setError('Unable to load venues — try refreshing.')
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    loadVenues()

    return () => {
      mounted = false
    }
  }, [])

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
      { label: 'Concierge fallback', value: unclaimed.toLocaleString() },
    ]
  }, [venues])

  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Venues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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

        <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Venue Catalog</p>
              <h2 className="mt-2 font-display text-xl font-bold text-foreground">Find the right room before outreach</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Search capacity, neighborhood, terms, and amenities. Holds and deposits stay approval-gated until the organizer confirms.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">Plan with agent</Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalogStats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-background/50 p-4">
                <p className="text-xs font-semibold text-muted-foreground">{stat.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search name, neighborhood, type, or amenities..."
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
              {areaOptions.map((area) => (
                <button
                  key={area}
                  type="button"
                  onClick={() => setSelectedArea(area)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-smooth',
                    selectedArea === area
                      ? 'border-primary/40 bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? <VenueSkeletonGrid /> : null}

        {!isLoading && error ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && venues.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            No venues in the catalog yet.
          </div>
        ) : null}

        {!isLoading && !error && venues.length > 0 && filteredVenues.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            No venues match that search.
          </div>
        ) : null}

        {!isLoading && !error && filteredVenues.length > 0 ? (
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
        <div key={item} className="rounded-lg border border-border bg-card p-5">
          <div className="h-5 w-2/3 rounded bg-muted" />
          <div className="mt-4 h-4 w-1/2 rounded bg-muted" />
          <div className="mt-6 h-10 rounded bg-muted" />
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
  const description = venue.description ? truncateText(venue.description, 118) : 'Details will fill in as this venue claims the listing or the concierge team verifies terms.'
  const tags = (venue.unique_features_tags || []).slice(0, 3)

  return (
    <article className={cn('flex min-h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-card')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-foreground">{venueName}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {location}
            </p>
          </div>
        </div>
        {venue.is_claimed === false ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
            Unclaimed
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Capacity fit</p>
          <p className="mt-1 flex items-center gap-1.5 font-semibold text-foreground">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            {formatCapacityRange(minCapacity, capacity)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Starting rate</p>
          <p className="mt-1 font-semibold text-foreground">{hourlyRate}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Type</p>
          <p className="mt-1 truncate font-semibold text-foreground" title={venueType}>{venueType}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Terms</p>
          <p className="mt-1 truncate font-semibold text-foreground" title={terms}>{terms}</p>
        </div>
      </div>

      {tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-primary" />
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

/**
 * Formats hourly rates while tolerating existing dollar and cents payloads.
 */
function formatVenueHourlyRate(rate: number | null | undefined) {
  if (typeof rate !== 'number') return 'TBD'

  const dollars = rate > 1000 ? rate / 100 : rate
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
