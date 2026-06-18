import {
  extractWebhookAttendanceCount,
  recordWebhookAttendanceForEvent,
} from '@/lib/finance/settlement-runs'

describe('settlement webhook attendance', () => {
  it('extracts check-in counts from common webhook payload shapes', () => {
    expect(extractWebhookAttendanceCount({ checked_in_count: 18 })).toBe(18)
    expect(extractWebhookAttendanceCount({ data: { attendance_count: '24' } })).toBe(24)
    expect(extractWebhookAttendanceCount({ data: { total_checked_in: 0 } })).toBe(0)
    expect(extractWebhookAttendanceCount({ type: 'event.updated' })).toBeNull()
  })

  it('caches webhook attendance when the settlement run does not exist yet', async () => {
    const db = createWebhookCacheDb()

    const result = await recordWebhookAttendanceForEvent(db as never, {
      eventId: 'event-1',
      source: 'webhook_posh',
      payload: { checked_in_count: 33 },
      attendanceCount: 33,
    })

    expect(result).toEqual({ recorded: false, cached: true })
    expect(db.cacheRows).toHaveLength(1)
    expect(db.cacheRows[0]).toMatchObject({
      event_id: 'event-1',
      source: 'webhook_posh',
      attendance_count: 33,
    })
  })
})

function createWebhookCacheDb() {
  const state = {
    cacheRows: [] as Array<Record<string, unknown>>,
  }

  return {
    get cacheRows() {
      return state.cacheRows
    },
    from(table: string) {
      const query: Record<string, unknown> = {
        table,
        mode: 'select',
        filters: [] as Array<[string, unknown]>,
        select() {
          return this
        },
        eq(column: string, value: unknown) {
          this.filters.push([column, value])
          return this
        },
        is(column: string, value: unknown) {
          this.filters.push([column, value])
          return this
        },
        update() {
          this.mode = 'update'
          return this
        },
        insert(values: Record<string, unknown>) {
          if (table !== 'settlement_attendance_webhook_cache') {
            return Promise.resolve({ error: { message: `Unexpected insert into ${table}` } })
          }
          state.cacheRows.push(values)
          return Promise.resolve({ error: null })
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null })
        },
      }
      return query
    },
  }
}
