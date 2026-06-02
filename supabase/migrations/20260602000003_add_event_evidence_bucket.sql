-- Migration: Add private event evidence storage
-- Created: 2026-06-02
-- Context: Receipt uploads for event cost commitments. Client writes go
-- through authenticated planner API routes; storage remains private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-evidence',
  'event-evidence',
  false,
  10485760,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/heic',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "Service role can manage event evidence" ON storage.objects;
CREATE POLICY "Service role can manage event evidence"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'event-evidence' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'event-evidence' AND auth.role() = 'service_role');
