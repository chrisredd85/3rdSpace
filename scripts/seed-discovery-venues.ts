import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const venueSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1).nullable().optional(),
  neighborhood: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).default('San Francisco'),
  state: z.string().trim().min(2).default('CA'),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  contact_email: z.string().trim().email().nullable().optional(),
  contact_phone: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().url().nullable().optional(),
  instagram_handle: z.string().trim().min(1).nullable().optional(),
  capacity_seated: z.number().int().nonnegative().nullable().optional(),
  capacity_standing: z.number().int().nonnegative().nullable().optional(),
  capacity_cocktail: z.number().int().nonnegative().nullable().optional(),
  vibe_tags: z.array(z.string().trim().min(1)).default([]),
  alcohol_policy: z.string().trim().min(1).nullable().optional(),
  av_available: z.boolean().nullable().optional(),
  parking_notes: z.string().trim().min(1).nullable().optional(),
  price_hint_cents_low: z.number().int().nonnegative().nullable().optional(),
  price_hint_cents_high: z.number().int().nonnegative().nullable().optional(),
  price_hint_note: z.string().trim().min(1).nullable().optional(),
  source: z.enum(['google_places', 'manual_seed', 'creator_referral', 'claimed', 'scrape']).default('manual_seed'),
  source_external_id: z.string().trim().min(1).nullable().optional(),
  last_verified_at: z.string().datetime().nullable().optional(),
}).refine((venue) => {
  if (venue.price_hint_cents_low == null || venue.price_hint_cents_high == null) return true
  return venue.price_hint_cents_low <= venue.price_hint_cents_high
}, {
  message: 'price_hint_cents_low must be <= price_hint_cents_high',
})

const venuesSchema = z.array(venueSchema)

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const filePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(process.cwd(), 'scripts/data/bay-area-venues.json')
  const raw = await readFile(filePath, 'utf8')
  const venues = venuesSchema.parse(JSON.parse(raw))

  if (venues.length < 200) {
    console.warn(
      `[seed-discovery-venues] Loaded ${venues.length} venues. Production requires 200-300 manually verified records.`
    )
  }

  if (venues.length === 0) {
    console.log('[seed-discovery-venues] No discovery venues to seed.')
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const rows = venues.map((venue) => ({
    ...venue,
    source_external_id: venue.source_external_id ?? `${venue.source}:${stableSlug(venue.name)}:${stableSlug(venue.neighborhood ?? venue.city)}`,
    metadata: { seeded_from: 'scripts/data/bay-area-venues.json' },
  }))

  const { error } = await supabase
    .from('discovery_venues')
    .upsert(rows, { onConflict: 'source,source_external_id' })

  if (error) throw new Error(`Failed to seed discovery venues: ${error.message}`)

  console.log(`[seed-discovery-venues] Seeded ${rows.length} discovery venues.`)
}

function stableSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
