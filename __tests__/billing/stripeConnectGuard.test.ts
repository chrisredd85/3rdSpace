jest.mock('server-only', () => ({}))

import {
  isStripeConnectModeMismatchError,
  validateStripeConnectAccount,
} from '@/lib/billing/stripeConnectGuard'

function makeDb() {
  const eq = jest.fn().mockResolvedValue({ error: null })
  const update = jest.fn(() => ({ eq }))
  const from = jest.fn(() => ({ update }))

  return {
    db: { from } as any,
    from,
    update,
    eq,
  }
}

function makeStripe(error?: unknown) {
  return {
    accounts: {
      retrieve: jest.fn(error
        ? () => Promise.reject(error)
        : async (accountId: string) => ({ id: accountId })),
    },
  } as any
}

describe('stripeConnectGuard', () => {
  it('detects Stripe Connect test/live mode mismatch errors only', () => {
    expect(isStripeConnectModeMismatchError({
      code: 'account_invalid',
      message: "No such account: 'acct_old'; a similar object exists in test mode, but a live mode key was used to make this request.",
    })).toBe(true)

    expect(isStripeConnectModeMismatchError({
      code: 'account_invalid',
      message: "No such account: 'acct_missing'.",
    })).toBe(false)

    expect(isStripeConnectModeMismatchError({
      code: 'resource_missing',
      message: "No such account: 'acct_old'; a similar object exists in test mode.",
    })).toBe(false)
  })

  it('returns the existing account when Stripe retrieval succeeds', async () => {
    const stripe = makeStripe()
    const { db, from } = makeDb()

    const result = await validateStripeConnectAccount({
      stripe,
      db,
      table: 'vendor_stripe_accounts',
      rowId: 'vendor-1',
      currentAccountId: 'acct_live',
    })

    expect(result).toEqual({
      accountId: 'acct_live',
      account: { id: 'acct_live' },
      mismatchCleared: false,
    })
    expect(stripe.accounts.retrieve).toHaveBeenCalledWith('acct_live')
    expect(from).not.toHaveBeenCalled()
  })

  it('clears a stale vendor account and its profile mirror on mode mismatch', async () => {
    const stripe = makeStripe({
      code: 'account_invalid',
      message: "No such account: 'acct_test'; a similar object exists in test mode, but a live mode key was used to make this request.",
    })
    const { db, from, update, eq } = makeDb()

    const result = await validateStripeConnectAccount({
      stripe,
      db,
      table: 'vendor_stripe_accounts',
      rowId: 'vendor-1',
      currentAccountId: 'acct_test',
    })

    expect(result).toEqual({ accountId: null, mismatchCleared: true })
    expect(from).toHaveBeenNthCalledWith(1, 'vendor_stripe_accounts')
    expect(from).toHaveBeenNthCalledWith(2, 'vendor_profiles')
    expect(update.mock.calls[0][0]).toEqual(expect.objectContaining({
      stripe_account_id: null,
      account_status: 'pending',
      charges_enabled: false,
      payouts_enabled: false,
      requirements_due: expect.objectContaining({
        stripe_mode_mismatch: true,
        stale_account_id: 'acct_test',
      }),
    }))
    expect(update.mock.calls[1][0]).toEqual(expect.objectContaining({
      stripe_account_id: null,
      payout_enabled: false,
    }))
    expect(eq).toHaveBeenNthCalledWith(1, 'vendor_id', 'vendor-1')
    expect(eq).toHaveBeenNthCalledWith(2, 'id', 'vendor-1')
  })

  it('clears a stale venue account and owner profile mirror on mode mismatch', async () => {
    const stripe = makeStripe({
      code: 'account_invalid',
      message: "No such account: 'acct_test'; a similar object exists in live mode, but a test mode key was used to make this request.",
    })
    const { db, from, update, eq } = makeDb()

    const result = await validateStripeConnectAccount({
      stripe,
      db,
      table: 'venue_stripe_accounts',
      rowId: 'owner-user-1',
      currentAccountId: 'acct_test',
    })

    expect(result).toEqual({ accountId: null, mismatchCleared: true })
    expect(from).toHaveBeenNthCalledWith(1, 'venue_stripe_accounts')
    expect(from).toHaveBeenNthCalledWith(2, 'owner_profiles')
    expect(update.mock.calls[0][0]).toEqual(expect.objectContaining({
      stripe_account_id: null,
      account_status: 'pending',
      charges_enabled: false,
      payouts_enabled: false,
    }))
    expect(update.mock.calls[1][0]).toEqual(expect.objectContaining({
      stripe_account_id: null,
      payout_enabled: false,
      stripe_account_status: 'pending',
    }))
    expect(eq).toHaveBeenNthCalledWith(1, 'owner_id', 'owner-user-1')
    expect(eq).toHaveBeenNthCalledWith(2, 'user_id', 'owner-user-1')
  })

  it('does not call Stripe or update rows when the account id is already null', async () => {
    const stripe = makeStripe()
    const { db, from } = makeDb()

    const result = await validateStripeConnectAccount({
      stripe,
      db,
      table: 'venue_stripe_accounts',
      rowId: 'owner-1',
      currentAccountId: null,
    })

    expect(result).toEqual({ accountId: null, mismatchCleared: false })
    expect(stripe.accounts.retrieve).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('propagates non-mode-mismatch Stripe errors without clearing data', async () => {
    const error = {
      code: 'account_invalid',
      message: "No such account: 'acct_missing'.",
    }
    const stripe = makeStripe(error)
    const { db, from } = makeDb()

    await expect(validateStripeConnectAccount({
      stripe,
      db,
      table: 'venue_stripe_accounts',
      rowId: 'owner-1',
      currentAccountId: 'acct_missing',
    })).rejects.toBe(error)

    expect(from).not.toHaveBeenCalled()
  })
})
