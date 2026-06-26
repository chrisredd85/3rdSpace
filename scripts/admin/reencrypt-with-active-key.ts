import { createClient } from '@supabase/supabase-js'
import {
  decryptSecret,
  encryptSecret,
  getEncryptedSecretVersion,
  isActiveKeyVersion,
} from '@/lib/server/token-crypto'
import type { Database } from '@/lib/types/database-generated'

type SupportedTable = 'builder_ticketing_connections' | 'provider_connections'

type EncryptedColumnTarget = {
  table: SupportedTable
  columns: string[]
}

type ReencryptResult = {
  value: unknown
  changed: boolean
}

const ENCRYPTED_COLUMN_TARGETS: EncryptedColumnTarget[] = [
  {
    table: 'builder_ticketing_connections',
    columns: ['access_token_encrypted', 'refresh_token_encrypted', 'webhook_secret_encrypted'],
  },
  {
    table: 'provider_connections',
    columns: ['encrypted_credentials'],
  },
]

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

export function reencryptCredentialValue(value: unknown): ReencryptResult {
  if (typeof value === 'string') {
    if (!value.trim()) return { value, changed: false }

    let version: string
    try {
      version = getEncryptedSecretVersion(value)
    } catch {
      return { value, changed: false }
    }

    if (version !== 'legacy' && isActiveKeyVersion(version)) {
      return { value, changed: false }
    }

    const plaintext = decryptSecret(value)
    return { value: encryptSecret(plaintext), changed: true }
  }

  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = reencryptCredentialValue(item)
      changed ||= result.changed
      return result.value
    })
    return { value: next, changed }
  }

  if (value && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const result = reencryptCredentialValue(item)
      changed ||= result.changed
      next[key] = result.value
    }
    return { value: next, changed }
  }

  return { value, changed: false }
}

async function run() {
  const dryRun = !process.argv.includes('--confirm')
  const supabase = createScriptServiceRoleClient()
  const summary: Array<{
    table: SupportedTable
    id: string
    changed_columns: string[]
    dry_run: boolean
  }> = []

  for (const target of ENCRYPTED_COLUMN_TARGETS) {
    const { data, error } = await supabase
      .from(target.table)
      .select(['id', ...target.columns].join(','))

    if (error) throw new Error(`${target.table} load failed: ${error.message}`)

    for (const row of ((data ?? []) as unknown as Array<Record<string, unknown>>)) {
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      const changedColumns: string[] = []

      for (const column of target.columns) {
        const result = reencryptCredentialValue(row[column])
        if (!result.changed) continue
        update[column] = result.value
        changedColumns.push(column)
      }

      if (changedColumns.length === 0) continue

      summary.push({
        table: target.table,
        id: String(row.id),
        changed_columns: changedColumns,
        dry_run: dryRun,
      })

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from(target.table)
          .update(update as never)
          .eq('id', row.id as never)

        if (updateError) {
          throw new Error(`${target.table}:${String(row.id)} update failed: ${updateError.message}`)
        }
      }
    }
  }

  console.log(JSON.stringify({
    dry_run: dryRun,
    changed_rows: summary.length,
    rows: summary,
  }, null, 2))

  if (dryRun) {
    console.log('Dry run only. Re-run with --confirm to write re-encrypted values.')
  }
}

if (process.argv[1]?.endsWith('reencrypt-with-active-key.ts')) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
