BEGIN;

-- Supabase CLI batch seeding does not reliably resolve pg_temp helper
-- functions, so keep deterministic seed helpers in a throwaway schema and
-- drop it before commit.
CREATE SCHEMA IF NOT EXISTS seed_helpers;

CREATE OR REPLACE FUNCTION seed_helpers.seed_uuid(n bigint)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;

CREATE OR REPLACE FUNCTION seed_helpers.seed_slug(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION seed_helpers.seed_name(n integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (ARRAY[
      'Avery', 'Jordan', 'Morgan', 'Taylor', 'Riley', 'Casey', 'Jamie', 'Quinn', 'Cameron', 'Drew',
      'Harper', 'Rowan', 'Reese', 'Skyler', 'Sage', 'Parker', 'Emerson', 'Finley', 'Dakota', 'Kendall',
      'Logan', 'Maya', 'Noah', 'Sofia', 'Ethan', 'Lena', 'Miles', 'Nora', 'Owen', 'Zara'
    ])[1 + ((n - 1) % 30)]
    || ' ' ||
    (ARRAY[
      'Bennett', 'Chen', 'Patel', 'Rivera', 'Thompson', 'Nguyen', 'Brooks', 'Carter', 'Morgan', 'Kim',
      'Foster', 'Diaz', 'Howard', 'Singh', 'Bailey', 'Murphy', 'Cooper', 'Reed', 'Perry', 'Hayes',
      'Coleman', 'Santos', 'Watson', 'Fischer', 'Morris', 'Ali', 'Griffin', 'Price', 'Stone', 'Vega'
    ])[1 + ((n - 1) % 30)];
$$;

-- PROFILES
-- This migration set does not include public.profiles. It uses public.users plus
-- builder_profiles, owner_profiles, and vendor_profiles as the profile tables.
-- If public.profiles exists in another environment, this optional block seeds it too.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE $seed_profiles$
      INSERT INTO public.profiles (
        id,
        email,
        name,
        user_type,
        avatar_url,
        bio,
        phone,
        website,
        created_at,
        updated_at
      )
      SELECT
        seed_helpers.seed_uuid(n),
        CASE
          WHEN n <= 30 THEN 'builder' || lpad(n::text, 2, '0') || '@3rdspace.test'
          WHEN n <= 80 THEN 'venue' || lpad((n - 30)::text, 2, '0') || '@3rdspace.test'
          ELSE 'vendor' || lpad((n - 80)::text, 2, '0') || '@3rdspace.test'
        END,
        seed_helpers.seed_name(n),
        CASE
          WHEN n <= 30 THEN 'community_builder'
          WHEN n <= 80 THEN 'venue_owner'
          ELSE 'vendor'
        END,
        NULL,
        CASE
          WHEN n <= 30 THEN 'Builds curated events for founders, creators, and local communities.'
          WHEN n <= 80 THEN 'Operates flexible spaces for meetings, mixers, launches, and private celebrations.'
          ELSE 'Provides event services with a focus on reliable production and polished guest experience.'
        END,
        '+1-555-' || lpad(n::text, 3, '0') || '-' || lpad((1000 + n)::text, 4, '0'),
        'https://3rdspace.test/profiles/' || n,
        now() - ((150 - n) * interval '1 day'),
        now()
      FROM generate_series(1, 130) AS n
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        user_type = EXCLUDED.user_type,
        bio = EXCLUDED.bio,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        updated_at = now();
    $seed_profiles$;
  ELSE
    RAISE NOTICE 'Skipping public.profiles; current schema uses public.users and role-specific profile tables.';
  END IF;
END $$;

INSERT INTO public.users (
  id,
  email,
  role,
  email_verified,
  created_at,
  updated_at,
  last_login_at,
  user_type,
  company_name,
  is_active,
  subscription_tier,
  subscription_status,
  platform_fee_percentage
)
SELECT
  seed_helpers.seed_uuid(n),
  CASE
    WHEN n <= 30 THEN 'builder' || lpad(n::text, 2, '0') || '@3rdspace.test'
    WHEN n <= 80 THEN 'venue' || lpad((n - 30)::text, 2, '0') || '@3rdspace.test'
    ELSE 'vendor' || lpad((n - 80)::text, 2, '0') || '@3rdspace.test'
  END,
  CASE
    WHEN n <= 30 THEN 'builder'
    WHEN n <= 80 THEN 'owner'
    ELSE 'vendor'
  END,
  true,
  now() - ((160 - n) * interval '1 day'),
  now(),
  now() - ((n % 21) * interval '1 day'),
  CASE
    WHEN n <= 30 THEN 'community_builder'
    WHEN n <= 80 THEN 'venue_owner'
    ELSE 'vendor'
  END,
  CASE
    WHEN n <= 30 THEN seed_helpers.seed_name(n) || ' Events'
    WHEN n <= 80 THEN seed_helpers.seed_name(n) || ' Hospitality'
    ELSE seed_helpers.seed_name(n) || ' Creative Services'
  END,
  true,
  CASE WHEN n <= 30 AND n % 4 = 0 THEN 'unlimited' ELSE 'pay_per_transaction' END,
  'active',
  0
FROM generate_series(1, 130) AS n
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  email_verified = EXCLUDED.email_verified,
  updated_at = now(),
  last_login_at = EXCLUDED.last_login_at,
  user_type = EXCLUDED.user_type,
  company_name = EXCLUDED.company_name,
  is_active = EXCLUDED.is_active,
  subscription_tier = EXCLUDED.subscription_tier,
  subscription_status = EXCLUDED.subscription_status,
  platform_fee_percentage = EXCLUDED.platform_fee_percentage;

-- BUILDERS
INSERT INTO public.builder_profiles (
  id,
  user_id,
  name,
  phone,
  event_types,
  priorities,
  subscription_status,
  eventbrite_connected,
  luma_connected,
  posh_connected,
  total_events_hosted,
  total_attendance,
  preferred_ticket_platforms,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(n),
  seed_helpers.seed_uuid(n),
  seed_helpers.seed_name(n),
  '+1-555-' || lpad(n::text, 3, '0') || '-' || lpad((1000 + n)::text, 4, '0'),
  ARRAY[
    (ARRAY['networking', 'conference', 'workshop', 'social_mixer', 'product_launch'])[1 + ((n - 1) % 5)],
    (ARRAY['private_dinner', 'community_meetup', 'brand_activation'])[1 + ((n - 1) % 3)]
  ],
  ARRAY[
    (ARRAY['venue_fit', 'budget_control', 'vendor_quality'])[1 + ((n - 1) % 3)],
    (ARRAY['fast_response', 'unique_spaces', 'production_support'])[1 + ((n - 1) % 3)]
  ],
  CASE WHEN n % 4 = 0 THEN 'trial' ELSE 'active' END,
  n % 3 = 0,
  n % 4 = 0,
  n % 5 = 0,
  CASE WHEN n <= 15 THEN 3 ELSE 2 END,
  120 + (n * 47),
  ARRAY[
    (ARRAY['luma', 'eventbrite', 'posh'])[1 + ((n - 1) % 3)]
  ],
  now() - ((120 - n) * interval '1 day'),
  now()
FROM generate_series(1, 30) AS n
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  event_types = EXCLUDED.event_types,
  priorities = EXCLUDED.priorities,
  subscription_status = EXCLUDED.subscription_status,
  eventbrite_connected = EXCLUDED.eventbrite_connected,
  luma_connected = EXCLUDED.luma_connected,
  posh_connected = EXCLUDED.posh_connected,
  total_events_hosted = EXCLUDED.total_events_hosted,
  total_attendance = EXCLUDED.total_attendance,
  preferred_ticket_platforms = EXCLUDED.preferred_ticket_platforms,
  updated_at = now();

-- VENUES
INSERT INTO public.owner_profiles (
  id,
  user_id,
  name,
  phone,
  business_name,
  business_type,
  stripe_account_status,
  payout_enabled,
  total_bookings,
  total_earnings,
  acceptance_rate,
  average_response_time,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(30 + n),
  seed_helpers.seed_uuid(30 + n),
  seed_helpers.seed_name(30 + n),
  '+1-555-' || lpad((30 + n)::text, 3, '0') || '-' || lpad((1030 + n)::text, 4, '0'),
  seed_helpers.seed_name(30 + n) || ' Hospitality Group',
  (ARRAY['bar', 'gallery', 'athletic_club', 'conference_space', 'event_space'])[1 + ((n - 1) % 5)],
  CASE WHEN n % 5 = 0 THEN 'pending' ELSE 'verified' END,
  n % 5 <> 0,
  3 + (n % 18),
  2500 + (n * 875),
  68 + (n % 27),
  18 + (n % 90),
  now() - ((130 - n) * interval '1 day'),
  now()
FROM generate_series(1, 50) AS n
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  business_name = EXCLUDED.business_name,
  business_type = EXCLUDED.business_type,
  stripe_account_status = EXCLUDED.stripe_account_status,
  payout_enabled = EXCLUDED.payout_enabled,
  total_bookings = EXCLUDED.total_bookings,
  total_earnings = EXCLUDED.total_earnings,
  acceptance_rate = EXCLUDED.acceptance_rate,
  average_response_time = EXCLUDED.average_response_time,
  updated_at = now();

WITH venue_seed(n, venue_name, category) AS (
  VALUES
    (1, 'The Brass Canopy', 'bar'),
    (2, 'Juniper Hall', 'bar'),
    (3, 'Northlight Social', 'bar'),
    (4, 'Backbar Annex', 'bar'),
    (5, 'Canal Street Taproom', 'bar'),
    (6, 'Sunset and Fig', 'bar'),
    (7, 'Fulton Public House', 'bar'),
    (8, 'Velvet Rail Lounge', 'bar'),
    (9, 'Brick Yard Bar', 'bar'),
    (10, 'Palmetto Room', 'bar'),
    (11, 'Gold Coast Pourhouse', 'bar'),
    (12, 'Morningside Spirits', 'bar'),
    (13, 'Whitebox Mercer', 'gallery'),
    (14, 'Mar Vista Gallery', 'gallery'),
    (15, 'Fulton Fine Arts', 'gallery'),
    (16, 'Edgewood Studio Gallery', 'gallery'),
    (17, 'Wynwood Frame House', 'gallery'),
    (18, 'Chelsea Minimal', 'gallery'),
    (19, 'West Loop Exhibit Hall', 'gallery'),
    (20, 'Midtown Art Loft', 'gallery'),
    (21, 'Silver Lake Walls', 'gallery'),
    (22, 'Biscayne Contemporary', 'gallery'),
    (23, 'Hudson Court Club', 'athletic'),
    (24, 'Wilshire Athletic House', 'athletic'),
    (25, 'Lakeshore Racquet Club', 'athletic'),
    (26, 'Peachtree Tennis Pavilion', 'athletic'),
    (27, 'Coral Club Courts', 'athletic'),
    (28, 'Court and Terrace', 'athletic'),
    (29, 'Netline Social Club', 'athletic'),
    (30, 'Cityside Athletic Hall', 'athletic'),
    (31, 'Union Square Forum', 'conference'),
    (32, 'Westside Workshop Hub', 'conference'),
    (33, 'Loop Conference Commons', 'conference'),
    (34, 'Ponce City Boardroom', 'conference'),
    (35, 'Brickell Collaboration Center', 'conference'),
    (36, 'Harbor Desk Hall', 'conference'),
    (37, 'Midtown Strategy Rooms', 'conference'),
    (38, 'Santa Monica Offsite', 'conference'),
    (39, 'River North Exchange', 'conference'),
    (40, 'Downtown Pitch Studio', 'conference'),
    (41, 'Skyline Foundry', 'event_space'),
    (42, 'The Alameda Loft', 'event_space'),
    (43, 'Fulton Rooftop', 'event_space'),
    (44, 'Peachtree Industrial Hall', 'event_space'),
    (45, 'Biscayne Terrace', 'event_space'),
    (46, 'Atlas Warehouse', 'event_space'),
    (47, 'Arts District Skydeck', 'event_space'),
    (48, 'West Loop Yard', 'event_space'),
    (49, 'Chelsea Event Works', 'event_space'),
    (50, 'Coconut Grove Loft', 'event_space')
),
venue_details AS (
  SELECT
    n,
    venue_name,
    category,
    CASE category
      WHEN 'bar' THEN 'restaurant'
      WHEN 'gallery' THEN 'gallery'
      WHEN 'athletic' THEN 'event_space'
      WHEN 'conference' THEN 'conference_center'
      ELSE CASE WHEN n % 2 = 0 THEN 'loft_warehouse' ELSE 'rooftop' END
    END AS venue_type,
    CASE ((n - 1) % 5)
      WHEN 0 THEN 'New York'
      WHEN 1 THEN 'Los Angeles'
      WHEN 2 THEN 'Chicago'
      WHEN 3 THEN 'Atlanta'
      ELSE 'Miami'
    END AS city,
    CASE ((n - 1) % 5)
      WHEN 0 THEN 'NY'
      WHEN 1 THEN 'CA'
      WHEN 2 THEN 'IL'
      WHEN 3 THEN 'GA'
      ELSE 'FL'
    END AS state,
    CASE ((n - 1) % 5)
      WHEN 0 THEN '100' || lpad(n::text, 2, '0')
      WHEN 1 THEN '900' || lpad(n::text, 2, '0')
      WHEN 2 THEN '606' || lpad(n::text, 2, '0')
      WHEN 3 THEN '303' || lpad(n::text, 2, '0')
      ELSE '331' || lpad(n::text, 2, '0')
    END AS zip_code,
    CASE category
      WHEN 'bar' THEN 80 + ((n * 17) % 221)
      WHEN 'gallery' THEN 50 + ((n * 13) % 151)
      WHEN 'athletic' THEN 40 + ((n * 11) % 111)
      WHEN 'conference' THEN 80 + ((n * 23) % 321)
      ELSE 100 + ((n * 37) % 401)
    END AS capacity,
    CASE category
      WHEN 'bar' THEN (200 + ((n * 47) % 601)) * 100
      WHEN 'gallery' THEN (300 + ((n * 73) % 901)) * 100
      WHEN 'athletic' THEN (400 + ((n * 97) % 1601)) * 100
      WHEN 'conference' THEN (150 + ((n * 57) % 851)) * 100
      ELSE (250 + ((n * 83) % 1001)) * 100
    END AS hourly_rate
  FROM venue_seed
)
INSERT INTO public.venues (
  id,
  owner_id,
  venue_name,
  slug,
  description,
  venue_type,
  address,
  city,
  state,
  zip_code,
  latitude,
  longitude,
  square_footage,
  standing_capacity,
  seated_capacity,
  pricing_model,
  hourly_rate,
  minimum_hours,
  bar_revenue_percentage,
  per_head_kickback,
  deposit_percentage,
  deposit_due,
  is_published,
  average_rating,
  total_bookings,
  offers_kickbacks,
  default_kickback_type,
  ticket_sales_share_enabled,
  ticket_sales_share_percent,
  bar_revenue_share_enabled,
  bar_revenue_share_percent,
  per_head_kickback_amount,
  requires_deposit,
  deposit_amount,
  deposit_type,
  deposit_refundable,
  deposit_terms,
  bulk_approval_enabled,
  auto_approve_threshold,
  auto_approve_conditions,
  unique_features,
  unique_features_tags,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(200 + n),
  seed_helpers.seed_uuid(30 + n),
  venue_name,
  seed_helpers.seed_slug(venue_name),
  CASE category
    WHEN 'bar' THEN venue_name || ' is a polished neighborhood bar with strong beverage service, flexible floor plans, and late-night staff used to private buyouts.'
    WHEN 'gallery' THEN venue_name || ' offers clean white walls, rotating exhibitions, museum-style lighting, and a calm setting for launches, talks, and receptions.'
    WHEN 'athletic' THEN venue_name || ' pairs private courts, clubhouse lounges, locker access, and outdoor terraces for team-building and member-style events.'
    WHEN 'conference' THEN venue_name || ' is an AV-equipped offsite space with breakout rooms, reliable WiFi, presentation support, and work-friendly catering areas.'
    ELSE venue_name || ' is a flexible event space with industrial character, adaptable layouts, skyline moments, and production-friendly load-in.'
  END,
  venue_type,
  (100 + n * 7)::text || ' ' ||
    (ARRAY['Market Street', 'Broadway', 'Grand Avenue', 'Peachtree Street', 'Biscayne Boulevard'])[1 + ((n - 1) % 5)],
  city,
  state,
  zip_code,
  CASE city
    WHEN 'New York' THEN 40.7128 + (n::numeric / 10000)
    WHEN 'Los Angeles' THEN 34.0522 + (n::numeric / 10000)
    WHEN 'Chicago' THEN 41.8781 + (n::numeric / 10000)
    WHEN 'Atlanta' THEN 33.7490 + (n::numeric / 10000)
    ELSE 25.7617 + (n::numeric / 10000)
  END,
  CASE city
    WHEN 'New York' THEN -74.0060 - (n::numeric / 10000)
    WHEN 'Los Angeles' THEN -118.2437 - (n::numeric / 10000)
    WHEN 'Chicago' THEN -87.6298 - (n::numeric / 10000)
    WHEN 'Atlanta' THEN -84.3880 - (n::numeric / 10000)
    ELSE -80.1918 - (n::numeric / 10000)
  END,
  capacity * 22,
  capacity,
  greatest(20, floor(capacity * 0.72)::integer),
  CASE WHEN category = 'bar' THEN 'hybrid' ELSE 'hourly' END,
  hourly_rate,
  CASE WHEN category IN ('conference', 'gallery') THEN 3 ELSE 4 END,
  CASE WHEN category = 'bar' THEN 15 + (n % 11) ELSE 0 END,
  CASE WHEN category = 'bar' AND n % 2 = 0 THEN 5 + (n % 11) ELSE 0 END,
  CASE WHEN n % 2 = 0 THEN 20 ELSE NULL END,
  CASE WHEN n % 2 = 0 THEN (ARRAY['immediately', '48_hours', '1_week', '14_days'])[1 + (n % 4)] ELSE NULL END,
  true,
  round((4.20 + ((n % 8)::numeric / 10))::numeric, 2),
  2 + (n % 22),
  category = 'bar',
  CASE WHEN category = 'bar' THEN 'per_head_attendance' ELSE NULL END,
  false,
  0,
  category = 'bar',
  CASE WHEN category = 'bar' THEN 15 + (n % 11) ELSE 0 END,
  CASE WHEN category = 'bar' AND n % 2 = 0 THEN 5 + (n % 11) ELSE 0 END,
  n % 2 = 0,
  CASE WHEN n % 2 = 0 THEN 200 + ((n * 73) % 1801) ELSE NULL END,
  CASE WHEN n % 2 = 0 THEN 'fixed' ELSE NULL END,
  n % 3 <> 0,
  CASE WHEN n % 2 = 0 THEN 'Deposit is due once the venue accepts the booking request and applies to the final balance.' ELSE NULL END,
  capacity > 200,
  CASE WHEN capacity > 200 THEN 0 ELSE NULL END,
  CASE WHEN capacity > 200 THEN jsonb_build_object('minNotice', 14, 'maxCapacity', capacity) ELSE '{}'::jsonb END,
  CASE category
    WHEN 'bar' THEN 'Built-in bar program, experienced private-event staff, and beverage revenue-share options.'
    WHEN 'gallery' THEN 'Rotating exhibitions, white walls, controlled lighting, and elegant reception flow.'
    WHEN 'athletic' THEN 'Private courts, clubhouse access, outdoor terraces, and wellness-oriented programming.'
    WHEN 'conference' THEN 'Breakout rooms, presentation AV, hybrid meeting support, and reliable WiFi.'
    ELSE 'Flexible open floor plate, production-friendly load-in, and rooftop or loft character.'
  END,
  CASE category
    WHEN 'bar' THEN ARRAY['bar', 'late-night', 'revenue-share']
    WHEN 'gallery' THEN ARRAY['white-walls', 'rotating-exhibitions', 'natural-light']
    WHEN 'athletic' THEN ARRAY['courts', 'clubhouse', 'outdoor-terrace']
    WHEN 'conference' THEN ARRAY['av-equipped', 'breakout-rooms', 'offsite']
    ELSE ARRAY['flexible-layout', 'industrial', 'rooftop']
  END,
  now() - ((110 - n) * interval '1 day'),
  now()
FROM venue_details
ON CONFLICT (id) DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  venue_name = EXCLUDED.venue_name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  venue_type = EXCLUDED.venue_type,
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  zip_code = EXCLUDED.zip_code,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  square_footage = EXCLUDED.square_footage,
  standing_capacity = EXCLUDED.standing_capacity,
  seated_capacity = EXCLUDED.seated_capacity,
  pricing_model = EXCLUDED.pricing_model,
  hourly_rate = EXCLUDED.hourly_rate,
  minimum_hours = EXCLUDED.minimum_hours,
  bar_revenue_percentage = EXCLUDED.bar_revenue_percentage,
  per_head_kickback = EXCLUDED.per_head_kickback,
  deposit_percentage = EXCLUDED.deposit_percentage,
  deposit_due = EXCLUDED.deposit_due,
  is_published = EXCLUDED.is_published,
  average_rating = EXCLUDED.average_rating,
  total_bookings = EXCLUDED.total_bookings,
  offers_kickbacks = EXCLUDED.offers_kickbacks,
  default_kickback_type = EXCLUDED.default_kickback_type,
  ticket_sales_share_enabled = EXCLUDED.ticket_sales_share_enabled,
  ticket_sales_share_percent = EXCLUDED.ticket_sales_share_percent,
  bar_revenue_share_enabled = EXCLUDED.bar_revenue_share_enabled,
  bar_revenue_share_percent = EXCLUDED.bar_revenue_share_percent,
  per_head_kickback_amount = EXCLUDED.per_head_kickback_amount,
  requires_deposit = EXCLUDED.requires_deposit,
  deposit_amount = EXCLUDED.deposit_amount,
  deposit_type = EXCLUDED.deposit_type,
  deposit_refundable = EXCLUDED.deposit_refundable,
  deposit_terms = EXCLUDED.deposit_terms,
  bulk_approval_enabled = EXCLUDED.bulk_approval_enabled,
  auto_approve_threshold = EXCLUDED.auto_approve_threshold,
  auto_approve_conditions = EXCLUDED.auto_approve_conditions,
  unique_features = EXCLUDED.unique_features,
  unique_features_tags = EXCLUDED.unique_features_tags,
  updated_at = now();

INSERT INTO public.venue_kickback_configs (
  id,
  venue_id,
  kickback_model,
  per_head_amount,
  minimum_attendees,
  maximum_payout,
  active,
  applies_to_event_types,
  applies_to_days_of_week,
  payment_terms,
  auto_payout_enabled,
  notes,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(12000 + n),
  seed_helpers.seed_uuid(200 + n),
  'per_head_attendance',
  5 + (n % 11),
  50,
  4500,
  true,
  ARRAY['networking', 'social_mixer', 'product_launch'],
  ARRAY[3, 4, 5, 6],
  'net_7',
  true,
  'Seeded per-head bar program for private-event beverage lift.',
  now(),
  now()
FROM generate_series(1, 12) AS n
ON CONFLICT (id) DO UPDATE SET
  kickback_model = EXCLUDED.kickback_model,
  per_head_amount = EXCLUDED.per_head_amount,
  minimum_attendees = EXCLUDED.minimum_attendees,
  maximum_payout = EXCLUDED.maximum_payout,
  active = EXCLUDED.active,
  applies_to_event_types = EXCLUDED.applies_to_event_types,
  applies_to_days_of_week = EXCLUDED.applies_to_days_of_week,
  payment_terms = EXCLUDED.payment_terms,
  auto_payout_enabled = EXCLUDED.auto_payout_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.venue_amenity_types (name, category, icon, description, display_order)
VALUES
  ('WiFi', 'tech', 'wifi', 'High-speed internet access for guests and production teams.', 10),
  ('Sound System', 'av_equipment', 'volume-2', 'House PA or speaker system.', 20),
  ('Bar', 'facilities', 'wine', 'Built-in bar or bar service area.', 30),
  ('On-site Parking', 'access', 'car', 'Parking available on site.', 40),
  ('Outdoor Space', 'features', 'trees', 'Patio, garden, rooftop, or other outdoor area.', 50),
  ('Kitchen', 'facilities', 'utensils', 'Kitchen or prep area for food service.', 60),
  ('Tables', 'furniture', 'layout', 'Tables available for event layouts.', 70),
  ('Chairs', 'furniture', 'armchair', 'Chairs available for seating layouts.', 80)
ON CONFLICT (name) DO UPDATE SET
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order;

WITH amenity_options(idx, amenity_name, amenity_type, description) AS (
  VALUES
    (1, 'WiFi', 'wifi', 'Reliable guest and production WiFi.'),
    (2, 'Sound System', 'av_equipment', 'House sound system for speeches, music, or presentation playback.'),
    (3, 'Bar', 'bar', 'Built-in bar or dedicated beverage service position.'),
    (4, 'On-site Parking', 'parking', 'Parking or valet staging available nearby.'),
    (5, 'Outdoor Space', 'outdoor_space', 'Outdoor patio, terrace, rooftop, or courtyard.'),
    (6, 'Kitchen', 'catering_kitchen', 'Prep kitchen or catering support area.'),
    (7, 'Tables', 'tables_chairs', 'Tables available for seated, classroom, or vendor layouts.'),
    (8, 'Chairs', 'tables_chairs', 'Chairs available for theater, dining, or lounge layouts.')
),
venue_slots AS (
  SELECT v.n, slot
  FROM generate_series(1, 50) AS v(n)
  CROSS JOIN generate_series(1, 8) AS slot
  WHERE slot <= 4 + (v.n % 5)
)
INSERT INTO public.venue_amenities (
  id,
  venue_id,
  amenity_type,
  amenity_name,
  description,
  amenity_type_id,
  custom_amenity_name,
  created_at
)
SELECT
  seed_helpers.seed_uuid(10000 + (vs.n * 10) + vs.slot),
  seed_helpers.seed_uuid(200 + vs.n),
  ao.amenity_type,
  ao.amenity_name,
  ao.description,
  vat.id,
  NULL,
  now() - (vs.slot * interval '1 day')
FROM venue_slots vs
JOIN amenity_options ao
  ON ao.idx = 1 + ((vs.n + vs.slot - 2) % 8)
LEFT JOIN public.venue_amenity_types vat
  ON vat.name = ao.amenity_name
ON CONFLICT (id) DO UPDATE SET
  amenity_type = EXCLUDED.amenity_type,
  amenity_name = EXCLUDED.amenity_name,
  description = EXCLUDED.description,
  amenity_type_id = EXCLUDED.amenity_type_id,
  custom_amenity_name = EXCLUDED.custom_amenity_name;

WITH rule_seed(n, category) AS (
  SELECT
    n,
    CASE
      WHEN n <= 12 THEN 'bar'
      WHEN n <= 22 THEN 'gallery'
      WHEN n <= 30 THEN 'athletic'
      WHEN n <= 40 THEN 'conference'
      ELSE 'event_space'
    END
  FROM generate_series(1, 50) AS n
),
rule_slots AS (
  SELECT n, category, slot
  FROM rule_seed
  CROSS JOIN generate_series(1, 3) AS slot
),
rules AS (
  SELECT
    n,
    slot,
    CASE
      WHEN category = 'bar' AND slot = 1 THEN 'No outside alcohol'
      WHEN category = 'bar' AND slot = 2 THEN 'Security required for 100+ guests'
      WHEN category = 'bar' THEN 'Music must end by 2am'
      WHEN category = 'gallery' AND slot = 1 THEN 'No food or drink near artwork'
      WHEN category = 'gallery' AND slot = 2 THEN 'Setup complete two hours before doors'
      WHEN category = 'gallery' THEN 'Artwork protection walkthrough required'
      WHEN category = 'athletic' AND slot = 1 THEN 'Courts are team-building only'
      WHEN category = 'athletic' AND slot = 2 THEN 'Approved catering vendors required'
      WHEN category = 'athletic' THEN 'Athletic surfaces must remain protected'
      WHEN category = 'conference' AND slot = 1 THEN 'AV schedule due three days prior'
      WHEN category = 'conference' AND slot = 2 THEN 'Rooms must reset after breakout sessions'
      WHEN category = 'conference' THEN 'Hybrid events require staff technician'
      WHEN slot = 1 THEN 'Load-in must use assigned freight route'
      WHEN slot = 2 THEN 'Open flame requires written approval'
      ELSE 'Event strike must finish within booked window'
    END AS title,
    CASE
      WHEN category = 'bar' AND slot = 1 THEN 'All beverage service must run through the venue bar team.'
      WHEN category = 'bar' AND slot = 2 THEN 'A licensed security plan is required once projected attendance reaches 100 guests.'
      WHEN category = 'bar' THEN 'DJ or amplified music must conclude by 2am unless the venue approves an extension.'
      WHEN category = 'gallery' AND slot = 1 THEN 'Food and beverage stations must stay clear of exhibition walls and artwork.'
      WHEN category = 'gallery' AND slot = 2 THEN 'Vendor setup must be complete two hours before guest arrival for gallery walkthrough.'
      WHEN category = 'gallery' THEN 'The venue manager must approve any layout that changes artwork sightlines.'
      WHEN category = 'athletic' AND slot = 1 THEN 'Courts may be used for light team-building activities, not unsupervised open play.'
      WHEN category = 'athletic' AND slot = 2 THEN 'Catering must be selected from the club-approved vendor list.'
      WHEN category = 'athletic' THEN 'Protective flooring is required for furniture, staging, and bar setups.'
      WHEN category = 'conference' AND slot = 1 THEN 'Final AV needs, run of show, and presenter count are due three business days before the event.'
      WHEN category = 'conference' AND slot = 2 THEN 'Breakout rooms must be returned to their original layouts at the end of the booking.'
      WHEN category = 'conference' THEN 'A house technician is required for hybrid streaming or multi-room audio.'
      WHEN slot = 1 THEN 'All vendor load-in must use the assigned entrance and freight route.'
      WHEN slot = 2 THEN 'Candles, cooking flames, and pyrotechnics require written venue approval.'
      ELSE 'Strike and trash removal must be completed before the reservation end time.'
    END AS description,
    CASE
      WHEN slot = 2 THEN 'safety'
      WHEN slot = 3 THEN 'conduct'
      ELSE 'general'
    END AS rule_type
  FROM rule_slots
)
INSERT INTO public.venue_rules (
  id,
  venue_id,
  rules_text,
  title,
  description,
  rule_type,
  applies_to,
  is_mandatory,
  display_order,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(11000 + (n * 10) + slot),
  seed_helpers.seed_uuid(200 + n),
  title || ': ' || description,
  title,
  description,
  rule_type,
  CASE WHEN slot = 2 THEN 'all' ELSE 'vendors' END,
  true,
  slot,
  now(),
  now()
FROM rules
ON CONFLICT (id) DO UPDATE SET
  rules_text = EXCLUDED.rules_text,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  rule_type = EXCLUDED.rule_type,
  applies_to = EXCLUDED.applies_to,
  is_mandatory = EXCLUDED.is_mandatory,
  display_order = EXCLUDED.display_order,
  updated_at = now();

INSERT INTO public.venue_photos (
  id,
  venue_id,
  photo_url,
  is_primary,
  display_order,
  created_at
)
SELECT
  seed_helpers.seed_uuid(13000 + n),
  seed_helpers.seed_uuid(200 + n),
  CASE
    WHEN n <= 12 THEN 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1200&q=80'
    WHEN n <= 22 THEN 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80'
    WHEN n <= 30 THEN 'https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=1200&q=80'
    WHEN n <= 40 THEN 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80'
    ELSE 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1200&q=80'
  END,
  true,
  1,
  now()
FROM generate_series(1, 50) AS n
ON CONFLICT (id) DO UPDATE SET
  photo_url = EXCLUDED.photo_url,
  is_primary = EXCLUDED.is_primary,
  display_order = EXCLUDED.display_order;

-- VENDORS
WITH vendor_seed(n, business_name) AS (
  VALUES
    (1, 'Pulse Theory DJs'),
    (2, 'Turntable Union'),
    (3, 'Metro Beat Collective'),
    (4, 'Signal Room Sound'),
    (5, 'Highline Vinyl Co.'),
    (6, 'Afterglow DJs'),
    (7, 'Northstar Music Crew'),
    (8, 'Skyline Selector'),
    (9, 'Groove Foundry'),
    (10, 'Late Night Frequency'),
    (11, 'Harvest Table Catering'),
    (12, 'Fork and Field Events'),
    (13, 'Bright Plate Kitchen'),
    (14, 'Cedar Spoon Catering'),
    (15, 'Gather Provisions'),
    (16, 'Seasonal Social Kitchen'),
    (17, 'Urban Feast Co.'),
    (18, 'Mainstay Catering'),
    (19, 'Blue Apron Hall'),
    (20, 'Market Line Kitchen'),
    (21, 'Craft Pour Bar Co.'),
    (22, 'Stirred Social'),
    (23, 'Copper Shaker Events'),
    (24, 'Juniper Mobile Bar'),
    (25, 'Neon Paloma Bar Service'),
    (26, 'Proof Positive Bar Team'),
    (27, 'Highball Hospitality'),
    (28, 'Last Call Service Co.'),
    (29, 'Frame House Photo'),
    (30, 'North Loop Photography'),
    (31, 'Golden Hour Collective'),
    (32, 'Kindred Lens Studio'),
    (33, 'Citylight Photo Co.'),
    (34, 'True North Images'),
    (35, 'Archive Social Photo'),
    (36, 'Focus Field Studio'),
    (37, 'Motion Room Films'),
    (38, 'Signal Story Video'),
    (39, 'Clear Cut Films'),
    (40, 'Foundry Motion'),
    (41, 'One Take Studio'),
    (42, 'Wide Angle Works'),
    (43, 'Aftermovie Co.'),
    (44, 'BrightRig AV'),
    (45, 'Stagecraft Technical'),
    (46, 'RoomTone Production'),
    (47, 'Switchboard AV'),
    (48, 'ClearLine Event Tech'),
    (49, 'Northstar Production Services'),
    (50, 'Projection House')
),
vendor_details AS (
  SELECT
    n,
    business_name,
    CASE
      WHEN n <= 10 THEN 'dj'
      WHEN n <= 20 THEN 'catering'
      WHEN n <= 28 THEN 'bartending'
      WHEN n <= 36 THEN 'photography'
      WHEN n <= 43 THEN 'videography'
      ELSE 'av_tech'
    END AS service_type,
    CASE
      WHEN n <= 10 THEN 'DJ / Music'
      WHEN n <= 20 THEN 'Caterer'
      WHEN n <= 28 THEN 'Bartender'
      WHEN n <= 36 THEN 'Photographer'
      WHEN n <= 43 THEN 'Photographer'
      ELSE 'Audio/Visual Tech'
    END AS vendor_type,
    CASE
      WHEN n <= 10 THEN 'hourly'
      WHEN n <= 20 THEN 'per_person'
      WHEN n <= 28 THEN 'per_person'
      WHEN n <= 36 THEN 'flat_rate'
      WHEN n <= 43 THEN 'flat_rate'
      ELSE 'hourly'
    END AS pricing_model,
    CASE ((n - 1) % 5)
      WHEN 0 THEN 'New York, NY'
      WHEN 1 THEN 'Los Angeles, CA'
      WHEN 2 THEN 'Chicago, IL'
      WHEN 3 THEN 'Atlanta, GA'
      ELSE 'Miami, FL'
    END AS primary_market
  FROM vendor_seed
)
INSERT INTO public.vendor_profiles (
  id,
  user_id,
  name,
  phone,
  vendor_type,
  years_experience,
  bio,
  services_offered,
  regions_served,
  travel_radius,
  languages,
  pricing_model,
  hourly_rate,
  minimum_hours,
  deposit_required,
  payout_enabled,
  rating,
  review_count,
  total_gigs,
  total_earnings,
  compatible_features,
  slug,
  service_type,
  service_area,
  setup_time_minutes,
  base_rate,
  per_person_rate,
  per_head_kickback,
  is_published,
  average_rating,
  total_bookings,
  bank_account_holder_name,
  bank_name,
  availability_notes,
  requires_deposit,
  deposit_amount,
  deposit_type,
  deposit_percentage,
  deposit_refundable,
  deposit_terms,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(80 + n),
  seed_helpers.seed_uuid(80 + n),
  business_name,
  '+1-555-' || lpad((80 + n)::text, 3, '0') || '-' || lpad((1080 + n)::text, 4, '0'),
  vendor_type,
  2 + (n % 14),
  CASE service_type
    WHEN 'dj' THEN business_name || ' programs music for networking mixers, launches, rooftops, and private celebrations with clean setup and flexible playlists.'
    WHEN 'catering' THEN business_name || ' builds seasonal menus for brunches, workshops, conferences, and galas with reliable staffing and dietary labeling.'
    WHEN 'bartending' THEN business_name || ' provides licensed bar teams, batching, mocktails, and polished service for venues that allow outside beverage partners.'
    WHEN 'photography' THEN business_name || ' captures event coverage, branded detail shots, speaker moments, and same-week highlight galleries.'
    WHEN 'videography' THEN business_name || ' produces recap films, speaker recordings, social clips, and launch assets for event teams.'
    ELSE business_name || ' supplies microphones, projection, lighting, streaming, and technician support for meetings and high-touch productions.'
  END,
  CASE service_type
    WHEN 'dj' THEN ARRAY['DJ sets', 'emcee support', 'playlist consultation']
    WHEN 'catering' THEN ARRAY['passed bites', 'buffet service', 'boxed meals']
    WHEN 'bartending' THEN ARRAY['mobile bar', 'bartenders', 'batch cocktails']
    WHEN 'photography' THEN ARRAY['event photography', 'step-and-repeat', 'edited gallery']
    WHEN 'videography' THEN ARRAY['recap video', 'speaker capture', 'social edits']
    ELSE ARRAY['audio', 'projection', 'lighting', 'hybrid event support']
  END,
  primary_market || '; New York, NY; Los Angeles, CA; Chicago, IL; Atlanta, GA; Miami, FL',
  CASE WHEN n % 4 = 0 THEN 'regional' ELSE 'metro area' END,
  ARRAY['English'] || CASE WHEN n % 6 = 0 THEN ARRAY['Spanish'] ELSE ARRAY[]::text[] END,
  pricing_model,
  CASE
    WHEN pricing_model = 'hourly' THEN (125 + ((n * 37) % 376)) * 100
    ELSE NULL
  END,
  CASE WHEN pricing_model = 'hourly' THEN 3 ELSE NULL END,
  CASE WHEN n % 3 = 0 THEN (250 + ((n * 29) % 1250)) * 100 ELSE 0 END,
  n % 5 <> 0,
  round((4.10 + ((n % 9)::numeric / 10))::numeric, 2),
  4 + (n % 42),
  6 + (n % 90),
  4000 + (n * 1850),
  CASE service_type
    WHEN 'dj' THEN ARRAY['late-night', 'bar', 'rooftop']
    WHEN 'catering' THEN ARRAY['kitchen', 'dietary-friendly', 'conference']
    WHEN 'bartending' THEN ARRAY['bar', 'cocktails', 'licensed']
    WHEN 'photography' THEN ARRAY['brand-launch', 'step-and-repeat', 'social']
    WHEN 'videography' THEN ARRAY['recap', 'speaker-recording', 'launch']
    ELSE ARRAY['av-equipped', 'hybrid', 'stage']
  END,
  seed_helpers.seed_slug(business_name),
  service_type,
  NULL,
  CASE service_type
    WHEN 'catering' THEN 120
    WHEN 'av_tech' THEN 120
    WHEN 'bartending' THEN 90
    ELSE 60
  END,
  CASE
    WHEN pricing_model = 'flat_rate' THEN (900 + ((n * 83) % 4101)) * 100
    WHEN pricing_model = 'per_person' THEN (600 + ((n * 53) % 2401)) * 100
    ELSE (300 + ((n * 41) % 1701)) * 100
  END,
  CASE WHEN pricing_model = 'per_person' THEN 2500 + ((n * 53) % 4001) ELSE NULL END,
  CASE WHEN service_type = 'bartending' AND n % 2 = 0 THEN 3 + (n % 8) ELSE NULL END,
  n % 5 <> 0,
  round((4.10 + ((n % 9)::numeric / 10))::numeric, 2),
  2 + (n % 28),
  business_name,
  CASE WHEN n % 2 = 0 THEN 'First Republic Events' ELSE 'Metro Business Bank' END,
  CASE WHEN n % 5 = 0 THEN 'Currently accepting waitlist requests only.' ELSE 'Available for most weekday and weekend event windows with advance notice.' END,
  n % 3 = 0,
  CASE WHEN n % 3 = 0 THEN (250 + ((n * 29) % 1250)) * 100 ELSE NULL END,
  CASE WHEN n % 3 = 0 THEN 'fixed' ELSE NULL END,
  NULL,
  n % 4 <> 0,
  CASE WHEN n % 3 = 0 THEN 'Deposit is due on booking acceptance and is refundable until seven days before the event.' ELSE NULL END,
  now() - ((100 - n) * interval '1 day'),
  now()
FROM vendor_details
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  vendor_type = EXCLUDED.vendor_type,
  years_experience = EXCLUDED.years_experience,
  bio = EXCLUDED.bio,
  services_offered = EXCLUDED.services_offered,
  regions_served = EXCLUDED.regions_served,
  travel_radius = EXCLUDED.travel_radius,
  languages = EXCLUDED.languages,
  pricing_model = EXCLUDED.pricing_model,
  hourly_rate = EXCLUDED.hourly_rate,
  minimum_hours = EXCLUDED.minimum_hours,
  deposit_required = EXCLUDED.deposit_required,
  payout_enabled = EXCLUDED.payout_enabled,
  rating = EXCLUDED.rating,
  review_count = EXCLUDED.review_count,
  total_gigs = EXCLUDED.total_gigs,
  total_earnings = EXCLUDED.total_earnings,
  compatible_features = EXCLUDED.compatible_features,
  slug = EXCLUDED.slug,
  service_type = EXCLUDED.service_type,
  service_area = EXCLUDED.service_area,
  setup_time_minutes = EXCLUDED.setup_time_minutes,
  base_rate = EXCLUDED.base_rate,
  per_person_rate = EXCLUDED.per_person_rate,
  per_head_kickback = EXCLUDED.per_head_kickback,
  is_published = EXCLUDED.is_published,
  average_rating = EXCLUDED.average_rating,
  total_bookings = EXCLUDED.total_bookings,
  bank_account_holder_name = EXCLUDED.bank_account_holder_name,
  bank_name = EXCLUDED.bank_name,
  availability_notes = EXCLUDED.availability_notes,
  requires_deposit = EXCLUDED.requires_deposit,
  deposit_amount = EXCLUDED.deposit_amount,
  deposit_type = EXCLUDED.deposit_type,
  deposit_percentage = EXCLUDED.deposit_percentage,
  deposit_refundable = EXCLUDED.deposit_refundable,
  deposit_terms = EXCLUDED.deposit_terms,
  updated_at = now();

-- vendor_profiles has no is_available column in this schema; is_published and
-- availability_notes carry the 80 percent available/published simulation.

WITH vendor_rows AS (
  SELECT
    row_number() OVER (ORDER BY id) AS n,
    id,
    name,
    service_type,
    pricing_model,
    COALESCE(base_rate, hourly_rate, 500) AS base_price
  FROM public.vendor_profiles
  WHERE id BETWEEN seed_helpers.seed_uuid(81) AND seed_helpers.seed_uuid(130)
)
INSERT INTO public.vendor_offerings (
  id,
  vendor_id,
  offering_name,
  description,
  is_included,
  base_price,
  pricing_model,
  min_quantity,
  max_quantity,
  duration_hours,
  portfolio_images,
  add_ons,
  service_category,
  max_capacity,
  equipment_included,
  is_active,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(8000 + n),
  id,
  CASE service_type
    WHEN 'dj' THEN 'DJ set and event sound'
    WHEN 'catering' THEN 'Full-service event catering'
    WHEN 'bartending' THEN 'Mobile bar service'
    WHEN 'photography' THEN 'Event photography coverage'
    WHEN 'videography' THEN 'Event recap and speaker video'
    ELSE 'AV package and technician'
  END,
  name || ' standard offering for realistic marketplace booking tests.',
  true,
  base_price,
  pricing_model,
  CASE WHEN service_type IN ('catering', 'bartending') THEN 20 ELSE 1 END,
  CASE WHEN service_type IN ('catering', 'bartending') THEN 500 ELSE NULL END,
  CASE WHEN service_type IN ('photography', 'videography') THEN 5 ELSE 4 END,
  ARRAY[]::text[],
  CASE service_type
    WHEN 'dj' THEN '[{"name":"Wireless mic","price":12500},{"name":"Dance lighting","price":25000}]'::jsonb
    WHEN 'catering' THEN '[{"name":"Coffee service","price":800},{"name":"Dessert bites","price":1200}]'::jsonb
    WHEN 'bartending' THEN '[{"name":"Signature cocktail","price":900},{"name":"Glassware rental","price":400}]'::jsonb
    WHEN 'photography' THEN '[{"name":"Rush edits","price":35000},{"name":"Second shooter","price":65000}]'::jsonb
    WHEN 'videography' THEN '[{"name":"Vertical social edits","price":50000},{"name":"Raw footage","price":30000}]'::jsonb
    ELSE '[{"name":"Extra projector","price":25000},{"name":"Streaming operator","price":50000}]'::jsonb
  END,
  CASE service_type WHEN 'av_tech' THEN 'av' ELSE service_type END,
  CASE WHEN service_type IN ('catering', 'bartending') THEN 500 ELSE NULL END,
  CASE service_type
    WHEN 'dj' THEN ARRAY['controller', 'speakers', 'wireless microphone']
    WHEN 'catering' THEN ARRAY['serving ware', 'menu labels', 'staffing plan']
    WHEN 'bartending' THEN ARRAY['portable bar', 'bar tools', 'ice bins']
    WHEN 'photography' THEN ARRAY['camera kit', 'event flash', 'online gallery']
    WHEN 'videography' THEN ARRAY['camera kit', 'audio recorder', 'stabilizer']
    ELSE ARRAY['speakers', 'projector', 'microphones', 'cables']
  END,
  true,
  now(),
  now()
FROM vendor_rows
ON CONFLICT (id) DO UPDATE SET
  offering_name = EXCLUDED.offering_name,
  description = EXCLUDED.description,
  is_included = EXCLUDED.is_included,
  base_price = EXCLUDED.base_price,
  pricing_model = EXCLUDED.pricing_model,
  min_quantity = EXCLUDED.min_quantity,
  max_quantity = EXCLUDED.max_quantity,
  duration_hours = EXCLUDED.duration_hours,
  portfolio_images = EXCLUDED.portfolio_images,
  add_ons = EXCLUDED.add_ons,
  service_category = EXCLUDED.service_category,
  max_capacity = EXCLUDED.max_capacity,
  equipment_included = EXCLUDED.equipment_included,
  is_active = EXCLUDED.is_active,
  updated_at = now();

WITH vendor_rows AS (
  SELECT
    row_number() OVER (ORDER BY id) AS n,
    id,
    name,
    service_type,
    COALESCE(base_rate, hourly_rate, 500) AS base_price
  FROM public.vendor_profiles
  WHERE id BETWEEN seed_helpers.seed_uuid(81) AND seed_helpers.seed_uuid(130)
)
INSERT INTO public.vendor_packages (
  id,
  vendor_id,
  package_name,
  description,
  price,
  duration_hours,
  inclusions,
  is_active,
  display_order,
  created_at
)
SELECT
  seed_helpers.seed_uuid(9000 + n),
  id,
  CASE service_type
    WHEN 'dj' THEN 'Mixer-ready music package'
    WHEN 'catering' THEN 'Reception menu package'
    WHEN 'bartending' THEN 'Hosted bar package'
    WHEN 'photography' THEN 'Launch coverage package'
    WHEN 'videography' THEN 'Recap film package'
    ELSE 'Conference AV package'
  END,
  'Bundled seed package from ' || name || ' for quote and invoice testing.',
  base_price + 40000,
  CASE WHEN service_type IN ('photography', 'videography') THEN 5 ELSE 4 END,
  jsonb_build_array(
    'planning call',
    'event-day service',
    'standard equipment',
    'post-event follow-up'
  ),
  true,
  1,
  now()
FROM vendor_rows
ON CONFLICT (id) DO UPDATE SET
  package_name = EXCLUDED.package_name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  duration_hours = EXCLUDED.duration_hours,
  inclusions = EXCLUDED.inclusions,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;

-- EVENTS
-- The requested "planning" status maps to the actual schema's "draft" status.
-- The requested "party" and "meeting" event types map to social_mixer and all_hands.
WITH event_seed AS (
  SELECT
    i,
    seed_helpers.seed_uuid(1000 + i) AS event_id,
    seed_helpers.seed_uuid(1 + ((i - 1) % 30)) AS builder_id,
    (ARRAY[
      'Q3 Tech Networking Mixer',
      'Founders Brunch Series',
      'Brand Launch Party',
      'Annual Charity Gala',
      'Creative Industry Workshop',
      'Private Birthday Dinner',
      'Product Demo Day',
      'Summer Rooftop Social',
      'Operator Breakfast Roundtable',
      'Design Leadership Salon',
      'Community Builders Meetup',
      'Retail Innovation Showcase',
      'Investor Demo Night',
      'Wellness Team Offsite',
      'Climate Founders Forum',
      'Creator Economy Mixer',
      'Women in Product Dinner',
      'AI Tools Workshop',
      'Holiday Client Reception',
      'Quarterly All Hands'
    ])[1 + ((i - 1) % 20)] AS base_name,
    (ARRAY['networking', 'conference', 'workshop', 'social_mixer', 'all_hands', 'product_launch'])[1 + ((i - 1) % 6)] AS event_type,
    DATE '2026-04-30' + ((i - 25) * 4) AS event_date,
    CASE
      WHEN i <= 20 THEN 20 + ((i * 29) % 481)
      WHEN i <= 35 THEN 40 + ((i * 7) % 90)
      WHEN i <= 50 THEN 90 + ((i * 13) % 250)
      WHEN i <= 60 THEN 50 + ((i * 9) % 120)
      ELSE 100 + ((i * 17) % 401)
    END AS expected_attendance,
    CASE
      WHEN i <= 20 THEN 'draft'
      WHEN i <= 35 THEN 'venue_pending'
      WHEN i <= 50 THEN 'confirmed'
      WHEN i <= 60 THEN 'cancelled'
      WHEN i <= 68 THEN 'completed'
      ELSE 'confirmed'
    END AS status,
    CASE
      WHEN i <= 20 THEN NULL::uuid
      WHEN i <= 35 THEN seed_helpers.seed_uuid(200 + 1 + ((i - 21) % 15))
      WHEN i <= 50 THEN seed_helpers.seed_uuid(200 + 31 + ((i - 36) % 20))
      WHEN i <= 60 THEN seed_helpers.seed_uuid(200 + 11 + ((i - 51) % 10))
      ELSE seed_helpers.seed_uuid(200 + 31 + ((i - 61) % 20))
    END AS venue_id,
    500 + ((i * 337) % 24501) AS budget
  FROM generate_series(1, 75) AS i
)
INSERT INTO public.events (
  id,
  builder_id,
  event_name,
  event_type,
  event_description,
  expected_attendance,
  event_date,
  start_time,
  end_time,
  duration_hours,
  status,
  is_recurring,
  total_budget,
  description,
  event_time,
  expected_attendance_min,
  expected_attendance_max,
  actual_cost,
  completion_percentage,
  venue_id,
  venue_confirmed,
  budget,
  platform_fee_paid,
  created_at,
  updated_at
)
SELECT
  event_id,
  builder_id,
  base_name || ' - ' || to_char(event_date, 'Mon YYYY') || ' #' || i,
  event_type,
  'Seeded event representing realistic builder wizard traffic for ' || lower(base_name) || '.',
  expected_attendance,
  event_date,
  (time '09:00' + ((i % 7) * interval '1 hour'))::time,
  (time '09:00' + ((i % 7) * interval '1 hour') + ((3 + (i % 4)) * interval '1 hour'))::time,
  (3 + (i % 4))::numeric,
  status,
  false,
  budget,
  'Planning notes include target audience, preferred layout, vendor needs, and follow-up logistics.',
  (time '09:00' + ((i % 7) * interval '1 hour'))::time,
  greatest(10, expected_attendance - 10),
  expected_attendance,
  CASE WHEN status IN ('confirmed', 'completed') THEN round((budget * 0.82)::numeric, 2) ELSE NULL END,
  CASE
    WHEN status = 'draft' THEN 20
    WHEN status = 'venue_pending' THEN 45
    WHEN status = 'confirmed' THEN 90
    WHEN status = 'completed' THEN 100
    ELSE 60
  END,
  venue_id,
  status IN ('confirmed', 'completed'),
  budget,
  status IN ('confirmed', 'completed'),
  (event_date::timestamp - interval '45 days')::timestamptz,
  now()
FROM event_seed
ON CONFLICT (id) DO UPDATE SET
  builder_id = EXCLUDED.builder_id,
  event_name = EXCLUDED.event_name,
  event_type = EXCLUDED.event_type,
  event_description = EXCLUDED.event_description,
  expected_attendance = EXCLUDED.expected_attendance,
  event_date = EXCLUDED.event_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  duration_hours = EXCLUDED.duration_hours,
  status = EXCLUDED.status,
  is_recurring = EXCLUDED.is_recurring,
  total_budget = EXCLUDED.total_budget,
  description = EXCLUDED.description,
  event_time = EXCLUDED.event_time,
  expected_attendance_min = EXCLUDED.expected_attendance_min,
  expected_attendance_max = EXCLUDED.expected_attendance_max,
  actual_cost = EXCLUDED.actual_cost,
  completion_percentage = EXCLUDED.completion_percentage,
  venue_id = EXCLUDED.venue_id,
  venue_confirmed = EXCLUDED.venue_confirmed,
  budget = EXCLUDED.budget,
  platform_fee_paid = EXCLUDED.platform_fee_paid,
  updated_at = now();

-- BOOKINGS
WITH booking_seed AS (
  SELECT
    j,
    CASE
      WHEN j <= 15 THEN 20 + j
      WHEN j <= 30 THEN 20 + j
      ELSE 20 + j
    END AS event_i,
    CASE
      WHEN j <= 15 THEN 'pending'
      WHEN j <= 30 THEN 'confirmed'
      ELSE 'cancelled'
    END AS booking_status
  FROM generate_series(1, 40) AS j
),
booking_rows AS (
  SELECT
    bs.j,
    bs.booking_status,
    e.id AS event_id,
    e.venue_id,
    e.builder_id AS organizer_id,
    e.event_date,
    e.start_time,
    e.end_time,
    e.expected_attendance,
    v.hourly_rate,
    greatest(e.duration_hours, 3) AS hours
  FROM booking_seed bs
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1000 + bs.event_i)
  JOIN public.venues v ON v.id = e.venue_id
)
INSERT INTO public.venue_bookings (
  id,
  venue_id,
  event_id,
  organizer_id,
  booking_date,
  start_time,
  end_time,
  guest_count_min,
  guest_count_max,
  status,
  quoted_price,
  final_price,
  services_needed,
  special_requests,
  decline_reason,
  responded_at,
  subtotal,
  platform_fee_percentage,
  platform_fee_amount,
  total_amount,
  payment_status,
  paid_at,
  approved_at,
  rejection_reason,
  approval_source,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(4000 + j),
  venue_id,
  event_id,
  organizer_id,
  event_date,
  start_time,
  end_time,
  greatest(10, expected_attendance - 10),
  expected_attendance,
  booking_status,
  round((hourly_rate * hours)::numeric, 2),
  CASE WHEN booking_status = 'confirmed' THEN round((hourly_rate * hours * 0.96)::numeric, 2) ELSE NULL END,
  jsonb_build_object('layout', 'mixed seating', 'bar', true, 'av', true),
  CASE
    WHEN booking_status = 'pending' THEN 'Builder is confirming guest count and layout before approving the quote.'
    WHEN booking_status = 'confirmed' THEN 'Confirmed with standard load-in and venue manager walkthrough.'
    ELSE 'Cancelled after the event scope changed.'
  END,
  CASE WHEN booking_status = 'cancelled' THEN 'Builder cancelled after choosing a different date.' ELSE NULL END,
  CASE WHEN booking_status <> 'pending' THEN now() - ((j % 8) * interval '1 day') ELSE NULL END,
  round((hourly_rate * hours)::numeric, 2),
  0,
  0,
  round((hourly_rate * hours)::numeric, 2),
  CASE
    WHEN booking_status = 'confirmed' THEN 'succeeded'
    WHEN booking_status = 'cancelled' THEN 'refunded'
    ELSE 'pending'
  END,
  CASE WHEN booking_status = 'confirmed' THEN now() - ((j % 5) * interval '1 day') ELSE NULL END,
  CASE WHEN booking_status = 'confirmed' THEN now() - ((j % 8) * interval '1 day') ELSE NULL END,
  CASE WHEN booking_status = 'cancelled' THEN 'Date hold released after cancellation.' ELSE NULL END,
  CASE WHEN booking_status = 'confirmed' THEN CASE WHEN j % 3 = 0 THEN 'bulk' ELSE 'manual' END ELSE NULL END,
  now() - ((35 - j) * interval '1 day'),
  now()
FROM booking_rows
ON CONFLICT (id) DO UPDATE SET
  venue_id = EXCLUDED.venue_id,
  event_id = EXCLUDED.event_id,
  organizer_id = EXCLUDED.organizer_id,
  booking_date = EXCLUDED.booking_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  guest_count_min = EXCLUDED.guest_count_min,
  guest_count_max = EXCLUDED.guest_count_max,
  status = EXCLUDED.status,
  quoted_price = EXCLUDED.quoted_price,
  final_price = EXCLUDED.final_price,
  services_needed = EXCLUDED.services_needed,
  special_requests = EXCLUDED.special_requests,
  decline_reason = EXCLUDED.decline_reason,
  responded_at = EXCLUDED.responded_at,
  subtotal = EXCLUDED.subtotal,
  platform_fee_percentage = EXCLUDED.platform_fee_percentage,
  platform_fee_amount = EXCLUDED.platform_fee_amount,
  total_amount = EXCLUDED.total_amount,
  payment_status = EXCLUDED.payment_status,
  paid_at = EXCLUDED.paid_at,
  approved_at = EXCLUDED.approved_at,
  rejection_reason = EXCLUDED.rejection_reason,
  approval_source = EXCLUDED.approval_source,
  updated_at = now();

WITH vendor_booking_seed AS (
  SELECT
    j,
    CASE
      WHEN j <= 20 THEN 21 + floor((j - 1) / 2)::integer
      WHEN j <= 50 THEN 36 + floor((j - 21) / 2)::integer
      ELSE j
    END AS event_i,
    CASE
      WHEN j <= 20 THEN 'pending'
      WHEN j <= 50 THEN 'confirmed'
      ELSE 'cancelled'
    END AS booking_status,
    1 + ((j - 1) % 2) AS slot
  FROM generate_series(1, 60) AS j
),
vendor_booking_needs AS (
  SELECT
    vbs.*,
    e.event_type,
    CASE
      WHEN e.event_type = 'product_launch' AND slot = 1 THEN 'photography'
      WHEN e.event_type = 'product_launch' THEN 'av_tech'
      WHEN e.event_type = 'conference' AND slot = 1 THEN 'av_tech'
      WHEN e.event_type = 'conference' THEN 'catering'
      WHEN e.event_type = 'workshop' AND slot = 1 THEN 'catering'
      WHEN e.event_type = 'workshop' THEN 'av_tech'
      WHEN e.event_type = 'social_mixer' AND slot = 1 THEN 'dj'
      WHEN e.event_type = 'social_mixer' THEN 'bartending'
      WHEN e.event_type = 'all_hands' AND slot = 1 THEN 'av_tech'
      WHEN e.event_type = 'all_hands' THEN 'videography'
      WHEN slot = 1 THEN 'dj'
      ELSE 'photography'
    END AS needed_service
  FROM vendor_booking_seed vbs
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1000 + vbs.event_i)
),
vendor_booking_rows AS (
  SELECT
    vbn.j,
    vbn.event_i,
    vbn.booking_status,
    vbn.needed_service,
    e.id AS event_id,
    e.builder_id AS organizer_id,
    e.event_date,
    e.start_time,
    e.end_time,
    e.expected_attendance,
    CASE vbn.needed_service
      WHEN 'dj' THEN 1 + ((vbn.j * 3) % 10)
      WHEN 'catering' THEN 11 + ((vbn.j * 3) % 10)
      WHEN 'bartending' THEN 21 + ((vbn.j * 3) % 8)
      WHEN 'photography' THEN 29 + ((vbn.j * 3) % 8)
      WHEN 'videography' THEN 37 + ((vbn.j * 3) % 7)
      ELSE 44 + ((vbn.j * 3) % 7)
    END AS vendor_n
  FROM vendor_booking_needs vbn
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1000 + vbn.event_i)
)
INSERT INTO public.vendor_bookings (
  id,
  vendor_id,
  event_id,
  organizer_id,
  booking_date,
  start_time,
  end_time,
  setup_time,
  guest_count,
  status,
  quoted_price,
  final_price,
  requirements,
  notes,
  decline_reason,
  responded_at,
  subtotal,
  platform_fee_percentage,
  platform_fee_amount,
  total_amount,
  payment_status,
  paid_at,
  vendor_offering_id,
  vendor_package_id,
  requested_date,
  requested_start_time,
  requested_end_time,
  confirmed_date,
  confirmed_start_time,
  confirmed_end_time,
  quantity,
  deposit_amount,
  deposit_paid,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(5000 + j),
  seed_helpers.seed_uuid(80 + vendor_n),
  event_id,
  organizer_id,
  event_date,
  start_time,
  end_time,
  (start_time - interval '1 hour')::time,
  expected_attendance,
  booking_status,
  CASE needed_service
    WHEN 'catering' THEN expected_attendance * (28 + (j % 26))
    WHEN 'bartending' THEN expected_attendance * (18 + (j % 14))
    WHEN 'av_tech' THEN 950 + (j * 87)
    WHEN 'videography' THEN 1300 + (j * 73)
    WHEN 'photography' THEN 900 + (j * 61)
    ELSE 600 + (j * 55)
  END,
  CASE
    WHEN booking_status = 'confirmed' THEN
      CASE needed_service
        WHEN 'catering' THEN round((expected_attendance * (28 + (j % 26)) * 0.97)::numeric, 2)
        WHEN 'bartending' THEN round((expected_attendance * (18 + (j % 14)) * 0.97)::numeric, 2)
        WHEN 'av_tech' THEN round((950 + (j * 87)) * 0.97, 2)
        WHEN 'videography' THEN round((1300 + (j * 73)) * 0.97, 2)
        WHEN 'photography' THEN round((900 + (j * 61)) * 0.97, 2)
        ELSE round((600 + (j * 55)) * 0.97, 2)
      END
    ELSE NULL
  END,
  jsonb_build_object('service', needed_service, 'guest_count', expected_attendance, 'load_in', 'standard'),
  CASE
    WHEN booking_status = 'pending' THEN 'Awaiting vendor confirmation and final scope.'
    WHEN booking_status = 'confirmed' THEN 'Confirmed and added to event production timeline.'
    ELSE 'Cancelled when the event scope changed.'
  END,
  CASE WHEN booking_status = 'cancelled' THEN 'Builder cancelled the service request.' ELSE NULL END,
  CASE WHEN booking_status <> 'pending' THEN now() - ((j % 7) * interval '1 day') ELSE NULL END,
  CASE needed_service
    WHEN 'catering' THEN expected_attendance * (28 + (j % 26))
    WHEN 'bartending' THEN expected_attendance * (18 + (j % 14))
    WHEN 'av_tech' THEN 950 + (j * 87)
    WHEN 'videography' THEN 1300 + (j * 73)
    WHEN 'photography' THEN 900 + (j * 61)
    ELSE 600 + (j * 55)
  END,
  0,
  0,
  CASE needed_service
    WHEN 'catering' THEN expected_attendance * (28 + (j % 26))
    WHEN 'bartending' THEN expected_attendance * (18 + (j % 14))
    WHEN 'av_tech' THEN 950 + (j * 87)
    WHEN 'videography' THEN 1300 + (j * 73)
    WHEN 'photography' THEN 900 + (j * 61)
    ELSE 600 + (j * 55)
  END,
  CASE
    WHEN booking_status = 'confirmed' THEN 'succeeded'
    WHEN booking_status = 'cancelled' THEN 'refunded'
    ELSE 'pending'
  END,
  CASE WHEN booking_status = 'confirmed' THEN now() - ((j % 6) * interval '1 day') ELSE NULL END,
  seed_helpers.seed_uuid(8000 + vendor_n),
  CASE WHEN booking_status = 'confirmed' THEN seed_helpers.seed_uuid(9000 + vendor_n) ELSE NULL END,
  event_date,
  start_time,
  end_time,
  CASE WHEN booking_status = 'confirmed' THEN event_date ELSE NULL END,
  CASE WHEN booking_status = 'confirmed' THEN start_time ELSE NULL END,
  CASE WHEN booking_status = 'confirmed' THEN end_time ELSE NULL END,
  CASE WHEN needed_service IN ('catering', 'bartending') THEN expected_attendance ELSE 1 END,
  CASE WHEN booking_status = 'confirmed' THEN 250 + ((j * 17) % 750) ELSE NULL END,
  booking_status = 'confirmed',
  now() - ((45 - j) * interval '1 day'),
  now()
FROM vendor_booking_rows
ON CONFLICT (id) DO UPDATE SET
  vendor_id = EXCLUDED.vendor_id,
  event_id = EXCLUDED.event_id,
  organizer_id = EXCLUDED.organizer_id,
  booking_date = EXCLUDED.booking_date,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  setup_time = EXCLUDED.setup_time,
  guest_count = EXCLUDED.guest_count,
  status = EXCLUDED.status,
  quoted_price = EXCLUDED.quoted_price,
  final_price = EXCLUDED.final_price,
  requirements = EXCLUDED.requirements,
  notes = EXCLUDED.notes,
  decline_reason = EXCLUDED.decline_reason,
  responded_at = EXCLUDED.responded_at,
  subtotal = EXCLUDED.subtotal,
  platform_fee_percentage = EXCLUDED.platform_fee_percentage,
  platform_fee_amount = EXCLUDED.platform_fee_amount,
  total_amount = EXCLUDED.total_amount,
  payment_status = EXCLUDED.payment_status,
  paid_at = EXCLUDED.paid_at,
  vendor_offering_id = EXCLUDED.vendor_offering_id,
  vendor_package_id = EXCLUDED.vendor_package_id,
  requested_date = EXCLUDED.requested_date,
  requested_start_time = EXCLUDED.requested_start_time,
  requested_end_time = EXCLUDED.requested_end_time,
  confirmed_date = EXCLUDED.confirmed_date,
  confirmed_start_time = EXCLUDED.confirmed_start_time,
  confirmed_end_time = EXCLUDED.confirmed_end_time,
  quantity = EXCLUDED.quantity,
  deposit_amount = EXCLUDED.deposit_amount,
  deposit_paid = EXCLUDED.deposit_paid,
  updated_at = now();

WITH rows AS (
  SELECT
    row_number() OVER (ORDER BY vb.id) AS n,
    vb.*
  FROM public.vendor_bookings vb
  WHERE vb.id BETWEEN seed_helpers.seed_uuid(5001) AND seed_helpers.seed_uuid(5060)
)
INSERT INTO public.event_vendors (
  id,
  event_id,
  vendor_id,
  status,
  quoted_price,
  final_price,
  setup_time,
  notes,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(5500 + n),
  event_id,
  vendor_id,
  status,
  quoted_price,
  final_price,
  setup_time,
  notes,
  created_at,
  updated_at
FROM rows
ON CONFLICT (id) DO UPDATE SET
  event_id = EXCLUDED.event_id,
  vendor_id = EXCLUDED.vendor_id,
  status = EXCLUDED.status,
  quoted_price = EXCLUDED.quoted_price,
  final_price = EXCLUDED.final_price,
  setup_time = EXCLUDED.setup_time,
  notes = EXCLUDED.notes,
  updated_at = now();

-- MESSAGES
-- Generic venue conversations require legacy bookings because messages.booking_id
-- references public.bookings, not public.venue_bookings.
WITH venue_space_rows AS (
  SELECT
    n,
    v.*
  FROM generate_series(1, 15) AS n
  JOIN public.venues v ON v.id = seed_helpers.seed_uuid(200 + n)
)
INSERT INTO public.spaces (
  id,
  owner_id,
  name,
  description,
  space_type,
  address,
  city,
  state,
  zip_code,
  country,
  capacity,
  square_footage,
  amenities,
  event_types,
  hourly_rate,
  minimum_hours,
  cleaning_fee,
  security_deposit,
  available,
  instant_booking,
  photos,
  rating,
  review_count,
  total_bookings,
  status,
  venue_features,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(300 + n),
  owner_profiles.id,
  venue_name,
  description,
  CASE venue_type
    WHEN 'gallery' THEN 'Gallery'
    WHEN 'rooftop' THEN 'Rooftop'
    WHEN 'loft_warehouse' THEN 'Loft'
    WHEN 'restaurant' THEN 'Restaurant'
    ELSE 'Other'
  END,
  address,
  city,
  state,
  zip_code,
  'USA',
  standing_capacity,
  square_footage,
  ARRAY['WiFi', 'Sound System', 'Tables', 'Chairs'],
  ARRAY['Networking', 'Workshop', 'Party'],
  hourly_rate,
  minimum_hours,
  150,
  COALESCE(deposit_amount, 0),
  true,
  false,
  ARRAY['https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80'],
  average_rating,
  8 + n,
  2 + n,
  'active',
  unique_features_tags,
  now(),
  now()
FROM venue_space_rows
JOIN public.owner_profiles ON owner_profiles.user_id = venue_space_rows.owner_id
ON CONFLICT (id) DO UPDATE SET
  owner_id = EXCLUDED.owner_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  space_type = EXCLUDED.space_type,
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  zip_code = EXCLUDED.zip_code,
  capacity = EXCLUDED.capacity,
  square_footage = EXCLUDED.square_footage,
  amenities = EXCLUDED.amenities,
  event_types = EXCLUDED.event_types,
  hourly_rate = EXCLUDED.hourly_rate,
  minimum_hours = EXCLUDED.minimum_hours,
  cleaning_fee = EXCLUDED.cleaning_fee,
  security_deposit = EXCLUDED.security_deposit,
  available = EXCLUDED.available,
  instant_booking = EXCLUDED.instant_booking,
  photos = EXCLUDED.photos,
  rating = EXCLUDED.rating,
  review_count = EXCLUDED.review_count,
  total_bookings = EXCLUDED.total_bookings,
  status = EXCLUDED.status,
  venue_features = EXCLUDED.venue_features,
  updated_at = now();

WITH legacy_booking_rows AS (
  SELECT
    n,
    e.id AS event_id,
    e.builder_id,
    op.id AS owner_profile_id,
    s.id AS space_id,
    s.hourly_rate,
    e.duration_hours
  FROM generate_series(1, 15) AS n
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1020 + n)
  JOIN public.spaces s ON s.id = seed_helpers.seed_uuid(300 + n)
  JOIN public.owner_profiles op ON op.id = seed_helpers.seed_uuid(30 + n)
)
INSERT INTO public.bookings (
  id,
  event_id,
  space_id,
  builder_id,
  owner_id,
  hourly_rate,
  subtotal,
  cleaning_fee,
  total_amount,
  platform_fee,
  owner_payout,
  payment_status,
  paid_at,
  status,
  requested_at,
  responded_at,
  builder_notes,
  owner_notes,
  venue_cost,
  vendors_cost,
  selected_requirements,
  budget_status,
  created_at,
  updated_at
)
SELECT
  seed_helpers.seed_uuid(3000 + n),
  event_id,
  space_id,
  builder_id,
  owner_profile_id,
  hourly_rate,
  round((hourly_rate * duration_hours)::numeric, 2),
  150,
  round((hourly_rate * duration_hours + 150)::numeric, 2),
  0,
  round((hourly_rate * duration_hours + 150)::numeric, 2),
  CASE WHEN n % 3 = 0 THEN 'paid' ELSE 'pending' END,
  CASE WHEN n % 3 = 0 THEN now() - (n * interval '1 day') ELSE NULL END,
  CASE WHEN n <= 5 THEN 'pending' WHEN n <= 12 THEN 'accepted' ELSE 'cancelled' END,
  now() - ((20 - n) * interval '1 day'),
  CASE WHEN n > 5 THEN now() - ((18 - n) * interval '1 day') ELSE NULL END,
  'Seed booking used for venue conversation history.',
  CASE WHEN n > 5 THEN 'Venue shared layout notes and next steps.' ELSE NULL END,
  round((hourly_rate * duration_hours)::numeric, 2),
  0,
  ARRAY['coi', 'layout_plan'],
  CASE WHEN n % 6 = 0 THEN 'at_limit' ELSE 'within_budget' END,
  now() - ((20 - n) * interval '1 day'),
  now()
FROM legacy_booking_rows
ON CONFLICT (id) DO UPDATE SET
  event_id = EXCLUDED.event_id,
  space_id = EXCLUDED.space_id,
  builder_id = EXCLUDED.builder_id,
  owner_id = EXCLUDED.owner_id,
  hourly_rate = EXCLUDED.hourly_rate,
  subtotal = EXCLUDED.subtotal,
  cleaning_fee = EXCLUDED.cleaning_fee,
  total_amount = EXCLUDED.total_amount,
  platform_fee = EXCLUDED.platform_fee,
  owner_payout = EXCLUDED.owner_payout,
  payment_status = EXCLUDED.payment_status,
  paid_at = EXCLUDED.paid_at,
  status = EXCLUDED.status,
  requested_at = EXCLUDED.requested_at,
  responded_at = EXCLUDED.responded_at,
  builder_notes = EXCLUDED.builder_notes,
  owner_notes = EXCLUDED.owner_notes,
  venue_cost = EXCLUDED.venue_cost,
  vendors_cost = EXCLUDED.vendors_cost,
  selected_requirements = EXCLUDED.selected_requirements,
  budget_status = EXCLUDED.budget_status,
  updated_at = now();

WITH venue_threads AS (
  SELECT
    n,
    seed_helpers.seed_uuid(6000 + n) AS thread_id,
    seed_helpers.seed_uuid(3000 + n) AS booking_id,
    e.id AS event_id,
    e.builder_id AS builder_user_id,
    v.owner_id AS owner_user_id,
    e.event_name,
    e.expected_attendance
  FROM generate_series(1, 15) AS n
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1020 + n)
  JOIN public.venues v ON v.id = e.venue_id
)
INSERT INTO public.message_threads (
  id,
  event_id,
  booking_id,
  booking_type,
  participant_1_id,
  participant_2_id,
  last_message_at,
  unread_count_participant_1,
  unread_count_participant_2,
  created_at,
  updated_at
)
SELECT
  thread_id,
  event_id,
  booking_id,
  'venue_booking',
  builder_user_id,
  owner_user_id,
  now() - (n * interval '3 hours'),
  CASE WHEN n % 4 = 0 THEN 1 ELSE 0 END,
  CASE WHEN n % 5 = 0 THEN 2 ELSE 0 END,
  now() - ((25 - n) * interval '1 day'),
  now()
FROM venue_threads
ON CONFLICT (id) DO UPDATE SET
  event_id = EXCLUDED.event_id,
  booking_id = EXCLUDED.booking_id,
  booking_type = EXCLUDED.booking_type,
  participant_1_id = EXCLUDED.participant_1_id,
  participant_2_id = EXCLUDED.participant_2_id,
  last_message_at = EXCLUDED.last_message_at,
  unread_count_participant_1 = EXCLUDED.unread_count_participant_1,
  unread_count_participant_2 = EXCLUDED.unread_count_participant_2,
  updated_at = now();

WITH venue_threads AS (
  SELECT
    n,
    seed_helpers.seed_uuid(6000 + n) AS thread_id,
    seed_helpers.seed_uuid(3000 + n) AS booking_id,
    e.event_name,
    e.expected_attendance,
    e.builder_id AS builder_user_id,
    v.owner_id AS owner_user_id
  FROM generate_series(1, 15) AS n
  JOIN public.events e ON e.id = seed_helpers.seed_uuid(1020 + n)
  JOIN public.venues v ON v.id = e.venue_id
),
message_slots AS (
  SELECT vt.*, m
  FROM venue_threads vt
  CROSS JOIN generate_series(1, 4) AS m
)
INSERT INTO public.messages (
  id,
  booking_id,
  vendor_booking_id,
  sender_id,
  receiver_id,
  content,
  attachments,
  read,
  read_at,
  created_at,
  thread_id
)
SELECT
  seed_helpers.seed_uuid(7000 + (n * 10) + m),
  booking_id,
  NULL,
  CASE WHEN m IN (1, 3) THEN builder_user_id ELSE owner_user_id END,
  CASE WHEN m IN (1, 3) THEN owner_user_id ELSE builder_user_id END,
  CASE m
    WHEN 1 THEN 'Hi, we are planning ' || event_name || ' for about ' || expected_attendance || ' guests. Is the date still open?'
    WHEN 2 THEN 'Thanks for reaching out. The date is open, and the guest count is workable. Can you share your preferred layout and load-in needs?'
    WHEN 3 THEN 'We are thinking mixed seating, a small check-in table, and light AV for remarks. Happy to send a run of show today.'
    ELSE 'That works. I will hold the date while we finalize the quote and house-rule checklist.'
  END,
  ARRAY[]::text[],
  m < 4,
  CASE WHEN m < 4 THEN now() - ((5 - m) * interval '1 hour') ELSE NULL END,
  now() - ((n * 8 + (5 - m)) * interval '1 hour'),
  thread_id
FROM message_slots
ON CONFLICT (id) DO UPDATE SET
  booking_id = EXCLUDED.booking_id,
  vendor_booking_id = EXCLUDED.vendor_booking_id,
  sender_id = EXCLUDED.sender_id,
  receiver_id = EXCLUDED.receiver_id,
  content = EXCLUDED.content,
  attachments = EXCLUDED.attachments,
  read = EXCLUDED.read,
  read_at = EXCLUDED.read_at,
  created_at = EXCLUDED.created_at,
  thread_id = EXCLUDED.thread_id;

WITH vendor_threads AS (
  SELECT
    n,
    seed_helpers.seed_uuid(6200 + n) AS thread_id,
    vb.id AS vendor_booking_id,
    vb.event_id,
    vb.organizer_id AS builder_user_id,
    vp.user_id AS vendor_user_id,
    vp.service_type,
    e.event_name
  FROM generate_series(1, 15) AS n
  JOIN public.vendor_bookings vb ON vb.id = seed_helpers.seed_uuid(5000 + n)
  JOIN public.vendor_profiles vp ON vp.id = vb.vendor_id
  JOIN public.events e ON e.id = vb.event_id
)
INSERT INTO public.message_threads (
  id,
  event_id,
  booking_id,
  booking_type,
  participant_1_id,
  participant_2_id,
  last_message_at,
  unread_count_participant_1,
  unread_count_participant_2,
  created_at,
  updated_at
)
SELECT
  thread_id,
  event_id,
  vendor_booking_id,
  'vendor_booking',
  builder_user_id,
  vendor_user_id,
  now() - (n * interval '2 hours'),
  CASE WHEN n % 3 = 0 THEN 1 ELSE 0 END,
  CASE WHEN n % 4 = 0 THEN 1 ELSE 0 END,
  now() - ((18 - n) * interval '1 day'),
  now()
FROM vendor_threads
ON CONFLICT (id) DO UPDATE SET
  event_id = EXCLUDED.event_id,
  booking_id = EXCLUDED.booking_id,
  booking_type = EXCLUDED.booking_type,
  participant_1_id = EXCLUDED.participant_1_id,
  participant_2_id = EXCLUDED.participant_2_id,
  last_message_at = EXCLUDED.last_message_at,
  unread_count_participant_1 = EXCLUDED.unread_count_participant_1,
  unread_count_participant_2 = EXCLUDED.unread_count_participant_2,
  updated_at = now();

WITH vendor_threads AS (
  SELECT
    n,
    seed_helpers.seed_uuid(6200 + n) AS thread_id,
    vb.id AS vendor_booking_id,
    vb.organizer_id AS builder_user_id,
    vp.user_id AS vendor_user_id,
    vp.service_type,
    e.event_name
  FROM generate_series(1, 15) AS n
  JOIN public.vendor_bookings vb ON vb.id = seed_helpers.seed_uuid(5000 + n)
  JOIN public.vendor_profiles vp ON vp.id = vb.vendor_id
  JOIN public.events e ON e.id = vb.event_id
),
message_slots AS (
  SELECT vt.*, m
  FROM vendor_threads vt
  CROSS JOIN generate_series(1, 4) AS m
)
INSERT INTO public.messages (
  id,
  booking_id,
  vendor_booking_id,
  sender_id,
  receiver_id,
  content,
  attachments,
  read,
  read_at,
  created_at,
  thread_id
)
SELECT
  seed_helpers.seed_uuid(7600 + (n * 10) + m),
  NULL,
  vendor_booking_id,
  CASE WHEN m IN (1, 3) THEN builder_user_id ELSE vendor_user_id END,
  CASE WHEN m IN (1, 3) THEN vendor_user_id ELSE builder_user_id END,
  CASE m
    WHEN 1 THEN 'Hi, are you available for ' || event_name || '? We would like a quote for ' || service_type || '.'
    WHEN 2 THEN 'Yes, that date is currently open. Please confirm timing, guest count, and any venue restrictions.'
    WHEN 3 THEN 'Timing is set and the venue has standard load-in. Can you include setup needs and deposit terms in the quote?'
    ELSE 'Absolutely. I will send a scoped quote with arrival time, equipment, and payment schedule.'
  END,
  ARRAY[]::text[],
  m < 4,
  CASE WHEN m < 4 THEN now() - ((4 - m) * interval '1 hour') ELSE NULL END,
  now() - ((n * 7 + (5 - m)) * interval '1 hour'),
  thread_id
FROM message_slots
ON CONFLICT (id) DO UPDATE SET
  booking_id = EXCLUDED.booking_id,
  vendor_booking_id = EXCLUDED.vendor_booking_id,
  sender_id = EXCLUDED.sender_id,
  receiver_id = EXCLUDED.receiver_id,
  content = EXCLUDED.content,
  attachments = EXCLUDED.attachments,
  read = EXCLUDED.read,
  read_at = EXCLUDED.read_at,
  created_at = EXCLUDED.created_at,
  thread_id = EXCLUDED.thread_id;

-- Optional modern vendor messaging tables from later migrations.
DO $$
BEGIN
  IF to_regclass('public.vendor_message_threads') IS NOT NULL
     AND to_regclass('public.vendor_messages') IS NOT NULL THEN
    EXECUTE $seed_vendor_messages$
      WITH vendor_threads AS (
        SELECT
          n,
          seed_helpers.seed_uuid(14000 + n) AS thread_id,
          vb.id AS booking_id,
          vb.vendor_id,
          vb.organizer_id AS builder_user_id,
          bp.id AS builder_id,
          e.event_name,
          vp.user_id AS vendor_user_id
        FROM generate_series(1, 15) AS n
        JOIN public.vendor_bookings vb ON vb.id = seed_helpers.seed_uuid(5000 + n)
        JOIN public.events e ON e.id = vb.event_id
        JOIN public.builder_profiles bp ON bp.id = e.builder_id
        JOIN public.vendor_profiles vp ON vp.id = vb.vendor_id
      )
      INSERT INTO public.vendor_message_threads (
        id,
        booking_id,
        vendor_id,
        builder_id,
        subject,
        status,
        last_message_at,
        created_at,
        updated_at
      )
      SELECT
        thread_id,
        booking_id,
        vendor_id,
        builder_id,
        'Booking discussion: ' || event_name,
        'active',
        now() - (n * interval '90 minutes'),
        now() - ((18 - n) * interval '1 day'),
        now()
      FROM vendor_threads
      ON CONFLICT (booking_id) DO UPDATE SET
        vendor_id = EXCLUDED.vendor_id,
        builder_id = EXCLUDED.builder_id,
        subject = EXCLUDED.subject,
        status = EXCLUDED.status,
        last_message_at = EXCLUDED.last_message_at,
        updated_at = now();

      WITH vendor_threads AS (
        SELECT
          n,
          vmt.id AS thread_id,
          vb.organizer_id AS builder_user_id,
          vp.user_id AS vendor_user_id,
          e.event_name
        FROM generate_series(1, 15) AS n
        JOIN public.vendor_bookings vb ON vb.id = seed_helpers.seed_uuid(5000 + n)
        JOIN public.vendor_message_threads vmt ON vmt.booking_id = vb.id
        JOIN public.vendor_profiles vp ON vp.id = vb.vendor_id
        JOIN public.events e ON e.id = vb.event_id
      ),
      message_slots AS (
        SELECT vt.*, m
        FROM vendor_threads vt
        CROSS JOIN generate_series(1, 4) AS m
      )
      INSERT INTO public.vendor_messages (
        id,
        thread_id,
        sender_id,
        sender_type,
        message,
        attachments,
        read_at,
        created_at
      )
      SELECT
        seed_helpers.seed_uuid(14100 + (n * 10) + m),
        thread_id,
        CASE WHEN m IN (1, 3) THEN builder_user_id ELSE vendor_user_id END,
        CASE WHEN m IN (1, 3) THEN 'builder' ELSE 'vendor' END,
        CASE m
          WHEN 1 THEN 'Can you confirm availability and quote timing for ' || event_name || '?'
          WHEN 2 THEN 'Yes, availability is open. I can send a quote once I have the final run of show.'
          WHEN 3 THEN 'Run of show is attached in the event notes. We need clean load-in and a simple payment schedule.'
          ELSE 'Great. I will quote the core package and note any optional add-ons separately.'
        END,
        '[]'::jsonb,
        CASE WHEN m < 4 THEN now() - ((4 - m) * interval '1 hour') ELSE NULL END,
        now() - ((n * 6 + (5 - m)) * interval '1 hour')
      FROM message_slots
      ON CONFLICT (id) DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        sender_id = EXCLUDED.sender_id,
        sender_type = EXCLUDED.sender_type,
        message = EXCLUDED.message,
        attachments = EXCLUDED.attachments,
        read_at = EXCLUDED.read_at,
        created_at = EXCLUDED.created_at;
    $seed_vendor_messages$;
  ELSE
    RAISE NOTICE 'Skipping public.vendor_message_threads/public.vendor_messages; tables are not present in this schema.';
  END IF;
END $$;

INSERT INTO public.notifications (
  id,
  user_id,
  notification_type,
  title,
  message,
  link_url,
  is_read,
  read_at,
  created_at
)
SELECT
  seed_helpers.seed_uuid(15000 + n),
  CASE WHEN n <= 30 THEN seed_helpers.seed_uuid(n) ELSE seed_helpers.seed_uuid(80 + ((n - 31) % 50) + 1) END,
  CASE
    WHEN n % 3 = 0 THEN 'booking_confirmed'
    WHEN n % 3 = 1 THEN 'new_message'
    ELSE 'new_booking_request'
  END,
  CASE
    WHEN n % 3 = 0 THEN 'Booking confirmed'
    WHEN n % 3 = 1 THEN 'New message'
    ELSE 'New booking request'
  END,
  CASE
    WHEN n % 3 = 0 THEN 'A seed booking has been confirmed for an upcoming event.'
    WHEN n % 3 = 1 THEN 'A marketplace participant sent a new logistics message.'
    ELSE 'A new event request is waiting for review.'
  END,
  CASE
    WHEN n % 3 = 1 THEN '/messages'
    WHEN n % 3 = 2 THEN '/vendor/bookings'
    ELSE '/builder/events'
  END,
  n % 4 <> 0,
  CASE WHEN n % 4 <> 0 THEN now() - ((n % 8) * interval '1 hour') ELSE NULL END,
  now() - (n * interval '2 hours')
FROM generate_series(1, 60) AS n
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  notification_type = EXCLUDED.notification_type,
  title = EXCLUDED.title,
  message = EXCLUDED.message,
  link_url = EXCLUDED.link_url,
  is_read = EXCLUDED.is_read,
  read_at = EXCLUDED.read_at,
  created_at = EXCLUDED.created_at;

-- Keep summary counters aligned with the simulated traffic.
UPDATE public.builder_profiles bp
SET
  total_events_hosted = counts.total_events,
  total_attendance = counts.total_attendance,
  updated_at = now()
FROM (
  SELECT
    builder_id,
    count(*)::integer AS total_events,
    coalesce(sum(expected_attendance), 0)::integer AS total_attendance
  FROM public.events
  WHERE id BETWEEN seed_helpers.seed_uuid(1001) AND seed_helpers.seed_uuid(1075)
  GROUP BY builder_id
) counts
WHERE bp.id = counts.builder_id;

UPDATE public.venues v
SET
  total_bookings = counts.total_bookings,
  updated_at = now()
FROM (
  SELECT
    venue_id,
    count(*)::integer AS total_bookings
  FROM public.venue_bookings
  WHERE id BETWEEN seed_helpers.seed_uuid(4001) AND seed_helpers.seed_uuid(4040)
  GROUP BY venue_id
) counts
WHERE v.id = counts.venue_id;

UPDATE public.vendor_profiles vp
SET
  total_bookings = counts.total_bookings,
  total_gigs = greatest(vp.total_gigs, counts.total_bookings),
  total_earnings = greatest(vp.total_earnings, counts.total_earnings),
  updated_at = now()
FROM (
  SELECT
    vendor_id,
    count(*)::integer AS total_bookings,
    coalesce(sum(coalesce(final_price, quoted_price, subtotal, 0)), 0)::numeric AS total_earnings
  FROM public.vendor_bookings
  WHERE id BETWEEN seed_helpers.seed_uuid(5001) AND seed_helpers.seed_uuid(5060)
    AND status = 'confirmed'
  GROUP BY vendor_id
) counts
WHERE vp.id = counts.vendor_id;

DROP SCHEMA IF EXISTS seed_helpers CASCADE;

COMMIT;
