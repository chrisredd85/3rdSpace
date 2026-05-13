-- Supabase CLI sends each seed file as a batch. Keep helper schema creation in
-- its own seed file so seed.sql can parse schema-qualified helper calls.
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
