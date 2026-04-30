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
  Plus,
  Sofa,
  Sun,
  Train,
  Trash2,
  Trees,
  Truck,
  Tv,
  Utensils,
  Video,
  Volume2,
  Wifi,
  Wind,
  Wine,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

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

const CATEGORY_LABELS: Record<string, string> = {
  av_equipment: 'AV Equipment',
  facilities: 'Facilities',
  furniture: 'Furniture',
  features: 'Features',
  access: 'Access & Parking',
  tech: 'Technology',
}

type AmenityType = {
  id: string
  name: string
  category: string
  icon: string
  description: string | null
}

type SelectedAmenity = {
  amenity_type_id: string | null
  custom_amenity_name: string | null
}

interface AmenitiesSelectorProps {
  venueId: string
  onSave?: (amenities: unknown[]) => void
}

/**
 * Loads the Lucide icon for a stored amenity icon key.
 *
 * @param icon - Icon key stored in the amenity master list.
 * @returns Lucide icon component, falling back to Package.
 */
function getAmenityIcon(icon: string | null | undefined) {
  return ICON_MAP[icon || 'package'] || Package
}

/**
 * Manages master-list and custom amenities for a venue owner.
 *
 * @param props - Venue id plus optional callback after save.
 * @returns Amenity selector UI grouped by category.
 */
export function AmenitiesSelector({ venueId, onSave }: AmenitiesSelectorProps) {
  const { addToast } = useToast()
  const [available, setAvailable] = useState<Record<string, AmenityType[]>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [customAmenities, setCustomAmenities] = useState<string[]>([])
  const [newCustom, setNewCustom] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  /**
   * Loads master amenity types and selected amenities for the venue.
   */
  async function loadAmenities() {
    setLoading(true)
    try {
      const response = await fetch(`/api/venue/amenities?venueId=${venueId}`, {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load amenities')
      }

      const selectedRows = (data.selected || []) as SelectedAmenity[]
      setAvailable((data.available || {}) as Record<string, AmenityType[]>)
      setSelected(
        selectedRows
          .filter((amenity) => amenity.amenity_type_id)
          .map((amenity) => amenity.amenity_type_id as string)
      )
      setCustomAmenities(
        selectedRows
          .filter((amenity) => amenity.custom_amenity_name)
          .map((amenity) => amenity.custom_amenity_name as string)
      )
    } catch (error) {
      console.error('[AmenitiesSelector] Failed to load amenities', error)
      addToast({
        title: 'Could not load amenities',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAmenities()
  }, [venueId])

  /**
   * Saves selected master-list and custom amenities for the venue.
   */
  async function handleSave() {
    setSaving(true)
    try {
      const response = await fetch('/api/venue/amenities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          venueId,
          amenityTypeIds: selected,
          customAmenities,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save amenities')
      }

      onSave?.(data.amenities || [])
      addToast({
        title: 'Amenities saved',
        description: 'Your venue amenities have been updated.',
      })
      await loadAmenities()
    } catch (error) {
      console.error('[AmenitiesSelector] Failed to save amenities', error)
      addToast({
        title: 'Could not save amenities',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Toggles a master-list amenity id in the selection.
   *
   * @param amenityId - Master amenity type id.
   */
  function toggleAmenity(amenityId: string) {
    setSelected((current) =>
      current.includes(amenityId)
        ? current.filter((id) => id !== amenityId)
        : [...current, amenityId]
    )
  }

  /**
   * Adds a custom amenity by name.
   */
  function addCustomAmenity() {
    const trimmedName = newCustom.trim()
    if (!trimmedName) return
    if (customAmenities.some((amenity) => amenity.toLowerCase() === trimmedName.toLowerCase())) {
      addToast({
        title: 'Amenity already added',
        description: 'Custom amenities should be unique.',
        variant: 'destructive',
      })
      return
    }

    setCustomAmenities((current) => [...current, trimmedName])
    setNewCustom('')
  }

  /**
   * Removes a custom amenity by index.
   *
   * @param index - Custom amenity index.
   */
  function removeCustomAmenity(index: number) {
    setCustomAmenities((current) => current.filter((_, amenityIndex) => amenityIndex !== index))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading amenities...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-foreground">Amenities & Features</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Select standard amenities or add custom features that make your venue stand out.
        </p>
      </div>

      {Object.entries(available).map(([category, amenities]) => (
        <section key={category} className="space-y-3">
          <h4 className="font-semibold text-foreground">
            {CATEGORY_LABELS[category] || category}
          </h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {amenities.map((amenity) => {
              const Icon = getAmenityIcon(amenity.icon)
              const isSelected = selected.includes(amenity.id)

              return (
                <button
                  key={amenity.id}
                  type="button"
                  onClick={() => toggleAmenity(amenity.id)}
                  className={`flex min-h-[76px] items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border'
                  }`}
                >
                  <div
                    className={`rounded-lg p-2 ${
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent/40 text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className={`text-sm font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    {amenity.name}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h4 className="font-semibold text-foreground">Custom Amenities</h4>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newCustom}
            onChange={(event) => setNewCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addCustomAmenity()
              }
            }}
            placeholder="Rooftop access, piano, green room..."
            className="min-h-[44px] flex-1 rounded-xl border-2 border-border px-4 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <Button type="button" onClick={addCustomAmenity}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        {customAmenities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {customAmenities.map((amenity, index) => (
              <div
                key={`${amenity}-${index}`}
                className="flex items-center gap-2 rounded-lg border-2 border-primary/30 bg-primary/10 px-3 py-2"
              >
                <span className="text-sm font-medium text-foreground">{amenity}</span>
                <button
                  type="button"
                  onClick={() => removeCustomAmenity(index)}
                  className="rounded-full text-primary hover:text-primary"
                  aria-label={`Remove ${amenity}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="button" onClick={loadAmenities} variant="outline" disabled={saving}>
          <Trash2 className="mr-2 h-4 w-4" />
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Amenities
        </Button>
      </div>
    </div>
  )
}
