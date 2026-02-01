'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Calendar,
  Clock,
  MapPin,
  ArrowRight,
  Filter,
  ArrowUpDown,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEvents, useEventProgress } from '@/lib/hooks/useEvents'
import { useUser } from '@/lib/hooks/useUser'
import type { Event, EventStatus } from '@/lib/types'

export default function EventsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')
  const userId = user?.id || null
  const { data: events = [], isLoading } = useEvents(userId)

  const filteredAndSortedEvents = useMemo(() => {
    const now = new Date()
    let filtered = events.filter(
      (e) =>
        new Date(e.event_date) >= now &&
        e.status !== 'completed' &&
        e.status !== 'cancelled'
    )

    if (statusFilter !== 'all') {
      filtered = filtered.filter((e) => e.status === statusFilter)
    }

    if (sortBy === 'date') {
      filtered.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    } else {
      filtered.sort((a, b) => a.title.localeCompare(b.title))
    }

    return filtered
  }, [events, statusFilter, sortBy])

  // Early returns after all hooks
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading events...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upcoming Events</h1>
        <p className="text-gray-600 mt-1">Manage and track your upcoming events</p>
      </div>

      {/* Filters and Sort */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EventStatus | 'all')}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
          >
            <option value="all">All Status</option>
            <option value="planning">Planning</option>
            <option value="in_progress">In Progress</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'name')}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
          >
            <option value="date">By Date</option>
            <option value="name">By Name</option>
          </select>
        </div>
      </div>

      {/* Events Grid */}
      {filteredAndSortedEvents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">No upcoming events found</p>
            <Link href="/builder/event/new">
              <Button>Create New Event</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ event }: { event: Event }) {
  const router = useRouter()
  const { data: progress = 0 } = useEventProgress(event.id)
  const eventDate = new Date(event.event_date)
  const emoji = getEventEmoji(event.event_type || '')
  const statusBadge = getStatusBadge(event.status)

  return (
    <Card
      className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => router.push(`/builder/events/${event.id}`)}
    >
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
            <CardTitle className="text-lg mb-1">{event.title}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-gray-600">
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
              <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                <MapPin className="h-4 w-4" />
                <span>Venue booked</span>
              </div>
            )}
          </div>
          {statusBadge}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Budget Progress */}
        {event.budget && (
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-600">Budget</span>
              <span className="font-medium">
                ${((event.budget * progress) / 100).toLocaleString()} / ${event.budget.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-forest-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Progress Percentage */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Completion</span>
          <span className="text-sm font-semibold text-forest-600">{progress}%</span>
        </div>

        <Button
          className="w-full"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/builder/events/${event.id}`)
          }}
        >
          Continue Planning
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

function getEventEmoji(type: string | null): string {
  const emojiMap: Record<string, string> = {
    networking: '🤝',
    conference: '🎤',
    party: '🎉',
    workshop: '📚',
    meeting: '💼',
  }
  return emojiMap[type || ''] || '📅'
}

function getStatusBadge(status: EventStatus) {
  const badges = {
    planning: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
        Planning
      </span>
    ),
    in_progress: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
        In Progress
      </span>
    ),
    confirmed: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-forest-100 text-forest-800">
        Confirmed
      </span>
    ),
    completed: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
        Completed
      </span>
    ),
    cancelled: (
      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
        Cancelled
      </span>
    ),
  }
  return badges[status] || badges.planning
}
