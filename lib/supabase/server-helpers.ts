import type { Event, EventStatus } from '@/lib/types'

export async function getBuilderProfileId(
  supabase: any,
  userId: string
) {
  const { data, error } = await supabase
    .from('builder_profiles')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    return { builderProfileId: null, error }
  }

  return { builderProfileId: data.id, error: null }
}

export async function getUserAccountRecord(
  supabase: any,
  userId: string
) {
  return supabase
    .from('users')
    .select('id, role, user_type')
    .eq('id', userId)
    .single()
}

export function mapDbEventStatusToApp(status: string | null | undefined): EventStatus {
  if (status === 'draft' || status === 'venue_pending') return 'planning'
  if (status === 'confirmed' || status === 'completed' || status === 'cancelled') {
    return status
  }
  return 'planning'
}

export function mapAppEventStatusToDb(status: string | null | undefined) {
  if (status === 'planning' || !status) return 'draft'
  if (status === 'venue_pending') return 'venue_pending'
  if (status === 'confirmed' || status === 'completed' || status === 'cancelled') {
    return status
  }
  return 'draft'
}

export function mapAppEventTypeToDb(eventType: string | null | undefined) {
  if (
    eventType === 'networking' ||
    eventType === 'conference' ||
    eventType === 'workshop' ||
    eventType === 'social_mixer' ||
    eventType === 'product_launch' ||
    eventType === 'all_hands' ||
    eventType === 'other'
  ) {
    return eventType
  }

  if (eventType === 'party') return 'social_mixer'
  if (eventType === 'meeting') return 'all_hands'

  return 'other'
}

export function mapDbEventToApp(row: Record<string, any>): Event {
  return {
    id: row.id,
    builder_id: row.builder_id,
    title: row.event_name,
    description: row.description ?? row.event_description,
    event_type: row.event_type,
    event_date: typeof row.event_date === 'string' ? row.event_date : String(row.event_date),
    start_time: row.start_time,
    end_time: row.end_time,
    expected_attendees:
      row.expected_attendance ??
      row.expected_attendance_min ??
      row.expected_attendance_max,
    status: mapDbEventStatusToApp(row.status),
    venue_id: row.venue_id,
    budget: row.budget ?? row.total_budget,
    notes: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
