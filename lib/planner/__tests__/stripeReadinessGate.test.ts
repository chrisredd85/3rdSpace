import {
  checkAuthorizationActionStripeGate,
  checkStripeReadinessForAuthorization,
  resolveAuthorizationGateTarget,
} from '@/lib/planner/stripeReadinessGate'

describe('stripeReadinessGate', () => {
  it('allows a vendor with charges and payouts enabled', async () => {
    const db = createReadinessDb({
      vendor_stripe_accounts: [{
        vendor_id: 'vendor-ready',
        stripe_account_id: 'acct_ready',
        account_status: 'active',
        charges_enabled: true,
        payouts_enabled: true,
        disabled_reason: null,
      }],
    })

    await expect(checkStripeReadinessForAuthorization({
      supabase: db,
      entityType: 'vendor',
      entityId: 'vendor-ready',
    })).resolves.toEqual({ ready: true, account_id: 'acct_ready' })
  })

  it('blocks a claimed vendor without a Stripe account', async () => {
    const db = createReadinessDb({ vendor_stripe_accounts: [] })

    await expect(checkStripeReadinessForAuthorization({
      supabase: db,
      entityType: 'vendor',
      entityId: 'vendor-missing',
    })).resolves.toMatchObject({
      ready: false,
      reason: 'no_account',
      needs_action_by: 'vendor',
    })
  })

  it('blocks deauthorized connected accounts explicitly', async () => {
    const db = createReadinessDb({
      vendor_stripe_accounts: [{
        vendor_id: 'vendor-deauthorized',
        stripe_account_id: 'acct_disabled',
        account_status: 'disabled',
        charges_enabled: false,
        payouts_enabled: false,
        disabled_reason: 'application_deauthorized',
      }],
    })

    await expect(checkStripeReadinessForAuthorization({
      supabase: db,
      entityType: 'vendor',
      entityId: 'vendor-deauthorized',
    })).resolves.toMatchObject({
      ready: false,
      reason: 'deauthorized',
      account_id: 'acct_disabled',
    })
  })

  it('does not gate ordinary outreach approvals', () => {
    expect(resolveAuthorizationGateTarget({
      actionType: 'opportunity_send_venues',
      targetType: 'venue',
      targetId: 'venue-1',
      payload: { provider: 'Gmail' },
    })).toBeNull()
  })

  it('gates controlled-payment agent actions before approval creation', async () => {
    const db = createReadinessDb({
      vendor_stripe_accounts: [{
        vendor_id: 'vendor-pending',
        stripe_account_id: 'acct_pending',
        account_status: 'pending_onboarding',
        charges_enabled: false,
        payouts_enabled: false,
        disabled_reason: null,
      }],
    })

    await expect(checkAuthorizationActionStripeGate({
      supabase: db,
      actionType: 'hold_request',
      targetType: 'vendor',
      targetId: 'vendor-pending',
      amountCents: 125000,
      payload: {
        execution_mode: 'controlled_payment',
        payment_required: true,
      },
    })).resolves.toMatchObject({
      target: { entityType: 'vendor', entityId: 'vendor-pending' },
      gate: {
        ready: false,
        reason: 'onboarding_incomplete',
        account_id: 'acct_pending',
      },
    })
  })
})

function createReadinessDb(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = []
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value })
          return builder
        },
        async maybeSingle() {
          const rows = rowsByTable[table] ?? []
          const row = rows.find((candidate) => filters.every((filter) => candidate[filter.column] === filter.value))
          return { data: row ?? null, error: null }
        },
      }
      return builder
    },
  } as any
}
