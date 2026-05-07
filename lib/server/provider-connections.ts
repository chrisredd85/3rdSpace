import 'server-only'

import type { Json } from '@/lib/types'

type SupabaseClient = any

export type ProviderConnectionProvider = 'eventbrite' | 'luma' | 'posh' | 'partiful'
export type ProviderConnectionStatus = 'setup_required' | 'pending' | 'connected' | 'linked' | 'failed' | 'disabled'

interface UpsertProviderConnectionInput {
  userId: string
  provider: ProviderConnectionProvider
  status: ProviderConnectionStatus
  builderId?: string | null
  planId?: string | null
  encryptedCredentials?: Record<string, Json | undefined>
  externalAccountId?: string | null
  webhookUrl?: string | null
  config?: Record<string, Json | undefined>
  lastConnectedAt?: string | null
  lastError?: string | null
}

/**
 * Upserts the normalized provider connection row used by planner ticketing.
 *
 * Existing product code still reads builder_ticketing_connections, so callers
 * should treat this as a compatibility dual-write and never block user flows on
 * a missing migration in local development.
 */
export async function upsertProviderConnection(
  client: SupabaseClient,
  input: UpsertProviderConnectionInput
) {
  if (!input.builderId && !input.planId) {
    throw new Error('Provider connection requires a builderId or planId')
  }

  let query = client
    .from('provider_connections')
    .select('id')
    .eq('user_id', input.userId)
    .eq('provider', input.provider)

  if (input.planId) {
    query = query.eq('plan_id', input.planId)
  } else {
    query = query.eq('builder_id', input.builderId).is('plan_id', null)
  }

  const { data: existing, error: lookupError } = await query.maybeSingle()
  if (lookupError) throw lookupError

  const row = {
    user_id: input.userId,
    builder_id: input.builderId ?? null,
    plan_id: input.planId ?? null,
    provider: input.provider,
    status: input.status,
    encrypted_credentials: removeUndefined(input.encryptedCredentials ?? {}),
    external_account_id: input.externalAccountId ?? null,
    webhook_url: input.webhookUrl ?? null,
    config: removeUndefined(input.config ?? {}),
    last_connected_at: input.lastConnectedAt ?? null,
    last_error: input.lastError ?? null,
    updated_at: new Date().toISOString(),
  }

  const result = existing?.id
    ? await client
        .from('provider_connections')
        .update(row)
        .eq('id', existing.id)
        .select('id')
        .single()
    : await client
        .from('provider_connections')
        .insert({
          ...row,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

  if (result.error) throw result.error
  return result.data as { id: string }
}

/**
 * Best-effort wrapper for local/dev environments where new migrations may not
 * be applied yet.
 */
export async function tryUpsertProviderConnection(
  client: SupabaseClient,
  input: UpsertProviderConnectionInput
) {
  try {
    return await upsertProviderConnection(client, input)
  } catch (error) {
    console.warn('[provider-connections] Dual-write skipped', error)
    return null
  }
}

function removeUndefined(value: Record<string, Json | undefined>) {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined)
  )
}
