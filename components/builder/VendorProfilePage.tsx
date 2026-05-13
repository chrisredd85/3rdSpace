'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, ExternalLink, Heart, Loader2, MapPin, Package, Star, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DepositDisplay } from '@/components/builder/DepositDisplay'
import { ServiceSelectionModal } from '@/components/builder/ServiceSelectionModal'
import { VendorReviews } from '@/components/vendor/VendorReviews'
import { useToast } from '@/components/ui/toast'
import { useSavedVendors, useToggleSavedVendor } from '@/lib/hooks/useVendors'
import { useUser } from '@/lib/hooks/useUser'
import type { VendorDiscoveryResult } from '@/lib/vendors/discovery'

interface VendorProfilePageProps {
  vendorId: string
}

interface VendorDetailResponse {
  vendor?: VendorDiscoveryResult
  error?: string
}

/**
 * Formats a service price.
 *
 * @param amount - Service price.
 * @returns Currency string.
 */
function formatPrice(amount: number | null) {
  if (amount == null) return 'Price TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Full builder-facing vendor profile page.
 *
 * @param props - Vendor id.
 * @returns Vendor profile with services and booking picker.
 */
export function VendorProfilePage({ vendorId }: VendorProfilePageProps) {
  const { user } = useUser()
  const { addToast } = useToast()
  const toggleSaved = useToggleSavedVendor()
  const { data: savedVendors = [] } = useSavedVendors(user?.id || null)
  const [vendor, setVendor] = useState<VendorDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showServicePicker, setShowServicePicker] = useState(false)

  const isSaved = useMemo(
    () => savedVendors.some((saved) => saved.vendor_id === vendorId),
    [savedVendors, vendorId]
  )

  useEffect(() => {
    let isMounted = true

    /**
     * Loads public vendor detail.
     */
    async function loadVendor() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/vendors/${vendorId}`)
        const data = (await response.json()) as VendorDetailResponse
        if (!response.ok) throw new Error(data.error || 'Failed to load vendor')
        if (isMounted) setVendor(data.vendor || null)
      } catch (loadError) {
        if (isMounted) setError(loadError instanceof Error ? loadError.message : 'Failed to load vendor')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadVendor()

    return () => {
      isMounted = false
    }
  }, [vendorId])

  const handleSave = async () => {
    if (!user?.id || !vendor) {
      addToast({
        title: 'Sign in required',
        description: 'Create or sign into a builder account to save vendors.',
        variant: 'destructive',
      })
      return
    }

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
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading vendor...
      </div>
    )
  }

  if (error || !vendor) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{error || 'Vendor not found.'}</CardContent>
      </Card>
    )
  }

  const location = vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : vendor.address || 'Service area varies'
  const services = Array.isArray(vendor.services) ? vendor.services : []
  const rating = Number(vendor.rating || 0)
  const reviewCount = Number(vendor.review_count || 0)
  const totalBookings = Number(vendor.total_bookings || 0)
  const bookingPath = `/planner/vendors/${vendor.id}?source=vendor_share`
  const bookingUrl = typeof window === 'undefined' ? bookingPath : `${window.location.origin}${bookingPath}`

  const handleCopyBookingLink = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl)
      addToast({
        title: 'Booking link copied',
        description: 'Share this link with hosts so they can request this vendor in their planner.',
      })
    } catch {
      addToast({
        title: 'Could not copy link',
        description: bookingUrl,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link href="/planner/vendors/marketplace">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to marketplace
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-white">
                {(vendor.business_name || vendor.name || 'V').charAt(0).toUpperCase()}
              </div>
              <div>
                <CardTitle className="text-3xl">{vendor.business_name || vendor.name}</CardTitle>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5 capitalize">
                    <Package className="h-4 w-4" />
                    {vendor.service_type.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {location}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    {rating > 0 ? rating.toFixed(1) : 'New'}
                    {reviewCount > 0 ? ` (${reviewCount})` : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    {totalBookings} bookings
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleSave}>
                <Heart className={isSaved ? 'mr-2 h-4 w-4 fill-current text-destructive' : 'mr-2 h-4 w-4'} />
                {isSaved ? 'Saved' : 'Save'}
              </Button>
              <Button type="button" variant="glass" onClick={handleCopyBookingLink}>
                <Copy className="h-4 w-4" />
                Copy booking link
              </Button>
              <Button type="button" onClick={() => setShowServicePicker(true)}>Request booking</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {vendor.description ? <p className="leading-relaxed text-foreground">{vendor.description}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-primary/25 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-xl">Book this vendor for your 3rdPlace event</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use this public link to start a planner request with this vendor attached. Nothing is contacted,
            charged, or held until the event host reviews and approves the plan.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{bookingUrl}</code>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="glass" size="sm" onClick={handleCopyBookingLink}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={bookingPath}>
                  <ExternalLink className="h-4 w-4" />
                  Open
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DepositDisplay vendorId={vendor.id} targetType="vendor" bookingCost={vendor.starting_price || 0} />

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Services</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose a service to start planning with this vendor.</p>
        </div>

        {services.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">This vendor has not published service listings yet.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {services.map((service) => {
              const equipmentIncluded = Array.isArray(service.equipment_included) ? service.equipment_included : []

              return (
                <button
                  key={`${service.type}-${service.id}`}
                  type="button"
                  onClick={() => setShowServicePicker(true)}
                  className="rounded-lg border border-border bg-card/40 p-5 text-left transition hover:border-primary/40 hover:bg-primary/10"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-bold text-foreground">{service.name}</p>
                      <p className="mt-1 text-sm capitalize text-muted-foreground">{service.service_category.replace(/_/g, ' ')}</p>
                    </div>
                    <p className="font-bold text-foreground">{formatPrice(service.base_price)}</p>
                  </div>
                  {service.description ? (
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{service.description}</p>
                  ) : null}
                  {equipmentIncluded.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {equipmentIncluded.slice(0, 5).map((item) => (
                        <span key={item} className="rounded-md bg-sidebar-accent/40 px-2 py-1 text-xs text-foreground">{item}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <VendorReviews
        vendorId={vendor.id}
        initialAverageRating={rating}
        initialReviewCount={reviewCount}
      />

      {showServicePicker ? (
        <ServiceSelectionModal vendor={vendor} onClose={() => setShowServicePicker(false)} />
      ) : null}
    </div>
  )
}
