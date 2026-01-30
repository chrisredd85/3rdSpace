'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, Calendar, DollarSign, TrendingUp, ArrowRight, Check } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/shared/StatCard'
import { RequestCard } from '@/components/shared/RequestCard'
import { QuickActionCard } from '@/components/shared/QuickActionCard'
import { useUser } from '@/lib/hooks/useUser'

interface VenueStats {
  pendingRequests: number
  thisMonthBookings: number
  revenueMtd: number
  revenueChange?: number
  acceptanceRate: number
  bookedPercentage: number
}

export default function VenueDashboard() {
  const { user } = useUser()
  const router = useRouter()
  const [stats, setStats] = useState<VenueStats | null>(null)
  const [isStatsLoading, setIsStatsLoading] = useState(true)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [isRequestsLoading, setIsRequestsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      try {
        // Fetch stats
        const statsResponse = await fetch('/api/venue/stats', {
          credentials: 'include',
        })
        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          setStats(statsData)
        }

        // Fetch recent requests
        const requestsResponse = await fetch('/api/venue/requests?status=pending&limit=3', {
          credentials: 'include',
        })
        if (requestsResponse.ok) {
          const requestsData = await requestsResponse.json()
          setRecentRequests(requestsData.bookings || [])
        }
      } catch (error) {
        console.error('Error fetching venue data:', error)
      } finally {
        setIsStatsLoading(false)
        setIsRequestsLoading(false)
      }
    }

    fetchData()
  }, [user])

  const displayRequests = useMemo(() => {
    return recentRequests.slice(0, 3)
  }, [recentRequests])

  const isLoading = isStatsLoading || isRequestsLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        <p className="text-lg text-slate-600 mt-2">Manage your venue bookings and revenue</p>
      </div>

      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Pending Requests"
            value={stats?.pendingRequests ?? 0}
            icon={<Bell className="h-6 w-6" />}
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          />
          <StatCard
            label="This Month Bookings"
            value={stats?.thisMonthBookings ?? 0}
            icon={<Calendar className="h-6 w-6" />}
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            label="Revenue (MTD)"
            value={`$${((stats?.revenueMtd ?? 0) / 1000).toFixed(1)}K`}
            change={stats?.revenueChange ? `${stats.revenueChange > 0 ? '+' : ''}${stats.revenueChange}%` : undefined}
            changeDirection={stats?.revenueChange && stats.revenueChange > 0 ? 'up' : 'down'}
            icon={<DollarSign className="h-6 w-6" />}
            iconBgColor="bg-forest-100"
            iconColor="text-forest-600"
          />
          <StatCard
            label="Acceptance Rate"
            value={`${stats?.acceptanceRate ?? 0}%`}
            icon={<TrendingUp className="h-6 w-6" />}
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          />
        </div>

        {/* Banner */}
        {stats && stats.bookedPercentage > 0 && (
          <div className="bg-forest-50 border border-forest-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-forest-600 flex-shrink-0" />
              <p className="text-sm sm:text-base text-forest-800">
                <span className="font-semibold">Your venue is {stats.bookedPercentage}% booked this month.</span>{' '}
                {new Date().toLocaleDateString('en-US', { month: 'long' })} is trending well!
              </p>
            </div>
          </div>
        )}

        {/* Recent Requests Section */}
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Recent Requests</h2>
              <p className="text-sm text-slate-600 mt-1">Latest booking requests for your venue</p>
            </div>
            <Link href="/venue/requests">
              <Button variant="outline" size="sm" className="min-h-[44px]">
                View All Requests
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
                
                return (
                  <RequestCard
                    key={booking.id}
                    title={event?.title || 'Event Booking Request'}
                    organizerName={organizer?.name || 'Organizer'}
                    organizerCompany={organizer?.company || undefined}
                    date={booking.confirmed_date || booking.requested_date || new Date().toISOString()}
                    time={booking.confirmed_start_time || booking.requested_start_time}
                    guestCount={event?.expected_attendance_min || event?.expected_attendance_max}
                    revenue={booking.final_price || booking.quoted_price}
                    status={booking.status}
                    onClick={() => router.push(`/venue/requests?booking=${booking.id}`)}
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
              description="See your monthly bookings at a glance"
              href="/venue/calendar"
            />
            <QuickActionCard
              icon="📋"
              title="Update Requirements"
              description="Edit insurance and document requirements"
              href="/venue/requirements"
            />
            <QuickActionCard
              icon="💰"
              title="Adjust Pricing"
              description="Update your rates and revenue share"
              href="/venue/pricing"
            />
          </div>
        </div>
      </div>
    </>
  )
}
