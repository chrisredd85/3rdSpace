jest.mock('server-only', () => ({}))

import {
  createBuilderCheckoutSession,
  ensureStripeCustomerForBuilder,
  getBuilderBillingSummary,
} from '@/lib/billing/builder-billing'
import { getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://3rdplace.test'),
  getStripeClient: jest.fn(),
}))

function createAdminMock() {
  const updates: Array<{ table: string; payload: unknown; filters: Array<[string, unknown]> }> = []

  return {
    updates,
    admin: {
      from: jest.fn((table: string) => ({
        update: jest.fn((payload: unknown) => {
          const entry = { table, payload, filters: [] as Array<[string, unknown]> }
          updates.push(entry)
          const query = {
            eq: jest.fn((column: string, value: unknown) => {
              entry.filters.push([column, value])
              return query
            }),
          }
          return query
        }),
      })),
    },
  }
}

const builder = {
  id: 'builder-1',
  user_id: 'user-1',
  name: 'QA Builder',
  stripe_customer_id: 'cus_existing',
}

describe('builder billing Stripe customer resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reuses a stored Stripe customer when it exists in the active Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockResolvedValue({ id: 'cus_existing' }),
        create: jest.fn(),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_existing')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('replaces a stored customer id that belongs to the other Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_replacement')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'qa@example.com',
        name: 'QA Builder',
        metadata: {
          builder_id: 'builder-1',
          user_id: 'user-1',
        },
      })
    )
    expect(updates).toEqual([
      {
        table: 'builder_profiles',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [['id', 'builder-1']],
      },
      {
        table: 'builder_subscriptions',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [
          ['builder_id', 'builder-1'],
          ['stripe_customer_id', 'cus_existing'],
        ],
      },
    ])
  })

  it('creates checkout with the replacement customer when the stored one is stale', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test' }),
        },
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin } = createAdminMock()

    await createBuilderCheckoutSession({
      admin,
      request: new Request('https://3rdplace.test/planner/billing'),
      builder,
      userEmail: 'qa@example.com',
      type: 'pay_per_event',
    })

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_replacement',
        mode: 'payment',
      })
    )
  })
})

describe('builder billing free tier summary', () => {
  it('grants two free events by default for new and legacy one-event profiles', () => {
    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: null,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)

    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 1,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)
  })
})
