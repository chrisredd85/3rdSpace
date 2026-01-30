'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, Calendar, DollarSign, TrendingUp, ArrowRight, Clock, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/shared/StatCard'
import { RequestCard } from '@/components/shared/RequestCard'
import { QuickActionCard } from '@/components/shared/QuickActionCard'
import { useUser } from '@/lib/hooks/useUser'

interface VendorStats {
  newRequests: number
  confirmedGigs: number
  revenueMtd: number
  revenueChange?: number
  responseRate: number
}

export default function VendorDashboard() {
  const { user } = useUser()
  const router = useRouter()
  const [stats, setStats] = useState<VendorStats | null>(null)
  const [isStatsLoading, setIsStatsLoading] = useState(true)
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState<any[]>([])
  const [isRequestsLoading, setIsRequestsLoading] = useState(true)

  // Fetch stats and vendor ID
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      try {
        // Fetch stats (which will also help us know vendor exists)
        const statsResponse = await fetch('/api/vendor/stats', {
          credentials: 'include',
        })
        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          setStats(statsData)
        }

        // Fetch bookings to get vendor ID and requests
        const bookingsResponse = await fetch('/api/vendor/bookings?status=pending&limit=3', {
          credentials: 'include',
        })
        if (bookingsResponse.ok) {
          const bookingsData = await bookingsResponse.json()
          setPendingRequests(bookingsData.bookings || [])
        }
      } catch (error) {
        console.error('Error fetching vendor data:', error)
      } finally {
        setIsStatsLoading(false)
        setIsRequestsLoading(false)
      }
    }

    fetchData()
  }, [user])

  const displayRequests = useMemo(() => {
    return pendingRequests.slice(0, 3)
  }, [pendingRequests])

  const isLoading = isStatsLoading || isRequestsLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-lg text-slate-600 mt-2">Overview of your vendor business</p>
      </div>

      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="New Requests"
            value={stats?.newRequests ?? 0}
            icon={<Bell className="h-6 w-6" />}
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          />
          <StatCard
            label="Confirmed Gigs"
            value={stats?.confirmedGigs ?? 0}
            icon={<Calendar className="h-6 w-6" />}
            iconBgColor="bg-forest-100"
            iconColor="text-forest-600"
          />
          <StatCard
            label="This Month Revenue"
            value={`$${((stats?.revenueMtd ?? 0) / 1000).toFixed(1)}K`}
            change={stats?.revenueChange ? `${stats.revenueChange > 0 ? '+' : ''}${stats.revenueChange}%` : undefined}
            changeDirection={stats?.revenueChange && stats.revenueChange > 0 ? 'up' : 'down'}
            icon={<DollarSign className="h-6 w-6" />}
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            label="Response Rate"
            value={`${stats?.responseRate ?? 0}%`}
            icon={<TrendingUp className="h-6 w-6" />}
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          />
        </div>

        {/* Banner */}
        {stats && stats.newRequests > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
              <p className="text-sm sm:text-base text-yellow-800">
                <span className="font-semibold">{stats.newRequests} new requests waiting.</span>{' '}
                Respond within 24 hours to maintain your response rate.
              </p>
            </div>
          </div>
        )}

        {/* Recent Booking Requests */}
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Recent Booking Requests</h2>
              <p className="text-sm text-slate-600 mt-1">Latest booking requests for your services</p>
            </div>
            <Link href="/vendor/bookings">
              <Button variant="outline" size="sm" className="min-h-[44px]">
                View All Bookings
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="space-y-4">
            {displayRequests.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">No pending requests</p>
                  <p className="text-sm text-gray-500">
                    New booking requests will appear here
                  </p>
                </CardContent>
              </Card>
            ) : (
              displayRequests.map((booking: any) => {
                const event = booking.events as any
                const organizer = event?.profiles || event?.builder_id
                const venue = event?.venues
                
                return (
                  <RequestCard
                    key={booking.id}
                    title={event?.title || 'Event Booking Request'}
                    organizerName={organizer?.name || 'Organizer'}
                    organizerCompany={organizer?.company || undefined}
                    date={booking.confirmed_date || booking.requested_date || new Date().toISOString()}
                    time={booking.confirmed_start_time || booking.requested_start_time}
                    venueName={venue?.name}
                    revenue={booking.final_price || booking.quoted_price}
                    status={booking.status}
                    onClick={() => router.push(`/vendor/bookings?booking=${booking.id}`)}
                  />
                )
              })
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Quick Actions</h2>
            <p className="text-sm text-slate-600 mt-1">Get started with common tasks</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <QuickActionCard
              icon="📅"
              title="View Calendar"
              description="Manage your availability and bookings"
              href="/vendor/calendar"
            />
            <QuickActionCard
              icon="🎵"
              title="Update Services"
              description="Edit your service offerings and packages"
              href="/vendor/services"
            />
            <QuickActionCard
              icon="💰"
              title="Adjust Pricing"
              description="Update your rates and packages"
              href="/vendor/pricing"
            />
          </div>
        </div>
      </div>
    </>
  )
}

