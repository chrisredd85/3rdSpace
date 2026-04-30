


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."calculate_event_kickback"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_expected_attendees INTEGER;
  v_actual_attendees INTEGER;
  v_kickback_amount INTEGER := 0;
  v_event_kickback_agreement public.event_kickback_agreements%ROWTYPE;
  v_result JSONB;
  v_has_access BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    LEFT JOIN public.builder_profiles bp ON bp.id = e.builder_id
    LEFT JOIN public.collaborators c ON c.event_id = e.id AND c.user_id = auth.uid()
    LEFT JOIN public.event_kickback_agreements eka ON eka.event_id = e.id
    WHERE e.id = p_event_id
      AND (
        bp.user_id = auth.uid()
        OR c.user_id = auth.uid()
        OR eka.venue_owner_id = auth.uid()
        OR auth.jwt()->>'role' = 'service_role'
      )
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'error', 'You do not have access to calculate kickback for this event',
      'event_id', p_event_id
    );
  END IF;

  SELECT expected_attendance
  INTO v_expected_attendees
  FROM public.events
  WHERE id = p_event_id;

  SELECT COUNT(*)
  INTO v_actual_attendees
  FROM public.imported_attendees
  WHERE event_id = p_event_id
    AND checked_in = true;

  SELECT *
  INTO v_event_kickback_agreement
  FROM public.event_kickback_agreements
  WHERE event_id = p_event_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'No kickback agreement found for this event',
      'event_id', p_event_id
    );
  END IF;

  IF v_actual_attendees >= COALESCE(v_event_kickback_agreement.minimum_attendees, 0) THEN
    v_kickback_amount := v_actual_attendees * COALESCE(v_event_kickback_agreement.per_head_amount, 0);

    IF v_event_kickback_agreement.maximum_payout IS NOT NULL THEN
      v_kickback_amount := LEAST(v_kickback_amount, v_event_kickback_agreement.maximum_payout);
    END IF;
  END IF;

  UPDATE public.event_kickback_agreements
  SET
    actual_attendance = v_actual_attendees,
    actual_qualified_attendance = v_actual_attendees,
    actual_kickback_amount = v_kickback_amount,
    updated_at = NOW()
  WHERE event_id = p_event_id;

  IF v_kickback_amount > 0 THEN
    INSERT INTO public.kickback_payments (
      agreement_id,
      event_id,
      payer_id,
      recipient_id,
      amount,
      status,
      notes,
      initiated_at
    ) VALUES (
      v_event_kickback_agreement.id,
      p_event_id,
      v_event_kickback_agreement.venue_owner_id,
      v_event_kickback_agreement.builder_id,
      v_kickback_amount,
      'pending',
      'Auto-calculated from imported attendee check-ins.',
      NOW()
    )
    ON CONFLICT (event_id)
    DO UPDATE SET
      agreement_id = EXCLUDED.agreement_id,
      payer_id = EXCLUDED.payer_id,
      recipient_id = EXCLUDED.recipient_id,
      amount = EXCLUDED.amount,
      status = 'pending',
      notes = EXCLUDED.notes,
      initiated_at = NOW(),
      failure_reason = NULL;
  ELSE
    DELETE FROM public.kickback_payments
    WHERE event_id = p_event_id;
  END IF;

  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'expected_attendees', v_expected_attendees,
    'actual_attendees', v_actual_attendees,
    'kickback_amount', v_kickback_amount,
    'per_head_rate', v_event_kickback_agreement.per_head_amount,
    'minimum_threshold', v_event_kickback_agreement.minimum_attendees,
    'met_minimum', v_actual_attendees >= COALESCE(v_event_kickback_agreement.minimum_attendees, 0),
    'calculated_at', NOW(),
    'status', CASE WHEN v_kickback_amount > 0 THEN 'eligible' ELSE 'ineligible' END
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."calculate_event_kickback"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_platform_fee"("user_id" "uuid", "booking_amount" numeric) RETURNS TABLE("fee_percentage" numeric, "fee_amount" numeric, "total_amount" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  user_subscription_tier TEXT;
BEGIN
  -- Get user's subscription tier
  SELECT subscription_tier INTO user_subscription_tier
  FROM users
  WHERE id = user_id;
  
  -- Calculate fee based on tier
  IF user_subscription_tier = 'unlimited' THEN
    -- Unlimited plan: 0% fee
    RETURN QUERY SELECT 
      0.00::DECIMAL as fee_percentage,
      0.00::DECIMAL as fee_amount,
      booking_amount as total_amount;
  ELSE
    -- Pay-per-transaction: 4% fee
    RETURN QUERY SELECT 
      4.00::DECIMAL as fee_percentage,
      ROUND(booking_amount * 0.04, 2) as fee_amount,
      ROUND(booking_amount * 1.04, 2) as total_amount;
  END IF;
END;
$$;


ALTER FUNCTION "public"."calculate_platform_fee"("user_id" "uuid", "booking_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_event_kickback_summary"("p_event_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result JSONB;
  v_has_access BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    LEFT JOIN public.builder_profiles bp ON bp.id = e.builder_id
    LEFT JOIN public.collaborators c ON c.event_id = e.id AND c.user_id = auth.uid()
    LEFT JOIN public.event_kickback_agreements eka ON eka.event_id = e.id
    WHERE e.id = p_event_id
      AND (
        bp.user_id = auth.uid()
        OR c.user_id = auth.uid()
        OR eka.venue_owner_id = auth.uid()
        OR auth.jwt()->>'role' = 'service_role'
      )
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'error', 'You do not have access to view this kickback summary',
      'event_id', p_event_id
    );
  END IF;

  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_name', e.event_name,
    'expected_attendees', e.expected_attendance,
    'actual_attendees', eka.actual_attendance,
    'checked_in_count', (
      SELECT COUNT(*)
      FROM public.imported_attendees ia
      WHERE ia.event_id = p_event_id
        AND ia.checked_in = true
    ),
    'kickback_amount', eka.actual_kickback_amount,
    'payment_status', kp.status,
    'venue_name', v.venue_name,
    'has_integration', EXISTS(
      SELECT 1
      FROM public.external_event_integrations eei
      WHERE eei.event_id = p_event_id
    )
  )
  INTO v_result
  FROM public.events e
  LEFT JOIN public.event_kickback_agreements eka ON e.id = eka.event_id
  LEFT JOIN public.kickback_payments kp ON e.id = kp.event_id
  LEFT JOIN public.venues v ON eka.venue_id = v.id
  WHERE e.id = p_event_id;

  RETURN COALESCE(
    v_result,
    jsonb_build_object('error', 'Event not found', 'event_id', p_event_id)
  );
END;
$$;


ALTER FUNCTION "public"."get_event_kickback_summary"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Remove stale app-profile rows left behind when an auth user was deleted.
  -- This avoids users_email_key failures when the same email signs up again
  -- and the old public.users row has no matching auth.users record.
  DELETE FROM public.users u
  WHERE u.email = NEW.email
    AND u.id <> NEW.id
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = u.id
    );

  INSERT INTO public.users (
    id,
    email,
    role,
    user_type,
    company_name,
    email_verified,
    last_login_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'builder'),
    COALESCE(NEW.raw_user_meta_data->>'user_type', 'community_builder'),
    NEW.raw_user_meta_data->>'company_name',
    NEW.email_confirmed_at IS NOT NULL,
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_vendor_booking_fees"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  fee_calc RECORD;
BEGIN
  -- Only calculate if subtotal changed and organizer_id exists
  IF NEW.subtotal IS NOT NULL AND NEW.organizer_id IS NOT NULL THEN
    -- Calculate fees using the function
    SELECT * INTO fee_calc
    FROM calculate_platform_fee(NEW.organizer_id, NEW.subtotal);
    
    -- Set the calculated values
    NEW.platform_fee_percentage := fee_calc.fee_percentage;
    NEW.platform_fee_amount := fee_calc.fee_amount;
    NEW.total_amount := fee_calc.total_amount;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_vendor_booking_fees"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_venue_booking_fees"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  fee_calc RECORD;
BEGIN
  -- Only calculate if subtotal changed and organizer_id exists
  IF NEW.subtotal IS NOT NULL AND NEW.organizer_id IS NOT NULL THEN
    -- Calculate fees using the function
    SELECT * INTO fee_calc
    FROM calculate_platform_fee(NEW.organizer_id, NEW.subtotal);
    
    -- Set the calculated values
    NEW.platform_fee_percentage := fee_calc.fee_percentage;
    NEW.platform_fee_amount := fee_calc.fee_amount;
    NEW.total_amount := fee_calc.total_amount;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_venue_booking_fees"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "event_type" "text",
    "event_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."availability_blocks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "blockable_type" "text" NOT NULL,
    "blockable_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "reason" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_block_reason" CHECK (("reason" = ANY (ARRAY['private_event'::"text", 'maintenance'::"text", 'renovation'::"text", 'personal'::"text", 'other'::"text"]))),
    CONSTRAINT "valid_blockable_type" CHECK (("blockable_type" = ANY (ARRAY['venue'::"text", 'vendor'::"text"])))
);


ALTER TABLE "public"."availability_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."baseline_sales_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "day_of_week" integer NOT NULL,
    "time_slot_start" time without time zone NOT NULL,
    "time_slot_end" time without time zone NOT NULL,
    "total_sales" integer NOT NULL,
    "transaction_count" integer,
    "data_source" "text" NOT NULL,
    "entered_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "baseline_sales_data_data_source_check" CHECK (("data_source" = ANY (ARRAY['manual_entry'::"text", 'pos_integration'::"text", 'historical_average'::"text"])))
);


ALTER TABLE "public"."baseline_sales_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "space_id" "uuid" NOT NULL,
    "builder_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "hourly_rate" numeric(10,2) NOT NULL,
    "subtotal" numeric(10,2) NOT NULL,
    "cleaning_fee" numeric(10,2) DEFAULT 0,
    "total_amount" numeric(10,2) NOT NULL,
    "platform_fee" numeric(10,2) NOT NULL,
    "owner_payout" numeric(10,2) NOT NULL,
    "stripe_payment_intent_id" character varying(255),
    "payment_status" character varying(20) DEFAULT 'pending'::character varying,
    "paid_at" timestamp with time zone,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "requested_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "builder_notes" "text",
    "owner_notes" "text",
    "decline_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "venue_cost" numeric(10,2),
    "vendors_cost" numeric(10,2),
    "selected_requirements" "text"[] DEFAULT '{}'::"text"[],
    "budget_status" "text" DEFAULT 'within_budget'::"text",
    CONSTRAINT "bookings_payment_status_check" CHECK ((("payment_status")::"text" = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'refunded'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "bookings_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying, 'cancelled'::character varying, 'completed'::character varying])::"text"[]))),
    CONSTRAINT "valid_budget_status" CHECK (("budget_status" = ANY (ARRAY['within_budget'::"text", 'over_budget'::"text", 'at_limit'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."builder_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "phone" character varying(20),
    "photo_url" "text",
    "event_types" "text"[] DEFAULT '{}'::"text"[],
    "priorities" "text"[] DEFAULT '{}'::"text"[],
    "subscription_status" character varying(20) DEFAULT 'trial'::character varying,
    "subscription_started_at" timestamp with time zone,
    "subscription_ends_at" timestamp with time zone,
    "stripe_customer_id" character varying(255),
    "stripe_subscription_id" character varying(255),
    "eventbrite_connected" boolean DEFAULT false,
    "eventbrite_organizer_id" character varying(255),
    "luma_connected" boolean DEFAULT false,
    "luma_calendar_id" character varying(255),
    "posh_connected" boolean DEFAULT false,
    "posh_organizer_id" character varying(255),
    "total_events_hosted" integer DEFAULT 0,
    "total_attendance" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "preferred_ticket_platforms" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "builder_profiles_subscription_status_check" CHECK ((("subscription_status")::"text" = ANY ((ARRAY['trial'::character varying, 'active'::character varying, 'cancelled'::character varying, 'past_due'::character varying])::"text"[])))
);


ALTER TABLE "public"."builder_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."builder_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "stripe_subscription_id" "text",
    "stripe_customer_id" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "events_used_this_period" integer DEFAULT 0,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "trial_start" timestamp with time zone,
    "trial_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "cancel_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "builder_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['incomplete'::"text", 'incomplete_expired'::"text", 'trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text"])))
);


ALTER TABLE "public"."builder_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."collaborators" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "role" character varying(20) NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    CONSTRAINT "collaborators_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['owner'::character varying, 'co_organizer'::character varying, 'volunteer'::character varying])::"text"[]))),
    CONSTRAINT "collaborators_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'declined'::character varying])::"text"[])))
);


ALTER TABLE "public"."collaborators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "uploader_id" "uuid" NOT NULL,
    "related_type" "text",
    "related_id" "uuid",
    "document_type" "text",
    "file_name" "text",
    "file_url" "text" NOT NULL,
    "file_size" integer,
    "mime_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_document_type" CHECK (("document_type" = ANY (ARRAY['coi'::"text", 'contract'::"text", 'invoice'::"text", 'receipt'::"text", 'other'::"text"]))),
    CONSTRAINT "valid_related_type" CHECK (("related_type" = ANY (ARRAY['event'::"text", 'venue_booking'::"text", 'vendor_booking'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "attendee_email" "text",
    "attendee_name" "text",
    "attendee_phone" "text",
    "check_in_time" timestamp with time zone NOT NULL,
    "external_platform" "text" NOT NULL,
    "external_attendee_id" "text",
    "external_ticket_id" "text",
    "is_valid" boolean DEFAULT true,
    "counted_for_payment" boolean DEFAULT true,
    "ticket_type" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_check_ins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_kickback_agreements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "builder_id" "uuid" NOT NULL,
    "venue_owner_id" "uuid" NOT NULL,
    "kickback_model" "text" NOT NULL,
    "per_head_amount" integer,
    "minimum_attendees" integer,
    "maximum_payout" integer,
    "flat_base_fee" integer,
    "bonus_threshold" integer,
    "bonus_per_person" integer,
    "baseline_sales" integer,
    "baseline_calculation_method" "text",
    "lift_share_percentage" numeric(5,2),
    "minimum_lift_amount" integer,
    "expected_attendance" integer,
    "expected_kickback_amount" integer,
    "actual_attendance" integer,
    "actual_qualified_attendance" integer,
    "actual_sales" integer,
    "actual_kickback_amount" integer,
    "base_fee_amount" integer,
    "bonus_amount" integer,
    "sales_lift_amount" integer,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attendance_lock_time" timestamp with time zone,
    "auto_locked" boolean DEFAULT false,
    "builder_approved" boolean DEFAULT false,
    "builder_approved_at" timestamp with time zone,
    "venue_approved" boolean DEFAULT false,
    "venue_approved_at" timestamp with time zone,
    "dispute_reason" "text",
    "dispute_notes" "text",
    "disputed_by" "uuid",
    "disputed_at" timestamp with time zone,
    "payment_method" "text" DEFAULT 'stripe'::"text",
    "stripe_transfer_id" "text",
    "payment_completed_at" timestamp with time zone,
    "data_entry_logs" "jsonb",
    "agreement_date" timestamp with time zone DEFAULT "now"(),
    "event_date" timestamp with time zone,
    "payment_due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "event_kickback_agreements_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'event_completed'::"text", 'attendance_locked'::"text", 'sales_submitted'::"text", 'data_verified'::"text", 'payment_pending'::"text", 'payment_processing'::"text", 'payment_completed'::"text", 'disputed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_kickback_agreements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_sales_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "agreement_id" "uuid",
    "total_sales" integer NOT NULL,
    "baseline_sales" integer,
    "sales_lift" integer,
    "data_source" "text" NOT NULL,
    "entered_by" "uuid" NOT NULL,
    "verified_by" "uuid",
    "receipt_urls" "text"[],
    "notes" "text",
    "is_verified" boolean DEFAULT false,
    "verified_at" timestamp with time zone,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_sales_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "creator_id" "uuid" NOT NULL,
    "template_name" "text" NOT NULL,
    "event_type" "text",
    "description" "text",
    "expected_attendance_min" integer,
    "expected_attendance_max" integer,
    "estimated_budget" numeric(10,2),
    "preferred_venue_types" "jsonb",
    "required_vendor_types" "jsonb",
    "template_data" "jsonb",
    "times_used" integer DEFAULT 0,
    "is_public" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_vendor_bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "booking_id" "uuid",
    "vendor_id" "uuid" NOT NULL,
    "vendor_type" "text" NOT NULL,
    "hourly_rate" numeric(10,2) NOT NULL,
    "hours" integer NOT NULL,
    "total_cost" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "positive_cost" CHECK (("total_cost" >= (0)::numeric)),
    CONSTRAINT "positive_hours" CHECK (("hours" > 0)),
    CONSTRAINT "positive_rate" CHECK (("hourly_rate" >= (0)::numeric)),
    CONSTRAINT "valid_vendor_booking_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_vendor_bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_vendors" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "quoted_price" numeric(10,2),
    "final_price" numeric(10,2),
    "setup_time" time without time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_event_vendor_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'declined'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."event_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "builder_id" "uuid" NOT NULL,
    "event_name" character varying(255) NOT NULL,
    "event_type" character varying(50) NOT NULL,
    "event_description" "text",
    "expected_attendance" integer,
    "event_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "duration_hours" numeric(4,2) NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "is_recurring" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "total_budget" numeric(10,2),
    "description" "text",
    "recurring_frequency" "text",
    "recurring_occurrences" integer,
    "parent_event_id" "uuid",
    "event_time" time without time zone,
    "expected_attendance_min" integer,
    "expected_attendance_max" integer,
    "actual_cost" numeric(10,2),
    "completion_percentage" integer DEFAULT 0,
    "venue_id" "uuid",
    "venue_confirmed" boolean DEFAULT false,
    "budget" numeric(10,2) DEFAULT 0,
    "kickback_agreement_id" "uuid",
    "platform_fee_paid" boolean DEFAULT false,
    "platform_fee_id" "uuid",
    CONSTRAINT "events_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'venue_pending'::character varying, 'confirmed'::character varying, 'cancelled'::character varying, 'completed'::character varying])::"text"[]))),
    CONSTRAINT "valid_event_type" CHECK ((("event_type")::"text" = ANY ((ARRAY['networking'::character varying, 'conference'::character varying, 'workshop'::character varying, 'social_mixer'::character varying, 'product_launch'::character varying, 'all_hands'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "valid_recurring_frequency" CHECK ((("recurring_frequency" IS NULL) OR ("recurring_frequency" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text"]))))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."external_event_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "external_event_id" "text",
    "external_event_url" "text",
    "access_token_encrypted" "text",
    "refresh_token_encrypted" "text",
    "api_key_encrypted" "text",
    "auto_sync_enabled" boolean DEFAULT true,
    "sync_frequency_minutes" integer DEFAULT 60,
    "last_sync_at" timestamp with time zone,
    "last_sync_status" "text",
    "last_sync_error" "text",
    "total_tickets_sold" integer DEFAULT 0,
    "total_checked_in" integer DEFAULT 0,
    "last_attendance_count" integer,
    "integration_metadata" "jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "token_expires_at" timestamp with time zone,
    "webhook_url" "text",
    "sync_status" "text" DEFAULT 'pending'::"text",
    "sync_error" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "external_event_integrations_platform_check" CHECK (("platform" = ANY (ARRAY['eventbrite'::"text", 'luma'::"text", 'posh'::"text", 'partiful'::"text", 'dice'::"text", 'meetup'::"text", 'tito'::"text", 'other'::"text"]))),
    CONSTRAINT "external_event_integrations_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['pending'::"text", 'connected'::"text", 'linked'::"text", 'syncing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."external_event_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."imported_attendees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "external_attendee_id" character varying(255) NOT NULL,
    "first_name" character varying(255),
    "last_name" character varying(255),
    "email" character varying(255),
    "ticket_type" character varying(100),
    "ticket_class" character varying(100),
    "order_id" character varying(255),
    "checked_in" boolean DEFAULT false,
    "check_in_time" timestamp with time zone,
    "check_in_method" character varying(50),
    "raw_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."imported_attendees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kickback_disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agreement_id" "uuid" NOT NULL,
    "initiated_by" "uuid" NOT NULL,
    "dispute_type" "text" NOT NULL,
    "disputed_value_claimed" integer,
    "disputed_value_actual" integer,
    "reason" "text" NOT NULL,
    "evidence_urls" "text"[],
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolution" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "final_amount" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "kickback_disputes_dispute_type_check" CHECK (("dispute_type" = ANY (ARRAY['attendance_count'::"text", 'sales_data_accuracy'::"text", 'payment_amount'::"text", 'terms_violation'::"text", 'other'::"text"]))),
    CONSTRAINT "kickback_disputes_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'under_review'::"text", 'resolved'::"text", 'escalated'::"text"])))
);


ALTER TABLE "public"."kickback_disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kickback_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agreement_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "payer_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text",
    "stripe_transfer_id" "text",
    "stripe_charge_id" "text",
    "stripe_payout_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "failure_reason" "text",
    "receipt_url" "text",
    "notes" "text",
    "initiated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "kickback_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."kickback_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_threads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid",
    "booking_id" "uuid",
    "booking_type" "text",
    "participant_1_id" "uuid" NOT NULL,
    "participant_2_id" "uuid" NOT NULL,
    "last_message_at" timestamp with time zone,
    "unread_count_participant_1" integer DEFAULT 0,
    "unread_count_participant_2" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_thread_booking_type" CHECK (("booking_type" = ANY (ARRAY['venue_booking'::"text", 'vendor_booking'::"text", 'general'::"text"])))
);


ALTER TABLE "public"."message_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid",
    "vendor_booking_id" "uuid",
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "attachments" "text"[] DEFAULT '{}'::"text"[],
    "read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "thread_id" "uuid",
    CONSTRAINT "messages_check" CHECK ((("booking_id" IS NOT NULL) OR ("vendor_booking_id" IS NOT NULL)))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_type" "text",
    "title" "text",
    "message" "text",
    "link_url" "text",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_notification_type" CHECK (("notification_type" = ANY (ARRAY['new_booking_request'::"text", 'booking_confirmed'::"text", 'booking_declined'::"text", 'new_message'::"text", 'payment_received'::"text", 'review_posted'::"text", 'reminder'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_pending_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "access_token" "text",
    "available_events" "jsonb",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."oauth_pending_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "phone" character varying(20),
    "photo_url" "text",
    "business_name" character varying(255),
    "business_type" character varying(50),
    "stripe_account_id" character varying(255),
    "stripe_account_status" character varying(20) DEFAULT 'pending'::character varying,
    "payout_enabled" boolean DEFAULT false,
    "total_bookings" integer DEFAULT 0,
    "total_earnings" numeric(10,2) DEFAULT 0,
    "acceptance_rate" numeric(5,2) DEFAULT 0,
    "average_response_time" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "owner_profiles_stripe_account_status_check" CHECK ((("stripe_account_status")::"text" = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'restricted'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."owner_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_fees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_id" "uuid",
    "subscription_id" "uuid",
    "fee_type" "text" NOT NULL,
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text",
    "stripe_payment_intent_id" "text",
    "stripe_charge_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "description" "text",
    "failure_reason" "text",
    "paid_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "platform_fees_fee_type_check" CHECK (("fee_type" = ANY (ARRAY['per_event'::"text", 'subscription_overage'::"text"]))),
    CONSTRAINT "platform_fees_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."platform_fees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid",
    "vendor_booking_id" "uuid",
    "reviewer_id" "uuid" NOT NULL,
    "reviewee_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "review_text" "text",
    "event_type" character varying(50),
    "response_text" "text",
    "responded_at" timestamp with time zone,
    "status" character varying(20) DEFAULT 'published'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "reviews_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'published'::character varying, 'hidden'::character varying])::"text"[])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_spaces" (
    "builder_id" "uuid" NOT NULL,
    "space_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."saved_spaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_vendors" (
    "builder_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."saved_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spaces" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "space_type" character varying(50) NOT NULL,
    "address" character varying(255) NOT NULL,
    "city" character varying(100) NOT NULL,
    "state" character varying(50) NOT NULL,
    "zip_code" character varying(20) NOT NULL,
    "country" character varying(50) DEFAULT 'USA'::character varying,
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "capacity" integer NOT NULL,
    "square_footage" integer,
    "amenities" "text"[] DEFAULT '{}'::"text"[],
    "event_types" "text"[] DEFAULT '{}'::"text"[],
    "hourly_rate" numeric(10,2) NOT NULL,
    "minimum_hours" integer DEFAULT 2,
    "cleaning_fee" numeric(10,2) DEFAULT 0,
    "security_deposit" numeric(10,2) DEFAULT 0,
    "available" boolean DEFAULT true,
    "instant_booking" boolean DEFAULT false,
    "photos" "text"[] DEFAULT '{}'::"text"[],
    "rating" numeric(3,2) DEFAULT 0,
    "review_count" integer DEFAULT 0,
    "total_bookings" integer DEFAULT 0,
    "status" character varying(20) DEFAULT 'active'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "venue_features" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "spaces_space_type_check" CHECK ((("space_type")::"text" = ANY ((ARRAY['Gallery'::character varying, 'Loft'::character varying, 'Rooftop'::character varying, 'Restaurant'::character varying, 'Warehouse'::character varying, 'Studio'::character varying, 'Theater'::character varying, 'Cafe'::character varying, 'Ballroom'::character varying, 'Garden'::character varying, 'Other'::character varying])::"text"[]))),
    CONSTRAINT "spaces_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'inactive'::character varying, 'suspended'::character varying])::"text"[])))
);


ALTER TABLE "public"."spaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_type" "text" NOT NULL,
    "stripe_account_id" "text" NOT NULL,
    "account_type" "text" DEFAULT 'express'::"text" NOT NULL,
    "charges_enabled" boolean DEFAULT false,
    "payouts_enabled" boolean DEFAULT false,
    "details_submitted" boolean DEFAULT false,
    "country" "text" DEFAULT 'US'::"text",
    "currency" "text" DEFAULT 'usd'::"text",
    "business_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "stripe_accounts_account_type_check" CHECK (("account_type" = ANY (ARRAY['express'::"text", 'standard'::"text"]))),
    CONSTRAINT "stripe_accounts_user_type_check" CHECK (("user_type" = ANY (ARRAY['builder'::"text", 'venue_owner'::"text", 'vendor'::"text"])))
);


ALTER TABLE "public"."stripe_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "processed" boolean DEFAULT false,
    "processed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "amount" integer NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text",
    "interval" "text" NOT NULL,
    "events_per_period" integer,
    "max_attendees_per_event" integer,
    "features" "jsonb",
    "platform_fee_discount" numeric(5,2) DEFAULT 0,
    "stripe_product_id" "text",
    "stripe_price_id" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "is_featured" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "subscription_plans_interval_check" CHECK (("interval" = ANY (ARRAY['month'::"text", 'year'::"text"])))
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "sync_started_at" timestamp with time zone DEFAULT "now"(),
    "sync_completed_at" timestamp with time zone,
    "status" "text" NOT NULL,
    "records_fetched" integer DEFAULT 0,
    "records_inserted" integer DEFAULT 0,
    "records_updated" integer DEFAULT 0,
    "records_failed" integer DEFAULT 0,
    "error_message" "text",
    "error_details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sync_logs_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'success'::"text", 'failed'::"text", 'partial'::"text"])))
);


ALTER TABLE "public"."sync_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" character varying(255) NOT NULL,
    "role" character varying(20) NOT NULL,
    "email_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_login_at" timestamp with time zone,
    "user_type" "text",
    "company_name" "text",
    "is_active" boolean DEFAULT true,
    "subscription_tier" "text" DEFAULT 'pay_per_transaction'::"text",
    "subscription_status" "text" DEFAULT 'active'::"text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_started_at" timestamp with time zone,
    "subscription_ends_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "monthly_bookings_count" integer DEFAULT 0,
    "monthly_revenue" numeric(10,2) DEFAULT 0,
    "last_payment_date" timestamp with time zone,
    "subscription_id" "uuid",
    "platform_fee_percentage" numeric(5,2) DEFAULT 10.00,
    CONSTRAINT "users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['builder'::character varying, 'owner'::character varying, 'vendor'::character varying])::"text"[]))),
    CONSTRAINT "valid_subscription_status" CHECK (("subscription_status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'canceled'::"text", 'incomplete'::"text"]))),
    CONSTRAINT "valid_subscription_tier" CHECK (("subscription_tier" = ANY (ARRAY['pay_per_transaction'::"text", 'unlimited'::"text"]))),
    CONSTRAINT "valid_user_type" CHECK (("user_type" = ANY (ARRAY['community_builder'::"text", 'venue_owner'::"text", 'vendor'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "organizer_id" "uuid" NOT NULL,
    "booking_date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "setup_time" time without time zone,
    "guest_count" integer,
    "status" "text" DEFAULT 'pending'::"text",
    "quoted_price" numeric(10,2),
    "final_price" numeric(10,2),
    "requirements" "jsonb",
    "notes" "text",
    "decline_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "subtotal" numeric(10,2),
    "platform_fee_percentage" numeric(5,2) DEFAULT 4.00,
    "platform_fee_amount" numeric(10,2),
    "total_amount" numeric(10,2),
    "stripe_payment_intent_id" "text",
    "payment_status" "text" DEFAULT 'pending'::"text",
    "paid_at" timestamp with time zone,
    CONSTRAINT "valid_payment_status" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "valid_vendor_booking_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'declined'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."vendor_bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_offerings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "offering_name" "text",
    "description" "text",
    "is_included" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_offerings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_packages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "package_name" "text" NOT NULL,
    "description" "text",
    "price" numeric(10,2),
    "duration_hours" integer,
    "inclusions" "jsonb",
    "is_active" boolean DEFAULT true,
    "display_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "phone" character varying(20),
    "photo_url" "text",
    "vendor_type" character varying(50) NOT NULL,
    "years_experience" integer DEFAULT 0,
    "bio" "text",
    "services_offered" "text"[] DEFAULT '{}'::"text"[],
    "regions_served" "text",
    "travel_radius" character varying(50),
    "languages" "text"[] DEFAULT '{}'::"text"[],
    "pricing_model" character varying(20),
    "hourly_rate" numeric(10,2),
    "minimum_hours" integer,
    "deposit_required" integer DEFAULT 0,
    "stripe_account_id" character varying(255),
    "payout_enabled" boolean DEFAULT false,
    "rating" numeric(3,2) DEFAULT 0,
    "review_count" integer DEFAULT 0,
    "total_gigs" integer DEFAULT 0,
    "total_earnings" numeric(10,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "compatible_features" "text"[] DEFAULT '{}'::"text"[],
    "slug" "text",
    "service_type" "text",
    "service_area" "text",
    "setup_time_minutes" integer,
    "base_rate" numeric(10,2),
    "per_person_rate" numeric(10,2),
    "per_head_kickback" numeric(10,2),
    "is_published" boolean DEFAULT false,
    "average_rating" numeric(3,2),
    "total_bookings" integer DEFAULT 0,
    "bank_account_holder_name" "text",
    "bank_name" "text",
    "availability_notes" "text",
    CONSTRAINT "valid_service_area" CHECK (("service_area" = ANY (ARRAY['all_bay_area'::"text", 'sf_only'::"text", 'east_bay'::"text", 'south_bay'::"text", 'north_bay'::"text"]))),
    CONSTRAINT "valid_service_type" CHECK (("service_type" = ANY (ARRAY['dj'::"text", 'catering'::"text", 'bartending'::"text", 'photography'::"text", 'videography'::"text", 'av_tech'::"text", 'event_planning'::"text", 'florist'::"text", 'other'::"text"]))),
    CONSTRAINT "valid_vendor_pricing_model" CHECK ((("pricing_model")::"text" = ANY ((ARRAY['flat_rate'::character varying, 'per_person'::character varying, 'hourly'::character varying])::"text"[]))),
    CONSTRAINT "vendor_profiles_pricing_model_check" CHECK ((("pricing_model")::"text" = ANY ((ARRAY['hourly'::character varying, 'flat'::character varying, 'per_person'::character varying, 'package'::character varying])::"text"[]))),
    CONSTRAINT "vendor_profiles_vendor_type_check" CHECK ((("vendor_type")::"text" = ANY ((ARRAY['DJ / Music'::character varying, 'Bartender'::character varying, 'Photographer'::character varying, 'Caterer'::character varying, 'Audio/Visual Tech'::character varying, 'Security / Event Staff'::character varying, 'Decorator / Florist'::character varying, 'Photo Booth Operator'::character varying])::"text"[])))
);


ALTER TABLE "public"."vendor_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_requirements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "requirement_type" "text",
    "description" "text",
    "is_required" boolean,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_vendor_requirement_type" CHECK (("requirement_type" = ANY (ARRAY['venue_details'::"text", 'guest_count'::"text", 'music_preferences'::"text", 'load_in_access'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."vendor_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_amenities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "amenity_type" "text",
    "amenity_name" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_amenity_type" CHECK (("amenity_type" = ANY (ARRAY['av_equipment'::"text", 'wifi'::"text", 'bar'::"text", 'parking'::"text", 'bart_access'::"text", 'outdoor_space'::"text", 'catering_kitchen'::"text", 'tables_chairs'::"text"])))
);


ALTER TABLE "public"."venue_amenities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "organizer_id" "uuid" NOT NULL,
    "booking_date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "guest_count_min" integer,
    "guest_count_max" integer,
    "status" "text" DEFAULT 'pending'::"text",
    "quoted_price" numeric(10,2),
    "final_price" numeric(10,2),
    "services_needed" "jsonb",
    "special_requests" "text",
    "decline_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    "subtotal" numeric(10,2),
    "platform_fee_percentage" numeric(5,2) DEFAULT 4.00,
    "platform_fee_amount" numeric(10,2),
    "total_amount" numeric(10,2),
    "stripe_payment_intent_id" "text",
    "payment_status" "text" DEFAULT 'pending'::"text",
    "paid_at" timestamp with time zone,
    CONSTRAINT "valid_payment_status" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "valid_venue_booking_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'declined'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."venue_bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_kickback_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "kickback_model" "text" NOT NULL,
    "per_head_amount" integer,
    "minimum_attendees" integer,
    "maximum_payout" integer,
    "flat_base_fee" integer,
    "bonus_threshold" integer,
    "bonus_per_person" integer,
    "baseline_calculation_method" "text",
    "lift_share_percentage" numeric(5,2),
    "minimum_lift_amount" integer,
    "baseline_window_weeks" integer DEFAULT 4,
    "active" boolean DEFAULT true,
    "applies_to_event_types" "text"[],
    "applies_to_days_of_week" integer[],
    "payment_terms" "text" DEFAULT 'net_7'::"text",
    "auto_payout_enabled" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "venue_kickback_configs_baseline_calculation_method_check" CHECK (("baseline_calculation_method" = ANY (ARRAY['historical_average'::"text", 'manual_entry'::"text", 'pos_automatic'::"text"]))),
    CONSTRAINT "venue_kickback_configs_kickback_model_check" CHECK (("kickback_model" = ANY (ARRAY['per_head_attendance'::"text", 'flat_fee_plus_bonus'::"text", 'incremental_lift'::"text"])))
);


ALTER TABLE "public"."venue_kickback_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_photos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "photo_url" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "display_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."venue_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_requirements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "requirement_type" "text",
    "is_required" boolean DEFAULT true,
    "description" "text",
    "minimum_liability_coverage" numeric(12,2),
    "requires_additional_insured" boolean,
    "custom_question" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_requirement_type" CHECK (("requirement_type" = ANY (ARRAY['coi'::"text", 'contract'::"text", 'alcohol_license'::"text", 'photo_id'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."venue_requirements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_rules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "rules_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."venue_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "venue_name" "text" NOT NULL,
    "slug" "text",
    "description" "text",
    "venue_type" "text",
    "address" "text",
    "city" "text",
    "state" "text",
    "zip_code" "text",
    "latitude" numeric(10,8),
    "longitude" numeric(11,8),
    "square_footage" integer,
    "standing_capacity" integer,
    "seated_capacity" integer,
    "pricing_model" "text",
    "hourly_rate" numeric(10,2),
    "minimum_hours" integer,
    "bar_revenue_percentage" numeric(5,2),
    "per_head_kickback" numeric(10,2),
    "deposit_percentage" numeric(5,2),
    "deposit_due" "text",
    "is_published" boolean DEFAULT false,
    "average_rating" numeric(3,2),
    "total_bookings" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "offers_kickbacks" boolean DEFAULT false,
    "default_kickback_type" "text",
    "stripe_account_id" "text",
    CONSTRAINT "valid_deposit_due" CHECK (("deposit_due" = ANY (ARRAY['immediately'::"text", '48_hours'::"text", '1_week'::"text", '14_days'::"text"]))),
    CONSTRAINT "valid_pricing_model" CHECK (("pricing_model" = ANY (ARRAY['hourly'::"text", 'revenue_share'::"text", 'hybrid'::"text"]))),
    CONSTRAINT "valid_venue_type" CHECK (("venue_type" = ANY (ARRAY['loft_warehouse'::"text", 'gallery'::"text", 'restaurant'::"text", 'rooftop'::"text", 'conference_center'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availability_blocks"
    ADD CONSTRAINT "availability_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."baseline_sales_data"
    ADD CONSTRAINT "baseline_sales_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."baseline_sales_data"
    ADD CONSTRAINT "baseline_sales_data_venue_id_date_time_slot_start_key" UNIQUE ("venue_id", "date", "time_slot_start");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_stripe_payment_intent_id_key" UNIQUE ("stripe_payment_intent_id");



ALTER TABLE ONLY "public"."builder_profiles"
    ADD CONSTRAINT "builder_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."builder_profiles"
    ADD CONSTRAINT "builder_profiles_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."builder_profiles"
    ADD CONSTRAINT "builder_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."builder_subscriptions"
    ADD CONSTRAINT "builder_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."builder_subscriptions"
    ADD CONSTRAINT "builder_subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."builder_subscriptions"
    ADD CONSTRAINT "builder_subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."collaborators"
    ADD CONSTRAINT "collaborators_event_id_user_id_key" UNIQUE ("event_id", "user_id");



ALTER TABLE ONLY "public"."collaborators"
    ADD CONSTRAINT "collaborators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_event_id_external_platform_external_attende_key" UNIQUE ("event_id", "external_platform", "external_attendee_id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_event_id_venue_id_key" UNIQUE ("event_id", "venue_id");



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_sales_data"
    ADD CONSTRAINT "event_sales_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_vendor_bookings"
    ADD CONSTRAINT "event_vendor_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_event_integrations"
    ADD CONSTRAINT "external_event_integrations_event_id_platform_key" UNIQUE ("event_id", "platform");



ALTER TABLE ONLY "public"."external_event_integrations"
    ADD CONSTRAINT "external_event_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."imported_attendees"
    ADD CONSTRAINT "imported_attendees_integration_id_external_attendee_id_key" UNIQUE ("integration_id", "external_attendee_id");



ALTER TABLE ONLY "public"."imported_attendees"
    ADD CONSTRAINT "imported_attendees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kickback_disputes"
    ADD CONSTRAINT "kickback_disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kickback_payments"
    ADD CONSTRAINT "kickback_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_threads"
    ADD CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_pending_connections"
    ADD CONSTRAINT "oauth_pending_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."owner_profiles"
    ADD CONSTRAINT "owner_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."owner_profiles"
    ADD CONSTRAINT "owner_profiles_stripe_account_id_key" UNIQUE ("stripe_account_id");



ALTER TABLE ONLY "public"."owner_profiles"
    ADD CONSTRAINT "owner_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."platform_fees"
    ADD CONSTRAINT "platform_fees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_reviewer_id_key" UNIQUE ("booking_id", "reviewer_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_vendor_booking_id_reviewer_id_key" UNIQUE ("vendor_booking_id", "reviewer_id");



ALTER TABLE ONLY "public"."saved_spaces"
    ADD CONSTRAINT "saved_spaces_pkey" PRIMARY KEY ("builder_id", "space_id");



ALTER TABLE ONLY "public"."saved_vendors"
    ADD CONSTRAINT "saved_vendors_pkey" PRIMARY KEY ("builder_id", "vendor_id");



ALTER TABLE ONLY "public"."spaces"
    ADD CONSTRAINT "spaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_accounts"
    ADD CONSTRAINT "stripe_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_accounts"
    ADD CONSTRAINT "stripe_accounts_stripe_account_id_key" UNIQUE ("stripe_account_id");



ALTER TABLE ONLY "public"."stripe_accounts"
    ADD CONSTRAINT "stripe_accounts_user_id_user_type_key" UNIQUE ("user_id", "user_type");



ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_stripe_price_id_key" UNIQUE ("stripe_price_id");



ALTER TABLE ONLY "public"."sync_logs"
    ADD CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."vendor_bookings"
    ADD CONSTRAINT "vendor_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_offerings"
    ADD CONSTRAINT "vendor_offerings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_packages"
    ADD CONSTRAINT "vendor_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_stripe_account_id_key" UNIQUE ("stripe_account_id");



ALTER TABLE ONLY "public"."vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."vendor_requirements"
    ADD CONSTRAINT "vendor_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_amenities"
    ADD CONSTRAINT "venue_amenities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_kickback_configs"
    ADD CONSTRAINT "venue_kickback_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_photos"
    ADD CONSTRAINT "venue_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_requirements"
    ADD CONSTRAINT "venue_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_rules"
    ADD CONSTRAINT "venue_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_slug_key" UNIQUE ("slug");



CREATE INDEX "idx_agreements_builder_id" ON "public"."event_kickback_agreements" USING "btree" ("builder_id");



CREATE INDEX "idx_agreements_event_id" ON "public"."event_kickback_agreements" USING "btree" ("event_id");



CREATE INDEX "idx_agreements_status" ON "public"."event_kickback_agreements" USING "btree" ("status");



CREATE INDEX "idx_agreements_venue_owner_id" ON "public"."event_kickback_agreements" USING "btree" ("venue_owner_id");



CREATE INDEX "idx_analytics_events_type" ON "public"."analytics_events" USING "btree" ("event_type", "created_at");



CREATE INDEX "idx_analytics_events_user" ON "public"."analytics_events" USING "btree" ("user_id", "created_at");



CREATE INDEX "idx_availability_blocks_composite" ON "public"."availability_blocks" USING "btree" ("blockable_type", "blockable_id", "start_date", "end_date");



CREATE INDEX "idx_baseline_sales_venue_day" ON "public"."baseline_sales_data" USING "btree" ("venue_id", "day_of_week", "time_slot_start");



CREATE INDEX "idx_bookings_budget_status" ON "public"."bookings" USING "btree" ("budget_status");



CREATE INDEX "idx_bookings_builder_id" ON "public"."bookings" USING "btree" ("builder_id");



CREATE INDEX "idx_bookings_event_id" ON "public"."bookings" USING "btree" ("event_id");



CREATE INDEX "idx_bookings_owner_id" ON "public"."bookings" USING "btree" ("owner_id");



CREATE INDEX "idx_bookings_payment_status" ON "public"."bookings" USING "btree" ("payment_status");



CREATE INDEX "idx_bookings_space_id" ON "public"."bookings" USING "btree" ("space_id");



CREATE INDEX "idx_bookings_status" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "idx_bookings_stripe_payment_intent" ON "public"."bookings" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_bookings_venue_cost" ON "public"."bookings" USING "btree" ("venue_cost");



CREATE INDEX "idx_builder_profiles_stripe_customer" ON "public"."builder_profiles" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_builder_profiles_subscription_status" ON "public"."builder_profiles" USING "btree" ("subscription_status");



CREATE INDEX "idx_builder_profiles_user_id" ON "public"."builder_profiles" USING "btree" ("user_id");



CREATE INDEX "idx_check_ins_counted" ON "public"."event_check_ins" USING "btree" ("counted_for_payment") WHERE ("counted_for_payment" = true);



CREATE INDEX "idx_check_ins_email" ON "public"."event_check_ins" USING "btree" ("attendee_email");



CREATE INDEX "idx_check_ins_event_id" ON "public"."event_check_ins" USING "btree" ("event_id");



CREATE INDEX "idx_check_ins_platform" ON "public"."event_check_ins" USING "btree" ("external_platform");



CREATE INDEX "idx_check_ins_valid" ON "public"."event_check_ins" USING "btree" ("is_valid") WHERE ("is_valid" = true);



CREATE INDEX "idx_collaborators_event_id" ON "public"."collaborators" USING "btree" ("event_id");



CREATE INDEX "idx_collaborators_user_id" ON "public"."collaborators" USING "btree" ("user_id");



CREATE INDEX "idx_disputes_agreement_id" ON "public"."kickback_disputes" USING "btree" ("agreement_id");



CREATE INDEX "idx_disputes_status" ON "public"."kickback_disputes" USING "btree" ("status");



CREATE INDEX "idx_documents_related" ON "public"."documents" USING "btree" ("related_type", "related_id");



CREATE INDEX "idx_documents_uploader" ON "public"."documents" USING "btree" ("uploader_id");



CREATE INDEX "idx_event_templates_creator" ON "public"."event_templates" USING "btree" ("creator_id");



CREATE INDEX "idx_event_templates_public" ON "public"."event_templates" USING "btree" ("is_public") WHERE ("is_public" = true);



CREATE INDEX "idx_event_vendor_bookings_booking" ON "public"."event_vendor_bookings" USING "btree" ("booking_id");



CREATE INDEX "idx_event_vendor_bookings_event" ON "public"."event_vendor_bookings" USING "btree" ("event_id");



CREATE INDEX "idx_event_vendor_bookings_status" ON "public"."event_vendor_bookings" USING "btree" ("status");



CREATE INDEX "idx_event_vendor_bookings_vendor" ON "public"."event_vendor_bookings" USING "btree" ("vendor_id");



CREATE INDEX "idx_event_vendors_event" ON "public"."event_vendors" USING "btree" ("event_id");



CREATE INDEX "idx_event_vendors_vendor" ON "public"."event_vendors" USING "btree" ("vendor_id");



CREATE INDEX "idx_events_builder_id" ON "public"."events" USING "btree" ("builder_id");



CREATE INDEX "idx_events_created_at" ON "public"."events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_events_date" ON "public"."events" USING "btree" ("event_date" DESC);



CREATE INDEX "idx_events_event_date" ON "public"."events" USING "btree" ("event_date");



CREATE INDEX "idx_events_is_recurring" ON "public"."events" USING "btree" ("is_recurring");



CREATE INDEX "idx_events_parent" ON "public"."events" USING "btree" ("parent_event_id") WHERE ("parent_event_id" IS NOT NULL);



CREATE INDEX "idx_events_status" ON "public"."events" USING "btree" ("status");



CREATE INDEX "idx_events_total_budget" ON "public"."events" USING "btree" ("total_budget");



CREATE INDEX "idx_external_integrations_platform_external_event" ON "public"."external_event_integrations" USING "btree" ("platform", "external_event_id");



CREATE INDEX "idx_external_integrations_status" ON "public"."external_event_integrations" USING "btree" ("sync_status") WHERE ("sync_status" <> 'completed'::"text");



CREATE INDEX "idx_imported_attendees_checked_in" ON "public"."imported_attendees" USING "btree" ("checked_in");



CREATE INDEX "idx_imported_attendees_email" ON "public"."imported_attendees" USING "btree" ("email");



CREATE INDEX "idx_imported_attendees_event" ON "public"."imported_attendees" USING "btree" ("event_id");



CREATE INDEX "idx_imported_attendees_integration" ON "public"."imported_attendees" USING "btree" ("integration_id");



CREATE INDEX "idx_integrations_active" ON "public"."external_event_integrations" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_integrations_event_id" ON "public"."external_event_integrations" USING "btree" ("event_id");



CREATE INDEX "idx_integrations_platform" ON "public"."external_event_integrations" USING "btree" ("platform");



CREATE INDEX "idx_kickback_configs_active" ON "public"."venue_kickback_configs" USING "btree" ("active") WHERE ("active" = true);



CREATE INDEX "idx_kickback_configs_venue_id" ON "public"."venue_kickback_configs" USING "btree" ("venue_id");



CREATE INDEX "idx_kickback_payments_agreement_id" ON "public"."kickback_payments" USING "btree" ("agreement_id");



CREATE UNIQUE INDEX "idx_kickback_payments_event_unique" ON "public"."kickback_payments" USING "btree" ("event_id");



CREATE INDEX "idx_kickback_payments_status" ON "public"."kickback_payments" USING "btree" ("status");



CREATE INDEX "idx_message_threads_participants" ON "public"."message_threads" USING "btree" ("participant_1_id", "participant_2_id");



CREATE UNIQUE INDEX "idx_message_threads_unique" ON "public"."message_threads" USING "btree" (COALESCE("booking_type", 'general'::"text"), COALESCE(("booking_id")::"text", ''::"text"), "participant_1_id", "participant_2_id");



CREATE INDEX "idx_messages_booking_id" ON "public"."messages" USING "btree" ("booking_id");



CREATE INDEX "idx_messages_created_at" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_messages_receiver_id" ON "public"."messages" USING "btree" ("receiver_id");



CREATE INDEX "idx_messages_sender_id" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_messages_thread" ON "public"."messages" USING "btree" ("thread_id", "created_at");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at");



CREATE INDEX "idx_owner_profiles_stripe_account" ON "public"."owner_profiles" USING "btree" ("stripe_account_id");



CREATE INDEX "idx_owner_profiles_user_id" ON "public"."owner_profiles" USING "btree" ("user_id");



CREATE INDEX "idx_platform_fees_event_id" ON "public"."platform_fees" USING "btree" ("event_id");



CREATE INDEX "idx_platform_fees_user_id" ON "public"."platform_fees" USING "btree" ("user_id");



CREATE INDEX "idx_reviews_booking_id" ON "public"."reviews" USING "btree" ("booking_id");



CREATE INDEX "idx_reviews_created_at" ON "public"."reviews" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reviews_reviewee_id" ON "public"."reviews" USING "btree" ("reviewee_id");



CREATE INDEX "idx_reviews_reviewer_id" ON "public"."reviews" USING "btree" ("reviewer_id");



CREATE INDEX "idx_reviews_status" ON "public"."reviews" USING "btree" ("status");



CREATE INDEX "idx_reviews_vendor_booking_id" ON "public"."reviews" USING "btree" ("vendor_booking_id");



CREATE INDEX "idx_saved_spaces_builder_id" ON "public"."saved_spaces" USING "btree" ("builder_id");



CREATE INDEX "idx_saved_spaces_space_id" ON "public"."saved_spaces" USING "btree" ("space_id");



CREATE UNIQUE INDEX "idx_saved_spaces_unique" ON "public"."saved_spaces" USING "btree" ("builder_id", "space_id");



CREATE INDEX "idx_saved_vendors_builder_id" ON "public"."saved_vendors" USING "btree" ("builder_id");



CREATE UNIQUE INDEX "idx_saved_vendors_unique" ON "public"."saved_vendors" USING "btree" ("builder_id", "vendor_id");



CREATE INDEX "idx_saved_vendors_vendor_id" ON "public"."saved_vendors" USING "btree" ("vendor_id");



CREATE INDEX "idx_spaces_capacity" ON "public"."spaces" USING "btree" ("capacity");



CREATE INDEX "idx_spaces_city" ON "public"."spaces" USING "btree" ("city");



CREATE INDEX "idx_spaces_hourly_rate" ON "public"."spaces" USING "btree" ("hourly_rate");



CREATE INDEX "idx_spaces_owner_id" ON "public"."spaces" USING "btree" ("owner_id");



CREATE INDEX "idx_spaces_rating" ON "public"."spaces" USING "btree" ("rating" DESC);



CREATE INDEX "idx_spaces_search" ON "public"."spaces" USING "gin" ("to_tsvector"('"english"'::"regconfig", ((("name")::"text" || ' '::"text") || COALESCE("description", ''::"text"))));



CREATE INDEX "idx_spaces_space_type" ON "public"."spaces" USING "btree" ("space_type");



CREATE INDEX "idx_spaces_status" ON "public"."spaces" USING "btree" ("status");



CREATE INDEX "idx_spaces_venue_features" ON "public"."spaces" USING "gin" ("venue_features");



CREATE INDEX "idx_stripe_accounts_stripe_id" ON "public"."stripe_accounts" USING "btree" ("stripe_account_id");



CREATE INDEX "idx_stripe_accounts_user_id" ON "public"."stripe_accounts" USING "btree" ("user_id");



CREATE INDEX "idx_subscriptions_status" ON "public"."builder_subscriptions" USING "btree" ("status");



CREATE INDEX "idx_subscriptions_user_id" ON "public"."builder_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_sync_logs_integration_id" ON "public"."sync_logs" USING "btree" ("integration_id");



CREATE INDEX "idx_sync_logs_status" ON "public"."sync_logs" USING "btree" ("status");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE INDEX "idx_users_stripe_customer" ON "public"."users" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_users_subscription_tier" ON "public"."users" USING "btree" ("subscription_tier");



CREATE INDEX "idx_vendor_bookings_event" ON "public"."vendor_bookings" USING "btree" ("event_id");



CREATE INDEX "idx_vendor_bookings_organizer" ON "public"."vendor_bookings" USING "btree" ("organizer_id");



CREATE INDEX "idx_vendor_bookings_payment_status" ON "public"."vendor_bookings" USING "btree" ("payment_status");



CREATE INDEX "idx_vendor_bookings_status" ON "public"."vendor_bookings" USING "btree" ("status");



CREATE INDEX "idx_vendor_bookings_stripe_intent" ON "public"."vendor_bookings" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_vendor_bookings_vendor_date" ON "public"."vendor_bookings" USING "btree" ("vendor_id", "booking_date");



CREATE INDEX "idx_vendor_offerings_vendor" ON "public"."vendor_offerings" USING "btree" ("vendor_id");



CREATE INDEX "idx_vendor_packages_vendor" ON "public"."vendor_packages" USING "btree" ("vendor_id");



CREATE INDEX "idx_vendor_profiles_compatible_features" ON "public"."vendor_profiles" USING "gin" ("compatible_features");



CREATE INDEX "idx_vendor_profiles_rating" ON "public"."vendor_profiles" USING "btree" ("rating");



CREATE INDEX "idx_vendor_profiles_stripe_account" ON "public"."vendor_profiles" USING "btree" ("stripe_account_id");



CREATE INDEX "idx_vendor_profiles_user_id" ON "public"."vendor_profiles" USING "btree" ("user_id");



CREATE INDEX "idx_vendor_profiles_vendor_type" ON "public"."vendor_profiles" USING "btree" ("vendor_type");



CREATE INDEX "idx_vendor_requirements_vendor" ON "public"."vendor_requirements" USING "btree" ("vendor_id");



CREATE INDEX "idx_venue_amenities_venue" ON "public"."venue_amenities" USING "btree" ("venue_id");



CREATE INDEX "idx_venue_bookings_event" ON "public"."venue_bookings" USING "btree" ("event_id");



CREATE INDEX "idx_venue_bookings_organizer" ON "public"."venue_bookings" USING "btree" ("organizer_id");



CREATE INDEX "idx_venue_bookings_payment_status" ON "public"."venue_bookings" USING "btree" ("payment_status");



CREATE INDEX "idx_venue_bookings_status" ON "public"."venue_bookings" USING "btree" ("status");



CREATE INDEX "idx_venue_bookings_stripe_intent" ON "public"."venue_bookings" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_venue_bookings_venue_date" ON "public"."venue_bookings" USING "btree" ("venue_id", "booking_date");



CREATE INDEX "idx_venue_photos_venue" ON "public"."venue_photos" USING "btree" ("venue_id");



CREATE INDEX "idx_venue_requirements_venue" ON "public"."venue_requirements" USING "btree" ("venue_id");



CREATE INDEX "idx_venue_rules_venue" ON "public"."venue_rules" USING "btree" ("venue_id");



CREATE INDEX "idx_venues_owner" ON "public"."venues" USING "btree" ("owner_id");



CREATE INDEX "idx_venues_published" ON "public"."venues" USING "btree" ("is_published") WHERE ("is_published" = true);



CREATE OR REPLACE TRIGGER "set_updated_at_availability_blocks" BEFORE UPDATE ON "public"."availability_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_event_templates" BEFORE UPDATE ON "public"."event_templates" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_event_vendor_bookings" BEFORE UPDATE ON "public"."event_vendor_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_event_vendors" BEFORE UPDATE ON "public"."event_vendors" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_message_threads" BEFORE UPDATE ON "public"."message_threads" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_vendor_bookings" BEFORE UPDATE ON "public"."vendor_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_venue_bookings" BEFORE UPDATE ON "public"."venue_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_venue_rules" BEFORE UPDATE ON "public"."venue_rules" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_venues" BEFORE UPDATE ON "public"."venues" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_set_vendor_booking_fees" BEFORE INSERT OR UPDATE OF "subtotal", "organizer_id" ON "public"."vendor_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_vendor_booking_fees"();



CREATE OR REPLACE TRIGGER "trigger_set_venue_booking_fees" BEFORE INSERT OR UPDATE OF "subtotal", "organizer_id" ON "public"."venue_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_venue_booking_fees"();



CREATE OR REPLACE TRIGGER "update_bookings_updated_at" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_builder_profiles_updated_at" BEFORE UPDATE ON "public"."builder_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_imported_attendees_updated_at" BEFORE UPDATE ON "public"."imported_attendees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_owner_profiles_updated_at" BEFORE UPDATE ON "public"."owner_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_reviews_updated_at" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_spaces_updated_at" BEFORE UPDATE ON "public"."spaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vendor_profiles_updated_at" BEFORE UPDATE ON "public"."vendor_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."baseline_sales_data"
    ADD CONSTRAINT "baseline_sales_data_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."baseline_sales_data"
    ADD CONSTRAINT "baseline_sales_data_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "public"."builder_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."builder_profiles"
    ADD CONSTRAINT "builder_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."builder_subscriptions"
    ADD CONSTRAINT "builder_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id");



ALTER TABLE ONLY "public"."builder_subscriptions"
    ADD CONSTRAINT "builder_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collaborators"
    ADD CONSTRAINT "collaborators_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collaborators"
    ADD CONSTRAINT "collaborators_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."collaborators"
    ADD CONSTRAINT "collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_disputed_by_fkey" FOREIGN KEY ("disputed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."event_kickback_agreements"
    ADD CONSTRAINT "event_kickback_agreements_venue_owner_id_fkey" FOREIGN KEY ("venue_owner_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_sales_data"
    ADD CONSTRAINT "event_sales_data_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."event_kickback_agreements"("id");



ALTER TABLE ONLY "public"."event_sales_data"
    ADD CONSTRAINT "event_sales_data_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_sales_data"
    ADD CONSTRAINT "event_sales_data_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_sales_data"
    ADD CONSTRAINT "event_sales_data_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."event_vendor_bookings"
    ADD CONSTRAINT "event_vendor_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vendor_bookings"
    ADD CONSTRAINT "event_vendor_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vendor_bookings"
    ADD CONSTRAINT "event_vendor_bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "public"."builder_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_kickback_agreement_id_fkey" FOREIGN KEY ("kickback_agreement_id") REFERENCES "public"."event_kickback_agreements"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_platform_fee_id_fkey" FOREIGN KEY ("platform_fee_id") REFERENCES "public"."platform_fees"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."external_event_integrations"
    ADD CONSTRAINT "external_event_integrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."imported_attendees"
    ADD CONSTRAINT "imported_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."imported_attendees"
    ADD CONSTRAINT "imported_attendees_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."external_event_integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kickback_disputes"
    ADD CONSTRAINT "kickback_disputes_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."event_kickback_agreements"("id");



ALTER TABLE ONLY "public"."kickback_disputes"
    ADD CONSTRAINT "kickback_disputes_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."kickback_disputes"
    ADD CONSTRAINT "kickback_disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."kickback_payments"
    ADD CONSTRAINT "kickback_payments_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."event_kickback_agreements"("id");



ALTER TABLE ONLY "public"."kickback_payments"
    ADD CONSTRAINT "kickback_payments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."kickback_payments"
    ADD CONSTRAINT "kickback_payments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."kickback_payments"
    ADD CONSTRAINT "kickback_payments_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."message_threads"
    ADD CONSTRAINT "message_threads_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."message_threads"
    ADD CONSTRAINT "message_threads_participant_1_id_fkey" FOREIGN KEY ("participant_1_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."message_threads"
    ADD CONSTRAINT "message_threads_participant_2_id_fkey" FOREIGN KEY ("participant_2_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."oauth_pending_connections"
    ADD CONSTRAINT "oauth_pending_connections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_pending_connections"
    ADD CONSTRAINT "oauth_pending_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."owner_profiles"
    ADD CONSTRAINT "owner_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_fees"
    ADD CONSTRAINT "platform_fees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."platform_fees"
    ADD CONSTRAINT "platform_fees_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."builder_subscriptions"("id");



ALTER TABLE ONLY "public"."platform_fees"
    ADD CONSTRAINT "platform_fees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_spaces"
    ADD CONSTRAINT "saved_spaces_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "public"."builder_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_spaces"
    ADD CONSTRAINT "saved_spaces_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_vendors"
    ADD CONSTRAINT "saved_vendors_builder_id_fkey" FOREIGN KEY ("builder_id") REFERENCES "public"."builder_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_vendors"
    ADD CONSTRAINT "saved_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spaces"
    ADD CONSTRAINT "spaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_accounts"
    ADD CONSTRAINT "stripe_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_logs"
    ADD CONSTRAINT "sync_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."external_event_integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."builder_subscriptions"("id");



ALTER TABLE ONLY "public"."vendor_bookings"
    ADD CONSTRAINT "vendor_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."vendor_bookings"
    ADD CONSTRAINT "vendor_bookings_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."vendor_bookings"
    ADD CONSTRAINT "vendor_bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id");



ALTER TABLE ONLY "public"."vendor_offerings"
    ADD CONSTRAINT "vendor_offerings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_packages"
    ADD CONSTRAINT "vendor_packages_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_requirements"
    ADD CONSTRAINT "vendor_requirements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_amenities"
    ADD CONSTRAINT "venue_amenities_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."venue_bookings"
    ADD CONSTRAINT "venue_bookings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."venue_kickback_configs"
    ADD CONSTRAINT "venue_kickback_configs_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_photos"
    ADD CONSTRAINT "venue_photos_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_requirements"
    ADD CONSTRAINT "venue_requirements_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_rules"
    ADD CONSTRAINT "venue_rules_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Active spaces are publicly viewable" ON "public"."spaces" FOR SELECT USING ((("status")::"text" = 'active'::"text"));



CREATE POLICY "Authenticated users can create own documents" ON "public"."documents" FOR INSERT WITH CHECK ((("uploader_id" = "auth"."uid"()) AND ((("related_type" = 'user'::"text") AND ("related_id" = "auth"."uid"())) OR (("related_type" = 'event'::"text") AND (("related_id" IN ( SELECT "collaborators"."event_id"
   FROM "public"."collaborators"
  WHERE ("collaborators"."user_id" = "auth"."uid"()))) OR ("related_id" IN ( SELECT "events"."id"
   FROM "public"."events"
  WHERE ("events"."builder_id" = "auth"."uid"()))))))));



CREATE POLICY "Builder profiles are publicly viewable" ON "public"."builder_profiles" FOR SELECT USING (true);



CREATE POLICY "Builders can add collaborators" ON "public"."collaborators" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "collaborators"."event_id") AND (EXISTS ( SELECT 1
           FROM "public"."builder_profiles"
          WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Builders can create bookings" ON "public"."bookings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "bookings"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can create events" ON "public"."events" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can create own profile" ON "public"."builder_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Builders can create vendor bookings" ON "public"."event_vendor_bookings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "event_vendor_bookings"."event_id") AND (EXISTS ( SELECT 1
           FROM "public"."builder_profiles"
          WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Builders can remove collaborators" ON "public"."collaborators" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "collaborators"."event_id") AND (EXISTS ( SELECT 1
           FROM "public"."builder_profiles"
          WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Builders can remove saved spaces" ON "public"."saved_spaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_spaces"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can remove saved vendors" ON "public"."saved_vendors" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_vendors"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can save spaces" ON "public"."saved_spaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_spaces"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can save vendors" ON "public"."saved_vendors" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_vendors"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can update own events" ON "public"."events" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can update own profile" ON "public"."builder_profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Builders can view event collaborators" ON "public"."collaborators" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "collaborators"."event_id") AND (EXISTS ( SELECT 1
           FROM "public"."builder_profiles"
          WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Builders can view own bookings" ON "public"."bookings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "bookings"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can view own events" ON "public"."events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can view saved spaces" ON "public"."saved_spaces" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_spaces"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can view saved vendors" ON "public"."saved_vendors" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."builder_profiles"
  WHERE (("builder_profiles"."id" = "saved_vendors"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Builders can view their vendor bookings" ON "public"."event_vendor_bookings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "event_vendor_bookings"."event_id") AND (EXISTS ( SELECT 1
           FROM "public"."builder_profiles"
          WHERE (("builder_profiles"."id" = "events"."builder_id") AND ("builder_profiles"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "Collaborators can update status" ON "public"."collaborators" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Collaborators can view events" ON "public"."events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."collaborators"
  WHERE (("collaborators"."event_id" = "events"."id") AND ("collaborators"."user_id" = "auth"."uid"())))));



CREATE POLICY "Collaborators can view their events" ON "public"."collaborators" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable insert for authenticated users and service role" ON "public"."users" FOR INSERT WITH CHECK (true);



CREATE POLICY "Event team can view event documents metadata" ON "public"."documents" FOR SELECT USING ((("uploader_id" = "auth"."uid"()) OR (("related_type" = 'event'::"text") AND (("related_id" IN ( SELECT "collaborators"."event_id"
   FROM "public"."collaborators"
  WHERE ("collaborators"."user_id" = "auth"."uid"()))) OR ("related_id" IN ( SELECT "events"."id"
   FROM "public"."events"
  WHERE ("events"."builder_id" = "auth"."uid"())))))));



CREATE POLICY "Event team can view imported attendees" ON "public"."imported_attendees" FOR SELECT USING ((("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"()))) OR ("event_id" IN ( SELECT "c"."event_id"
   FROM "public"."collaborators" "c"
  WHERE ("c"."user_id" = "auth"."uid"())))));



CREATE POLICY "Organizers can view their vendor bookings" ON "public"."vendor_bookings" FOR SELECT USING (("organizer_id" = "auth"."uid"()));



CREATE POLICY "Organizers can view their venue bookings" ON "public"."venue_bookings" FOR SELECT USING (("organizer_id" = "auth"."uid"()));



CREATE POLICY "Owner profiles are publicly viewable" ON "public"."owner_profiles" FOR SELECT USING (true);



CREATE POLICY "Owners can create own profile" ON "public"."owner_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can create spaces" ON "public"."spaces" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."owner_profiles"
  WHERE (("owner_profiles"."id" = "spaces"."owner_id") AND ("owner_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Owners can delete own spaces" ON "public"."spaces" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."owner_profiles"
  WHERE (("owner_profiles"."id" = "spaces"."owner_id") AND ("owner_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Owners can manage their venues" ON "public"."venues" USING (("owner_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Owners can update bookings" ON "public"."bookings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."owner_profiles"
  WHERE (("owner_profiles"."id" = "bookings"."owner_id") AND ("owner_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Owners can update own profile" ON "public"."owner_profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can update own spaces" ON "public"."spaces" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."owner_profiles"
  WHERE (("owner_profiles"."id" = "spaces"."owner_id") AND ("owner_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Owners can view bookings for their spaces" ON "public"."bookings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."owner_profiles"
  WHERE (("owner_profiles"."id" = "bookings"."owner_id") AND ("owner_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Published venues are publicly viewable" ON "public"."venues" FOR SELECT USING (("is_published" = true));



CREATE POLICY "Reviews are publicly viewable" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Service role can manage imported attendees" ON "public"."imported_attendees" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Users can create reviews" ON "public"."reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "reviewer_id"));



CREATE POLICY "Users can delete their own documents" ON "public"."documents" FOR DELETE USING ((("uploader_id" = "auth"."uid"()) OR (("related_type" = 'event'::"text") AND (("related_id" IN ( SELECT "collaborators"."event_id"
   FROM "public"."collaborators"
  WHERE ("collaborators"."user_id" = "auth"."uid"()))) OR ("related_id" IN ( SELECT "events"."id"
   FROM "public"."events"
  WHERE ("events"."builder_id" = "auth"."uid"())))))));



CREATE POLICY "Users can read own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can send messages" ON "public"."messages" FOR INSERT WITH CHECK (("auth"."uid"() = "sender_id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update received messages" ON "public"."messages" FOR UPDATE USING (("auth"."uid"() = "receiver_id"));



CREATE POLICY "Users can update their notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own messages" ON "public"."messages" FOR SELECT USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "receiver_id")));



CREATE POLICY "Users can view own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their documents" ON "public"."documents" FOR SELECT USING (("uploader_id" = "auth"."uid"()));



CREATE POLICY "Users can view their notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view threads they're part of" ON "public"."message_threads" FOR SELECT USING ((("participant_1_id" = "auth"."uid"()) OR ("participant_2_id" = "auth"."uid"())));



CREATE POLICY "Vendor offerings are publicly viewable" ON "public"."vendor_offerings" FOR SELECT USING (true);



CREATE POLICY "Vendor profiles are publicly viewable" ON "public"."vendor_profiles" FOR SELECT USING (true);



CREATE POLICY "Vendors can create own offerings" ON "public"."vendor_offerings" FOR INSERT WITH CHECK (("vendor_id" IN ( SELECT "vendor_profiles"."id"
   FROM "public"."vendor_profiles"
  WHERE ("vendor_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Vendors can create own profile" ON "public"."vendor_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Vendors can delete own offerings" ON "public"."vendor_offerings" FOR DELETE USING (("vendor_id" IN ( SELECT "vendor_profiles"."id"
   FROM "public"."vendor_profiles"
  WHERE ("vendor_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Vendors can update own offerings" ON "public"."vendor_offerings" FOR UPDATE USING (("vendor_id" IN ( SELECT "vendor_profiles"."id"
   FROM "public"."vendor_profiles"
  WHERE ("vendor_profiles"."user_id" = "auth"."uid"())))) WITH CHECK (("vendor_id" IN ( SELECT "vendor_profiles"."id"
   FROM "public"."vendor_profiles"
  WHERE ("vendor_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Vendors can update own profile" ON "public"."vendor_profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Vendors can update their booking status" ON "public"."event_vendor_bookings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."vendor_profiles"
  WHERE (("vendor_profiles"."id" = "event_vendor_bookings"."vendor_id") AND ("vendor_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Vendors can view their bookings" ON "public"."event_vendor_bookings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."vendor_profiles"
  WHERE (("vendor_profiles"."id" = "event_vendor_bookings"."vendor_id") AND ("vendor_profiles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Vendors can view their bookings" ON "public"."vendor_bookings" FOR SELECT USING (("vendor_id" IN ( SELECT "vendor_profiles"."id"
   FROM "public"."vendor_profiles"
  WHERE ("vendor_profiles"."user_id" = "auth"."uid"()))));



CREATE POLICY "Venue owners can view bookings for their venues" ON "public"."venue_bookings" FOR SELECT USING (("venue_id" IN ( SELECT "venues"."id"
   FROM "public"."venues"
  WHERE ("venues"."owner_id" = "auth"."uid"()))));



CREATE POLICY "agreements_select" ON "public"."event_kickback_agreements" FOR SELECT TO "authenticated" USING ((("builder_id" = "auth"."uid"()) OR ("venue_owner_id" = "auth"."uid"())));



ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."availability_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."baseline_sales_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."builder_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."builder_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "builder_subscriptions_select" ON "public"."builder_subscriptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "check_ins_select" ON "public"."event_check_ins" FOR SELECT TO "authenticated" USING (("event_id" IN ( SELECT "events"."id"
   FROM "public"."events"
  WHERE ("events"."builder_id" = "auth"."uid"())
UNION
 SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."venues" "v" ON (("e"."venue_id" = "v"."id")))
  WHERE ("v"."owner_id" = "auth"."uid"()))));



ALTER TABLE "public"."collaborators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_check_ins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_kickback_agreements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_sales_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_vendor_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_delete" ON "public"."events" FOR DELETE TO "authenticated" USING (("builder_id" = "auth"."uid"()));



CREATE POLICY "events_insert" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (("builder_id" = "auth"."uid"()));



CREATE POLICY "events_select" ON "public"."events" FOR SELECT TO "authenticated" USING (("builder_id" = "auth"."uid"()));



CREATE POLICY "events_update" ON "public"."events" FOR UPDATE TO "authenticated" USING (("builder_id" = "auth"."uid"()));



ALTER TABLE "public"."external_event_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."imported_attendees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "integrations_delete" ON "public"."external_event_integrations" FOR DELETE USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"()))));



CREATE POLICY "integrations_insert" ON "public"."external_event_integrations" FOR INSERT WITH CHECK (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"()))));



CREATE POLICY "integrations_select" ON "public"."external_event_integrations" FOR SELECT USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"()))));



CREATE POLICY "integrations_update" ON "public"."external_event_integrations" FOR UPDATE USING (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"())))) WITH CHECK (("event_id" IN ( SELECT "e"."id"
   FROM ("public"."events" "e"
     JOIN "public"."builder_profiles" "bp" ON (("bp"."id" = "e"."builder_id")))
  WHERE ("bp"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."kickback_disputes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kickback_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_pending_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."owner_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_fees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "platform_fees_select" ON "public"."platform_fees" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_spaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."spaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stripe_accounts_select" ON "public"."stripe_accounts" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_plans_select" ON "public"."subscription_plans" FOR SELECT TO "authenticated" USING (("is_active" = true));



ALTER TABLE "public"."sync_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_offerings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_amenities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_kickback_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_event_kickback"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_event_kickback"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_event_kickback"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_platform_fee"("user_id" "uuid", "booking_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_platform_fee"("user_id" "uuid", "booking_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_platform_fee"("user_id" "uuid", "booking_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_event_kickback_summary"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_event_kickback_summary"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_event_kickback_summary"("p_event_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_vendor_booking_fees"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_vendor_booking_fees"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_vendor_booking_fees"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_venue_booking_fees"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_venue_booking_fees"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_venue_booking_fees"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."availability_blocks" TO "anon";
GRANT ALL ON TABLE "public"."availability_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."availability_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."baseline_sales_data" TO "anon";
GRANT ALL ON TABLE "public"."baseline_sales_data" TO "authenticated";
GRANT ALL ON TABLE "public"."baseline_sales_data" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."builder_profiles" TO "anon";
GRANT ALL ON TABLE "public"."builder_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."builder_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."builder_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."builder_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."builder_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."collaborators" TO "anon";
GRANT ALL ON TABLE "public"."collaborators" TO "authenticated";
GRANT ALL ON TABLE "public"."collaborators" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."event_check_ins" TO "anon";
GRANT ALL ON TABLE "public"."event_check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."event_check_ins" TO "service_role";



GRANT ALL ON TABLE "public"."event_kickback_agreements" TO "anon";
GRANT ALL ON TABLE "public"."event_kickback_agreements" TO "authenticated";
GRANT ALL ON TABLE "public"."event_kickback_agreements" TO "service_role";



GRANT ALL ON TABLE "public"."event_sales_data" TO "anon";
GRANT ALL ON TABLE "public"."event_sales_data" TO "authenticated";
GRANT ALL ON TABLE "public"."event_sales_data" TO "service_role";



GRANT ALL ON TABLE "public"."event_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_templates" TO "service_role";



GRANT ALL ON TABLE "public"."event_vendor_bookings" TO "anon";
GRANT ALL ON TABLE "public"."event_vendor_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."event_vendor_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."event_vendors" TO "anon";
GRANT ALL ON TABLE "public"."event_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."event_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."external_event_integrations" TO "anon";
GRANT ALL ON TABLE "public"."external_event_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."external_event_integrations" TO "service_role";



GRANT ALL ON TABLE "public"."imported_attendees" TO "anon";
GRANT ALL ON TABLE "public"."imported_attendees" TO "authenticated";
GRANT ALL ON TABLE "public"."imported_attendees" TO "service_role";



GRANT ALL ON TABLE "public"."kickback_disputes" TO "anon";
GRANT ALL ON TABLE "public"."kickback_disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."kickback_disputes" TO "service_role";



GRANT ALL ON TABLE "public"."kickback_payments" TO "anon";
GRANT ALL ON TABLE "public"."kickback_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."kickback_payments" TO "service_role";



GRANT ALL ON TABLE "public"."message_threads" TO "anon";
GRANT ALL ON TABLE "public"."message_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."message_threads" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_pending_connections" TO "anon";
GRANT ALL ON TABLE "public"."oauth_pending_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_pending_connections" TO "service_role";



GRANT ALL ON TABLE "public"."owner_profiles" TO "anon";
GRANT ALL ON TABLE "public"."owner_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."platform_fees" TO "anon";
GRANT ALL ON TABLE "public"."platform_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_fees" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."saved_spaces" TO "anon";
GRANT ALL ON TABLE "public"."saved_spaces" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_spaces" TO "service_role";



GRANT ALL ON TABLE "public"."saved_vendors" TO "anon";
GRANT ALL ON TABLE "public"."saved_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."spaces" TO "anon";
GRANT ALL ON TABLE "public"."spaces" TO "authenticated";
GRANT ALL ON TABLE "public"."spaces" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_accounts" TO "anon";
GRANT ALL ON TABLE "public"."stripe_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON TABLE "public"."sync_logs" TO "anon";
GRANT ALL ON TABLE "public"."sync_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_logs" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_bookings" TO "anon";
GRANT ALL ON TABLE "public"."vendor_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_offerings" TO "anon";
GRANT ALL ON TABLE "public"."vendor_offerings" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_offerings" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_packages" TO "anon";
GRANT ALL ON TABLE "public"."vendor_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_packages" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_profiles" TO "anon";
GRANT ALL ON TABLE "public"."vendor_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_requirements" TO "anon";
GRANT ALL ON TABLE "public"."vendor_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."venue_amenities" TO "anon";
GRANT ALL ON TABLE "public"."venue_amenities" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_amenities" TO "service_role";



GRANT ALL ON TABLE "public"."venue_bookings" TO "anon";
GRANT ALL ON TABLE "public"."venue_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."venue_kickback_configs" TO "anon";
GRANT ALL ON TABLE "public"."venue_kickback_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_kickback_configs" TO "service_role";



GRANT ALL ON TABLE "public"."venue_photos" TO "anon";
GRANT ALL ON TABLE "public"."venue_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_photos" TO "service_role";



GRANT ALL ON TABLE "public"."venue_requirements" TO "anon";
GRANT ALL ON TABLE "public"."venue_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."venue_rules" TO "anon";
GRANT ALL ON TABLE "public"."venue_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_rules" TO "service_role";



GRANT ALL ON TABLE "public"."venues" TO "anon";
GRANT ALL ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







