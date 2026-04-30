-- During the Eventbrite OAuth flow a pending integration row is created before
-- the builder has selected an Eventbrite event to link. external_event_id is
-- only populated in a subsequent /link call, so the column must be nullable.
ALTER TABLE public.external_event_integrations
  ALTER COLUMN external_event_id DROP NOT NULL;
