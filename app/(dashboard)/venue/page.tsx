'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { AlertCircle, Building2, TrendingUp, Calendar, PiggyBank, Check, X, ArrowRight, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PayoutOverviewPanel } from '@/components/dashboard/PayoutOverviewPanel'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'

interface VenueStats {
  pendingRequests: number
  thisMonthBookings: number
  revenueMtd: number
  revenueChange?: number
  acceptanceRate: number
  bookedPercentage: number
  venues?: Array<{
    id: string
    name: string
    address: string | null
    city: string | null
    state: string | null
    capacity: number | null
    isPublished: boolean
  }>
}

function formatMoney(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string
  value: string
  hint?: string
  icon: React.ReactNode
  accent: 'success' | 'primary' | 'accent' | 'secondary'
}) {
  const accentBg = {
    success: 'bg-forest/15 text-forest',
    primary: 'bg-clay/15 text-clay',
    accent: 'bg-forest-tint text-forest',
    secondary: 'bg-clay/15 text-clay',
  }
  return (
    <div className="rounded-lg border border-tan bg-cream p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
        </div>
        <div className={`rounded-lg p-2.5 ${accentBg[accent]}`}>{icon}</div>
      </div>
    </div>
  )
}

export default function VenueDashboard() {
  const { user } = useUser()
  const { addToast } = useToast()
  const [stats, setStats] = useState<VenueStats | null>(null)
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [hasStripeAccount, setHasStripeAccount] = useState<boolean | null>(null)
  const [isStripeBannerDismissed, setIsStripeBannerDismissed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let isMounted = true
    const controller = new AbortController()

    Promise.all([
      fetch('/api/venue/stats', { credentials: 'include', signal: controller.signal }).then((r) => r.ok ? r.json() : null),
      fetch('/api/venue/requests?status=pending&limit=5', { credentials: 'include', signal: controller.signal }).then((r) => r.ok ? r.json() : null),
      fetch('/api/venue/stripe/status', { credentials: 'include', signal: controller.signal }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([statsData, requestsData, stripeData]) => {
        if (!isMounted) return
        if (statsData) setStats(statsData)
        if (requestsData) setRecentRequests(requestsData.bookings || [])
        if (stripeData) setHasStripeAccount(Boolean(stripeData.account?.stripe_account_id))
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (isMounted && message !== 'Failed to fetch' && !controller.signal.aborted) {
          console.error(error)
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [user])

  const handleApprove = async (bookingId: string) => {
    try {
      await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
        credentials: 'include',
      })
      setRecentRequests((prev) => prev.filter((b) => b.id !== bookingId))
      addToast({ title: 'Booking approved!' })
    } catch {
      addToast({ title: 'Error', description: 'Failed to approve booking', variant: 'destructive' })
    }
  }

  const handleDecline = async (bookingId: string) => {
    try {
      await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'declined' }),
        credentials: 'include',
      })
      setRecentRequests((prev) => prev.filter((b) => b.id !== bookingId))
      addToast({ title: 'Booking declined.' })
    } catch {
      addToast({ title: 'Error', description: 'Failed to decline booking', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-clay border-t-transparent" />
          <p className="text-ink-soft">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-ink-soft">Welcome back, host</p>
        <h1 className="mt-1 font-display text-4xl font-bold">Your Venue Dashboard</h1>
      </div>

      {!isStripeBannerDismissed && hasStripeAccount === false ? (
        <div className="rounded-lg border border-clay/30 bg-clay/10 p-5 shadow-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-lg font-bold">Connect Stripe to receive deposits when you accept an opportunity</p>
                <p className="mt-1 text-sm text-ink-soft">You can explore and respond before setup. Payouts are only required when money needs to move.</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="hero" size="sm" asChild>
                <Link href="/venue/payouts">Set up payouts</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsStripeBannerDismissed(true)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <VenueSpacePanel venues={stats?.venues ?? []} />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Confirmed Revenue"
          value={formatMoney(stats?.revenueMtd ?? 0)}
          hint="This month"
          icon={<TrendingUp className="h-5 w-5" />}
          accent="success"
        />
        <StatCard
          label="Pending Requests"
          value={String(stats?.pendingRequests ?? 0)}
          hint="Awaiting approval"
          icon={<Building2 className="h-5 w-5" />}
          accent="primary"
        />
        <StatCard
          label="Bookings This Month"
          value={String(stats?.thisMonthBookings ?? 0)}
          hint={stats?.bookedPercentage ? `${stats.bookedPercentage}% booked` : undefined}
          icon={<Calendar className="h-5 w-5" />}
          accent="accent"
        />
        <StatCard
          label="Acceptance Rate"
          value={`${stats?.acceptanceRate ?? 0}%`}
          icon={<PiggyBank className="h-5 w-5" />}
          accent="secondary"
        />
      </div>

      <PayoutOverviewPanel role="venue" />

      {/* Booking requests */}
      <div className="rounded-lg border border-tan bg-cream p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Booking requests</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/venue/requests">View all <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>

        {recentRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-12 w-12 text-ink-soft/40" />
            <p className="mt-3 font-display font-semibold">No pending requests</p>
            <p className="mt-1 text-sm text-ink-soft">New booking requests will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentRequests.map((b: any) => {
              const event = b.events as any
              return (
                <div key={b.id} className="rounded-lg border border-tan bg-cream/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-display font-semibold">{event?.title || 'Event Booking Request'}</p>
                      <p className="text-xs text-ink-soft">
                        {b.confirmed_date || b.requested_date
                          ? new Date(b.confirmed_date || b.requested_date).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                            })
                          : 'Date TBD'}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="rounded-full bg-clay/15 px-2.5 py-0.5 text-xs font-semibold text-clay">
                          {b.status || 'pending'}
                        </span>
                        {(b.final_price || b.quoted_price) && (
                          <span className="text-sm font-semibold">
                            {formatMoney(b.final_price || b.quoted_price)}
                          </span>
                        )}
                      </div>
                    </div>
                    {(b.status === 'pending' || b.status === 'requested') && (
                      <div className="flex gap-2">
                        <Button variant="hero" size="sm" onClick={() => handleApprove(b.id)}>
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button variant="glass" size="sm" onClick={() => handleDecline(b.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'View Calendar', hint: 'Monthly bookings at a glance', href: '/venue/calendar', icon: Calendar },
          { label: 'Update Listing', hint: 'Edit your venue profile', href: '/venue/listing', icon: Building2 },
          { label: 'Adjust Pricing', hint: 'Update rates and incentives', href: '/venue/pricing', icon: DollarSign },
        ].map((a) => {
          const Icon = a.icon
          return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-start gap-4 rounded-lg border border-tan bg-cream p-5 shadow-card transition-smooth hover:-translate-y-1 hover:shadow-card"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display font-semibold">{a.label}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{a.hint}</p>
            </div>
          </Link>
          )
        })}
      </div>
    </div>
  )
}

function VenueSpacePanel({ venues }: { venues: NonNullable<VenueStats['venues']> }) {
  if (venues.length === 0) {
    return (
      <section className="rounded-lg border border-tan bg-cream p-6 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">No space listed yet</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Venue signup normally creates this automatically. Example accounts may not have a venue row yet.
              </p>
            </div>
          </div>
          <Button variant="hero" asChild>
            <Link href="/venue/listing">
              Add venue details <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-tan bg-cream p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Your listed space</h2>
          <p className="mt-1 text-sm text-ink-soft">This is the venue builders can request.</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/venue/listing">
            Edit listing <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {venues.map((venue) => (
          <Link
            key={venue.id}
            href="/venue/listing"
            className="rounded-lg border border-tan bg-cream/40 p-4 transition-smooth hover:border-clay/50 hover:bg-cream"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-semibold">{venue.name}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {[venue.city, venue.state].filter(Boolean).join(', ') || venue.address || 'Location not set'}
                </p>
              </div>
              <span className="rounded-full bg-clay/15 px-2.5 py-1 text-xs font-semibold text-clay">
                {venue.isPublished ? 'Published' : 'Draft'}
              </span>
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {venue.capacity ? `${venue.capacity.toLocaleString()} standing capacity` : 'Capacity not set'}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
