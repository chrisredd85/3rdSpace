'use client'

import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import {
  Accessibility,
  Armchair,
  ArrowUp,
  Car,
  DoorOpen,
  Flame,
  Layout,
  Loader2,
  Mic,
  Music,
  Package,
  Sofa,
  Sun,
  Train,
  Trees,
  Truck,
  Tv,
  Utensils,
  Video,
  Volume2,
  Wifi,
  Wind,
  Wine,
} from 'lucide-react'

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  wifi: Wifi,
  'volume-2': Volume2,
  mic: Mic,
  music: Music,
  layout: Layout,
  utensils: Utensils,
  wine: Wine,
  package: Package,
  'door-open': DoorOpen,
  armchair: Armchair,
  sofa: Sofa,
  trees: Trees,
  sun: Sun,
  wind: Wind,
  flame: Flame,
  car: Car,
  train: Train,
  accessibility: Accessibility,
  'arrow-up': ArrowUp,
  truck: Truck,
  video: Video,
  tv: Tv,
  projector: Layout,
}

type SelectedAmenity = {
  id: string
  amenity_name?: string | null
  custom_amenity_name?: string | null
  venue_amenity_types?: {
    name?: string | null
    icon?: string | null
  } | null
}

interface VenueAmenitiesBadgesProps {
  venueId: string
  maxDisplay?: number
}

/**
 * Returns a display name for standard and custom venue amenities.
 *
 * @param amenity - Selected amenity API row.
 * @returns Human-readable amenity name.
 */
function getAmenityName(amenity: SelectedAmenity) {
  return (
    amenity.custom_amenity_name ||
    amenity.venue_amenity_types?.name ||
    amenity.amenity_name ||
    'Amenity'
  )
}

/**
 * Returns the icon component for an amenity row.
 *
 * @param amenity - Selected amenity API row.
 * @returns Lucide icon component.
 */
function getAmenityIcon(amenity: SelectedAmenity) {
  return ICON_MAP[amenity.venue_amenity_types?.icon || 'package'] || Package
}

/**
 * Displays selected venue amenities as compact icon badges.
 *
 * @param props - Venue id and max number of badges to show before expansion.
 * @returns Amenity badge list with optional show-all control.
 */
export function VenueAmenitiesBadges({ venueId, maxDisplay = 5 }: VenueAmenitiesBadgesProps) {
  const [amenities, setAmenities] = useState<SelectedAmenity[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads selected amenities for badge display.
     */
    async function loadAmenities() {
      setLoading(true)
      try {
        const response = await fetch(`/api/venue/amenities?venueId=${venueId}`)
        const data = await response.json()

        if (isMounted) {
          setAmenities((data.selected || []) as SelectedAmenity[])
        }
      } catch (error) {
        console.error('[VenueAmenitiesBadges] Failed to load amenities', error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadAmenities()

    return () => {
      isMounted = false
    }
  }, [venueId])

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Amenities
      </div>
    )
  }

  if (amenities.length === 0) return null

  const displayAmenities = showAll ? amenities : amenities.slice(0, maxDisplay)
  const remaining = amenities.length - maxDisplay

  return (
    <div className="flex flex-wrap gap-2">
      {displayAmenities.map((amenity) => {
        const Icon = getAmenityIcon(amenity)
        const name = getAmenityName(amenity)

        return (
          <div
            key={amenity.id}
            className="flex items-center gap-1.5 rounded-lg bg-sidebar-accent/40 px-2.5 py-1.5"
            title={name}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{name}</span>
          </div>
        )
      })}

      {!showAll && remaining > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setShowAll(true)
          }}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:text-primary"
        >
          +{remaining} more
        </button>
      ) : null}
    </div>
  )
}
