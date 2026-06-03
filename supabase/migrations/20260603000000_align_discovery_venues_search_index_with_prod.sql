-- Align local/fresh schemas with the production discovery venue search index.
-- Production uses this immutable helper to keep vibe_tags in the full-text
-- search document while satisfying Postgres index-expression volatility rules.

CREATE OR REPLACE FUNCTION public.discovery_venues_search_document(
  venue_name text,
  venue_neighborhood text,
  venue_vibe_tags text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT concat_ws(' ', venue_name, venue_neighborhood, array_to_string(venue_vibe_tags, ' '));
$function$;

DROP INDEX IF EXISTS public.idx_discovery_venues_search;

CREATE INDEX idx_discovery_venues_search
  ON public.discovery_venues USING gin (
    to_tsvector(
      'english'::regconfig,
      public.discovery_venues_search_document(name, neighborhood, vibe_tags)
    )
  );
