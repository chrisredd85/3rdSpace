import 'server-only'

import type Stripe from 'stripe'
type AnySupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, any, any>

export type StripeConnectAccountTable =
  | 'vendor_profiles'
  | 'owner_profiles'
  | 'vendor_stripe_accounts'
  | 'venue_stripe_accounts'
  | 'builder_stripe_accounts'

export type StripeConnectGuardResult = {
  accountId: string | null
  account?: Stripe.Account
  mismatchCleared: boolean
}

type ValidateStripeConnectAccountParams = {
  stripe: Stripe
  db: AnySupabaseClient
  table: StripeConnectAccountTable
  rowId: string
  currentAccountId: string | null | undefined
  idColumn?: string
}

type ClearConfig = {
  idColumn: string
  reset: Record<string, unknown>
  mirrors?: Array<{
    table: StripeConnectAccountTable
    idColumn: string
    reset: Record<string, unknown>
  }>
}

const ACCOUNT_RESET = {
  stripe_account_id: null,
  account_status: 'pending',
  charges_enabled: false,
  payouts_enabled: false,
} as const

const CLEAR_CONFIGS: Record<StripeConnectAccountTable, ClearConfig> = {
  vendor_profiles: {
    idColumn: 'id',
    reset: {
      stripe_account_id: null,
      payout_enabled: false,
    },
  },
  owner_profiles: {
    idColumn: 'id',
    reset: {
      stripe_account_id: null,
      payout_enabled: false,
      stripe_account_status: 'pending',
    },
  },
  vendor_stripe_accounts: {
    idColumn: 'vendor_id',
    reset: ACCOUNT_RESET,
    mirrors: [
      {
        table: 'vendor_profiles',
        idColumn: 'id',
        reset: {
          stripe_account_id: null,
          payout_enabled: false,
        },
      },
    ],
  },
  venue_stripe_accounts: {
    idColumn: 'owner_id',
    reset: ACCOUNT_RESET,
    mirrors: [
      {
        table: 'owner_profiles',
        idColumn: 'user_id',
        reset: {
          stripe_account_id: null,
          payout_enabled: false,
          stripe_account_status: 'pending',
        },
      },
    ],
  },
  builder_stripe_accounts: {
    idColumn: 'user_id',
    reset: ACCOUNT_RESET,
  },
}

function getStripeErrorCode(error: unknown) {
  const candidate = error as { code?: unknown; raw?: { code?: unknown } } | null
  return typeof candidate?.code === 'string'
    ? candidate.code
    : typeof candidate?.raw?.code === 'string'
      ? candidate.raw.code
      : null
}

function getStripeErrorMessage(error: unknown) {
  const candidate = error as { message?: unknown; raw?: { message?: unknown } } | null
  return typeof candidate?.message === 'string'
    ? candidate.message
    : typeof candidate?.raw?.message === 'string'
      ? candidate.raw.message
      : ''
}

export function isStripeConnectModeMismatchError(error: unknown) {
  const code = getStripeErrorCode(error)
  const message = getStripeErrorMessage(error)

  return (
    code === 'account_invalid' &&
    /no such account/i.test(message) &&
    /similar object exists in (test|live) mode/i.test(message)
  )
}

async function clearStripeAccountReference(
  db: AnySupabaseClient,
  table: StripeConnectAccountTable,
  rowId: string,
  idColumn: string,
  currentAccountId: string
) {
  const now = new Date().toISOString()
  const config = CLEAR_CONFIGS[table]
  const reset = {
    ...config.reset,
    updated_at: now,
    ...(table.endsWith('_stripe_accounts')
      ? {
          requirements_due: {
            stripe_mode_mismatch: true,
            stale_account_id: currentAccountId,
            cleared_at: now,
          },
        }
      : {}),
  }

  const { error } = await db
    .from(table)
    .update(reset)
    .eq(idColumn, rowId)

  if (error) {
    throw new Error(`Failed to clear stale Stripe Connect account from ${table}: ${error.message}`)
  }

  for (const mirror of config.mirrors ?? []) {
    const { error: mirrorError } = await db
      .from(mirror.table)
      .update({
        ...mirror.reset,
        updated_at: now,
      })
      .eq(mirror.idColumn, rowId)

    if (mirrorError) {
      throw new Error(`Failed to clear mirrored Stripe Connect account from ${mirror.table}: ${mirrorError.message}`)
    }
  }
}

export async function validateStripeConnectAccount({
  stripe,
  db,
  table,
  rowId,
  currentAccountId,
  idColumn,
}: ValidateStripeConnectAccountParams): Promise<StripeConnectGuardResult> {
  if (!currentAccountId) {
    return { accountId: null, mismatchCleared: false }
  }

  try {
    const account = await stripe.accounts.retrieve(currentAccountId)
    return { accountId: account.id, account, mismatchCleared: false }
  } catch (error) {
    if (!isStripeConnectModeMismatchError(error)) {
      throw error
    }

    await clearStripeAccountReference(
      db,
      table,
      rowId,
      idColumn ?? CLEAR_CONFIGS[table].idColumn,
      currentAccountId
    )

    return { accountId: null, mismatchCleared: true }
  }
}
