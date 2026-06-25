import { notifyEntityStripeSetup, recordStripeReadyUnblockNotice } from '@/lib/server/notifyEntityStripeSetup'
import { sendEmailNotification } from '@/lib/email'

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

const mockedSendEmailNotification = sendEmailNotification as jest.MockedFunction<typeof sendEmailNotification>

describe('notifyEntityStripeSetup', () => {
  beforeEach(() => {
    mockedSendEmailNotification.mockReset()
    mockedSendEmailNotification.mockResolvedValue({ sent: true, responsePayload: { id: 'email-1' } } as any)
  })

  it('sends one setup email and records the notification', async () => {
    const db = createNotificationDb({
      venues: [{
        id: '11111111-1111-1111-1111-111111111111',
        venue_name: 'Moongate Lounge',
        contact_email: 'events@moongate.example',
        owner_id: '22222222-2222-2222-2222-222222222222',
      }],
      stripe_setup_notifications: [],
    })

    const result = await notifyEntityStripeSetup({
      supabase: db,
      entityType: 'venue',
      entityId: '11111111-1111-1111-1111-111111111111',
      planId: '33333333-3333-3333-3333-333333333333',
      organizerId: '44444444-4444-4444-4444-444444444444',
      reason: 'onboarding_incomplete',
    })

    expect(result).toMatchObject({ sent: true, notification_id: 'notification-1' })
    expect(mockedSendEmailNotification).toHaveBeenCalledWith(expect.objectContaining({
      to: 'events@moongate.example',
      subject: 'Action needed: complete Stripe setup to receive payments',
    }))
    expect(db.rows.stripe_setup_notifications).toHaveLength(1)
    expect(db.rows.stripe_setup_notifications[0]).toMatchObject({
      entity_type: 'venue',
      entity_id: '11111111-1111-1111-1111-111111111111',
      sent: true,
    })
  })

  it('rate-limits setup notifications per entity for 24 hours', async () => {
    const db = createNotificationDb({
      venues: [{
        id: '11111111-1111-1111-1111-111111111111',
        venue_name: 'Moongate Lounge',
        contact_email: 'events@moongate.example',
        owner_id: null,
      }],
      stripe_setup_notifications: [{
        id: 'recent-notification',
        entity_type: 'venue',
        entity_id: '11111111-1111-1111-1111-111111111111',
        created_at: new Date().toISOString(),
      }],
    })

    const result = await notifyEntityStripeSetup({
      supabase: db,
      entityType: 'venue',
      entityId: '11111111-1111-1111-1111-111111111111',
      planId: '33333333-3333-3333-3333-333333333333',
      organizerId: '44444444-4444-4444-4444-444444444444',
      reason: 'restricted',
    })

    expect(result).toEqual({ sent: false, rate_limited: true, notification_id: 'recent-notification' })
    expect(mockedSendEmailNotification).not.toHaveBeenCalled()
  })

  it('records Stripe-ready webhook unblock notices without sending email', async () => {
    const db = createNotificationDb({ stripe_setup_notifications: [] })

    await recordStripeReadyUnblockNotice({
      supabase: db,
      entityType: 'vendor',
      entityId: '55555555-5555-5555-5555-555555555555',
      stripeAccountId: 'acct_ready',
      eventId: 'evt_ready',
    })

    expect(mockedSendEmailNotification).not.toHaveBeenCalled()
    expect(db.rows.stripe_setup_notifications[0]).toMatchObject({
      entity_type: 'vendor',
      entity_id: '55555555-5555-5555-5555-555555555555',
      channel: 'webhook_log',
      metadata: {
        action: 'stripe_ready_unblock_available',
        stripe_account_id: 'acct_ready',
        stripe_event_id: 'evt_ready',
      },
    })
  })
})

function createNotificationDb(initialRows: Record<string, Array<Record<string, unknown>>>) {
  const rows = {
    venues: [],
    vendor_profiles: [],
    users: [],
    stripe_setup_notifications: [],
    ...initialRows,
  } as Record<string, Array<Record<string, unknown>>>

  let insertCounter = 0

  const db = {
    rows,
    from(table: string) {
      const filters: Array<{ column: string; value: unknown; op: 'eq' | 'gte' }> = []
      let insertPayload: Record<string, unknown> | null = null
      let updatePayload: Record<string, unknown> | null = null
      const builder = {
        select() {
          return builder
        },
        insert(value: Record<string, unknown>) {
          insertPayload = {
            id: `notification-${++insertCounter}`,
            created_at: new Date().toISOString(),
            ...value,
          }
          rows[table] = rows[table] ?? []
          rows[table].push(insertPayload)
          return builder
        },
        update(value: Record<string, unknown>) {
          updatePayload = value
          return builder
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value, op: 'eq' })
          if (updatePayload) {
            for (const row of rows[table] ?? []) {
              if (row[column] === value) Object.assign(row, updatePayload)
            }
          }
          return builder
        },
        gte(column: string, value: unknown) {
          filters.push({ column, value, op: 'gte' })
          return builder
        },
        order() {
          return builder
        },
        limit() {
          return builder
        },
        async maybeSingle() {
          if (insertPayload) return { data: { id: insertPayload.id }, error: null }
          const row = (rows[table] ?? []).find((candidate) => filters.every((filter) => {
            if (filter.op === 'gte') return String(candidate[filter.column] ?? '') >= String(filter.value)
            return candidate[filter.column] === filter.value
          }))
          return { data: row ?? null, error: null }
        },
      }
      return builder
    },
  }

  return db as typeof db & { from: (table: string) => any }
}
