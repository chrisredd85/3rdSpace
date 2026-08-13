-- Venue photos must pass the server-owned magic-byte and dimension validator.
-- Service-role operations bypass storage RLS; authenticated clients may no
-- longer upload directly to this bucket and bypass that validation boundary.

drop policy if exists "Venue owners can upload photos" on storage.objects;
