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
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVenues, useToggleSavedVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
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
    return filterObj
  }, [venueType, neighborhood, minCapacity, maxCapacity, minPrice, maxPrice])

  const { data: venuesResult, isLoading } = useVenues(filters, { 
    page: currentPage - 1, 
    pageSize: itemsPerPage 
  })
  // Handle both paginated and non-paginated responses
  const venues = Array.isArray(venuesResult) 
    ? venuesResult 
    : venuesResult?.data || []

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
          v.address.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [venues, searchQuery])

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
    setCurrentPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Venue Marketplace</h2>
          <p className="text-gray-600 mt-1">Find the perfect venue for your events</p>
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
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Venue Type
                </label>
                <select
                  value={venueType}
                  onChange={(e) => {
                    setVenueType(e.target.value as VenueType | 'all')
                    setCurrentPage(1)
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                <label className="text-sm font-medium text-gray-700 mb-2 block">
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
                <label className="text-sm font-medium text-gray-700 mb-2 block">
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
                <label className="text-sm font-medium text-gray-700 mb-2 block">
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
            </CardContent>
          </Card>
        </div>

        {/* Venue Grid */}
        <div className="lg:col-span-3">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
          <div className="mb-4 text-sm text-gray-600">
            {filteredVenues.length} venue{filteredVenues.length !== 1 ? 's' : ''} found
          </div>

          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
                <p className="text-gray-600">Loading venues...</p>
              </div>
            </div>
          ) : paginatedVenues.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Building2 className="h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-600">No venues found</p>
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
                    onSave={() => handleToggleSaved(venue.id, false)}
                    onViewProfile={() => {
                      window.location.href = `/builder/venues/${venue.id}`
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
                  <span className="text-sm text-gray-600">
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
  onSave: () => void
  onViewProfile: () => void
}

function VenueMarketplaceCard({ venue, onSave, onViewProfile }: VenueMarketplaceCardProps) {
  const rating = 4.7 // Mock data
  const reviewCount = 8 // Mock data

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden" onClick={onViewProfile}>
      {/* Venue Thumbnail */}
      <div className="h-48 bg-gradient-to-br from-forest-400 to-forest-600 relative">
        <div className="absolute inset-0 flex items-center justify-center text-4xl">
          🏢
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSave()
          }}
          className="absolute top-2 right-2 text-white hover:text-red-500 bg-black/20 rounded-full p-2"
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
            <Users className="h-4 w-4 text-gray-400" />
            <span>{venue.capacity} capacity</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-gray-400" />
            <span>
              ${venue.hourly_rate || venue.daily_rate || 'N/A'}
              {venue.hourly_rate ? '/hr' : '/day'}
            </span>
          </div>
        </div>

        {venue.description && (
          <p className="text-sm text-gray-600 line-clamp-2">{venue.description}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-semibold">{rating}</span>
            <span className="text-sm text-gray-500">({reviewCount})</span>
          </div>
          {venue.is_verified && (
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-forest-100 text-forest-700">
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
