'use client'

import type { VendorAvailabilityStatus } from '@/lib/types'

const LEGEND_ITEMS: Array<{ status: VendorAvailabilityStatus; label: string; className: string }> = [
  { status: 'available', label: 'Available', className: 'bg-cream/40 border-tan' },
  { status: 'tentative', label: 'Tentative', className: 'bg-ochre-tint border-ochre/30' },
  { status: 'booked', label: 'Booked', className: 'bg-clay/15 border-clay/80' },
  { status: 'blocked', label: 'Blocked', className: 'bg-brick/15 border-brick/30' },
]

/**
 * Explains vendor availability calendar statuses.
 *
 * @returns Availability legend UI.
 */
export function AvailabilityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium text-ink">Legend:</span>
      {LEGEND_ITEMS.map((item) => (
        <div key={item.status} className="flex items-center gap-2">
          <span className={`h-4 w-4 rounded border ${item.className}`} />
          <span className="text-ink-soft">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

