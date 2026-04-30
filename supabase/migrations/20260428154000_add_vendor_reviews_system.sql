-- ============================================================================
-- Vendor Reviews
-- ============================================================================
-- Extends the existing generic reviews table so post-event vendor reviews can
-- be tied directly to vendor profiles and vendor bookings.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS vendor_id UUID,
  ADD COLUMN IF NOT EXISTS builder_id UUID,
  ADD COLUMN IF NOT EXISTS vendor_response TEXT,
  ADD COLUMN IF NOT EXISTS response_date TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_vendor_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_vendor_id_fkey
      FOREIGN KEY (vendor_id)
      REFERENCES public.vendor_profiles(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_builder_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_builder_id_fkey
      FOREIGN KEY (builder_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

UPDATE public.reviews r
SET
  vendor_id = COALESCE(r.vendor_id, vb.vendor_id),
  builder_id = COALESCE(r.builder_id, vb.organizer_id)
FROM public.vendor_bookings vb
WHERE r.vendor_booking_id = vb.id
  AND (r.vendor_id IS NULL OR r.builder_id IS NULL);

UPDATE public.reviews
SET
  vendor_response = COALESCE(vendor_response, response_text),
  response_date = COALESCE(response_date, responded_at)
WHERE vendor_response IS NULL
  OR response_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_vendor_id
  ON public.reviews(vendor_id);

CREATE INDEX IF NOT EXISTS idx_reviews_builder_id
  ON public.reviews(builder_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_vendor_booking_builder_unique
  ON public.reviews(vendor_booking_id, builder_id)
  WHERE vendor_booking_id IS NOT NULL
    AND builder_id IS NOT NULL;

DROP POLICY IF EXISTS "Vendors can respond to vendor reviews" ON public.reviews;
CREATE POLICY "Vendors can respond to vendor reviews"
  ON public.reviews FOR UPDATE
  USING (
    vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.recalculate_vendor_review_stats(p_vendor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_average NUMERIC(3,2);
  v_count INTEGER;
BEGIN
  IF p_vendor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0)::NUMERIC(3,2),
    COUNT(*)::INTEGER
  INTO v_average, v_count
  FROM public.reviews
  WHERE vendor_id = p_vendor_id
    AND status = 'published';

  UPDATE public.vendor_profiles
  SET
    average_rating = v_average,
    rating = v_average,
    review_count = v_count,
    updated_at = NOW()
  WHERE id = p_vendor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vendor_review_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_vendor_review_stats(OLD.vendor_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_vendor_review_stats(NEW.vendor_id);

  IF TG_OP = 'UPDATE' AND OLD.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
    PERFORM public.recalculate_vendor_review_stats(OLD.vendor_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_vendor_review_stats_after_write ON public.reviews;
CREATE TRIGGER sync_vendor_review_stats_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vendor_review_stats();

DO $$
DECLARE
  v_vendor_id UUID;
BEGIN
  FOR v_vendor_id IN
    SELECT DISTINCT vendor_id
    FROM public.reviews
    WHERE vendor_id IS NOT NULL
  LOOP
    PERFORM public.recalculate_vendor_review_stats(v_vendor_id);
  END LOOP;
END $$;

COMMENT ON COLUMN public.reviews.vendor_id IS
  'Vendor profile receiving this review.';

COMMENT ON COLUMN public.reviews.builder_id IS
  'Builder user who submitted this vendor review.';

COMMENT ON COLUMN public.reviews.vendor_response IS
  'Public response written by the vendor.';

COMMENT ON COLUMN public.reviews.response_date IS
  'Timestamp when the vendor response was saved.';
