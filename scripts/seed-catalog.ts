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

  const venues = [
    {
      slug: 'the-loft-at-soma',
      venue_name: 'The Loft at SOMA',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94103',
      address: '620 Folsom St, San Francisco, CA 94107',
      venue_type: 'loft_warehouse',
      description: 'Open-plan SOMA loft with flexible seating, AV-ready walls, and loading access.',
      standing_capacity: 150,
      seated_capacity: 90,
      pricing_model: 'flat',
      hourly_rate: 250000,
      minimum_hours: 1,
      deposit_percentage: 25,
      unique_features: 'AV, flexible layout, loading access',
      unique_features_tags: ['av', 'flexible_layout', 'loading_access'],
      bar_revenue_share_enabled: true,
      bar_rev_share_enabled: true,
      offers_kickbacks: true,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'rooftop-at-salesforce-tower',
      venue_name: 'Rooftop at Salesforce Tower',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94105',
      address: '415 Mission St, San Francisco, CA 94105',
      venue_type: 'rooftop',
      description: 'Premium rooftop-style event setting near downtown offices and transit.',
      standing_capacity: 80,
      seated_capacity: 50,
      pricing_model: 'flat',
      hourly_rate: 400000,
      minimum_hours: 1,
      deposit_percentage: 30,
      unique_features: 'Skyline views, elevator access, premium hospitality',
      unique_features_tags: ['skyline_views', 'elevator_access', 'premium_hospitality'],
      bar_revenue_share_enabled: true,
      bar_rev_share_enabled: true,
      offers_kickbacks: true,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'tartine-private-room',
      venue_name: 'Tartine Private Room',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94110',
      address: '595 Alabama St, San Francisco, CA 94110',
      venue_type: 'restaurant_buyout',
      description: 'Warm private dining room for dinners, tastings, and intimate creator events.',
      standing_capacity: 40,
      seated_capacity: 40,
      pricing_model: 'flat',
      hourly_rate: 180000,
      minimum_hours: 1,
      deposit_percentage: 25,
      unique_features: 'Private dining, in-house food, neighborhood foot traffic',
      unique_features_tags: ['private_dining', 'in_house_food', 'mission'],
      bar_revenue_share_enabled: true,
      bar_rev_share_enabled: true,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'haight-gallery-space',
      venue_name: 'Haight Gallery Space',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94117',
      address: '1500 Haight St, San Francisco, CA 94117',
      venue_type: 'gallery',
      description: 'Street-level gallery for art shows, launches, talks, and small receptions.',
      standing_capacity: 60,
      seated_capacity: 35,
      pricing_model: 'flat',
      hourly_rate: 120000,
      minimum_hours: 1,
      deposit_percentage: 20,
      unique_features: 'Gallery lighting, street frontage, wall display space',
      unique_features_tags: ['gallery_lighting', 'street_frontage', 'wall_display'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'dolores-park-permit-zone-a',
      venue_name: 'Dolores Park Permit Zone A',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94114',
      address: '19th St & Dolores St, San Francisco, CA 94114',
      venue_type: 'outdoor_park',
      description: 'Outdoor permit zone suited for large community gatherings and daytime activations.',
      standing_capacity: 300,
      seated_capacity: 120,
      pricing_model: 'flat',
      hourly_rate: 50000,
      minimum_hours: 1,
      deposit_percentage: 10,
      unique_features: 'Outdoor, large capacity, picnic-friendly',
      unique_features_tags: ['outdoor', 'large_capacity', 'picnic_friendly'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'wework-event-floor-soma',
      venue_name: 'WeWork Event Floor SOMA',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94103',
      address: '535 Mission St, San Francisco, CA 94105',
      venue_type: 'coworking_event_space',
      description: 'Coworking event floor with breakout rooms, Wi-Fi, presentation setup, and reception desk.',
      standing_capacity: 100,
      seated_capacity: 70,
      pricing_model: 'flat',
      hourly_rate: 90000,
      minimum_hours: 1,
      deposit_percentage: 20,
      unique_features: 'Breakout rooms, Wi-Fi, presentation screen',
      unique_features_tags: ['breakout_rooms', 'wifi', 'presentation_screen'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
  ]

  const vendors = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'bay-shots-photography',
      name: 'Bay Shots Photography',
      service_type: 'photographer',
      vendor_type: 'photographer',
      base_rate: 80000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'San Francisco',
      regions_served: 'San Francisco, CA',
      services_offered: ['event photography', 'edited gallery', 'same-week highlights'],
      bio: 'Event photographer for founder dinners, brand activations, and community gatherings.',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'dj-mango',
      name: 'DJ Mango',
      service_type: 'dj',
      vendor_type: 'dj',
      base_rate: 60000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'San Francisco',
      regions_served: 'San Francisco, CA',
      services_offered: ['DJ set', 'playlist curation', 'basic sound setup'],
      bio: 'Open-format DJ for rooftop socials, launch parties, and professional mixers.',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'nourish-catering-co',
      name: 'Nourish Catering Co.',
      service_type: 'catering',
      vendor_type: 'catering',
      base_rate: 150000,
      deposit_percentage: 30,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'San Francisco',
      regions_served: 'San Francisco, CA',
      services_offered: ['passed bites', 'buffet service', 'dietary accommodations'],
      bio: 'Flexible catering team for dinners, workshops, and premium networking events.',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      slug: 'pour-masters-bartending',
      name: 'Pour Masters Bartending',
      service_type: 'bartending',
      vendor_type: 'bartending',
      base_rate: 70000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'San Francisco',
      regions_served: 'San Francisco, CA',
      services_offered: ['bartenders', 'menu planning', 'bar setup'],
      bio: 'Mobile bartending crew for private events, sponsor activations, and receptions.',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'clearsound-av',
      name: 'ClearSound AV',
      service_type: 'av_production',
      vendor_type: 'av_production',
      base_rate: 120000,
      deposit_percentage: 30,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'San Francisco',
      regions_served: 'San Francisco, CA',
      services_offered: ['sound system', 'microphones', 'projector support'],
      bio: 'AV production support for talks, panels, offsites, and live programming.',
    },
  ]

  const { data: seededVenues, error: venueError } = await admin
    .from('venues')
    .upsert(venues, { onConflict: 'slug' })
    .select('id, venue_name')

  if (venueError) {
    throw new Error(`Failed to seed catalog venues: ${venueError.message}`)
  }

  const { data: seededVendors, error: vendorError } = await admin
    .from('vendor_profiles')
    .upsert(vendors, { onConflict: 'id' })
    .select('id, name')

  if (vendorError) {
    throw new Error(`Failed to seed catalog vendors: ${vendorError.message}`)
  }

  console.log(`Seeded ${seededVenues?.length ?? 0} venues, ${seededVendors?.length ?? 0} vendors`)
}

seedCatalog().catch((error) => {
  console.error(error)
  process.exit(1)
})
