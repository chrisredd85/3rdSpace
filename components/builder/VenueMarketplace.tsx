'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Search,
  Heart,
  MapPin,
  Users,
  DollarSign,
  Star,
  X,
  Building2,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenues, useToggleSavedVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import { supabase } from '@/lib/supabase/client'
import { getUniqueFeatureTagOptions } from '@/lib/venues/unique-features'
import type { Venue, VenueType } from '@/lib/types'

interface VenueMarketplaceProps {
  onClose?: () => void
}

export function VenueMarketplace({ onClose }: VenueMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [venueType, setVenueType] = useState<VenueType | 'all'>('all')
  const [neighborhood, setNeighborhood] = useState('')
  const [minCapacity, setMinCapacity] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [amenityFilter, setAmenityFilter] = useState('')
  const [featureTagFilter, setFeatureTagFilter] = useState('')
  const [amenityOptions, setAmenityOptions] = useState<Array<{ id: string; name: string; category: string }>>([])
  const [venueAmenityMap, setVenueAmenityMap] = useState<Record<string, Set<string>>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  const { user } = useUser()
  const userId = user?.id || null
  const { addToast } = useToast()
  const toggleSaved = useToggleSavedVenue()

  // Build filters
  const filters = useMemo(() => {
    const filterObj: any = {}
    if (venueType !== 'all') filterObj.venue_type = venueType
    if (neighborhood) {
      filterObj.city = neighborhood
    }
    if (minCapacity) filterObj.min_capacity = parseInt(minCapacity)
    if (maxCapacity) filterObj.max_capacity = parseInt(maxCapacity)
    if (minPrice) filterObj.min_price = parseInt(minPrice)
    if (maxPrice) filterObj.max_price = parseInt(maxPrice)
    if (featureTagFilter) filterObj.unique_feature_tags = [featureTagFilter]
    return filterObj
  }, [venueType, neighborhood, minCapacity, maxCapacity, minPrice, maxPrice, featureTagFilter])

  const { data: venuesResult, isLoading } = useVenues(filters, { 
    page: currentPage - 1, 
    pageSize: itemsPerPage 
  })
  // Handle both paginated and non-paginated responses
  const venues = useMemo(
    () => Array.isArray(venuesResult) ? venuesResult : venuesResult?.data || [],
    [venuesResult]
  )
  const venueIds = useMemo(() => venues.map((venue) => venue.id), [venues])
  const amenityNameById = useMemo(
    () => new Map(amenityOptions.map((amenity) => [amenity.id, amenity.name])),
    [amenityOptions]
  )

  useEffect(() => {
    /**
     * Loads the master amenity list for marketplace filtering.
     */
    async function loadAmenityOptions() {
      try {
        const response = await fetch('/api/venue/amenities')
        const data = await response.json()
        const grouped = (data.available || {}) as Record<string, Array<{ id: string; name: string; category: string }>>
        setAmenityOptions(Object.values(grouped).flat())
      } catch (error) {
        console.error('[VenueMarketplace] Failed to load amenity filters', error)
      }
    }

    loadAmenityOptions()
  }, [])

  useEffect(() => {
    /**
     * Loads selected amenity ids for the current venue result set.
     */
    async function loadVenueAmenityMap() {
      if (venueIds.length === 0) {
        setVenueAmenityMap({})
        return
      }

      const { data, error } = await supabase
        .from('venue_amenities')
        .select('venue_id, amenity_type_id')
        .in('venue_id', venueIds)
        .not('amenity_type_id', 'is', null)

      if (error) {
        console.error('[VenueMarketplace] Failed to load venue amenities', error)
        return
      }

      const nextMap: Record<string, Set<string>> = {}
      ;((data as Array<{ venue_id: string; amenity_type_id: string | null }> | null) ?? []).forEach((row) => {
        if (!row.amenity_type_id) return
        nextMap[row.venue_id] = nextMap[row.venue_id] ?? new Set<string>()
        nextMap[row.venue_id].add(row.amenity_type_id)
      })
      setVenueAmenityMap(nextMap)
    }

    loadVenueAmenityMap()
  }, [venueIds])

  // Filter and search venues
  const filteredVenues = useMemo(() => {
    let filtered = venues

    // Search by name or description
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (v) =>
          v.name.toLowerCase().includes(query) ||
          v.description?.toLowerCase().includes(query) ||
          v.unique_features?.toLowerCase().includes(query) ||
          v.unique_features_tags?.some((tag) => tag.toLowerCase().includes(query)) ||
          v.address.toLowerCase().includes(query)
      )
    }

    if (amenityFilter) {
      filtered = filtered.filter((venue) => venueAmenityMap[venue.id]?.has(amenityFilter))
    }

    return filtered
  }, [venues, searchQuery, amenityFilter, venueAmenityMap])

  // Pagination
  const totalPages = Math.ceil(filteredVenues.length / itemsPerPage)
  const paginatedVenues = filteredVenues.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )


  const handleToggleSaved = async (venueId: string, isSaved: boolean) => {
    if (!userId) {
      addToast({
        title: 'Please sign in',
        description: 'You need to be signed in to save venues',
        variant: 'destructive',
      })
      return
    }

    try {
      await toggleSaved.mutateAsync({
        userId,
        venueId,
        isSaved,
      })
      addToast({
        title: isSaved ? 'Removed from saved' : 'Saved venue',
        description: isSaved
          ? 'Venue removed from your saved list'
          : 'Venue added to your saved list',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update saved venue',
        variant: 'destructive',
      })
    }
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setVenueType('all')
    setNeighborhood('')
    setMinCapacity('')
    setMaxCapacity('')
    setMinPrice('')
    setMaxPrice('')
    setAmenityFilter('')
    setFeatureTagFilter('')
    setCurrentPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Venue Marketplace</h2>
          <p className="text-muted-foreground mt-1">Find the perfect venue for your events</p>
        </div>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filters Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Filters</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Venue Type */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Venue Type
                </label>
                <select
                  value={venueType}
                  onChange={(e) => {
                    setVenueType(e.target.value as VenueType | 'all')
                    setCurrentPage(1)
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="all">All Types</option>
                  <option value="loft_warehouse">Loft/Warehouse</option>
                  <option value="gallery">Gallery</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="rooftop">Rooftop</option>
                  <option value="conference_center">Conference Center</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Neighborhood */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Neighborhood
                </label>
                <Input
                  placeholder="City, State"
                  value={neighborhood}
                  onChange={(e) => {
                    setNeighborhood(e.target.value)
                    setCurrentPage(1)
                  }}
                />
              </div>

              {/* Capacity Range */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Capacity
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minCapacity}
                    onChange={(e) => {
                      setMinCapacity(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxCapacity}
                    onChange={(e) => {
                      setMaxCapacity(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                </div>
              </div>

              {/* Price Range */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Price Range ($/hr)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(e) => {
                      setMinPrice(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(e) => {
                      setMaxPrice(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                </div>
              </div>

              {/* Amenities */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Amenity
                </label>
                <select
                  value={amenityFilter}
                  onChange={(e) => {
                    setAmenityFilter(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="">Any amenity</option>
                  {amenityOptions.map((amenity) => (
                    <option key={amenity.id} value={amenity.id}>
                      {amenity.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Unique Feature Tags */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-yellow-500" />
                  Standout Feature
                </label>
                <select
                  value={featureTagFilter}
                  onChange={(e) => {
                    setFeatureTagFilter(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="">Any standout feature</option>
                  {getUniqueFeatureTagOptions().map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Venue Grid */}
        <div className="lg:col-span-3">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                placeholder="Search venues..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-10"
              />
            </div>
          </div>

          {/* Results Count */}
          <div className="mb-4 text-sm text-muted-foreground">
            {filteredVenues.length} venue{filteredVenues.length !== 1 ? 's' : ''} found
          </div>

          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                <p className="text-muted-foreground">Loading venues...</p>
              </div>
            </div>
          ) : paginatedVenues.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Building2 className="h-12 w-12 text-muted-foreground/60 mb-4" />
                <p className="text-muted-foreground">No venues found</p>
                <Button variant="outline" onClick={handleClearFilters} className="mt-4">
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Venue Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {paginatedVenues.map((venue) => (
                  <VenueMarketplaceCard
                    key={venue.id}
                    venue={venue}
                    amenities={Array.from(venueAmenityMap[venue.id] || [])
                      .map((amenityId) => amenityNameById.get(amenityId))
                      .filter((name): name is string => Boolean(name))}
                    onSave={() => handleToggleSaved(venue.id, false)}
                    onViewProfile={() => {
                      window.location.href = `/planner/venues/${venue.id}`
                    }}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface VenueMarketplaceCardProps {
  venue: Venue
  amenities: string[]
  onSave: () => void
  onViewProfile: () => void
}

function VenueMarketplaceCard({ venue, amenities, onSave, onViewProfile }: VenueMarketplaceCardProps) {
  const rating = 4.7 // Mock data
  const reviewCount = 8 // Mock data
  const displayedAmenities = amenities.slice(0, 3)
  const remainingAmenityCount = Math.max(0, amenities.length - displayedAmenities.length)

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden" onClick={onViewProfile}>
      {/* Venue Thumbnail */}
      <div className="h-48 bg-gradient-to-br from-primary/80 to-primary relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <Building2 className="h-12 w-12 text-primary-foreground" />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSave()
          }}
          className="absolute top-2 right-2 text-white hover:text-destructive bg-black/20 rounded-full p-2"
        >
          <Heart className="h-5 w-5" />
        </button>
      </div>

      <CardHeader>
        <CardTitle className="text-lg">{venue.name}</CardTitle>
        <CardDescription className="flex items-center gap-1 mt-1">
          <MapPin className="h-3 w-3" />
          {venue.city && venue.state ? `${venue.city}, ${venue.state}` : venue.address}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground/60" />
            <span>{venue.capacity} capacity</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground/60" />
            <span>
              ${venue.hourly_rate || venue.daily_rate || 'N/A'}
              {venue.hourly_rate ? '/hr' : '/day'}
            </span>
          </div>
        </div>

        {venue.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{venue.description}</p>
        )}

        {(venue.unique_features || (venue.unique_features_tags?.length || 0) > 0) && (
          <div className="space-y-2 rounded-lg bg-yellow-500/10 p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              Venue Highlights
            </div>
            {venue.unique_features && (
              <p className="line-clamp-2 text-sm text-foreground">{venue.unique_features}</p>
            )}
            {(venue.unique_features_tags?.length || 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {venue.unique_features_tags?.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-yellow-500/30 bg-card/40 px-2 py-0.5 text-xs font-medium capitalize text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {displayedAmenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {displayedAmenities.map((amenity) => (
              <span
                key={amenity}
                className="rounded-md border border-border bg-sidebar-accent/40 px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {amenity}
              </span>
            ))}
            {remainingAmenityCount > 0 && (
              <span className="rounded-md border border-border bg-sidebar-accent/40 px-2 py-0.5 text-xs font-semibold text-primary">
                +{remainingAmenityCount} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-semibold">{rating}</span>
            <span className="text-sm text-muted-foreground">({reviewCount})</span>
          </div>
          {venue.is_verified && (
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-primary/15 text-primary">
              Verified
            </span>
          )}
        </div>

        <Button className="w-full" onClick={(e) => {
          e.stopPropagation()
          onViewProfile()
        }}>
          View Profile
        </Button>
      </CardContent>
    </Card>
  )
}
