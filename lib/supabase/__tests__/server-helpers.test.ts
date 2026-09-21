import { mapDbEventToApp } from '@/lib/supabase/server-helpers'

describe('mapDbEventToApp canonical identity', () => {
  it('preserves planner identity and the exact timezone-aware schedule', () => {
    expect(mapDbEventToApp({
      id: 'event-1',
      plan_id: 'plan-1',
      builder_id: 'builder-1',
      event_name: 'Oakland community dinner',
      event_type: 'founder_operator_dinner',
      event_date: '2026-08-20',
      start_time: '18:30:00',
      end_time: '21:30:00',
      starts_at: '2026-08-21T01:30:00.000Z',
      ends_at: '2026-08-21T04:30:00.000Z',
      time_zone: 'America/Los_Angeles',
      expected_attendance: 40,
      status: 'confirmed',
      venue_id: null,
      budget: 5000,
      created_at: '2026-07-09T12:00:00.000Z',
      updated_at: '2026-07-09T12:00:00.000Z',
    })).toEqual(expect.objectContaining({
      id: 'event-1',
      plan_id: 'plan-1',
      event_type: 'founder_operator_dinner',
      starts_at: '2026-08-21T01:30:00.000Z',
      ends_at: '2026-08-21T04:30:00.000Z',
      time_zone: 'America/Los_Angeles',
    }))
  })

  it('keeps legacy events visible with a null plan identity', () => {
    expect(mapDbEventToApp({
      id: 'legacy-event',
      builder_id: 'builder-1',
      event_name: 'Legacy event',
      event_type: 'networking',
      event_date: '2026-01-01',
      start_time: null,
      end_time: null,
      status: 'draft',
      venue_id: null,
      created_at: '2025-12-01T12:00:00.000Z',
      updated_at: '2025-12-01T12:00:00.000Z',
    })).toEqual(expect.objectContaining({
      plan_id: null,
      starts_at: null,
      ends_at: null,
      time_zone: null,
    }))
  })
})
