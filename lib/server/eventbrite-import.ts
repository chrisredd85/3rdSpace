import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  fetchEventbriteAttendeePage,
  getEventbriteAccessToken,
  type EventbriteIntegrationRow,
} from '@/lib/server/eventbrite'

type ImportedAttendeePayload = {
  integration_id: string
  event_id: string
  external_attendee_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  ticket_type: string | null
  order_id: string | null
  checked_in: boolean
  check_in_time: string | null
  raw_data: Record<string, any>
}

function mapEventbriteAttendee(
  integrationId: string,
  eventId: string,
  attendee: {
    id: string
    checked_in?: boolean | null
    checked_in_at?: string | null
    ticket_class_name?: string | null
    order_id?: string | null
    profile?: {
      first_name?: string | null
      last_name?: string | null
      email?: string | null
    } | null
  }
): ImportedAttendeePayload {
  return {
    integration_id: integrationId,
    event_id: eventId,
    external_attendee_id: attendee.id,
    first_name: attendee.profile?.first_name ?? null,
    last_name: attendee.profile?.last_name ?? null,
    email: attendee.profile?.email ?? null,
    ticket_type: attendee.ticket_class_name ?? null,
    order_id: attendee.order_id ?? null,
    checked_in: Boolean(attendee.checked_in),
    check_in_time: attendee.checked_in ? attendee.checked_in_at ?? null : null,
    raw_data: attendee as Record<string, any>,
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function upsertAttendeeChunks(
  admin: ReturnType<typeof createServiceRoleClient>,
  attendeeChunks: ImportedAttendeePayload[][]
) {
  const chunkGroups = chunk(attendeeChunks, 4)

  for (const chunkGroup of chunkGroups) {
    const results = await Promise.all(
      chunkGroup.map((attendeeChunk) =>
        admin.from('imported_attendees').upsert(attendeeChunk as never, {
          onConflict: 'integration_id,external_attendee_id',
        })
      )
    )

    const failedResult = results.find((result) => result.error)
    if (failedResult?.error) {
      throw failedResult.error
    }
  }
}

export async function runEventbriteImport(
  admin: ReturnType<typeof createServiceRoleClient>,
  integrationId: string
) {
  let lockedIntegrationId: string | null = null

  try {
    const { data: integration, error: integrationError } = await admin
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, access_token_encrypted, sync_status, config')
      .eq('id', integrationId)
      .eq('platform', 'eventbrite')
      .maybeSingle()

    if (integrationError) throw new Error(`Failed to load integration: ${integrationError.message}`)
    if (!integration) throw new Error('Integration not found')

    const typedIntegration = integration as EventbriteIntegrationRow
    if (!typedIntegration.external_event_id) {
      throw new Error('Event not linked to Eventbrite event')
    }

    const accessToken = getEventbriteAccessToken(typedIntegration)
    const { data: lock, error: lockError } = await admin
      .from('external_event_integrations')
      .update({
        sync_status: 'syncing',
        sync_error: null,
        last_sync_status: 'syncing',
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)
      .neq('sync_status', 'syncing')
      .select('id')
      .maybeSingle()

    if (lockError) throw new Error(`Failed to lock integration: ${lockError.message}`)
    if (!lock) throw new Error('An Eventbrite import is already running for this event.')

    lockedIntegrationId = typedIntegration.id

    const allAttendees: ImportedAttendeePayload[] = []
    let continuation: string | undefined
    let hasMore = true

    while (hasMore) {
      const response = await fetchEventbriteAttendeePage(accessToken, typedIntegration.external_event_id, continuation)
      const attendees = response.attendees ?? []

      attendees.forEach((attendee) => {
        allAttendees.push(mapEventbriteAttendee(typedIntegration.id, typedIntegration.event_id, attendee))
      })

      hasMore = Boolean(response.pagination?.has_more_items)
      continuation = response.pagination?.continuation ?? undefined
    }

    const checkedInCount = allAttendees.filter((attendee) => attendee.checked_in).length
    const { data: existingAttendees, error: existingError } = await admin
      .from('imported_attendees')
      .select('external_attendee_id')
      .eq('integration_id', typedIntegration.id)

    if (existingError) throw new Error(`Failed to load existing attendees: ${existingError.message}`)

    const existingIds = new Set(
      ((existingAttendees as Array<{ external_attendee_id: string }> | null) ?? []).map(
        (row) => row.external_attendee_id
      )
    )
    const imported = allAttendees.filter((attendee) => !existingIds.has(attendee.external_attendee_id)).length
    const updated = allAttendees.length - imported

    await upsertAttendeeChunks(admin, chunk(allAttendees, 100))

    const { error: updateError } = await admin
      .from('external_event_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        sync_status: 'completed',
        sync_error: null,
        last_sync_status: 'completed',
        last_sync_error: null,
        total_checked_in: checkedInCount,
        last_attendance_count: allAttendees.length,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)

    if (updateError) throw new Error(`Failed to update sync status: ${updateError.message}`)

    lockedIntegrationId = null

    return {
      imported,
      updated,
      checked_in: checkedInCount,
      total: allAttendees.length,
      message: `Successfully imported ${allAttendees.length} attendees`,
    }
  } catch (error) {
    if (lockedIntegrationId) {
      await admin
        .from('external_event_integrations')
        .update({
          sync_status: 'failed',
          sync_error: error instanceof Error ? error.message : 'Import failed',
          last_sync_status: 'failed',
          last_sync_error: error instanceof Error ? error.message : 'Import failed',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', lockedIntegrationId)
    }

    throw error
  }
}
