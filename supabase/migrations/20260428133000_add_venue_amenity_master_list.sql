-- ============================================================================
-- VENUE AMENITY MASTER LIST AND CUSTOM OPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_amenity_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'package',
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venue_amenity_types_category_order
  ON public.venue_amenity_types(category, display_order);

ALTER TABLE public.venue_amenities
  ADD COLUMN IF NOT EXISTS amenity_type_id UUID REFERENCES public.venue_amenity_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_amenity_name TEXT;

UPDATE public.venue_amenities
SET custom_amenity_name = amenity_name
WHERE custom_amenity_name IS NULL
  AND amenity_type_id IS NULL
  AND amenity_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_amenities_type
  ON public.venue_amenities(amenity_type_id);

CREATE INDEX IF NOT EXISTS idx_venue_amenities_venue_type
  ON public.venue_amenities(venue_id, amenity_type_id);

ALTER TABLE public.venue_amenity_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view venue amenity types" ON public.venue_amenity_types;
CREATE POLICY "Anyone can view venue amenity types"
  ON public.venue_amenity_types FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role can manage venue amenity types" ON public.venue_amenity_types;
CREATE POLICY "Service role can manage venue amenity types"
  ON public.venue_amenity_types FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

INSERT INTO public.venue_amenity_types (name, category, icon, description, display_order)
VALUES
  ('WiFi', 'tech', 'wifi', 'High-speed internet access for guests, vendors, and production teams.', 10),
  ('Projector', 'av_equipment', 'projector', 'Projection equipment for presentations or visuals.', 20),
  ('TV Screens', 'av_equipment', 'tv', 'Mounted or portable screens for slides, video, or menus.', 30),
  ('Sound System', 'av_equipment', 'volume-2', 'House PA or speaker system.', 40),
  ('Microphones', 'av_equipment', 'mic', 'Wired or wireless microphones available.', 50),
  ('DJ Booth', 'av_equipment', 'music', 'Dedicated DJ setup or booth area.', 60),
  ('Stage', 'facilities', 'layout', 'Raised stage or performance area.', 70),
  ('Kitchen', 'facilities', 'utensils', 'Kitchen or prep area for food service.', 80),
  ('Bar', 'facilities', 'wine', 'Built-in bar or bar service area.', 90),
  ('Green Room', 'facilities', 'door-open', 'Private backstage or prep room.', 100),
  ('Coat Check', 'facilities', 'package', 'Coat check area or service support.', 110),
  ('Tables', 'furniture', 'layout', 'Tables available for event layouts.', 120),
  ('Chairs', 'furniture', 'armchair', 'Chairs available for seating layouts.', 130),
  ('Lounge Furniture', 'furniture', 'sofa', 'Sofas, lounge seating, or soft seating vignettes.', 140),
  ('Outdoor Space', 'features', 'trees', 'Patio, garden, rooftop, or other outdoor area.', 150),
  ('Natural Light', 'features', 'sun', 'Strong daylight or large windows.', 160),
  ('Climate Control', 'features', 'wind', 'Heating, cooling, or ventilation systems.', 170),
  ('Fireplace', 'features', 'flame', 'Fireplace or fire feature.', 180),
  ('On-site Parking', 'access', 'car', 'Parking available on site.', 190),
  ('Transit Nearby', 'access', 'train', 'Convenient public transit access.', 200),
  ('ADA Accessible', 'access', 'accessibility', 'Accessible entrance, restrooms, or routes.', 210),
  ('Elevator', 'access', 'arrow-up', 'Elevator access for guests or load-in.', 220),
  ('Loading Dock', 'access', 'truck', 'Loading dock or dedicated load-in zone.', 230),
  ('Video Conferencing', 'tech', 'video', 'Video conferencing equipment or support.', 240)
ON CONFLICT (name) DO UPDATE SET
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order;
