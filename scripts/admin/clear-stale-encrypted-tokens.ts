import { createClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/server/token-crypto'
import type { Database } from '@/lib/types/database-generated'

type SupportedTable = 'builder_ticketing_connections' | 'provider_connections'

type AffectedRow = {
  table: SupportedTable
  id: string
  columns: string[]
  reason: string
  setStatus: 'setup_required' | null
}

type CleanupResult = {
  table: SupportedTable
  id: string
  action:
    | 'cleared'
    | 'skipped_not_found'
    | 'skipped_already_clear'
    | 'aborted_decryptable'
    | 'failed'
  columns?: string[]
  decryptable_columns?: string[]
  error?: string
}

const ROTATION_REASON = 'stale_token_crypto_key_rotation_2026_06_25'

const AFFECTED_ROWS: AffectedRow[] = [
  {
    table: 'builder_ticketing_connections',
    id: '11cf69df-d660-4777-b8eb-1d6026276d59',
    columns: ['access_token_encrypted', 'refresh_token_encrypted', 'webhook_secret_encrypted'],
    reason: ROTATION_REASON,
    setStatus: 'setup_required',
  },
  {
    table: 'provider_connections',
    id: '00ec6025-3e65-480e-b6df-0ff0e60623eb',
    columns: ['encrypted_credentials'],
    reason: ROTATION_REASON,
    setStatus: 'setup_required',
  },
  {
    table: 'builder_ticketing_connections',
    id: '1327a847-7754-46ba-823a-db37b160aa0c',
    columns: ['access_token_encrypted', 'refresh_token_encrypted', 'webhook_secret_encrypted'],
    reason: ROTATION_REASON,
    setStatus: 'setup_required',
  },
  {
    table: 'builder_ticketing_connections',
    id: 'c44d18c9-f3bb-4622-b360-3c300260dfc9',
    columns: ['webhook_secret_encrypted'],
    reason: ROTATION_REASON,
    setStatus: 'setup_required',
  },
]

function assertConfirmed() {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'Refusing to clear encrypted tokens without --confirm. Usage: npx tsx scripts/admin/clear-stale-encrypted-tokens.ts --confirm'
    )
  }
}

function createScriptServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
  }

  return createClient<Database, 'public'>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}

function valueLooksEncryptedCredential(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function collectCredentialStrings(value: unknown): string[] {
  if (valueLooksEncryptedCredential(value)) {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCredentialStrings(item))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectCredentialStrings(item)
    )
  }

  return []
}

function decryptable(value: string): boolean {
  try {
    decryptSecret(value)
    return true
  } catch {
    return false
  }
}

function hasEncryptedValues(row: Record<string, unknown>, columns: string[]) {
  return columns.filter((column) => collectCredentialStrings(row[column]).length > 0)
}

async function insertAuditLog(
  supabase: ReturnType<typeof createScriptServiceRoleClient>,
  row: AffectedRow,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
  clearedColumns: string[]
) {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_user_id: null,
    action: 'cleared_stale_ciphertext',
    entity_type: row.table,
    entity_id: row.id,
    reason: row.reason,
    before_state: beforeState,
    after_state: afterState,
    metadata: {
      columns_cleared: clearedColumns,
      status_set: row.setStatus,
      script: 'scripts/admin/clear-stale-encrypted-tokens.ts',
    },
  } as never)

  if (error) {
    throw new Error(`admin_audit_log insert failed for ${row.table}:${row.id}: ${error.message}`)
  }
}

async function clearRow(
  supabase: ReturnType<typeof createScriptServiceRoleClient>,
  row: AffectedRow
): Promise<CleanupResult> {
  const { data, error: loadError } = await supabase
    .from(row.table)
    .select('*')
    .eq('id', row.id)
    .maybeSingle()

  if (loadError) {
    return { table: row.table, id: row.id, action: 'failed', error: loadError.message }
  }

  if (!data) {
    return { table: row.table, id: row.id, action: 'skipped_not_found' }
  }

  const record = data as Record<string, unknown>
  const encryptedColumns = hasEncryptedValues(record, row.columns)

  if (encryptedColumns.length === 0) {
    return { table: row.table, id: row.id, action: 'skipped_already_clear' }
  }

  const stillDecryptable = encryptedColumns.filter((column) =>
    collectCredentialStrings(record[column]).some((value) => decryptable(value))
  )
  if (stillDecryptable.length > 0) {
    return {
      table: row.table,
      id: row.id,
      action: 'aborted_decryptable',
      decryptable_columns: stillDecryptable,
    }
  }

  const updatedAt = new Date().toISOString()
  const update: Record<string, unknown> = {
    updated_at: updatedAt,
    last_error: row.reason,
  }

  for (const column of row.columns) {
    update[column] = column === 'encrypted_credentials' ? {} : null
  }

  if (row.setStatus) {
    update.status = row.setStatus
  }

  const { data: updated, error: updateError } = await supabase
    .from(row.table)
    .update(update as never)
    .eq('id', row.id)
    .select('*')
    .maybeSingle()

  if (updateError) {
    return { table: row.table, id: row.id, action: 'failed', error: updateError.message }
  }

  await insertAuditLog(
    supabase,
    row,
    record,
    (updated as Record<string, unknown> | null) ?? update,
    encryptedColumns
  )

  return { table: row.table, id: row.id, action: 'cleared', columns: encryptedColumns }
}

async function cleanup() {
  assertConfirmed()

  const supabase = createScriptServiceRoleClient()
  const results: CleanupResult[] = []

  for (const row of AFFECTED_ROWS) {
    try {
      results.push(await clearRow(supabase, row))
    } catch (error) {
      results.push({
        table: row.table,
        id: row.id,
        action: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log(JSON.stringify(results, null, 2))

  const failures = results.filter((result) =>
    ['failed', 'aborted_decryptable'].includes(result.action)
  )

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

cleanup().catch((error) => {
  console.error(error)
  process.exit(1)
})
