'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface VendorReviewResponseFormProps {
  reviewId: string
  initialResponse?: string | null
  onSaved?: (response: string) => void
}

interface VendorReviewResponse {
  review?: unknown
  error?: string
}

/**
 * Lets a vendor respond publicly to a review.
 *
 * @param props - Review id, current response, and save callback.
 * @returns Vendor response form.
 */
export function VendorReviewResponseForm({ reviewId, initialResponse = '', onSaved }: VendorReviewResponseFormProps) {
  const { addToast } = useToast()
  const [responseText, setResponseText] = useState(initialResponse || '')
  const [saving, setSaving] = useState(false)

  /**
   * Persists the vendor response through the review response API.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)

    try {
      const response = await fetch(`/api/vendor/reviews/${reviewId}/respond`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: responseText }),
      })
      const data = (await response.json()) as VendorReviewResponse
      if (!response.ok) throw new Error(data.error || 'Failed to save response')

      addToast({
        title: 'Response saved',
        description: 'Your response is now visible on your vendor profile.',
        variant: 'success',
      })
      onSaved?.(responseText)
    } catch (saveError) {
      addToast({
        title: 'Could not save response',
        description: saveError instanceof Error ? saveError.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={responseText}
        onChange={(event) => setResponseText(event.target.value)}
        rows={4}
        maxLength={1200}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        placeholder="Thank the builder or add context for future clients."
        required
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{responseText.length}/1200 characters</p>
        <Button type="submit" disabled={saving || responseText.trim().length === 0} size="sm">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Response
        </Button>
      </div>
    </form>
  )
}
