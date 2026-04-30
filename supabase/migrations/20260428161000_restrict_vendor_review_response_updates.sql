-- ============================================================================
-- Restrict Vendor Review Updates
-- ============================================================================
-- Vendors may respond to reviews, but should not be able to alter the review
-- rating, text, reviewer, booking, or vendor linkage through direct table calls.

CREATE OR REPLACE FUNCTION public.restrict_vendor_review_response_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.booking_id IS DISTINCT FROM NEW.booking_id
    OR OLD.vendor_booking_id IS DISTINCT FROM NEW.vendor_booking_id
    OR OLD.vendor_id IS DISTINCT FROM NEW.vendor_id
    OR OLD.builder_id IS DISTINCT FROM NEW.builder_id
    OR OLD.reviewer_id IS DISTINCT FROM NEW.reviewer_id
    OR OLD.reviewee_id IS DISTINCT FROM NEW.reviewee_id
    OR OLD.rating IS DISTINCT FROM NEW.rating
    OR OLD.review_text IS DISTINCT FROM NEW.review_text
    OR OLD.event_type IS DISTINCT FROM NEW.event_type
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Only vendor response fields can be updated on reviews';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_vendor_review_response_updates_before_update ON public.reviews;
CREATE TRIGGER restrict_vendor_review_response_updates_before_update
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.restrict_vendor_review_response_updates();
