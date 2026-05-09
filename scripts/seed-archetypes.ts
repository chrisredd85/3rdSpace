import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { ARCHETYPES } from '@/lib/planner/archetypes/data'

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

async function seedArchetypes() {
  loadLocalEnv()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const archetypeRows = ARCHETYPES.map((archetype) => ({
    key: archetype.key,
    display_name: archetype.display_name,
    description: archetype.description,
    config: archetype,
    updated_at: new Date().toISOString(),
  }))

  const { error: archetypeError } = await admin
    .from('event_archetypes')
    .upsert(archetypeRows, { onConflict: 'key' })

  if (archetypeError) {
    throw new Error(`Failed to seed event archetypes: ${archetypeError.message}`)
  }

  const aliasByPhrase = new Map<string, { phrase: string; archetype_key: string }>()
  ARCHETYPES.forEach((archetype) => {
    const aliases = new Set([
      archetype.key.replace(/_/g, ' '),
      archetype.display_name,
      ...archetype.aliases,
    ])

    for (const phrase of aliases) {
      const normalizedPhrase = phrase.toLowerCase().trim()
      if (!aliasByPhrase.has(normalizedPhrase)) {
        aliasByPhrase.set(normalizedPhrase, {
          phrase: normalizedPhrase,
          archetype_key: archetype.key,
        })
      }
    }
  })
  const aliasRows = [...aliasByPhrase.values()]

  const { error: aliasError } = await admin
    .from('event_archetype_aliases')
    .upsert(aliasRows, { onConflict: 'phrase' })

  if (aliasError) {
    throw new Error(`Failed to seed event archetype aliases: ${aliasError.message}`)
  }

  console.log(`Seeded ${ARCHETYPES.length} archetypes with ${aliasRows.length} total aliases`)
}

seedArchetypes().catch((error) => {
  console.error(error)
  process.exit(1)
})
