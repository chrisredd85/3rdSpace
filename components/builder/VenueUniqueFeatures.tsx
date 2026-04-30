'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Tag } from 'lucide-react'

interface VenueUniqueFeaturesProps {
  venueId: string
  compact?: boolean
}

interface UniqueFeaturesResponse {
  unique_features?: string
  unique_features_tags?: string[]
  error?: string
}

/**
 * Displays a venue's standout features and extracted searchable tags.
 *
 * @param props - Venue id and optional compact layout flag.
 * @returns Unique features section or null when empty.
 */
export function VenueUniqueFeatures({ venueId, compact = false }: VenueUniqueFeaturesProps) {
  const [features, setFeatures] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    /**
     * Loads public unique features for this venue.
     */
    async function loadFeatures() {
      setLoading(true)
      try {
        const response = await fetch(`/api/venue/unique-features?venueId=${venueId}`)
        const data = (await response.json()) as UniqueFeaturesResponse

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load unique features')
        }

        setFeatures(data.unique_features || '')
        setTags(data.unique_features_tags || [])
      } catch (error) {
        console.error('[VenueUniqueFeatures] Failed to load features', error)
      } finally {
        setLoading(false)
      }
    }

    loadFeatures()
  }, [venueId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading highlights...
      </div>
    )
  }

  if (!features && tags.length === 0) return null

  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-yellow-500" />
        <h3 className={compact ? 'text-sm font-bold text-foreground' : 'text-xl font-bold text-foreground'}>
          What Makes This Venue Special
        </h3>
      </div>

      {features ? (
        <div className={compact ? 'rounded-lg bg-yellow-500/10 p-3' : 'rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-5'}>
          <p className={compact ? 'line-clamp-3 text-sm leading-relaxed text-foreground' : 'whitespace-pre-wrap leading-relaxed text-foreground'}>
            {features}
          </p>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="space-y-2">
          {!compact ? (
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Key Features</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-card/40 px-2.5 py-1 text-xs font-medium capitalize text-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
