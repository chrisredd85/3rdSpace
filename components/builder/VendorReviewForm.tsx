'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

interface VendorReviewFormProps {
  vendorBookingId: string
  vendorName?: string
  onSubmitted?: (review: unknown) => void
}

interface SubmitReviewResponse {
  review?: unknown
  error?: string
}

/**
 * Renders an interactive star picker.
 *
 * @param props - Rating state and change handler.
 * @returns Clickable 5-star control.
 */
function RatingInput({ rating, onChange }: { rating: number; onChange: (rating: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Review rating">
      {Array.from({ length: 5 }).map((_, index) => {
        const value = index + 1
        const filled = value <= rating
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className="rounded-md p-1 text-yellow-400 transition hover:bg-yellow-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
            aria-label={`${value} star${value === 1 ? '' : 's'}`}
            aria-checked={rating === value}
            role="radio"
          >
            <Star className={filled ? 'h-7 w-7 fill-yellow-400' : 'h-7 w-7 text-muted-foreground/40'} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * Lets a builder submit a post-event review for a completed vendor booking.
 *
 * The API enforces final eligibility, including ownership, completion, and one
 * review per booking. This form keeps the client interaction lightweight.
 *
 * @param props - Vendor booking id, optional vendor name, and submit callback.
 * @returns Builder review form.
 */
export function VendorReviewForm({ vendorBookingId, vendorName = 'this vendor', onSubmitted }: VendorReviewFormProps) {
  const { addToast } = useToast()
  const [rating, setRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /**
   * Submits the review to the vendor reviews API.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (rating < 1) {
      addToast({
        title: 'Rating required',
        description: 'Choose a star rating before submitting your review.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/vendor/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorBookingId,
          rating,
          reviewText,
        }),
      })
      const data = (await response.json()) as SubmitReviewResponse
      if (!response.ok) throw new Error(data.error || 'Failed to submit review')

      addToast({
        title: 'Review submitted',
        description: 'Thanks for helping other builders choose vendors with confidence.',
        variant: 'success',
      })
      setReviewText('')
      setRating(0)
      onSubmitted?.(data.review)
    } catch (submitError) {
      addToast({
        title: 'Could not submit review',
        description: submitError instanceof Error ? submitError.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Review {vendorName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Rating</label>
            <RatingInput rating={rating} onChange={setRating} />
          </div>

          <div className="space-y-2">
            <label htmlFor={`vendor-review-${vendorBookingId}`} className="text-sm font-semibold text-foreground">
              Written review
            </label>
            <textarea
              id={`vendor-review-${vendorBookingId}`}
              value={reviewText}
              onChange={(event) => setReviewText(event.target.value)}
              rows={5}
              minLength={1}
              maxLength={2000}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Share what went well, how the vendor communicated, and whether you would book them again."
              required
            />
            <p className="text-xs text-muted-foreground">{reviewText.length}/2000 characters</p>
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Review
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
