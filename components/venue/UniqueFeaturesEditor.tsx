'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface UniqueFeaturesEditorProps {
  venueId: string
  onSave?: (features: string, tags: string[]) => void
}

interface UniqueFeaturesResponse {
  unique_features?: string
  unique_features_tags?: string[]
  extracted_tags?: string[]
  error?: string
}

const DRAFT_KEY_PREFIX = 'venue_unique_features_draft'

/**
 * Returns the local draft storage key for a venue.
 *
 * @param venueId - Venue id.
 * @returns Stable draft key.
 */
function getDraftKey(venueId: string) {
  return `${DRAFT_KEY_PREFIX}:${venueId}`
}

/**
 * Counts non-empty words in freeform text.
 *
 * @param text - Text to count.
 * @returns Word count.
 */
function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

/**
 * Lets venue owners describe standout venue features and preview extracted tags.
 *
 * @param props - Venue id plus optional save callback.
 * @returns Unique features editor UI.
 */
export function UniqueFeaturesEditor({ venueId, onSave }: UniqueFeaturesEditorProps) {
  const { addToast } = useToast()
  const [features, setFeatures] = useState('')
  const [lastSavedFeatures, setLastSavedFeatures] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)

  const charCount = features.length
  const wordCount = useMemo(() => countWords(features), [features])

  /**
   * Loads saved unique features and restores any unsaved local draft.
   */
  const loadFeatures = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/venue/unique-features?venueId=${venueId}`, {
        credentials: 'include',
      })
      const data = (await response.json()) as UniqueFeaturesResponse

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load unique features')
      }

      const savedFeatures = data.unique_features || ''
      const draft = window.localStorage.getItem(getDraftKey(venueId))
      setLastSavedFeatures(savedFeatures)
      setFeatures(draft ?? savedFeatures)
      setTags(data.unique_features_tags || [])
    } catch (error) {
      console.error('[UniqueFeaturesEditor] Error loading features', error)
      addToast({
        title: 'Could not load unique features',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, venueId])

  useEffect(() => {
    loadFeatures()
  }, [loadFeatures])

  useEffect(() => {
    if (loading || features === lastSavedFeatures) return

    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(getDraftKey(venueId), features)
      setDraftSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    }, 30000)

    return () => window.clearTimeout(timeout)
  }, [features, lastSavedFeatures, loading, venueId])

  /**
   * Saves unique features and clears the local draft.
   */
  async function handleSave() {
    setSaving(true)
    try {
      const response = await fetch('/api/venue/unique-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ venueId, uniqueFeatures: features }),
      })
      const data = (await response.json()) as UniqueFeaturesResponse

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save unique features')
      }

      const extractedTags = data.extracted_tags || []
      setTags(extractedTags)
      setLastSavedFeatures(features)
      window.localStorage.removeItem(getDraftKey(venueId))
      setDraftSavedAt(null)
      onSave?.(features, extractedTags)
      addToast({
        title: 'Unique features saved',
        description: 'Your venue highlights and search tags have been updated.',
      })
    } catch (error) {
      console.error('[UniqueFeaturesEditor] Error saving features', error)
      addToast({
        title: 'Could not save unique features',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading unique features...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Sparkles className="h-6 w-6 text-yellow-500" />
          What Makes Your Venue Unique?
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the details that help builders picture the experience, not just the room.
        </p>
      </div>

      <div className="space-y-2">
        <textarea
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
          placeholder="Historic brick building with exposed beams and original hardwood floors. Floor-to-ceiling windows provide natural light. Rooftop terrace with skyline views. In-house sound system and lighting rig. Walking distance from BART."
          rows={8}
          maxLength={3000}
          className="w-full resize-none rounded-md border border-border px-3 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />

        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{wordCount} words · {charCount} characters</span>
          <span className={charCount > 500 ? 'text-yellow-200' : ''}>
            {draftSavedAt ? `Draft autosaved at ${draftSavedAt}` : charCount > 500 ? 'Consider trimming for card readability.' : 'Specific details make better matches.'}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
        <p className="mb-2 font-semibold text-foreground">Writing Tips</p>
        <ul className="space-y-1 text-sm text-foreground">
          <li>Mention architectural features like exposed brick, high ceilings, or skylights.</li>
          <li>Call out technical amenities such as projectors, sound, and lighting.</li>
          <li>Describe ambiance, transit, parking, views, and event flow.</li>
        </ul>
      </div>

      {tags.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Auto-detected search tags</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium capitalize text-primary">
                {tag}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">These tags help builders find your venue in marketplace search.</p>
        </div>
      ) : null}

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={loadFeatures} disabled={saving}>
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Unique Features'
          )}
        </Button>
      </div>
    </div>
  )
}
