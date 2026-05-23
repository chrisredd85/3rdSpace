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
    {
      slug: 'mission-bar-social',
      venue_name: 'Mission Bar Social',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94110',
      address: '2200 Mission St, San Francisco, CA 94110',
      venue_type: 'bar',
      description: 'Standing-room bar with full beverage program, reserved lounge area, and light bites.',
      standing_capacity: 130,
      seated_capacity: 45,
      pricing_model: 'minimum_spend',
      hourly_rate: 0,
      minimum_hours: 1,
      deposit_percentage: 20,
      auto_approve_conditions: { minimum_spend_cents: 350000 },
      unique_features: 'Full bar, standing room, light bites, DJ input',
      unique_features_tags: ['full_bar', 'standing_room', 'light_bites', 'dj_setup'],
      bar_revenue_share_enabled: true,
      bar_rev_share_enabled: true,
      bar_rev_share_pct: 10,
      offers_kickbacks: true,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'north-beach-private-dining-room',
      venue_name: 'North Beach Private Dining Room',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94133',
      address: '710 Vallejo St, San Francisco, CA 94133',
      venue_type: 'private_dining_room',
      description: 'Quiet private dining room with prix fixe menu, wine program, and semi-private reception bar.',
      standing_capacity: 45,
      seated_capacity: 32,
      pricing_model: 'prix_fixe',
      hourly_rate: 0,
      minimum_hours: 1,
      deposit_percentage: 25,
      auto_approve_conditions: { minimum_spend_cents: 250000 },
      unique_features: 'Private dining, prix fixe menu, quiet room, wine program',
      unique_features_tags: ['private_room', 'seated_dining', 'menu', 'wine_program'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'civic-screening-theater',
      venue_name: 'Civic Screening Theater',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94102',
      address: '75 Grove St, San Francisco, CA 94102',
      venue_type: 'theater',
      description: 'Screening room with fixed seating, projection, microphones, and post-show lobby reception.',
      standing_capacity: 220,
      seated_capacity: 180,
      pricing_model: 'flat',
      hourly_rate: 175000,
      minimum_hours: 3,
      deposit_percentage: 30,
      unique_features: 'Screens, sightlines, sound, lobby reception, microphones',
      unique_features_tags: ['screens', 'sightlines', 'sound', 'mics', 'networking_area'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      ticket_sales_share_enabled: true,
      ticket_sales_share_pct: 8,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'mission-campus-build-hall',
      venue_name: 'Mission Campus Build Hall',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94107',
      address: '88 Rhode Island St, San Francisco, CA 94103',
      venue_type: 'campus',
      description: 'Campus-style build hall with breakout rooms, strong Wi-Fi, power drops, and overnight staffing option.',
      standing_capacity: 320,
      seated_capacity: 240,
      pricing_model: 'flat',
      hourly_rate: 220000,
      minimum_hours: 6,
      deposit_percentage: 30,
      unique_features: 'Power, Wi-Fi, breakout rooms, catering space, overnight access',
      unique_features_tags: ['power', 'wifi', 'breakout_rooms', 'catering_space', 'overnight_access'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      sponsor_rev_share_enabled: true,
      sponsor_rev_share_pct: 8,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'dogpatch-market-hall',
      venue_name: 'Dogpatch Market Hall',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94107',
      address: '1201 3rd St, San Francisco, CA 94158',
      venue_type: 'market_hall',
      description: 'High-foot-traffic market hall with vendor stalls, storage, loading access, and brandable frontage.',
      standing_capacity: 280,
      seated_capacity: 120,
      pricing_model: 'flat',
      hourly_rate: 150000,
      minimum_hours: 4,
      deposit_percentage: 25,
      unique_features: 'Foot traffic, load-in, storage, permits, street frontage',
      unique_features_tags: ['foot_traffic', 'load_in', 'storage', 'permits', 'street_frontage'],
      bar_revenue_share_enabled: false,
      bar_rev_share_enabled: false,
      offers_kickbacks: false,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
    },
    {
      slug: 'union-square-hotel-ballroom',
      venue_name: 'Union Square Hotel Ballroom',
      owner_id: null,
      city: 'San Francisco',
      state: 'CA',
      zip_code: '94108',
      address: '340 Powell St, San Francisco, CA 94102',
      venue_type: 'hotel',
      description: 'Hotel ballroom package with catering, bar, seasonal decor options, and sponsor-friendly reception foyer.',
      standing_capacity: 300,
      seated_capacity: 220,
      pricing_model: 'package',
      hourly_rate: 300000,
      minimum_hours: 4,
      deposit_percentage: 35,
      unique_features: 'Catering, bar, seasonal availability, sponsor visibility, foyer',
      unique_features_tags: ['catering', 'bar', 'seasonal_availability', 'sponsor_visibility', 'donor_flow'],
      bar_revenue_share_enabled: true,
      bar_rev_share_enabled: true,
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
      vendor_type: 'Photographer',
      base_rate: 80000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'sf_only',
      regions_served: 'San Francisco, CA',
      services_offered: ['event photography', 'edited gallery', 'same-week highlights'],
      bio: 'Event photographer for founder dinners, brand activations, and community gatherings.',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'dj-mango',
      name: 'DJ Mango',
      service_type: 'dj',
      vendor_type: 'DJ / Music',
      base_rate: 60000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'sf_only',
      regions_served: 'San Francisco, CA',
      services_offered: ['DJ set', 'playlist curation', 'basic sound setup'],
      bio: 'Open-format DJ for rooftop socials, launch parties, and professional mixers.',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'nourish-catering-co',
      name: 'Nourish Catering Co.',
      service_type: 'catering',
      vendor_type: 'Caterer',
      base_rate: 150000,
      deposit_percentage: 30,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'sf_only',
      regions_served: 'San Francisco, CA',
      services_offered: ['passed bites', 'buffet service', 'dietary accommodations'],
      bio: 'Flexible catering team for dinners, workshops, and premium networking events.',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      slug: 'pour-masters-bartending',
      name: 'Pour Masters Bartending',
      service_type: 'bartending',
      vendor_type: 'Bartender',
      base_rate: 70000,
      deposit_percentage: 25,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'sf_only',
      regions_served: 'San Francisco, CA',
      services_offered: ['bartenders', 'menu planning', 'bar setup'],
      bio: 'Mobile bartending crew for private events, sponsor activations, and receptions.',
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'clearsound-av',
      name: 'ClearSound AV',
      service_type: 'av_production',
      vendor_type: 'Audio/Visual Tech',
      base_rate: 120000,
      deposit_percentage: 30,
      is_published: true,
      is_admin_seeded: true,
      is_claimed: false,
      service_area: 'sf_only',
      regions_served: 'San Francisco, CA',
      services_offered: ['sound system', 'microphones', 'projector support'],
      bio: 'AV production support for talks, panels, offsites, and live programming.',
    },
  ]

  const venuesWithDefaults = venues.map((venue) => {
    const row = venue as Record<string, unknown>

    return {
      ...venue,
      ticket_sales_share_enabled: readBoolean(row.ticket_sales_share_enabled) ?? false,
      ticket_sales_share_pct: readNumber(row.ticket_sales_share_pct) ?? 0,
      sponsor_rev_share_enabled: readBoolean(row.sponsor_rev_share_enabled) ?? false,
      sponsor_rev_share_pct: readNumber(row.sponsor_rev_share_pct) ?? 0,
      bar_rev_share_enabled: readBoolean(row.bar_rev_share_enabled) ?? false,
      bar_rev_share_pct: readNumber(row.bar_rev_share_pct) ?? 0,
      per_head_kickback_cents: readNumber(row.per_head_kickback_cents) ?? 0,
      pricing_model: normalizeVenuePricingModel(venue.pricing_model),
    }
  })

  const { data: seededVenues, error: venueError } = await admin
    .from('venues')
    .upsert(venuesWithDefaults, { onConflict: 'slug' })
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

function normalizeVenuePricingModel(value: string | undefined): 'hourly' | 'revenue_share' | 'hybrid' {
  if (value === 'revenue_share') return 'revenue_share'
  if (value === 'hybrid' || value === 'minimum_spend') return 'hybrid'
  return 'hourly'
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

seedCatalog().catch((error) => {
  console.error(error)
  process.exit(1)
})
