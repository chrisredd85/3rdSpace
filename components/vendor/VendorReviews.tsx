'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageSquare, Star } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface VendorReview {
  id: string
  rating: number
  review_text: string | null
  reviewer_name: string
  reviewer_photo_url: string | null
  vendor_response: string | null
  response_date: string | null
  created_at: string
}

interface VendorReviewsProps {
  vendorId: string
  initialAverageRating?: number
  initialReviewCount?: number
}

interface VendorReviewsResponse {
  reviews?: VendorReview[]
  average_rating?: number
  review_count?: number
  error?: string
}

/**
 * Formats a review timestamp for display.
 *
 * @param value - ISO timestamp.
 * @returns Short localized date.
 */
function formatReviewDate(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

/**
 * Renders a readonly 5-star rating.
 *
 * @param props - Rating value.
 * @returns Star rating UI.
 */
function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, index) => {
        const filled = index < rating
        return (
          <Star
            key={index}
            className={filled ? 'h-4 w-4 fill-yellow-400 text-yellow-400' : 'h-4 w-4 text-muted-foreground/40'}
          />
        )
      })}
    </div>
  )
}

/**
 * Displays public post-event reviews for a vendor profile.
 *
 * @param props - Vendor id and optional initial rating summary.
 * @returns Vendor review summary and review list.
 */
export function VendorReviews({ vendorId, initialAverageRating = 0, initialReviewCount = 0 }: VendorReviewsProps) {
  const [reviews, setReviews] = useState<VendorReview[]>([])
  const [averageRating, setAverageRating] = useState(initialAverageRating)
  const [reviewCount, setReviewCount] = useState(initialReviewCount)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads public reviews for the vendor.
     */
    async function loadReviews() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/vendor/reviews?vendorId=${vendorId}`)
        const data = (await response.json()) as VendorReviewsResponse
        if (!response.ok) throw new Error(data.error || 'Failed to load reviews')
        if (!isMounted) return
        setReviews(data.reviews || [])
        setAverageRating(data.average_rating ?? 0)
        setReviewCount(data.review_count ?? 0)
      } catch (loadError) {
        if (isMounted) setError(loadError instanceof Error ? loadError.message : 'Failed to load reviews')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadReviews()

    return () => {
      isMounted = false
    }
  }, [vendorId])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading reviews...
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <MessageSquare className="h-5 w-5 text-primary" />
              Reviews
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Post-event feedback from builders.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="font-bold text-foreground">{averageRating > 0 ? averageRating.toFixed(1) : 'New'}</span>
            <span className="text-sm text-muted-foreground">({reviewCount})</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            This vendor does not have reviews yet.
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <article key={review.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{review.reviewer_name}</p>
                    <p className="text-xs text-muted-foreground">{formatReviewDate(review.created_at)}</p>
                  </div>
                  <StarRating rating={review.rating} />
                </div>

                {review.review_text ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{review.review_text}</p>
                ) : null}

                {review.vendor_response ? (
                  <div className="mt-4 rounded-lg bg-background p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendor response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{review.vendor_response}</p>
                    {review.response_date ? (
                      <p className="mt-2 text-xs text-muted-foreground">{formatReviewDate(review.response_date)}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
