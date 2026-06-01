'use client'

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { Calendar, CheckCircle, Clock, DollarSign, Download, Star, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MetricCard } from '@/components/analytics/MetricCard'

const RevenueChart = dynamic(
  () => import('@/components/analytics/RevenueChart').then((mod) => mod.RevenueChart),
  { ssr: false, loading: () => <ChartLoading label="Loading revenue chart..." /> }
)
const BookingsChart = dynamic(
  () => import('@/components/analytics/BookingsChart').then((mod) => mod.BookingsChart),
  { ssr: false, loading: () => <ChartLoading label="Loading bookings chart..." /> }
)

type Period = 'month' | 'year' | 'all' | 'custom'

type AnalyticsData = {
  overview: {
    total_revenue: number
    pending_revenue: number
    total_bookings: number
    confirmed_bookings: number
    completed_bookings: number
    cancelled_bookings: number
    average_booking_value: number
    average_rating: number
    total_reviews: number
    conversion_rate: number
  }
  this_month: {
    revenue: number
    bookings: number
    growth_percentage: number
    booking_growth_percentage: number
  }
  comparison: {
    current: {
      revenue: number
      bookings: number
      average_booking_value: number
    }
    previous: {
      revenue: number
      bookings: number
      average_booking_value: number
    }
  }
  performance: {
    response_time_hours: number
    acceptance_rate: number
    cancellation_rate: number
  }
  charts: {
    revenue_by_month: Array<{ month: string; revenue: number }>
    bookings_by_month: Array<{ month: string; bookings: number }>
  }
  popular_services: Array<{ service_name: string; bookings: number; revenue: number }>
  date_range: {
    startDate: string
    endDate: string
  }
}

/**
 * Vendor analytics dashboard with KPIs, charts, comparisons, services, and CSV export.
 */
export default function VendorAnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState<Period>('month')
  const [customStart, setCustomStart] = useState(getMonthStart())
  const [customEnd, setCustomEnd] = useState(getToday())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ period })
    if (period === 'custom') {
      params.set('start', customStart)
      params.set('end', customEnd)
    }
    return params.toString()
  }, [customEnd, customStart, period])

  /**
   * Loads analytics from the vendor API.
   */
  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/vendor/analytics?${queryString}`)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to load analytics')

      setAnalytics(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  /**
   * Updates the period selector.
   */
  function handlePeriodChange(event: ChangeEvent<HTMLSelectElement>) {
    setPeriod(event.target.value as Period)
  }

  /**
   * Exports the current analytics response as CSV.
   */
  function exportCsv() {
    if (!analytics) return

    const rows = buildCsvRows(analytics)
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `vendor-analytics-${analytics.date_range.startDate}-${analytics.date_range.endDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink-soft">
        Loading analytics...
      </div>
    )
  }

  if (error || !analytics) {
    return (
      <div className="rounded-lg border border-brick/30 bg-brick/10 p-6 text-sm text-brick">
        {error || 'No analytics data available'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-ink">Analytics</h1>
          <p className="mt-2 text-lg text-ink-soft">Revenue, bookings, and performance for your vendor business</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={period}
            onChange={handlePeriodChange}
            className="h-11 rounded-lg border border-tan bg-cream/40 px-3 text-sm outline-none transition-colors focus:border-clay"
          >
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="all">All Time</option>
            <option value="custom">Custom</option>
          </select>

          {period === 'custom' && (
            <div className="flex gap-2">
              <Input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="h-11 py-2 text-sm" />
              <Input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="h-11 py-2 text-sm" />
            </div>
          )}

          <Button type="button" variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(analytics.overview.total_revenue)}
          icon={<DollarSign className="h-6 w-6" />}
          trend={analytics.this_month.growth_percentage}
          trendLabel="this month vs last month"
          color="green"
        />
        <MetricCard
          title="Pending Revenue"
          value={formatCurrency(analytics.overview.pending_revenue)}
          icon={<Clock className="h-6 w-6" />}
          subtitle="Pending and upcoming confirmed bookings"
          color="blue"
        />
        <MetricCard
          title="Total Bookings"
          value={analytics.overview.total_bookings.toLocaleString()}
          icon={<Calendar className="h-6 w-6" />}
          trend={analytics.this_month.booking_growth_percentage}
          trendLabel="booking growth"
          subtitle={`${analytics.overview.confirmed_bookings} confirmed`}
          color="purple"
        />
        <MetricCard
          title="Average Rating"
          value={analytics.overview.average_rating.toFixed(1)}
          icon={<Star className="h-6 w-6" />}
          subtitle={`${analytics.overview.total_reviews} reviews`}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <PerformancePanel
          title="Avg Response Time"
          value={`${analytics.performance.response_time_hours.toFixed(1)}h`}
          subtitle="Average time to respond to requests"
          icon={<Clock className="h-5 w-5" />}
        />
        <PerformancePanel
          title="Acceptance Rate"
          value={`${analytics.performance.acceptance_rate.toFixed(0)}%`}
          subtitle="Confirmed or completed out of responded requests"
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <PerformancePanel
          title="Avg Booking Value"
          value={formatCurrency(analytics.overview.average_booking_value)}
          subtitle="Average revenue per confirmed booking"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <PerformancePanel
          title="Conversion Rate"
          value={`${analytics.overview.conversion_rate.toFixed(0)}%`}
          subtitle="Confirmed or completed out of all requests"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-tan bg-cream/40 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-ink">Revenue Over Time</h2>
          <RevenueChart data={analytics.charts.revenue_by_month} />
        </section>

        <section className="rounded-lg border border-tan bg-cream/40 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-ink">Bookings Over Time</h2>
          <BookingsChart data={analytics.charts.bookings_by_month} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <section className="rounded-lg border border-tan bg-cream/40 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-ink">This Month vs Last Month</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <ComparisonMetric label="Revenue" current={formatCurrency(analytics.comparison.current.revenue)} previous={formatCurrency(analytics.comparison.previous.revenue)} />
            <ComparisonMetric label="Bookings" current={analytics.comparison.current.bookings.toLocaleString()} previous={analytics.comparison.previous.bookings.toLocaleString()} />
            <ComparisonMetric label="Avg Value" current={formatCurrency(analytics.comparison.current.average_booking_value)} previous={formatCurrency(analytics.comparison.previous.average_booking_value)} />
          </div>
        </section>

        <section className="rounded-lg border border-tan bg-cream/40 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-ink">Popular Services</h2>
          {analytics.popular_services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-tan p-6 text-center text-sm text-ink-soft">
              No booked services in this period
            </div>
          ) : (
            <div className="space-y-3">
              {analytics.popular_services.map((service) => (
                <div key={service.service_name} className="flex items-center justify-between gap-3 rounded-lg border border-tan p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{service.service_name}</p>
                    <p className="text-sm text-ink-soft">{Number(service.bookings).toLocaleString()} bookings</p>
                  </div>
                  <p className="shrink-0 font-semibold text-ink">{formatCurrency(Number(service.revenue))}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * Displays a compact performance KPI.
 */
function PerformancePanel({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string
  value: string
  subtitle: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-lg border border-tan bg-cream/40 p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-lg bg-cream-deep/40 p-2 text-ink">{icon}</div>
        <div>
          <p className="text-sm text-ink-soft">{title}</p>
          <p className="text-2xl font-bold text-ink">{value}</p>
        </div>
      </div>
      <p className="text-sm text-ink-soft">{subtitle}</p>
    </div>
  )
}

/**
 * Displays a current-vs-previous comparison tile.
 */
function ComparisonMetric({ label, current, previous }: { label: string; current: string; previous: string }) {
  return (
    <div className="rounded-lg bg-cream p-4">
      <p className="text-sm font-medium text-ink-soft">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{current}</p>
      <p className="mt-1 text-xs text-ink-soft">Last month: {previous}</p>
    </div>
  )
}

/**
 * Reserves chart space while Recharts loads in the browser.
 */
function ChartLoading({ label }: { label: string }) {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-tan text-sm text-ink-soft">
      {label}
    </div>
  )
}

/**
 * Formats a number as USD.
 */
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount || 0)
}

/**
 * Returns the current local date in YYYY-MM-DD format.
 */
function getToday() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Returns the first day of the current month in YYYY-MM-DD format.
 */
function getMonthStart() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
}

/**
 * Builds CSV rows from the analytics response.
 */
function buildCsvRows(analytics: AnalyticsData) {
  const rows: Array<Array<string | number>> = [
    ['Section', 'Metric', 'Value'],
    ['Overview', 'Total Revenue', analytics.overview.total_revenue],
    ['Overview', 'Pending Revenue', analytics.overview.pending_revenue],
    ['Overview', 'Total Bookings', analytics.overview.total_bookings],
    ['Overview', 'Confirmed Bookings', analytics.overview.confirmed_bookings],
    ['Overview', 'Completed Bookings', analytics.overview.completed_bookings],
    ['Overview', 'Cancelled Bookings', analytics.overview.cancelled_bookings],
    ['Overview', 'Average Booking Value', analytics.overview.average_booking_value],
    ['Overview', 'Average Rating', analytics.overview.average_rating],
    ['Performance', 'Response Time Hours', analytics.performance.response_time_hours],
    ['Performance', 'Acceptance Rate', analytics.performance.acceptance_rate],
    ['Performance', 'Conversion Rate', analytics.overview.conversion_rate],
    [],
    ['Revenue By Month', 'Month', 'Revenue'],
    ...analytics.charts.revenue_by_month.map((item) => ['Revenue By Month', item.month, item.revenue]),
    [],
    ['Bookings By Month', 'Month', 'Bookings'],
    ...analytics.charts.bookings_by_month.map((item) => ['Bookings By Month', item.month, item.bookings]),
    [],
    ['Popular Services', 'Service', 'Bookings', 'Revenue'],
    ...analytics.popular_services.map((item) => ['Popular Services', item.service_name, item.bookings, item.revenue]),
  ]

  return rows
}

/**
 * Escapes a CSV cell.
 */
function escapeCsvValue(value: string | number) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
