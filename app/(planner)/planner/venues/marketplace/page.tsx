'use client'

import Link from 'next/link'
import { VenueMarketplace } from '@/components/builder/VenueMarketplace'

/**
 * Venue catalog route within the planner shell.
 */
export default function VenueMarketplacePage() {
  return (
    <div className="space-y-4 px-6 py-6">
      <Link href="/planner/venues" className="text-sm font-medium text-ink-soft hover:text-ink">
        ← Venues
      </Link>
      <VenueMarketplace />
    </div>
  )
}
