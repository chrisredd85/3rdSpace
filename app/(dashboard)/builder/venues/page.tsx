'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Heart,
  Star,
  Search,
  MapPin,
  Users,
  DollarSign,
  TrendingUp,
  Building2,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSavedVenues, useToggleSavedVenue } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import type { Venue } from '@/lib/types'

export default function SavedVenuesPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const userId = user?.id || null
  const { data: savedVenues = [], isLoading } = useSavedVenues(userId)
  const toggleSaved = useToggleSavedVenue()
  const { addToast } = useToast()
  const router = useRouter()

  const stats = useMemo(() => {
    const totalVenues = savedVenues.length
    // Mock data - would fetch from bookings
    const totalBookings = savedVenues.length * 1.8 // Average bookings per venue
    const avgRating = savedVenues.length > 0
      ? savedVenues.reduce((sum, sv) => {
          // Mock rating - would come from reviews
          return sum + 4.7
        }, 0) / savedVenues.length
      : 0

    return {
      savedVenues: totalVenues,
      totalBookings: Math.round(totalBookings),
      avgRating: avgRating.toFixed(1),
    }
  }, [savedVenues])

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">Please log in to continue</div>
      </div>
    )
  }

  const handleToggleSaved = async (venueId: string, isSaved: boolean) => {
    if (!userId) return

    try {
      await toggleSaved.mutateAsync({
        userId,
        venueId,
        isSaved,
      })
      addToast({
        title: isSaved ? 'Removed from saved' : 'Saved venue',
        description: isSaved
          ? 'Venue removed from your saved list'
          : 'Venue added to your saved list',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update saved venue',
        variant: 'destructive',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading venues...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Saved Venues</h1>
          <p className="text-muted-foreground mt-1">Manage your favorite venues and book them again</p>
        </div>
        <Button onClick={() => router.push('/builder/venues/marketplace')}>
          <Search className="h-4 w-4 mr-2" />
          Find New Venues
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saved Venues</CardTitle>
            <Heart className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.savedVenues}</div>
            <p className="text-xs text-muted-foreground">In your list</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bookings</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBookings}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Rating</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgRating}</div>
            <p className="text-xs text-muted-foreground">Out of 5.0</p>
          </CardContent>
        </Card>
      </div>

      {/* Venue Cards Grid */}
      {savedVenues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground/60 mb-4" />
            <p className="text-muted-foreground mb-2">No saved venues yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Start exploring the venue marketplace to find venues for your events
            </p>
            <Button onClick={() => router.push('/builder/venues/marketplace')}>
              <Search className="h-4 w-4 mr-2" />
              Browse Venues
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {savedVenues.map((savedVenue) => {
            const venue = (savedVenue as any).venues as Venue
            if (!venue) return null

            return (
              <VenueCard
                key={savedVenue.id}
                venue={venue}
                onViewProfile={() => router.push(`/builder/venues/${venue.id}`)}
                onBookAgain={() => router.push(`/builder/event/new?venue=${venue.id}`)}
                onToggleSaved={() => handleToggleSaved(venue.id, true)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface VenueCardProps {
  venue: Venue
  onViewProfile: () => void
  onBookAgain: () => void
  onToggleSaved: () => void
}

function VenueCard({ venue, onViewProfile, onBookAgain, onToggleSaved }: VenueCardProps) {
  // Mock data - would fetch from reviews and bookings
  const rating = 4.7
  const timesBooked = 2
  const location = venue.city && venue.state
    ? `${venue.city}, ${venue.state}`
    : venue.address || 'Location TBD'

  return (
    <Card className="hover:shadow-lg transition-shadow overflow-hidden">
      {/* Venue Thumbnail */}
      <div className="h-48 bg-gradient-to-br from-primary/80 to-primary relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <Building2 className="h-12 w-12 text-primary-foreground" />
        </div>
        <button
          onClick={onToggleSaved}
          className="absolute top-2 right-2 text-white hover:text-destructive bg-black/20 rounded-full p-2"
        >
          <Heart className="h-5 w-5 fill-current" />
        </button>
      </div>

      <CardHeader>
        <CardTitle className="text-lg">{venue.name}</CardTitle>
        <CardDescription className="flex items-center gap-1 mt-1">
          <MapPin className="h-3 w-3" />
          {location}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Capacity:</span>
            <span className="ml-2 font-semibold">{venue.capacity}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Rate:</span>
            <span className="ml-2 font-semibold">
              ${venue.hourly_rate || venue.daily_rate || 'N/A'}
              {venue.hourly_rate ? '/hr' : '/day'}
            </span>
          </div>
        </div>

        {/* Rating and Usage */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-semibold">{rating}</span>
            <span className="text-sm text-muted-foreground">(8 reviews)</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>Booked {timesBooked} times</span>
          </div>
        </div>

        {/* Description */}
        {venue.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{venue.description}</p>
        )}

        {(venue.unique_features || (venue.unique_features_tags?.length || 0) > 0) && (
          <div className="space-y-2 rounded-lg bg-yellow-500/10 p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              Venue Highlights
            </div>
            {venue.unique_features && (
              <p className="line-clamp-2 text-sm text-foreground">{venue.unique_features}</p>
            )}
            {(venue.unique_features_tags?.length || 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {venue.unique_features_tags?.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-yellow-500/30 bg-card/40 px-2 py-0.5 text-xs font-medium capitalize text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onViewProfile}
          >
            View Profile
          </Button>
          <Button
            className="flex-1"
            onClick={onBookAgain}
          >
            Book Again
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
