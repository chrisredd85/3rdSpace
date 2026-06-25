-- Migration: Add data deletion request workflow
-- Context: User privacy requests need a cooling-off period, admin review, and
-- auditable execution before paid pilot.

CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested',
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooling_off_ends_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  executed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_reason TEXT,
  execution_log JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT data_deletion_requests_status_check CHECK (
    status IN ('requested', 'canceled', 'in_review', 'approved', 'executed', 'rejected')
  ),
  CONSTRAINT data_deletion_requests_cooling_off_check CHECK (cooling_off_ends_at > requested_at)
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_user_status
  ON public.data_deletion_requests(user_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_status_cooling
  ON public.data_deletion_requests(status, cooling_off_ends_at, requested_at DESC);

DROP TRIGGER IF EXISTS update_data_deletion_requests_updated_at ON public.data_deletion_requests;
CREATE TRIGGER update_data_deletion_requests_updated_at
  BEFORE UPDATE ON public.data_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own data deletion requests" ON public.data_deletion_requests;
CREATE POLICY "Users can read own data deletion requests"
  ON public.data_deletion_requests FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own data deletion requests" ON public.data_deletion_requests;
CREATE POLICY "Users can create own data deletion requests"
  ON public.data_deletion_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can cancel own requested data deletion requests" ON public.data_deletion_requests;
CREATE POLICY "Users can cancel own requested data deletion requests"
  ON public.data_deletion_requests FOR UPDATE
  USING (auth.uid() = user_id AND status = 'requested')
  WITH CHECK (auth.uid() = user_id AND status = 'canceled');

DROP POLICY IF EXISTS "Service role can manage data deletion requests" ON public.data_deletion_requests;
CREATE POLICY "Service role can manage data deletion requests"
  ON public.data_deletion_requests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON public.data_deletion_requests TO authenticated;
GRANT ALL ON public.data_deletion_requests TO service_role;

COMMENT ON TABLE public.data_deletion_requests IS
  'User-initiated privacy deletion requests with mandatory cooling-off, admin review, and execution audit log.';
COMMENT ON COLUMN public.data_deletion_requests.execution_log IS
  'Structured result from lib/privacy/executeDataDeletion: deleted, anonymized, retained, failed.';
