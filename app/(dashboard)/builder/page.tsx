'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  Users,
  DollarSign,
  TrendingUp,
  Search,
  FileText,
  BarChart3,
  ArrowRight,
  Clock,
  MapPin,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useEvents, useEventProgress } from '@/lib/hooks/useEvents'
import { useBuilderStats } from '@/lib/hooks/useBuilderStats'
import { useUser } from '@/lib/hooks/useUser'
import { StatCard } from '@/components/shared/StatCard'
import { QuickActionCard } from '@/components/shared/QuickActionCard'
import { Badge } from '@/components/shared/Badge'
import type { Event, EventStatus } from '@/lib/types'

export default function BuilderDashboard() {
  const { user } = useUser()
  const { data: stats, isLoading: isStatsLoading } = useBuilderStats()
  const { data: events = [], isLoading: isEventsLoading } = useEvents(user?.id || null)
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
      .slice(0, 3)
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
  }, [events])

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
        <p className="text-lg text-slate-600 mt-2">Welcome back! Here's what's happening with your events.</p>
      </div>
      
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Upcoming Events"
            value={stats?.upcomingEvents ?? 0}
            icon={<Calendar className="h-6 w-6" />}
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            label="Active Vendors"
            value={stats?.activeVendors ?? 0}
            icon={<Users className="h-6 w-6" />}
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          />
          <StatCard
            label="YTD Spend"
            value={`$${((stats?.ytdSpend ?? 0) / 1000).toFixed(1)}K`}
            icon={<DollarSign className="h-6 w-6" />}
            iconBgColor="bg-forest-100"
            iconColor="text-forest-600"
          />
          <StatCard
            label="Events This Year"
            value={stats?.eventsThisYear ?? 0}
            icon={<TrendingUp className="h-6 w-6" />}
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          />
        </div>

        {/* Upcoming Events Section */}
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Upcoming Events</h2>
              <p className="text-sm text-slate-600 mt-1">Your next events in progress</p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/builder/event/new">
                <Button size="sm" className="min-h-[44px]">
                  + New Event
                </Button>
              </Link>
              <Link href="/builder/events">
                <Button variant="outline" size="sm" className="min-h-[44px]">
                  View all
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {upcomingEvents.length === 0 ? (
              <div className="col-span-full text-center py-16">
                <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
                  <Calendar className="w-10 h-10 text-slate-400" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">No upcoming events</h3>
                <p className="text-slate-600 mb-6">Get started by creating your first event</p>
                <Link href="/builder/event/new">
                  <Button>Create your first event</Button>
                </Link>
              </div>
            ) : (
              upcomingEvents.map((event) => (
                <EventProgressCard key={event.id} event={event} />
              ))
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <QuickActionCard
              icon="🤝"
              title="Find Vendors"
              description="Browse and save trusted Bay Area service providers"
              href="/builder/vendors/marketplace"
            />
            <QuickActionCard
              icon="📋"
              title="Use Template"
              description="Start from a saved event template to save time"
              href="/builder/templates"
            />
            <QuickActionCard
              icon="📈"
              title="View Analytics"
              description="Track spending, venue usage, and ROI"
              href="/builder/analytics"
            />
          </div>
        </div>
      </div>
    </>
  )
}

// Event Progress Card Component
function EventProgressCard({ event }: { event: Event }) {
  const router = useRouter()
  const { data: progress = 0 } = useEventProgress(event.id)
  const [spent, setSpent] = useState(0)
  const [tasksRemaining, setTasksRemaining] = useState(0)

  useEffect(() => {
    // Calculate spent amount (simplified - would fetch from bookings)
    setSpent(event.budget ? (event.budget * progress) / 100 : 0)
    // Calculate tasks remaining (simplified - would fetch from checklist)
    setTasksRemaining(Math.max(0, Math.round((100 - progress) / 20)))
  }, [event.budget, progress])

  const eventDate = new Date(event.event_date)
  const emoji = getEventEmoji(event.event_type || '')

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1 border border-gray-200">
      {/* Event Image/Gradient */}
      <div
        className="h-32 bg-gradient-to-br from-forest-400 to-forest-600 flex items-center justify-center text-4xl"
        style={{
          background: `linear-gradient(135deg, #10B981 0%, #059669 100%)`,
        }}
      >
        {emoji}
      </div>

      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-xl mb-2 group-hover:text-forest-600 transition-colors">{event.name}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Calendar className="h-4 w-4" />
              <span>{eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              {event.start_time && (
                <>
                  <Clock className="h-4 w-4 ml-2" />
                  <span>{new Date(`2000-01-01T${event.start_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </>
              )}
            </div>
            {event.venue_id && (
              <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                <MapPin className="h-4 w-4 text-slate-400" />
                <span>Venue booked</span>
              </div>
            )}
          </div>
          <Badge status={event.status} size="sm" />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Budget Progress */}
        {event.budget && (
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-600 font-medium">Budget</span>
              <span className="font-semibold text-slate-900">
                ${Math.round(spent).toLocaleString()} / ${event.budget.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-forest-500 to-forest-600 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (spent / event.budget) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-600 font-medium">Progress</span>
            <span className="font-semibold text-slate-900">{progress}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-forest-500 to-forest-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {tasksRemaining > 0 && (
            <p className="text-xs text-slate-500 mt-2">{tasksRemaining} tasks remaining</p>
          )}
        </div>

        <Button
          className="w-full"
          onClick={() => router.push(`/builder/event/${event.id}`)}
        >
          Continue Planning →
        </Button>
      </CardContent>
    </Card>
  )
}

function getEventEmoji(type: string): string {
  const emojiMap: Record<string, string> = {
    networking: '🤝',
    conference: '🎤',
    workshop: '🔧',
    party: '🎉',
    meeting: '💼',
    default: '📅',
  }
  return emojiMap[type.toLowerCase()] || emojiMap.default
}

function getStatusBadge(status: EventStatus) {
  const badges: Record<EventStatus, { label: string; className: string }> = {
    planning: { label: 'Planning', className: 'bg-yellow-100 text-yellow-800' },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-800' },
    confirmed: { label: 'Confirmed', className: 'bg-forest-100 text-forest-800' },
    completed: { label: 'Completed', className: 'bg-gray-100 text-gray-800' },
    cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
  }

  const badge = badges[status] || badges.planning
  return (
    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${badge.className}`}>
      {badge.label}
    </span>
  )
}
