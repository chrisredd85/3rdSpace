-- Keep published vendor catalog profiles public, but make unpublished vendor
-- profiles private to their owner.

DROP POLICY IF EXISTS "Vendor profiles are publicly viewable" ON public.vendor_profiles;

CREATE POLICY "Published vendor profiles are publicly viewable"
  ON public.vendor_profiles
  FOR SELECT
  USING (is_published = true);

CREATE POLICY "Vendors can view own profile"
  ON public.vendor_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
