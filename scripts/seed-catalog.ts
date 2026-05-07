import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

/**
 * Loads .env.local for local script execution without adding a dotenv dependency.
 */
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

/**
 * Seeds one admin-managed venue that is visible through the public catalog.
 */
async function seedCatalog() {
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

  const { data, error } = await admin
    .from('venues')
    .upsert(
      {
        slug: 'the-workshop-soma',
        venue_name: 'The Workshop SOMA',
        owner_id: null,
        city: 'San Francisco',
        state: 'CA',
        venue_type: 'loft_warehouse',
        description:
          'Open-plan industrial space with exposed brick, AV included, flexible layout.',
        standing_capacity: 150,
        seated_capacity: 40,
        pricing_model: 'hourly',
        hourly_rate: 35000,
        is_published: true,
        is_admin_seeded: true,
        is_claimed: false,
        ticket_sales_share_enabled: true,
        ticket_sales_share_pct: 5,
        bar_rev_share_enabled: false,
        bar_rev_share_pct: 0,
        sponsor_rev_share_enabled: false,
        sponsor_rev_share_pct: 0,
        per_head_kickback_cents: 200,
        unique_features: 'AV/projector, catering kitchen, street parking',
        unique_features_tags: ['AV/projector', 'catering_kitchen', 'street_parking'],
      },
      { onConflict: 'slug' }
    )
    .select('id, venue_name')
    .single()

  if (error) {
    throw new Error(`Failed to seed catalog venue: ${error.message}`)
  }

  console.log(`Seeded catalog venue: ${data?.venue_name} (${data?.id})`)
}

seedCatalog().catch((error) => {
  console.error(error)
  process.exit(1)
})
