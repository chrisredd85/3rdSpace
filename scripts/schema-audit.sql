-- Canonical schema audit for local Supabase development.
--
-- This checks the tables/columns the app now treats as DB truth. It also
-- reports the older app-era assumptions that should stay behind adapters.

DO $$
DECLARE
  missing_required text;
  absent_legacy text;
BEGIN
  WITH required_columns(table_name, column_name) AS (
    VALUES
      ('users', 'id'),
      ('users', 'email'),
      ('builder_profiles', 'user_id'),
      ('owner_profiles', 'user_id'),
      ('vendor_profiles', 'user_id'),
      ('venues', 'venue_name'),
      ('venues', 'standing_capacity'),
      ('venues', 'is_published'),
      ('events', 'event_name'),
      ('events', 'expected_attendance'),
      ('venue_bookings', 'booking_date'),
      ('venue_bookings', 'special_requests'),
      ('vendor_bookings', 'booking_date'),
      ('message_threads', 'booking_id'),
      ('message_threads', 'booking_type'),
      ('messages', 'sender_id'),
      ('messages', 'receiver_id'),
      ('messages', 'read'),
      ('messages', 'venue_booking_id'),
      ('notifications', 'notification_type'),
      ('notifications', 'link_url'),
      ('availability_blocks', 'blockable_type'),
      ('availability_blocks', 'blockable_id'),
      ('saved_venues', 'user_id'),
      ('saved_venues', 'venue_id')
  )
  SELECT string_agg(format('public.%I.%I', required.table_name, required.column_name), ', ')
  INTO missing_required
  FROM required_columns required
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF missing_required IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical schema audit failed. Missing required columns: %', missing_required;
  END IF;

  WITH legacy_assumptions(table_name, column_name) AS (
    VALUES
      ('profiles', 'id'),
      ('venues', 'name'),
      ('venues', 'capacity'),
      ('venues', 'is_active'),
      ('venues', 'is_verified'),
      ('events', 'title'),
      ('events', 'expected_attendees'),
      ('venue_bookings', 'requested_date'),
      ('venue_bookings', 'confirmed_date'),
      ('availability_blocks', 'venue_id'),
      ('availability_blocks', 'vendor_id'),
      ('messages', 'is_read')
  )
  SELECT string_agg(format('public.%I.%I', legacy.table_name, legacy.column_name), ', ')
  INTO absent_legacy
  FROM legacy_assumptions legacy
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = legacy.table_name
      AND c.column_name = legacy.column_name
  );

  RAISE NOTICE 'Canonical schema audit passed.';
  RAISE NOTICE 'Non-canonical legacy assumptions absent and must remain behind adapters: %', absent_legacy;
END $$;
