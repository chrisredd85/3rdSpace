'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Calendar,
  DollarSign,
  TrendingUp,
  Download,
  FileText,
  Eye,
  Star,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useEvents } from '@/lib/hooks/useEvents'
import { useUser } from '@/lib/hooks/useUser'
import type { Event } from '@/lib/types'

export default function PastEventsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const userId = user?.id || null
  const { data: events = [], isLoading } = useEvents(userId)

  const pastEvents = useMemo(() => {
    const now = new Date()
    return events
      .filter((e) => new Date(e.event_date) < now || e.status === 'completed')
      .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
  }, [events])

  const stats = useMemo(() => {
    const totalEvents = pastEvents.length
    const totalSpent = pastEvents.reduce((sum, e) => sum + (e.budget || 0), 0)
    const avgPerEvent = totalEvents > 0 ? totalSpent / totalEvents : 0

    return {
      totalEvents,
      totalSpent,
      avgPerEvent,
    }
  }, [pastEvents])

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
          <p className="text-gray-600">Loading past events...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Past Events</h1>
        <p className="text-gray-600 mt-1">Review your completed events and performance</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Calendar className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalEvents}</div>
            <p className="text-xs text-gray-500">Completed events</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
            <DollarSign className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalSpent.toLocaleString()}</div>
            <p className="text-xs text-gray-500">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Per Event</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${Math.round(stats.avgPerEvent).toLocaleString()}</div>
            <p className="text-xs text-gray-500">Average cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Past Events List */}
      {pastEvents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">No past events found</p>
            <Link href="/builder/event/new">
              <Button>Create New Event</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pastEvents.map((event) => (
            <PastEventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  )
}

function PastEventCard({ event }: { event: Event }) {
  const router = useRouter()
  const eventDate = new Date(event.event_date)
  const emoji = getEventEmoji(event.event_type || '')

  // Mock ratings (would come from reviews table)
  const rating = 4.5
  const reviewCount = 12

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          {/* Event Icon */}
          <div className="flex-shrink-0">
            <div className="h-16 w-16 rounded-lg bg-gradient-to-br from-forest-400 to-forest-600 flex items-center justify-center text-2xl">
              {emoji}
            </div>
          </div>

          {/* Event Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{event.title}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                  <span>{eventDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  {event.expected_attendees && (
                    <span>{event.expected_attendees} attendees</span>
                  )}
                </div>
                {event.description && (
                  <p className="text-sm text-gray-600 line-clamp-2 mb-3">{event.description}</p>
                )}
              </div>
            </div>

            {/* Final Cost and Ratings */}
            <div className="flex items-center gap-6 mb-4">
              {event.budget && (
                <div>
                  <span className="text-sm text-gray-600">Final Cost: </span>
                  <span className="text-sm font-semibold text-gray-900">
                    ${event.budget.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span className="text-sm font-semibold">{rating}</span>
                <span className="text-sm text-gray-600">({reviewCount} reviews)</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Download invoice functionality
                  console.log('Download invoice for event:', event.id)
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Invoice
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Use as template functionality
                  router.push(`/builder/event/new?template=${event.id}`)
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Use as Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/builder/events/${event.id}`)}
              >
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </Button>
            </div>
          </div>
        </div>
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
