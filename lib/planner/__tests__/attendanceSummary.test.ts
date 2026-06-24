import { normalizePlanAttendanceSnapshot } from '@/lib/planner/attendanceSummary'

describe('normalizePlanAttendanceSnapshot', () => {
  it('reads ticket and check-in counts from event actuals metadata', () => {
    const snapshot = normalizePlanAttendanceSnapshot({
      event_actuals: {
        tickets_sold: 64,
        tickets_refunded: 4,
        tickets_checked_in: 52,
        data_sources: ['eventbrite'],
        last_event_at: '2026-06-16T17:00:00.000Z',
      },
    })

    expect(snapshot).toMatchObject({
      ticketsSold: 64,
      ticketsRefunded: 4,
      checkedIn: 52,
      sourceLabel: 'Eventbrite',
      updatedAt: '2026-06-16T17:00:00.000Z',
    })
  })

  it('reads nested live-event snapshot shapes', () => {
    const snapshot = normalizePlanAttendanceSnapshot({
      kpis: {
        tickets_sold: 88,
        active_tickets: 84,
      },
      signals: {
        attendance: {
          checked_in: 71,
        },
      },
      freshness: {
        connected_platforms: ['posh', 'luma'],
        last_event_at: '2026-06-18T02:30:00.000Z',
      },
    })

    expect(snapshot.ticketsSold).toBe(88)
    expect(snapshot.currentAttendance).toBe(84)
    expect(snapshot.checkedIn).toBe(71)
    expect(snapshot.sourceLabel).toBe('Posh, Luma')
    expect(snapshot.updatedAt).toBe('2026-06-18T02:30:00.000Z')
  })
})
