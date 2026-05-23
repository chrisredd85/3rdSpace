-- Expand vendor catalog constraints to match planner archetype vendor stacks.
-- Keep legacy service_type/vendor_type values valid so existing signup/admin
-- paths can continue to save older catalog labels while planner seeds move to
-- the canonical archetype vocabulary.

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS valid_service_type;

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT valid_service_type
    CHECK (
      service_type IS NULL OR service_type IN (
        -- canonical planner archetype service types
        'av_production',
        'bartending',
        'cake_pastry',
        'catering',
        'check_in',
        'decor',
        'dj',
        'florist',
        'instructor',
        'lighting',
        'permits',
        'photo_booth',
        'photographer',
        'pos_systems',
        'security',
        'staffing',
        'transport',
        'videographer',
        -- legacy vendor/admin/signup aliases kept for compatibility
        'av_tech',
        'event_planning',
        'other',
        'photography',
        'videography'
      )
    );

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_vendor_type_check;

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT vendor_profiles_vendor_type_check
    CHECK (
      vendor_type IS NULL OR vendor_type IN (
        -- existing catalog labels
        'Audio/Visual Tech',
        'Bartender',
        'Caterer',
        'DJ / Music',
        'Decorator / Florist',
        'Photo Booth Operator',
        'Photographer',
        'Security / Event Staff',
        -- expanded seed labels
        'Cake / Pastry',
        'Check-in Staff',
        'Decor',
        'Event Staff',
        'Fitness Instructor',
        'Florist',
        'Lighting',
        'Permit Liaison',
        'POS Systems',
        'Security',
        'Transport',
        'Videographer',
        'Workshop Instructor'
      )
    );
