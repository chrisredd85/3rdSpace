jest.mock('server-only', () => ({}))

import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { processStripeConnectWebhookEvent } from '@/lib/stripe/connect-webhook'

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

const mockCaptureMessage = Sentry.captureMessage as jest.Mock

type Row = Record<string, any>
type RoleName = 'vendor' | 'venue' | 'builder'

type RoleConfig = {
  role: RoleName
  table: 'vendor_stripe_accounts' | 'venue_stripe_accounts' | 'builder_stripe_accounts'
  ownerColumn: 'vendor_id' | 'owner_id' | 'user_id'
  ownerId: string
  accountId: string
}

const ROLE_CONFIGS: RoleConfig[] = [
  {
    role: 'vendor',
    table: 'vendor_stripe_accounts',
    ownerColumn: 'vendor_id',
    ownerId: '550e8400-e29b-41d4-a716-446655441001',
    accountId: 'acct_vendor_kyc',
  },
  {
    role: 'venue',
    table: 'venue_stripe_accounts',
    ownerColumn: 'owner_id',
    ownerId: '550e8400-e29b-41d4-a716-446655441002',
    accountId: 'acct_venue_kyc',
  },
  {
    role: 'builder',
    table: 'builder_stripe_accounts',
    ownerColumn: 'user_id',
    ownerId: '550e8400-e29b-41d4-a716-446655441003',
    accountId: 'acct_builder_kyc',
  },
]

class MemoryDb {
  rows: Record<string, Row[]> = {
    vendor_stripe_accounts: [],
    vendor_profiles: [],
    venue_stripe_accounts: [],
    owner_profiles: [],
    builder_stripe_accounts: [],
  }
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  capturingPaymentIntentsPreserved = 0

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args })
    return {
      data: fn === 'block_inflight_stripe_account_payments'
        ? { capturing_payment_intents_preserved: this.capturingPaymentIntentsPreserved }
        : null,
      error: null,
    }
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private operation: 'select' | 'update' | 'upsert' = 'select'
  private payload: Row | null = null
  private selectedColumns = '*'
  private onConflict: string | null = null

  constructor(
    private db: MemoryDb,
    private table: string
  ) {}

  select(columns = '*') {
    this.selectedColumns = columns
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Row, options?: { onConflict?: string }) {
    this.operation = 'upsert'
    this.payload = payload
    this.onConflict = options?.onConflict ?? null
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  async single() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Row | Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'upsert' && this.payload) {
      const conflictColumns = (this.onConflict ?? 'id')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
      const existing = this.db.rows[this.table].find((row) => (
        conflictColumns.every((column) => row[column] === this.payload?.[column])
      ))
      const now = new Date().toISOString()
      if (existing) {
        Object.assign(existing, this.payload, { updated_at: this.payload.updated_at ?? now })
        return { data: this.project(existing), error: null }
      }

      const inserted = {
        id: `${this.table}-${this.db.rows[this.table].length + 1}`,
        created_at: now,
        updated_at: now,
        ...this.payload,
      }
      this.db.rows[this.table].push(inserted)
      return { data: this.project(inserted), error: null }
    }

    if (this.operation === 'update' && this.payload) {
      const rows = this.db.rows[this.table].filter((row) => this.matches(row))
      rows.forEach((row) => Object.assign(row, this.payload, { updated_at: this.payload?.updated_at ?? new Date().toISOString() }))
      return { data: rows.map((row) => this.project(row)), error: null }
    }

    const rows = this.db.rows[this.table].filter((row) => this.matches(row))
    return { data: rows.map((row) => this.project(row)), error: null }
  }

  private matches(row: Row) {
    return this.filters.every(([field, value]) => row[field] === value)
  }

  private project(row: Row) {
    if (this.selectedColumns === '*' || !this.selectedColumns.trim()) return row
    const columns = this.selectedColumns.split(',').map((column) => column.trim()).filter(Boolean)
    return Object.fromEntries(columns.map((column) => [column, row[column]]))
  }
}

function seedDb(config: RoleConfig) {
  const db = new MemoryDb()
  const baseRow = {
    id: `${config.role}-stripe-account-row`,
    [config.ownerColumn]: config.ownerId,
    stripe_account_id: config.accountId,
    account_status: 'active',
    charges_enabled: true,
    payouts_enabled: true,
    requirements_due: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    disabled_reason: null,
    last_webhook_event_id: null,
    last_webhook_event_type: null,
    last_webhook_at: null,
  }

  if (config.role === 'builder') {
    db.rows.builder_stripe_accounts.push({
      ...baseRow,
      builder_id: '550e8400-e29b-41d4-a716-446655449999',
    })
  } else {
    db.rows[config.table].push(baseRow)
  }

  if (config.role === 'vendor') {
    db.rows.vendor_profiles.push({
      id: config.ownerId,
      stripe_account_id: config.accountId,
      payout_enabled: true,
      stripe_skipped_at: '2026-06-01T12:00:00.000Z',
    })
  }

  if (config.role === 'venue') {
    db.rows.owner_profiles.push({
      user_id: config.ownerId,
      stripe_account_id: config.accountId,
      payout_enabled: true,
    })
  }

  return db
}

function makeAccount(config: RoleConfig, overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: config.accountId,
    object: 'account',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: true,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    ...overrides,
  } as Stripe.Account
}

function accountUpdatedEvent(config: RoleConfig, account: Stripe.Account, eventId: string): Stripe.Event {
  return {
    id: eventId,
    object: 'event',
    type: 'account.updated',
    account: config.accountId,
    data: { object: account },
  } as Stripe.Event
}

function capabilityEvent(config: RoleConfig, eventId: string): Stripe.Event {
  return {
    id: eventId,
    object: 'event',
    type: 'capability.updated',
    account: config.accountId,
    data: {
      object: {
        id: 'card_payments',
        object: 'capability',
        account: config.accountId,
        status: 'inactive',
      },
    },
  } as Stripe.Event
}

function deauthorizedEvent(config: RoleConfig, eventId: string): Stripe.Event {
  return {
    id: eventId,
    object: 'event',
    type: 'account.application.deauthorized',
    account: config.accountId,
    data: {
      object: {
        id: 'ca_deauthorized',
        object: 'application',
      },
    },
  } as Stripe.Event
}

function targetRow(db: MemoryDb, config: RoleConfig) {
  const row = db.rows[config.table].find((account) => account.stripe_account_id === config.accountId)
  if (!row) throw new Error(`Missing ${config.role} account row`)
  return row
}

function expectReadiness(row: Row, expected: {
  status: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  disabledReason?: string | null
  currentlyDue?: string[]
  pastDue?: string[]
  pendingVerification?: string[]
}) {
  expect(row).toEqual(expect.objectContaining({
    account_status: expected.status,
    charges_enabled: expected.chargesEnabled,
    payouts_enabled: expected.payoutsEnabled,
  }))
  expect(row.requirements_due).toEqual(expect.objectContaining({
    disabled_reason: expected.disabledReason ?? null,
    currently_due: expected.currentlyDue ?? [],
    past_due: expected.pastDue ?? [],
    pending_verification: expected.pendingVerification ?? [],
  }))
}

describe.each(ROLE_CONFIGS)('Stripe Connect KYC failure handling for $role accounts', (config) => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('marks disabled_reason account.updated payloads as disabled', async () => {
    const db = seedDb(config)
    const account = makeAccount(config, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['external_account'],
        eventually_due: [],
        past_due: ['external_account'],
        pending_verification: [],
        disabled_reason: 'requirements.past_due',
      },
    })

    const result = await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_disabled`))

    expect(result).toEqual({ received: true })
    const row = targetRow(db, config)
    expectReadiness(row, {
      status: 'disabled',
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: 'requirements.past_due',
      currentlyDue: ['external_account'],
      pastDue: ['external_account'],
    })
    expect(row.last_webhook_event_id).toBe(`evt_${config.role}_disabled`)
    expect(row.last_webhook_event_type).toBe('account.updated')
  })

  it('marks past_due account.updated payloads as restricted', async () => {
    const db = seedDb(config)
    const account = makeAccount(config, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: ['owners.address.line1'],
        pending_verification: [],
        disabled_reason: null,
      },
    })

    await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_restricted`))

    expectReadiness(targetRow(db, config), {
      status: 'restricted',
      chargesEnabled: false,
      payoutsEnabled: false,
      pastDue: ['owners.address.line1'],
    })
    expect(db.rpcCalls).toContainEqual({
      fn: 'block_inflight_stripe_account_payments',
      args: {
        p_stripe_account_id: config.accountId,
        p_reason: 'account.updated',
        p_event_id: `evt_${config.role}_restricted`,
      },
    })
  })

  it('marks current requirements as capabilities_pending once onboarding details are submitted', async () => {
    const db = seedDb(config)
    const account = makeAccount(config, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: ['company.tax_id'],
        eventually_due: ['representative.verification.document'],
        past_due: [],
        pending_verification: ['individual.verification.document'],
        disabled_reason: null,
      },
    })

    await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_capabilities_pending`))

    expectReadiness(targetRow(db, config), {
      status: 'capabilities_pending',
      chargesEnabled: false,
      payoutsEnabled: false,
      currentlyDue: ['company.tax_id'],
      pendingVerification: ['individual.verification.document'],
    })
  })

  it('restores the account to active when Stripe reports charges and payouts enabled', async () => {
    const db = seedDb(config)
    const account = makeAccount(config, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
      },
    })

    await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_active`))

    expectReadiness(targetRow(db, config), {
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    })
    if (config.role === 'vendor') {
      expect(db.rows.vendor_profiles[0]).toEqual(expect.objectContaining({
        payout_enabled: true,
        stripe_skipped_at: null,
      }))
    }
    if (config.role === 'venue') {
      expect(db.rows.owner_profiles[0]).toEqual(expect.objectContaining({
        payout_enabled: true,
      }))
    }
  })

  it('handles replayed account.updated restoration idempotently without inserting duplicate account rows', async () => {
    const db = seedDb(config)
    const account = makeAccount(config, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
      },
    })

    await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_active_replay`))
    await processStripeConnectWebhookEvent(db as never, accountUpdatedEvent(config, account, `evt_${config.role}_active_replay`))

    expect(db.rows[config.table].filter((row) => row[config.ownerColumn] === config.ownerId)).toHaveLength(1)
    expectReadiness(targetRow(db, config), {
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
    })
  })

  it('records capability.updated without mutating readiness flags', async () => {
    const db = seedDb(config)

    const result = await processStripeConnectWebhookEvent(db as never, capabilityEvent(config, `evt_${config.role}_capability`))

    expect(result).toEqual({ received: true, observed: 'capability.updated' })
    expect(targetRow(db, config)).toEqual(expect.objectContaining({
      account_status: 'active',
      charges_enabled: true,
      payouts_enabled: true,
      last_webhook_event_id: `evt_${config.role}_capability`,
      last_webhook_event_type: 'capability.updated',
      last_webhook_at: expect.any(String),
    }))
  })

  it('marks deauthorized accounts disabled and asks the database to block in-flight money movement', async () => {
    const db = seedDb(config)
    db.capturingPaymentIntentsPreserved = 1

    const result = await processStripeConnectWebhookEvent(db as never, deauthorizedEvent(config, `evt_${config.role}_deauthorized`))

    expect(result).toEqual({ received: true })
    expect(targetRow(db, config)).toEqual(expect.objectContaining({
      account_status: 'disabled',
      charges_enabled: false,
      payouts_enabled: false,
      requirements_due: { disabled_reason: 'application_deauthorized' },
      disabled_reason: 'application_deauthorized',
    }))
    expect(db.rpcCalls).toEqual([
      {
        fn: 'block_inflight_stripe_account_payments',
        args: {
          p_stripe_account_id: config.accountId,
          p_reason: 'account.application.deauthorized',
          p_event_id: `evt_${config.role}_deauthorized`,
        },
      },
    ])
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'restricted_stripe_account_capture_preserved',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({
          action: 'restricted_stripe_account_capture_preserved',
          stripe_account_id: config.accountId,
        }),
        extra: expect.objectContaining({
          capturing_payment_intents_preserved: 1,
        }),
      })
    )
  })
})
