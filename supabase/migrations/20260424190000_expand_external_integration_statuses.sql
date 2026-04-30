ALTER TABLE public.external_event_integrations
  DROP CONSTRAINT IF EXISTS external_event_integrations_sync_status_check;

ALTER TABLE public.external_event_integrations
  ADD CONSTRAINT external_event_integrations_sync_status_check
  CHECK (sync_status = ANY (ARRAY['pending', 'connected', 'linked', 'syncing', 'completed', 'failed']));
