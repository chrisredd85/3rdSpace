'use client'

import type { VendorAvailabilityStatus } from '@/lib/types'

const LEGEND_ITEMS: Array<{ status: VendorAvailabilityStatus; label: string; className: string }> = [
  { status: 'available', label: 'Available', className: 'bg-card/40 border-border' },
  { status: 'tentative', label: 'Tentative', className: 'bg-yellow-500/15 border-yellow-500/30' },
  { status: 'booked', label: 'Booked', className: 'bg-primary/15 border-primary/80' },
  { status: 'blocked', label: 'Blocked', className: 'bg-destructive/15 border-red-300' },
]

/**
 * Explains vendor availability calendar statuses.
 *
 * @returns Availability legend UI.
 */
export function AvailabilityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium text-foreground">Legend:</span>
      {LEGEND_ITEMS.map((item) => (
        <div key={item.status} className="flex items-center gap-2">
          <span className={`h-4 w-4 rounded border ${item.className}`} />
          <span className="text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

