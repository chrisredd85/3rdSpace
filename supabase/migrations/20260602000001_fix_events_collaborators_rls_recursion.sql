-- Avoid policy recursion between events and collaborators once events RLS is on.
-- These helpers return booleans only and run as the function owner, so they can
-- inspect the relationship tables without invoking their caller's RLS policies.

CREATE OR REPLACE FUNCTION public.is_event_builder(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events
    JOIN public.builder_profiles
      ON builder_profiles.id = events.builder_id
    WHERE events.id = p_event_id
      AND builder_profiles.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_event_collaborator(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collaborators
    WHERE collaborators.event_id = p_event_id
      AND collaborators.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_event_builder(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_collaborator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_builder(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_event_collaborator(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "Collaborators can view events" ON public.events;
CREATE POLICY "Collaborators can view events"
  ON public.events
  FOR SELECT
  TO authenticated
  USING (public.is_event_collaborator(id));

DROP POLICY IF EXISTS "Builders can add collaborators" ON public.collaborators;
CREATE POLICY "Builders can add collaborators"
  ON public.collaborators
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_event_builder(event_id));

DROP POLICY IF EXISTS "Builders can remove collaborators" ON public.collaborators;
CREATE POLICY "Builders can remove collaborators"
  ON public.collaborators
  FOR DELETE
  TO authenticated
  USING (public.is_event_builder(event_id));

DROP POLICY IF EXISTS "Builders can view event collaborators" ON public.collaborators;
CREATE POLICY "Builders can view event collaborators"
  ON public.collaborators
  FOR SELECT
  TO authenticated
  USING (public.is_event_builder(event_id));
