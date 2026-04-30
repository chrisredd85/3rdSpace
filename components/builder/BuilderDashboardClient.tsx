'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  Wallet,
  TrendingUp,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  ClipboardList,
  Plus,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PayoutOverviewPanel } from '@/components/dashboard/PayoutOverviewPanel'
import { useEvents } from '@/lib/hooks/useEvents'
import { useBuilderStats, type BuilderStats } from '@/lib/hooks/useBuilderStats'
import { useUser } from '@/lib/hooks/useUser'
import type { Event } from '@/lib/types'

interface BuilderDashboardClientProps {
  initialStats: BuilderStats
  initialEvents: Event[]
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
  accent: 'primary' | 'accent' | 'secondary' | 'success'
}) {
  const accentBg = {
    primary: 'bg-primary/15 text-primary',
    accent: 'bg-accent/15 text-accent-foreground',
    secondary: 'bg-secondary/15 text-secondary',
    success: 'bg-success/15 text-success',
  }
  return (
    <div className="rounded-3xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={`rounded-xl p-2.5 ${accentBg[accent]}`}>{icon}</div>
      </div>
    </div>
  )
}

export function BuilderDashboardClient({
  initialStats,
  initialEvents,
}: BuilderDashboardClientProps) {
  const { user } = useUser()
  const { data: stats, isLoading: isStatsLoading } = useBuilderStats(initialStats)
  const { data: events = [], isLoading: isEventsLoading } = useEvents(user?.id || null, undefined, initialEvents)
  const isLoading = isStatsLoading || isEventsLoading

  const upcomingEvents = useMemo(() => {
    const now = new Date()
    return events
      .filter(
        (e) =>
          new Date(e.event_date) >= now &&
          e.status !== 'completed' &&
          e.status !== 'cancelled'
      )
      .slice(0, 5)
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
  }, [events])

  const ytdRevenue = useMemo(
    () => events.reduce((s, e) => s + (e.budget || 0), 0),
    [events]
  )

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}</p>
        <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Your event command center</h1>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Upcoming Events"
          value={String(stats?.upcomingEvents ?? 0)}
          hint="Active planning"
          icon={<CalendarDays className="h-5 w-5" />}
          accent="primary"
        />
        <StatCard
          label="Active Vendors"
          value={String(stats?.activeVendors ?? 0)}
          hint="Confirmed bookings"
          icon={<TrendingUp className="h-5 w-5" />}
          accent="accent"
        />
        <StatCard
          label="YTD Budget"
          value={formatMoney(stats?.ytdSpend ?? 0)}
          hint="Venues + vendors"
          icon={<Wallet className="h-5 w-5" />}
          accent="secondary"
        />
        <StatCard
          label="Events This Year"
          value={String(stats?.eventsThisYear ?? 0)}
          hint={stats?.totalEvents ? `${stats.totalEvents} total` : 'All time'}
          icon={<TrendingUp className="h-5 w-5" />}
          accent="success"
        />
      </div>

      <PayoutOverviewPanel role="builder" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming events */}
        <div className="lg:col-span-2 rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Upcoming events</h2>
            <div className="flex items-center gap-2">
              <Button variant="hero" size="sm" asChild>
                <Link href="/builder/event/new">
                  <Plus className="h-4 w-4" /> New Event
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/builder/events">
                  View all <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          {upcomingEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarDays className="h-12 w-12 text-muted-foreground/40" />
              <p className="mt-3 font-display font-semibold">No upcoming events</p>
              <p className="mt-1 text-sm text-muted-foreground">Create your first event to get started</p>
              <Button variant="hero" className="mt-5" asChild>
                <Link href="/builder/event/new">
                  <Plus className="h-4 w-4" /> Create your first event
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((e) => (
                <Link
                  key={e.id}
                  href={`/builder/event/${e.id}`}
                  className="group flex items-center gap-4 rounded-2xl border border-border bg-card/40 p-3 transition-smooth hover:border-primary/50 hover:bg-card"
                >
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
                    <CalendarDays className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-display font-semibold">{e.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(e.event_date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      {e.expected_attendees ? `· ${e.expected_attendees} guests` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {e.budget ? (
                      <>
                        <p className="font-display text-base font-bold tabular-nums text-accent sm:text-lg">
                          {formatMoney(e.budget)}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">budget</p>
                      </>
                    ) : (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusBadge(e.status)}`}
                      >
                        {e.status}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions / attention */}
        <div className="rounded-3xl border border-border bg-gradient-card p-4 shadow-card sm:p-6">
          <h2 className="mb-5 font-display text-xl font-semibold">Quick actions</h2>
          <div className="space-y-3">
            {[
              { label: 'Find Venues', href: '/builder/venues', hint: 'Browse available spaces', icon: Building2 },
              { label: 'Find Vendors', href: '/builder/vendors/marketplace', hint: 'Service providers', icon: Store },
              { label: 'View Analytics', href: '/builder/analytics', hint: 'Spend & ROI', icon: BarChart3 },
              { label: 'Past Events', href: '/builder/past', hint: 'Review & rebook', icon: ClipboardList },
            ].map((a) => {
              const Icon = a.icon
              return (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card/40 p-3 transition-smooth hover:border-primary/50 hover:bg-card"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.hint}</p>
                </div>
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
              </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground border-border',
    planning: 'bg-info/15 text-info border-info/30',
    confirmed: 'bg-accent/20 text-accent-foreground border-accent/30',
    live: 'bg-secondary/20 text-secondary border-secondary/30',
    completed: 'bg-muted text-muted-foreground border-border',
    cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
  }
  return map[status] ?? 'bg-muted text-muted-foreground border-border'
}
