'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Search,
  Filter,
  Heart,
  MapPin,
  Package,
  DollarSign,
  Star,
  X,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useVendors, useToggleSavedVendor } from '@/lib/hooks/useVendors'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import type { Vendor, ServiceType } from '@/lib/types'

interface VendorMarketplaceProps {
  onClose?: () => void
}

export function VendorMarketplace({ onClose }: VendorMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [serviceType, setServiceType] = useState<ServiceType | 'all'>('all')
  const [serviceArea, setServiceArea] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12

  const { user } = useUser()
  const userId = user?.id || null
  const { addToast } = useToast()
  const toggleSaved = useToggleSavedVendor()

  // Build filters
  const filters = useMemo(() => {
    const filterObj: any = {}
    if (serviceType !== 'all') filterObj.service_type = serviceType
    if (serviceArea) {
      filterObj.city = serviceArea
    }
    return filterObj
  }, [serviceType, serviceArea])

  const { data: vendors = [], isLoading } = useVendors(filters)

  // Filter and search vendors
  const filteredVendors = useMemo(() => {
    let filtered = vendors

    // Search by name or description
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (v) =>
          v.name.toLowerCase().includes(query) ||
          v.business_name?.toLowerCase().includes(query) ||
          v.description?.toLowerCase().includes(query)
      )
    }

    // Price filter (simplified - would need pricing data)
    // This is a placeholder

    return filtered
  }, [vendors, searchQuery])

  // Pagination
  const totalPages = Math.ceil(filteredVendors.length / itemsPerPage)
  const paginatedVendors = filteredVendors.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )


  const handleToggleSaved = async (vendorId: string, isSaved: boolean) => {
    if (!userId) {
      addToast({
        title: 'Please sign in',
        description: 'You need to be signed in to save vendors',
        variant: 'destructive',
      })
      return
    }

    try {
      await toggleSaved.mutateAsync({
        userId,
        vendorId,
        isSaved,
      })
      addToast({
        title: isSaved ? 'Removed from saved' : 'Saved vendor',
        description: isSaved
          ? 'Vendor removed from your saved list'
          : 'Vendor added to your saved list',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update saved vendor',
        variant: 'destructive',
      })
    }
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setServiceType('all')
    setServiceArea('')
    setMinPrice('')
    setMaxPrice('')
    setCurrentPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Vendor Marketplace</h2>
          <p className="text-muted-foreground mt-1">Find vendors for your events</p>
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
              {/* Service Type */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Service Type
                </label>
                <select
                  value={serviceType}
                  onChange={(e) => {
                    setServiceType(e.target.value as ServiceType | 'all')
                    setCurrentPage(1)
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="all">All Services</option>
                  <option value="dj">DJ</option>
                  <option value="catering">Catering</option>
                  <option value="bartending">Bartending</option>
                  <option value="photography">Photography</option>
                  <option value="videography">Videography</option>
                  <option value="av_tech">AV/Tech</option>
                  <option value="event_planning">Event Planning</option>
                  <option value="florist">Florist</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Service Area */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Service Area
                </label>
                <Input
                  placeholder="City, State"
                  value={serviceArea}
                  onChange={(e) => {
                    setServiceArea(e.target.value)
                    setCurrentPage(1)
                  }}
                />
              </div>

              {/* Price Range */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Price Range
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

        {/* Vendor Grid */}
        <div className="lg:col-span-3">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                placeholder="Search vendors..."
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
            {filteredVendors.length} vendor{filteredVendors.length !== 1 ? 's' : ''} found
          </div>

          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                <p className="text-muted-foreground">Loading vendors...</p>
              </div>
            </div>
          ) : paginatedVendors.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground/60 mb-4" />
                <p className="text-muted-foreground">No vendors found</p>
                <Button variant="outline" onClick={handleClearFilters} className="mt-4">
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Vendor Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {paginatedVendors.map((vendor) => (
                  <VendorMarketplaceCard
                    key={vendor.id}
                    vendor={vendor}
                    onSave={() => handleToggleSaved(vendor.id, false)}
                    onViewProfile={() => {
                      // Navigate to vendor profile
                      window.location.href = `/builder/vendors/${vendor.id}`
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

interface VendorMarketplaceCardProps {
  vendor: Vendor
  onSave: () => void
  onViewProfile: () => void
}

function VendorMarketplaceCard({ vendor, onSave, onViewProfile }: VendorMarketplaceCardProps) {
  const rating = 4.5 // Mock data
  const reviewCount = 12 // Mock data

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={onViewProfile}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-white font-semibold text-lg">
              {vendor.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-lg">{vendor.business_name || vendor.name}</CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <Package className="h-3 w-3" />
                {vendor.service_type}
              </CardDescription>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSave()
            }}
            className="text-muted-foreground/60 hover:text-destructive"
          >
            <Heart className="h-5 w-5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <span>{vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : 'Multiple areas'}</span>
        </div>

        {vendor.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{vendor.description}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-semibold">{rating}</span>
            <span className="text-sm text-muted-foreground">({reviewCount})</span>
          </div>
          {vendor.is_verified && (
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
