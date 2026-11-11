-- C1 HARDEN: add only the deferred template_runs durable-copy guard.
-- Requires the EXPAND helper and completed ACTIVATE phase. Apply this file
-- and its migration-ledger row in one outer transaction. No historical purge.

DROP TRIGGER IF EXISTS fence_venue_durable_sink ON public.template_runs;
CREATE TRIGGER fence_venue_durable_sink
  BEFORE INSERT OR UPDATE ON public.template_runs
  FOR EACH ROW EXECUTE FUNCTION private.fence_venue_durable_sink();
