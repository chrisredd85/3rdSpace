-- Bootstrap values pending human refinement based on Bay Area market data.
-- Refine after the first 5-10 settled events.

INSERT INTO public.chi_network_defaults (
  archetype,
  venue_type,
  neighborhood,
  per_attendee_cents,
  sample_size,
  source
)
VALUES
  ('founder_dinner', 'bar', 'Mission', 4000, 0, 'bootstrap'),
  ('founder_dinner', 'restaurant', 'Mission', 5500, 0, 'bootstrap'),
  ('founder_dinner', 'bar', 'SOMA', 4200, 0, 'bootstrap'),
  ('founder_dinner', 'bar', 'Hayes_Valley', 4500, 0, 'bootstrap'),
  ('networking_mixer', 'bar', 'Mission', 2800, 0, 'bootstrap'),
  ('networking_mixer', 'bar', 'SOMA', 3000, 0, 'bootstrap'),
  ('networking_mixer', 'cafe', 'Mission', 1500, 0, 'bootstrap'),
  ('workshop', 'cafe', 'Mission', 1200, 0, 'bootstrap'),
  ('workshop', 'coworking_event_space', 'SOMA', 0, 0, 'bootstrap'),
  ('book_club', 'cafe', 'Mission', 1200, 0, 'bootstrap')
ON CONFLICT (archetype, venue_type, neighborhood) DO UPDATE SET
  per_attendee_cents = EXCLUDED.per_attendee_cents,
  sample_size = EXCLUDED.sample_size,
  source = EXCLUDED.source,
  updated_at = now();
