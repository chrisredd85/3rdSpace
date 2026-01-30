'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Heart,
  Star,
  Search,
  MapPin,
  Package,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSavedVendors, useToggleSavedVendor } from '@/lib/hooks/useVendors'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import type { Vendor } from '@/lib/types'

export default function SavedVendorsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const userId = user?.id || null
  const { data: savedVendors = [], isLoading } = useSavedVendors(userId)
  const toggleSaved = useToggleSavedVendor()
  const { addToast } = useToast()
  const router = useRouter()

  // Loading and error handling
  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Please log in to continue</div>
      </div>
    )
  }

  // Calculate stats
  const stats = useMemo(() => {
    const totalVendors = savedVendors.length
    // Mock data - would fetch from bookings
    const totalBookings = savedVendors.length * 2.5 // Average bookings per vendor
    const avgRating = savedVendors.length > 0
      ? savedVendors.reduce((sum, sv) => {
          // Mock rating - would come from reviews
          return sum + 4.5
        }, 0) / savedVendors.length
      : 0

    return {
      savedVendors: totalVendors,
      totalBookings: Math.round(totalBookings),
      avgRating: avgRating.toFixed(1),
    }
  }, [savedVendors])

  const handleToggleSaved = async (vendorId: string, isSaved: boolean) => {
    if (!userId) return

    try {
      await toggleSaved.mutateAsync({
        userId,
        vendorId,
        isSaved,
      })
      addToast({
        title: isSaved ? 'Removed from saved' : 'Saved vendor',
        description: isSaved
          ? 'Vendor removed from your saved list'
          : 'Vendor added to your saved list',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to update saved vendor',
        variant: 'destructive',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading vendors...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Saved Vendors</h1>
          <p className="text-gray-600 mt-1">Manage your favorite vendors and book them again</p>
        </div>
        <Button onClick={() => router.push('/builder/vendors/marketplace')}>
          <Search className="h-4 w-4 mr-2" />
          Find New Vendors
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saved Vendors</CardTitle>
            <Heart className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.savedVendors}</div>
            <p className="text-xs text-gray-500">In your list</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bookings</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBookings}</div>
            <p className="text-xs text-gray-500">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Rating</CardTitle>
            <Star className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgRating}</div>
            <p className="text-xs text-gray-500">Out of 5.0</p>
          </CardContent>
        </Card>
      </div>

      {/* Vendor Cards Grid */}
      {savedVendors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Heart className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">No saved vendors yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Start exploring the vendor marketplace to find vendors for your events
            </p>
            <Button onClick={() => router.push('/builder/vendors/marketplace')}>
              <Search className="h-4 w-4 mr-2" />
              Browse Vendors
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {savedVendors.map((savedVendor) => {
            const vendor = (savedVendor as any).vendors as Vendor
            if (!vendor) return null

            return (
              <VendorCard
                key={savedVendor.id}
                vendor={vendor}
                onViewProfile={() => router.push(`/builder/vendors/${vendor.id}`)}
                onBookAgain={() => router.push(`/builder/event/new?vendor=${vendor.id}`)}
                onToggleSaved={() => handleToggleSaved(vendor.id, true)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface VendorCardProps {
  vendor: Vendor
  onViewProfile: () => void
  onBookAgain: () => void
  onToggleSaved: () => void
}

function VendorCard({ vendor, onViewProfile, onBookAgain, onToggleSaved }: VendorCardProps) {
  // Mock data - would fetch from reviews and bookings
  const rating = 4.5
  const timesUsed = 3
  const serviceArea = vendor.city && vendor.state
    ? `${vendor.city}, ${vendor.state}`
    : 'Multiple areas'

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-forest-400 to-forest-600 flex items-center justify-center text-white font-semibold text-lg">
              {vendor.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-lg">{vendor.business_name || vendor.name}</CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <Package className="h-3 w-3" />
                {vendor.service_type}
              </CardDescription>
            </div>
          </div>
          <button
            onClick={onToggleSaved}
            className="text-red-500 hover:text-red-600"
          >
            <Heart className="h-5 w-5 fill-current" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Location */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MapPin className="h-4 w-4" />
          <span>{serviceArea}</span>
        </div>

        {/* Rating and Usage */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-semibold">{rating}</span>
            <span className="text-sm text-gray-500">(12 reviews)</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <Users className="h-4 w-4" />
            <span>Used {timesUsed} times</span>
          </div>
        </div>

        {/* Description */}
        {vendor.description && (
          <p className="text-sm text-gray-600 line-clamp-2">{vendor.description}</p>
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
