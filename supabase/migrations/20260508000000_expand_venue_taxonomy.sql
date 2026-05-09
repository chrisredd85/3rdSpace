ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS valid_venue_type;

UPDATE public.venues
SET venue_type = 'event_space'
WHERE venue_type = 'other';

ALTER TABLE public.venues
  ADD CONSTRAINT valid_venue_type CHECK (
    venue_type = ANY (ARRAY[
      'bar',
      'lounge',
      'rooftop',
      'coworking_event_space',
      'restaurant',
      'private_dining_room',
      'gallery',
      'showroom',
      'event_space',
      'retail',
      'cafe',
      'market_hall',
      'studio',
      'classroom',
      'theater',
      'auditorium',
      'startup_venue',
      'expo_space',
      'campus',
      'event_hall',
      'community_space',
      'ballroom',
      'restaurant_buyout',
      'club',
      'warehouse',
      'sports_bar',
      'hotel',
      'conference_center',
      'winery',
      'private_estate',
      'loft_warehouse',
      'outdoor_park'
    ]::text[])
  );

CREATE TABLE IF NOT EXISTS public.event_archetypes (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_archetype_aliases (
  phrase TEXT PRIMARY KEY,
  archetype_key TEXT NOT NULL REFERENCES public.event_archetypes(key)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_archetype_aliases_key
  ON public.event_archetype_aliases(archetype_key);

ALTER TABLE public.event_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_archetype_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read archetypes" ON public.event_archetypes;
CREATE POLICY "Anyone can read archetypes" ON public.event_archetypes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read archetype aliases" ON public.event_archetype_aliases;
CREATE POLICY "Anyone can read archetype aliases"
  ON public.event_archetype_aliases FOR SELECT USING (true);
