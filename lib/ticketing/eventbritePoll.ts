import 'server-only'

import { eventbriteFetch } from '@/lib/server/eventbrite'

export type EventbriteAttendancePollInput = {
  accessToken: string
  eventbriteEventId: string
}

export type EventbriteAttendancePollOutput = {
  checkedInCount: number
  rawResponse: {
    event: unknown
    pages: number
    attendees_seen: number
  }
}

export async function pollEventbriteCheckedInCount({
  accessToken,
  eventbriteEventId,
}: EventbriteAttendancePollInput): Promise<EventbriteAttendancePollOutput> {
  const event = await eventbriteFetch(
    `/v3/events/${eventbriteEventId}/`,
    accessToken,
    undefined,
    { expand: 'event_attendees' }
  )

  let checkedInCount = 0
  let attendeesSeen = 0
  let pages = 0
  let continuation: string | undefined
  let hasMore = true

  while (hasMore) {
    const page = await eventbriteFetch<{
      attendees?: Array<{ id?: string | null; checked_in?: boolean | null }>
      pagination?: { has_more_items?: boolean | null; continuation?: string | null } | null
    }>(
      `/v3/events/${eventbriteEventId}/attendees/`,
      accessToken,
      undefined,
      {
        status: 'checked_in',
        page_size: '200',
        continuation,
      }
    )

    const attendees = page.attendees ?? []
    attendeesSeen += attendees.length
    checkedInCount += attendees.filter((attendee) => attendee.checked_in !== false).length
    pages += 1
    hasMore = Boolean(page.pagination?.has_more_items)
    continuation = page.pagination?.continuation ?? undefined
  }

  return {
    checkedInCount,
    rawResponse: {
      event,
      pages,
      attendees_seen: attendeesSeen,
    },
  }
}
