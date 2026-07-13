jest.mock('server-only', () => ({}))

const mockGetAuthenticatedBuilderBillingProfile = jest.fn()
const mockEnsureStripeCustomerForBuilder = jest.fn()
const mockCreateClient = jest.fn()
const mockCreateServiceRoleClient = jest.fn()
const mockGetStripeClient = jest.fn()

const mockStripeCustomersListPaymentMethods = jest.fn()
const mockStripeCustomersRetrievePaymentMethod = jest.fn()
const mockStripeSetupIntentsCreate = jest.fn()
const mockStripeSetupIntentsRetrieve = jest.fn()

jest.mock('@/lib/billing/builder-billing', () => ({
  getAuthenticatedBuilderBillingProfile: (...args: unknown[]) => (
    mockGetAuthenticatedBuilderBillingProfile(...args)
  ),
  ensureStripeCustomerForBuilder: (...args: unknown[]) => (
    mockEnsureStripeCustomerForBuilder(...args)
  ),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
  createServiceRoleClient: () => mockCreateServiceRoleClient(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: () => mockGetStripeClient(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import type { NextRequest } from 'next/server'
import {
  GET as listPaymentMethods,
  POST as createSetupIntent,
} from '@/app/api/planner/payment-methods/route'
import { POST as confirmSetupIntent } from '@/app/api/planner/payment-methods/confirm/route'

const USER_ID = '550e8400-e29b-41d4-a716-446655440101'
const BUILDER_ID = '550e8400-e29b-41d4-a716-446655440102'
const SETUP_ATTEMPT_ID = '550e8400-e29b-41d4-a716-446655440103'
const CUSTOMER_ID = 'cus_planner_owner'

type PaymentMethodRow = {
  builder_id: string
  stripe_payment_method_id: string
  card_brand: string
  card_last4: string
  card_exp_month: number
  card_exp_year: number
  is_default: boolean
  is_active: boolean
  updated_at?: string
}

class PaymentMethodDb {
  rows: PaymentMethodRow[]
  upsertCalls: Array<{ payload: Record<string, unknown>; options: Record<string, unknown> }> = []

  constructor(rows: PaymentMethodRow[] = []) {
    this.rows = rows
  }

  from(table: string) {
    if (table !== 'builder_payment_methods') {
      throw new Error(`Unexpected table: ${table}`)
    }

    return {
      select: (_columns: string) => ({
        eq: async (field: string, value: unknown) => ({
          data: this.rows.filter((row) => row[field as keyof PaymentMethodRow] === value),
          error: null,
        }),
      }),
      upsert: (payload: Record<string, unknown>, options: Record<string, unknown>) => {
        this.upsertCalls.push({ payload, options })
        const paymentMethodId = String(payload.stripe_payment_method_id)
        let row = this.rows.find((candidate) => (
          candidate.stripe_payment_method_id === paymentMethodId
        ))
        if (row) {
          Object.assign(row, payload)
        } else {
          row = {
            is_default: false,
            ...(payload as Omit<PaymentMethodRow, 'is_default'>),
          }
          this.rows.push(row)
        }

        return {
          select: (_columns: string) => ({
            single: async () => ({ data: { ...row }, error: null }),
          }),
        }
      },
    }
  }
}

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>
}

function ownedCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pm_planner_owned',
    type: 'card',
    customer: CUSTOMER_ID,
    card: {
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2032,
      fingerprint: 'do_not_return',
    },
    billing_details: {
      email: 'private-cardholder@example.com',
      name: 'Private Cardholder',
    },
    metadata: { private_note: 'do_not_return' },
    ...overrides,
  }
}

describe('planner organizer payment-method routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateClient.mockReturnValue({ auth: {} })
    mockGetAuthenticatedBuilderBillingProfile.mockResolvedValue({
      user: { id: USER_ID, email: 'organizer@example.com' },
      builder: {
        id: BUILDER_ID,
        user_id: USER_ID,
        name: 'Organizer',
        stripe_customer_id: CUSTOMER_ID,
      },
      error: null,
      status: 200,
    })
    mockEnsureStripeCustomerForBuilder.mockResolvedValue(CUSTOMER_ID)
    mockGetStripeClient.mockReturnValue({
      customers: {
        listPaymentMethods: mockStripeCustomersListPaymentMethods,
        retrievePaymentMethod: mockStripeCustomersRetrievePaymentMethod,
      },
      setupIntents: {
        create: mockStripeSetupIntentsCreate,
        retrieve: mockStripeSetupIntentsRetrieve,
      },
    })
  })

  it('lists only safe card summaries from the authenticated Customer', async () => {
    const db = new PaymentMethodDb([{
      builder_id: BUILDER_ID,
      stripe_payment_method_id: 'pm_planner_owned',
      card_brand: 'visa',
      card_last4: '4242',
      card_exp_month: 12,
      card_exp_year: 2032,
      is_default: true,
      is_active: true,
    }])
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockStripeCustomersListPaymentMethods.mockResolvedValue({
      data: [
        ownedCard(),
        { id: 'pm_not_a_card', type: 'us_bank_account', customer: CUSTOMER_ID },
      ],
    })

    const response = await listPaymentMethods()
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(mockStripeCustomersListPaymentMethods).toHaveBeenCalledWith(
      CUSTOMER_ID,
      { type: 'card' }
    )
    expect(json).toEqual({
      paymentMethods: [{
        id: 'pm_planner_owned',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2032,
        isDefault: true,
      }],
    })
    expect(JSON.stringify(json)).not.toContain('private-cardholder')
    expect(JSON.stringify(json)).not.toContain('fingerprint')
    expect(JSON.stringify(json)).not.toContain(CUSTOMER_ID)
  })

  it('creates an on-session Customer SetupIntent with retry-stable idempotency', async () => {
    const db = new PaymentMethodDb()
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockStripeSetupIntentsCreate.mockResolvedValue({
      id: 'seti_planner_setup',
      client_secret: 'seti_planner_setup_secret_test',
    })

    const response = await createSetupIntent(
      request('/api/planner/payment-methods', { setupAttemptId: SETUP_ATTEMPT_ID })
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(mockEnsureStripeCustomerForBuilder).toHaveBeenCalledWith(expect.objectContaining({
      admin: db,
      builder: expect.objectContaining({ id: BUILDER_ID }),
      email: 'organizer@example.com',
    }))
    expect(mockStripeSetupIntentsCreate).toHaveBeenCalledWith(
      {
        customer: CUSTOMER_ID,
        usage: 'on_session',
        payment_method_types: ['card'],
        metadata: {
          payment_kind: 'planner_builder_payment_method',
          builder_id: BUILDER_ID,
          user_id: USER_ID,
          setup_attempt_id: SETUP_ATTEMPT_ID,
        },
      },
      {
        idempotencyKey: `planner_payment_method_setup_${BUILDER_ID}_${SETUP_ATTEMPT_ID}`,
      }
    )
    expect(json).toEqual({
      setupIntentId: 'seti_planner_setup',
      clientSecret: 'seti_planner_setup_secret_test',
    })
    expect(json).not.toHaveProperty('customerId')
  })

  it('verifies Stripe truth and idempotently caches a completed owned card', async () => {
    const db = new PaymentMethodDb()
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockStripeSetupIntentsRetrieve.mockResolvedValue({
      id: 'seti_planner_complete',
      status: 'succeeded',
      customer: CUSTOMER_ID,
      payment_method: 'pm_planner_owned',
      metadata: {
        builder_id: BUILDER_ID,
        user_id: USER_ID,
      },
    })
    mockStripeCustomersRetrievePaymentMethod.mockResolvedValue(ownedCard())

    const first = await confirmSetupIntent(
      request('/api/planner/payment-methods/confirm', {
        setupIntentId: 'seti_planner_complete',
      })
    )
    const second = await confirmSetupIntent(
      request('/api/planner/payment-methods/confirm', {
        setupIntentId: 'seti_planner_complete',
      })
    )
    const json = await readJson(first)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mockStripeCustomersRetrievePaymentMethod).toHaveBeenCalledWith(
      CUSTOMER_ID,
      'pm_planner_owned'
    )
    expect(db.upsertCalls).toHaveLength(2)
    expect(db.upsertCalls[0]).toEqual({
      payload: expect.objectContaining({
        builder_id: BUILDER_ID,
        stripe_payment_method_id: 'pm_planner_owned',
        card_brand: 'visa',
        card_last4: '4242',
        card_exp_month: 12,
        card_exp_year: 2032,
        is_active: true,
      }),
      options: { onConflict: 'stripe_payment_method_id' },
    })
    expect(db.rows).toHaveLength(1)
    expect(json).toEqual({
      paymentMethod: {
        id: 'pm_planner_owned',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2032,
        isDefault: false,
      },
    })
    expect(JSON.stringify(json)).not.toContain(CUSTOMER_ID)
    expect(JSON.stringify(db.rows)).not.toContain('private-cardholder')
  })

  it('rejects a SetupIntent belonging to another Customer before local persistence', async () => {
    const db = new PaymentMethodDb()
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockStripeSetupIntentsRetrieve.mockResolvedValue({
      id: 'seti_cross_customer',
      status: 'succeeded',
      customer: 'cus_other_organizer',
      payment_method: 'pm_other_organizer',
      metadata: {
        builder_id: BUILDER_ID,
        user_id: USER_ID,
      },
    })

    const response = await confirmSetupIntent(
      request('/api/planner/payment-methods/confirm', {
        setupIntentId: 'seti_cross_customer',
      })
    )

    expect(response.status).toBe(403)
    expect(await readJson(response)).toEqual({
      error: 'This payment method is not attached to the authenticated organizer.',
      code: 'builder_payment_method_forbidden',
    })
    expect(mockStripeCustomersRetrievePaymentMethod).not.toHaveBeenCalled()
    expect(db.upsertCalls).toHaveLength(0)
  })

  it('rejects an unattached PaymentMethod without caching it', async () => {
    const db = new PaymentMethodDb()
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockStripeSetupIntentsRetrieve.mockResolvedValue({
      id: 'seti_unattached_method',
      status: 'succeeded',
      customer: CUSTOMER_ID,
      payment_method: 'pm_unattached',
      metadata: {
        builder_id: BUILDER_ID,
        user_id: USER_ID,
      },
    })
    mockStripeCustomersRetrievePaymentMethod.mockRejectedValue({
      code: 'resource_missing',
    })

    const response = await confirmSetupIntent(
      request('/api/planner/payment-methods/confirm', {
        setupIntentId: 'seti_unattached_method',
      })
    )

    expect(response.status).toBe(403)
    expect(db.upsertCalls).toHaveLength(0)
  })

  it('requires authentication before creating Stripe state', async () => {
    const db = new PaymentMethodDb()
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockGetAuthenticatedBuilderBillingProfile.mockResolvedValue({
      user: null,
      builder: null,
      error: 'Not authenticated',
      status: 401,
    })

    const response = await createSetupIntent(
      request('/api/planner/payment-methods', { setupAttemptId: SETUP_ATTEMPT_ID })
    )

    expect(response.status).toBe(401)
    expect(mockEnsureStripeCustomerForBuilder).not.toHaveBeenCalled()
    expect(mockStripeSetupIntentsCreate).not.toHaveBeenCalled()
  })
})
