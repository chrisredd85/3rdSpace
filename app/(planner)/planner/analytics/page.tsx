'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  Calendar,
  DollarSign,
  TrendingUp,
  Star,
  Download,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEvents } from '@/lib/hooks/useEvents'
import { useSavedVendors } from '@/lib/hooks/useVendors'
import { useSavedVenues } from '@/lib/hooks/useVenues'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import {
  normalizeVenueBookings,
  VENUE_BOOKING_WITH_DETAILS_SELECT,
  type VenueBookingJoinRow,
} from '@/lib/bookings/venue-booking-adapter'
import {
  normalizeVendorBookings,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'
import type { VenueBooking } from '@/lib/types'
import type { VendorBookingDashboardItem } from '@/lib/vendors/booking-dashboard'

const BuilderMonthlySpendingChart = dynamic(
  () => import('@/components/analytics/BuilderMonthlySpendingChart').then((mod) => mod.BuilderMonthlySpendingChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

type SortField = 'name' | 'category' | 'timesUsed' | 'totalSpent' | 'avgRating'
type SortDirection = 'asc' | 'desc'

interface VendorPerformance {
  id: string
  name: string
  category: string
  timesUsed: number
  totalSpent: number
  avgRating: number
}

type VenueBookingAnalyticsItem = VenueBooking & {
  venues?: Record<string, unknown> | null
}

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6']

export default function BuilderAnalyticsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  })
  const [sortField, setSortField] = useState<SortField>('totalSpent')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [venueBookingsData, setVenueBookingsData] = useState<VenueBookingAnalyticsItem[]>([])
  const [vendorBookingsData, setVendorBookingsData] = useState<VendorBookingDashboardItem[]>([])
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: events = [] } = useEvents(userId)
  const { data: savedVendors = [] } = useSavedVendors(userId)
  const { data: savedVenues = [] } = useSavedVenues(userId)

  // Filter events by date range (all hooks must run before any return)
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (!event.event_date) return false
      const eventDate = new Date(event.event_date)
      const startDate = new Date(dateRange.start)
      const endDate = new Date(dateRange.end)
      return eventDate >= startDate && eventDate <= endDate
    })
  }, [events, dateRange])

  // Calculate stats
  const stats = useMemo(() => {
    const eventsThisYear = filteredEvents.length
    const totalSpend = filteredEvents.reduce((sum, event) => sum + (event.budget || 0), 0)
    const avgCostPerEvent = eventsThisYear > 0 ? totalSpend / eventsThisYear : 0

    // Calculate average vendor rating (would come from reviews)
    const avgVendorRating = 4.5 // Mock - would calculate from reviews

    return {
      eventsThisYear,
      totalSpend,
      avgCostPerEvent,
      avgVendorRating,
    }
  }, [filteredEvents])

  // Monthly spending trend
  const monthlySpending = useMemo(() => {
    const monthly: Record<string, number> = {}

    filteredEvents.forEach((event) => {
      if (!event.event_date) return
      const date = new Date(event.event_date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      monthly[monthKey] = (monthly[monthKey] || 0) + (event.budget || 0)
    })

    return Object.entries(monthly)
      .map(([month, amount]) => ({
        month: new Date(month).toLocaleDateString('en-US', { month: 'short' }),
        amount,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [filteredEvents])

  // Most used venues
  const venueUsage = useMemo(() => {
    const usage: Record<string, { name: string; count: number }> = {}
    const venueNamesById = new Map<string, string>()

    venueBookingsData.forEach((booking) => {
      const venue = booking.venues as { name?: string | null } | null | undefined
      if (booking.venue_id && venue?.name) {
        venueNamesById.set(booking.venue_id, venue.name)
      }
    })

    filteredEvents.forEach((event) => {
      if (event.venue_id) {
        const key = event.venue_id
        const savedVenue = savedVenues.find((v: any) => v.venue_id === event.venue_id)
        
        if (!usage[key]) {
          usage[key] = {
            name: venueNamesById.get(key) || savedVenue?.venues?.name || 'Unknown Venue',
            count: 0,
          }
        }
        usage[key].count++
      }
    })

    const total = Object.values(usage).reduce((sum, v) => sum + v.count, 0)

    return Object.values(usage)
      .map((v) => ({
        ...v,
        percentage: total > 0 ? (v.count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [filteredEvents, savedVenues, venueBookingsData])

  useEffect(() => {
    if (filteredEvents.length > 0 && userId) {
      const eventIds = filteredEvents.map((e) => e.id)
      supabase
        .from('venue_bookings')
        .select(VENUE_BOOKING_WITH_DETAILS_SELECT)
        .in('event_id', eventIds)
        .then((result: { data: VenueBookingJoinRow[] | null }) => {
          setVenueBookingsData(normalizeVenueBookings(result.data))
        })
    } else {
      setVenueBookingsData([])
    }
  }, [filteredEvents, userId])

  const spendingByCategory = useMemo(() => {
    const categories = {
      Venues: 0,
      Catering: 0,
      Entertainment: 0,
      Other: 0,
    }

    // Calculate venue spending from actual bookings
    venueBookingsData.forEach((booking) => {
      categories.Venues += booking.final_price || booking.quoted_price || 0
    })

    // Calculate vendor spending by category
    vendorBookingsData.forEach((booking) => {
      const vendor = booking.vendor_profiles
      if (vendor) {
        const serviceType = vendor.service_type
        const amount = booking.final_price || booking.quoted_price || 0

        if (serviceType === 'catering' || serviceType === 'bartending') {
          categories.Catering += amount
        } else if (serviceType === 'dj' || serviceType === 'av_tech' || serviceType === 'photography' || serviceType === 'videography') {
          categories.Entertainment += amount
        } else {
          categories.Other += amount
        }
      }
    })

    const total = Object.values(categories).reduce((sum, v) => sum + v, 0)

    return Object.entries(categories)
      .filter(([_, amount]) => amount > 0)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      }))
  }, [venueBookingsData, vendorBookingsData])

  useEffect(() => {
    if (filteredEvents.length > 0 && userId) {
      const eventIds = filteredEvents.map((e) => e.id)
      supabase
        .from('vendor_bookings')
        .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
        .in('event_id', eventIds)
        .then((result: { data: VendorBookingJoinRow[] | null }) => {
          setVendorBookingsData(normalizeVendorBookings(result.data))
        })
    } else {
      setVendorBookingsData([])
    }
  }, [filteredEvents, userId])

  const vendorPerformance = useMemo(() => {
    const performance: Record<string, VendorPerformance> = {}

    type VendorRow = { id: string; name: string; service_type: string }
    // Build performance data from actual vendor bookings
    vendorBookingsData.forEach((booking) => {
      const vendor = booking.vendor_profiles as VendorRow | undefined
      if (vendor) {
        const key = vendor.id
        if (!performance[key]) {
          performance[key] = {
            id: vendor.id,
            name: vendor.name,
            category: vendor.service_type,
            timesUsed: 0,
            totalSpent: 0,
            avgRating: 4.5, // Mock - would come from reviews
          }
        }
        performance[key].timesUsed++
        performance[key].totalSpent += booking.final_price || booking.quoted_price || 0
      }
    })

    // Also include saved vendors that haven't been used yet (for completeness)
    savedVendors.forEach((saved: { vendor_profiles?: VendorRow }) => {
      const vendor = saved.vendor_profiles
      if (vendor && !performance[vendor.id]) {
        performance[vendor.id] = {
          id: vendor.id,
          name: vendor.name,
          category: vendor.service_type,
          timesUsed: 0,
          totalSpent: 0,
          avgRating: 4.5,
        }
      }
    })

    return Object.values(performance).filter((v) => v.timesUsed > 0)
  }, [vendorBookingsData, savedVendors])

  // Sort vendor performance
  const sortedVendorPerformance = useMemo(() => {
    return [...vendorPerformance].sort((a, b) => {
      let aValue = a[sortField]
      let bValue = b[sortField]

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = (bValue as string).toLowerCase()
      }

      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1
      } else {
        return aValue < bValue ? 1 : -1
      }
    })
  }, [vendorPerformance, sortField, sortDirection])

  // Loading and error handling (after all hooks)
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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const handleExportCSV = () => {
    // Create CSV content
    const headers = ['Metric', 'Value']
    const rows = [
      ['Events This Year', stats.eventsThisYear],
      ['Total Spend', `$${stats.totalSpend.toLocaleString()}`],
      ['Avg Cost/Event', `$${stats.avgCostPerEvent.toLocaleString()}`],
      ['Avg Vendor Rating', stats.avgVendorRating.toFixed(1)],
    ]

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `analytics-${dateRange.start}-${dateRange.end}.csv`
    link.click()
    URL.revokeObjectURL(url)

    addToast({
      title: 'Report exported',
      description: 'Analytics report downloaded as CSV.',
    })
  }

  const handleExportPDF = () => {
    // PDF export would require a library like jsPDF or html2pdf
    // For now, we'll show a toast
    addToast({
      title: 'PDF Export',
      description: 'PDF export feature coming soon. Use CSV export for now.',
    })
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Event performance, vendor spend, and venue bookings.
        </p>
      </div>
      <div className="px-6 py-6">
        <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">Track your event performance and spending</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            <Input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="flex-1 sm:w-40 min-h-[44px]"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="flex-1 sm:w-40 min-h-[44px]"
            />
          </div>
          <Button variant="outline" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={handleExportPDF}>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Events This Year</p>
                <p className="text-3xl font-bold text-foreground mt-2">
                  {stats.eventsThisYear}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Spend</p>
                <p className="text-3xl font-bold text-foreground mt-2">
                  ${stats.totalSpend.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Cost/Event</p>
                <p className="text-3xl font-bold text-foreground mt-2">
                  ${Math.round(stats.avgCostPerEvent).toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Vendor Rating</p>
                <p className="text-3xl font-bold text-foreground mt-2">
                  {stats.avgVendorRating.toFixed(1)}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-yellow-500/15 flex items-center justify-center">
                <Star className="h-6 w-6 text-yellow-200" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Spending Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Spending Trend</CardTitle>
          <CardDescription>
            Track your spending over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          {monthlySpending.length > 0 ? (
            <BuilderMonthlySpendingChart data={monthlySpending} />
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No spending data for selected date range</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Used Venues */}
        <Card>
          <CardHeader>
            <CardTitle>Most Used Venues</CardTitle>
            <CardDescription>
              Your top venues by usage
            </CardDescription>
          </CardHeader>
          <CardContent>
            {venueUsage.length > 0 ? (
              <div className="space-y-4">
                {venueUsage.map((venue, index) => (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">
                        {venue.name}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {venue.count} event{venue.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="w-full bg-sidebar-accent rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${venue.percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {venue.percentage.toFixed(1)}% of events
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No venue usage data</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Spending by Category */}
        <Card>
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
            <CardDescription>
              Breakdown of your spending
            </CardDescription>
          </CardHeader>
          <CardContent>
            {spendingByCategory.length > 0 ? (
              <div className="space-y-4">
                {spendingByCategory.map((item, index) => (
                  <div key={item.category}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">
                        {item.category}
                      </span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-foreground">
                          ${Math.round(item.amount).toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          ({item.percentage.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-sidebar-accent rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: COLORS[index % COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No spending data</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Performing Vendors */}
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Vendors</CardTitle>
          <CardDescription>
            Your most used and highest-rated vendors
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedVendorPerformance.length > 0 ? (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {sortedVendorPerformance.map((vendor) => (
                  <Card key={vendor.id} className="p-4">
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{vendor.name}</h3>
                        <p className="text-sm text-muted-foreground">{vendor.category}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Times Used</p>
                          <p className="font-semibold text-foreground">{vendor.timesUsed}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Total Spent</p>
                          <p className="font-semibold text-foreground">
                            ${Math.round(vendor.totalSpent).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Avg Rating</p>
                          <p className="font-semibold text-foreground">
                            {vendor.avgRating.toFixed(1)} ⭐
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4">
                      <button
                        onClick={() => handleSort('name')}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground"
                      >
                        Vendor Name
                        {sortField === 'name' && (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="text-left py-3 px-4">
                      <button
                        onClick={() => handleSort('category')}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground"
                      >
                        Category
                        {sortField === 'category' && (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="text-right py-3 px-4">
                      <button
                        onClick={() => handleSort('timesUsed')}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground ml-auto"
                      >
                        Times Used
                        {sortField === 'timesUsed' && (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="text-right py-3 px-4">
                      <button
                        onClick={() => handleSort('totalSpent')}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground ml-auto"
                      >
                        Total Spent
                        {sortField === 'totalSpent' && (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="text-right py-3 px-4">
                      <button
                        onClick={() => handleSort('avgRating')}
                        className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground ml-auto"
                      >
                        Avg Rating
                        {sortField === 'avgRating' && (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVendorPerformance.map((vendor) => (
                    <tr key={vendor.id} className="border-b border-border hover:bg-background">
                      <td className="py-3 px-4 font-medium text-foreground">
                        {vendor.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground capitalize">
                        {vendor.category}
                      </td>
                      <td className="py-3 px-4 text-sm text-foreground text-right">
                        {vendor.timesUsed}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-foreground text-right">
                        ${vendor.totalSpent.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm font-medium text-foreground">
                            {vendor.avgRating.toFixed(1)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No vendor performance data</p>
            </div>
          )}
        </CardContent>
      </Card>
        </div>
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return <div className="h-[300px] animate-pulse rounded-lg bg-muted" />
}
