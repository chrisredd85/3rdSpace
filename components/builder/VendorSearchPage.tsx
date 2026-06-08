'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Filter, Loader2, Search, Star } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useSavedVendors, useToggleSavedVendor } from '@/lib/hooks/useVendors'
import { useUser } from '@/lib/hooks/useUser'
import { VendorCard } from '@/components/builder/VendorCard'
import { ServiceSelectionModal } from '@/components/builder/ServiceSelectionModal'
import type { VendorDiscoveryResult, VendorSearchSort } from '@/lib/vendors/discovery'

type ServiceFilter = 'all' | 'dj' | 'catering' | 'bartending' | 'photography' | 'videography' | 'av_tech' | 'event_planning' | 'florist' | 'other'

const SERVICE_TYPES: Array<{ value: ServiceFilter; label: string }> = [
  { value: 'all', label: 'All Services' },
  { value: 'dj', label: 'DJ' },
  { value: 'catering', label: 'Catering' },
  { value: 'bartending', label: 'Bartending' },
  { value: 'photography', label: 'Photography' },
  { value: 'videography', label: 'Videography' },
  { value: 'av_tech', label: 'AV / Tech' },
  { value: 'event_planning', label: 'Event Planning' },
  { value: 'florist', label: 'Florist' },
  { value: 'other', label: 'Other' },
]

interface SearchResponse {
  vendors?: VendorDiscoveryResult[]
  error?: string
}

/**
 * Builder-facing vendor marketplace search page.
 *
 * @returns Vendor search experience with filters and result grid.
 */
export function VendorSearchPage() {
  const { user } = useUser()
  const { addToast } = useToast()
  const toggleSaved = useToggleSavedVendor()
  const { data: savedVendors = [] } = useSavedVendors(user?.id || null)

  const [query, setQuery] = useState('')
  const [type, setType] = useState<ServiceFilter>('all')
  const [date, setDate] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [minRating, setMinRating] = useState('')
  const [sort, setSort] = useState<VendorSearchSort>('rating')
  const [vendors, setVendors] = useState<VendorDiscoveryResult[]>([])
  const [featured, setFeatured] = useState<VendorDiscoveryResult[]>([])
  const [selectedVendor, setSelectedVendor] = useState<VendorDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const savedIds = useMemo(
    () => new Set(savedVendors.map((saved) => saved.vendor_id)),
    [savedVendors]
  )

  const searchVendors = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('query', query.trim())
      if (type !== 'all') params.set('type', type)
      if (date) params.set('date', date)
      if (maxPrice) params.set('maxPrice', maxPrice)
      if (minRating) params.set('minRating', minRating)
      params.set('sort', sort)

      const response = await fetch(`/api/vendors/search?${params.toString()}`, { signal })
      const data = (await response.json()) as SearchResponse

      if (!response.ok) throw new Error(data.error || 'Failed to search vendors')
      setVendors(data.vendors || [])
    } catch (searchError) {
      if (signal?.aborted) return
      setError(searchError instanceof Error ? searchError.message : 'Failed to search vendors')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [date, maxPrice, minRating, query, sort, type])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      searchVendors(controller.signal)
    }, 300)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [searchVendors])

  useEffect(() => {
    let isMounted = true

    /**
     * Loads featured vendors for the empty/default state.
     */
    async function loadFeatured() {
      try {
        const response = await fetch('/api/vendors/featured?limit=6')
        const data = (await response.json()) as SearchResponse
        if (isMounted && response.ok) setFeatured(data.vendors || [])
      } catch (loadError) {
        console.error('[VendorSearchPage] Failed to load featured vendors', loadError)
      }
    }

    loadFeatured()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSave = useCallback(async (vendor: VendorDiscoveryResult) => {
    if (!user?.id) {
      addToast({
        title: 'Sign in required',
        description: 'Create or sign into a builder account to save vendors.',
        variant: 'destructive',
      })
      return
    }

    const isSaved = savedIds.has(vendor.id)
    try {
      await toggleSaved.mutateAsync({ userId: user.id, vendorId: vendor.id, isSaved })
      addToast({
        title: isSaved ? 'Removed from saved' : 'Vendor saved',
        description: isSaved ? 'Vendor removed from your saved list.' : 'Vendor added to your saved list.',
      })
    } catch (saveError) {
      addToast({
        title: 'Could not update saved vendor',
        description: saveError instanceof Error ? saveError.message : 'Please try again.',
        variant: 'destructive',
      })
    }
  }, [addToast, savedIds, toggleSaved, user?.id])

  const handleViewVendor = useCallback((vendor: VendorDiscoveryResult) => {
    window.location.href = `/planner/vendors/${vendor.id}`
  }, [])

  const handleBookVendor = useCallback((vendor: VendorDiscoveryResult) => {
    setSelectedVendor(vendor)
  }, [])

  const clearFilters = () => {
    setQuery('')
    setType('all')
    setDate('')
    setMaxPrice('')
    setMinRating('')
    setSort('rating')
  }

  const showFeatured = !query && type === 'all' && !date && !maxPrice && !minRating && featured.length > 0
  const resultVendors = vendors

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Find Vendors</h1>
        <p className="mt-1 text-muted-foreground">Search available vendors by service, date, price, and rating.</p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px_150px_140px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendors, services, or keywords" className="pl-10" />
            </div>
            <select value={type} onChange={(event) => setType(event.target.value as ServiceFilter)} className="h-11 rounded-md border border-border px-3 text-sm">
              {SERVICE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="pl-10" />
            </div>
            <Input type="number" min={0} value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Max price" />
            <select value={sort} onChange={(event) => setSort(event.target.value as VendorSearchSort)} className="h-11 rounded-md border border-border px-3 text-sm">
              <option value="rating">Top rated</option>
              <option value="price">Lowest price</option>
              <option value="popularity">Most booked</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Star className="h-4 w-4 text-yellow-500" />
              Min rating
              <select value={minRating} onChange={(event) => setMinRating(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm">
                <option value="">Any</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
                <option value="4.5">4.5+</option>
              </select>
            </label>
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              <Filter className="mr-2 h-4 w-4" />
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {showFeatured ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">Featured Vendors</h2>
            <p className="text-sm text-muted-foreground">A quick look at strong vendor matches.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((vendor) => (
              <VendorCard
                key={vendor.id}
                vendor={vendor}
                isSaved={savedIds.has(vendor.id)}
                onSave={handleSave}
                onView={handleViewVendor}
                onBook={handleBookVendor}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">Search Results</h2>
          <p className="text-sm text-muted-foreground">{resultVendors.length} vendor{resultVendors.length === 1 ? '' : 's'} found</p>
        </div>

        {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Searching vendors...
          </div>
        ) : resultVendors.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="font-semibold text-foreground">No vendors match these filters.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try changing the service type, date, or price range.</p>
              <Button type="button" variant="outline" className="mt-4" onClick={clearFilters}>Reset Search</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {resultVendors.map((vendor) => (
              <VendorCard
                key={vendor.id}
                vendor={vendor}
                isSaved={savedIds.has(vendor.id)}
                onSave={handleSave}
                onView={handleViewVendor}
                onBook={handleBookVendor}
              />
            ))}
          </div>
        )}
      </section>

      {selectedVendor ? (
        <ServiceSelectionModal vendor={selectedVendor} onClose={() => setSelectedVendor(null)} />
      ) : null}
    </div>
  )
}
