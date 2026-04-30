'use client'

import { Heart, MapPin, Package, Star, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VendorDiscoveryResult } from '@/lib/vendors/discovery'

interface VendorCardProps {
  vendor: VendorDiscoveryResult
  isSaved?: boolean
  onSave: (vendor: VendorDiscoveryResult) => void
  onView: (vendor: VendorDiscoveryResult) => void
  onBook: (vendor: VendorDiscoveryResult) => void
}

/**
 * Formats vendor starting price.
 *
 * @param amount - Price amount.
 * @returns Currency string or TBD.
 */
function formatVendorPrice(amount: number | null) {
  if (amount == null) return 'Price TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Displays a vendor preview card for builder search results.
 *
 * @param props - Vendor row and card actions.
 * @returns Vendor preview card.
 */
export function VendorCard({ vendor, isSaved = false, onSave, onView, onBook }: VendorCardProps) {
  const location = vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : vendor.address || 'Service area varies'
  const primaryService = vendor.services[0]

  return (
    <div className="rounded-lg border border-border bg-card/40 p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => onView(vendor)} className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white">
            {(vendor.business_name || vendor.name || 'V').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-foreground">{vendor.business_name || vendor.name}</h3>
            <p className="mt-1 flex items-center gap-1 text-sm capitalize text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              {vendor.service_type.replace(/_/g, ' ')}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSave(vendor)}
          className={isSaved ? 'text-destructive' : 'text-muted-foreground/60 hover:text-destructive'}
          aria-label={isSaved ? 'Remove saved vendor' : 'Save vendor'}
        >
          <Heart className={isSaved ? 'h-5 w-5 fill-current' : 'h-5 w-5'} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-muted-foreground/60" />
          {location}
        </span>
        <span className="flex items-center gap-1.5">
          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          {vendor.rating > 0 ? vendor.rating.toFixed(1) : 'New'}
          {vendor.review_count > 0 ? ` (${vendor.review_count})` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground/60" />
          {vendor.total_bookings} booking{vendor.total_bookings === 1 ? '' : 's'}
        </span>
      </div>

      {vendor.description ? (
        <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{vendor.description}</p>
      ) : null}

      <div className="mt-4 rounded-md bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{primaryService?.name || 'Custom service'}</p>
            <p className="text-xs text-muted-foreground">
              {primaryService?.duration_hours ? `${primaryService.duration_hours} hours` : 'Duration varies'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold text-foreground">{formatVendorPrice(vendor.starting_price)}</p>
            <p className="text-xs text-muted-foreground">starting</p>
          </div>
        </div>
      </div>

      {vendor.is_available_on_date ? (
        <p className="mt-3 text-xs font-medium text-primary">Available for selected date</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={() => onView(vendor)}>
          Profile
        </Button>
        <Button type="button" className="flex-1" onClick={() => onBook(vendor)}>
          Select Service
        </Button>
      </div>
    </div>
  )
}
