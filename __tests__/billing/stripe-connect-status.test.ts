jest.mock('server-only', () => ({}))

import { getLegacyStripeAccountStatus, saveBuilderStripeAccount } from '@/lib/stripe/connect'

type UpsertCall = {
  table: string
  payload: Record<string, unknown>
}

function makeConstraintFallbackDb() {
  const upserts: UpsertCall[] = []

  const db = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>) {
          upserts.push({ table, payload })

          return {
            select() {
              return {
                async single() {
                  if (upserts.length === 1) {
                    return {
                      data: null,
                      error: {
                        message:
                          'new row for relation "builder_stripe_accounts" violates check constraint "builder_stripe_accounts_status_check"',
                      },
                    }
                  }

                  return { data: payload, error: null }
                },
              }
            },
          }
        },
      }
    },
  }

  return { db, upserts }
}

describe('Stripe Connect account status persistence', () => {
  it('maps detailed account statuses to the legacy persisted constraint values', () => {
    expect(getLegacyStripeAccountStatus('pending_onboarding')).toBe('pending')
    expect(getLegacyStripeAccountStatus('onboarding_started')).toBe('pending')
    expect(getLegacyStripeAccountStatus('capabilities_pending')).toBe('pending')
    expect(getLegacyStripeAccountStatus('active')).toBe('active')
    expect(getLegacyStripeAccountStatus('complete')).toBe('active')
    expect(getLegacyStripeAccountStatus('restricted')).toBe('restricted')
    expect(getLegacyStripeAccountStatus('disabled')).toBe('restricted')
  })

  it('retries builder account saves with a legacy status when the deployed DB constraint is stale', async () => {
    const { db, upserts } = makeConstraintFallbackDb()
    const account = {
      id: 'acct_preview_pending',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['business_profile.url'],
        eventually_due: ['external_account'],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
      },
    }

    const saved = await saveBuilderStripeAccount(db as never, 'user_1', 'builder_1', account as never)

    expect(upserts).toHaveLength(2)
    expect(upserts[0]?.payload.account_status).toBe('pending_onboarding')
    expect(upserts[1]?.payload.account_status).toBe('pending')
    expect(saved.account_status).toBe('pending')
  })
})
