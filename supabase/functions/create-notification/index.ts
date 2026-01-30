/**
 * Supabase Edge Function: Create Notification
 * 
 * This function creates notifications when certain events occur in the system.
 * 
 * Usage:
 * - Triggered via database triggers or called directly from the application
 * - Creates notifications for booking status changes, new messages, etc.
 * 
 * Example triggers to set up in Supabase:
 * 
 * 1. Booking Request Created:
 * CREATE OR REPLACE FUNCTION notify_booking_request()
 * RETURNS TRIGGER AS $$
 * BEGIN
 *   INSERT INTO notifications (user_id, type, title, message, link, metadata)
 *   VALUES (
 *     NEW.venue_owner_id,
 *     'new_booking_request',
 *     'New booking request',
 *     'You have a new booking request for ' || NEW.event_date,
 *     '/venue/requests',
 *     jsonb_build_object('booking_id', NEW.id, 'event_id', NEW.event_id)
 *   );
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql;
 * 
 * CREATE TRIGGER booking_request_notification
 * AFTER INSERT ON venue_bookings
 * FOR EACH ROW
 * WHEN (NEW.booking_status = 'pending')
 * EXECUTE FUNCTION notify_booking_request();
 * 
 * 2. Booking Confirmed:
 * CREATE OR REPLACE FUNCTION notify_booking_confirmed()
 * RETURNS TRIGGER AS $$
 * BEGIN
 *   -- Notify community builder
 *   INSERT INTO notifications (user_id, type, title, message, link, metadata)
 *   SELECT 
 *     e.organizer_id,
 *     'booking_confirmed',
 *     'Booking confirmed',
 *     'Your booking at ' || v.name || ' is confirmed!',
 *     '/builder/events/' || NEW.event_id,
 *     jsonb_build_object('booking_id', NEW.id, 'event_id', NEW.event_id, 'venue_id', NEW.venue_id)
 *   FROM events e
 *   JOIN venues v ON v.id = NEW.venue_id
 *   WHERE e.id = NEW.event_id;
 *   
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql;
 * 
 * CREATE TRIGGER booking_confirmed_notification
 * AFTER UPDATE ON venue_bookings
 * FOR EACH ROW
 * WHEN (NEW.booking_status = 'confirmed' AND OLD.booking_status = 'pending')
 * EXECUTE FUNCTION notify_booking_confirmed();
 * 
 * 3. New Message:
 * CREATE OR REPLACE FUNCTION notify_new_message()
 * RETURNS TRIGGER AS $$
 * DECLARE
 *   recipient_id UUID;
 * BEGIN
 *   -- Get the other participant in the thread
 *   SELECT CASE
 *     WHEN NEW.sender_id = mt.participant_1_id THEN mt.participant_2_id
 *     ELSE mt.participant_1_id
 *   END INTO recipient_id
 *   FROM message_threads mt
 *   WHERE mt.id = NEW.thread_id;
 *   
 *   INSERT INTO notifications (user_id, type, title, message, link, metadata)
 *   SELECT 
 *     recipient_id,
 *     'new_message',
 *     'New message',
 *     COALESCE(p.full_name, p.email) || ' sent you a message',
 *     '/builder/messages',
 *     jsonb_build_object('thread_id', NEW.thread_id, 'message_id', NEW.id)
 *   FROM profiles p
 *   WHERE p.id = NEW.sender_id;
 *   
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql;
 * 
 * CREATE TRIGGER new_message_notification
 * AFTER INSERT ON messages
 * FOR EACH ROW
 * EXECUTE FUNCTION notify_new_message();
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotificationPayload {
  user_id: string
  type: string
  title: string
  message: string
  link?: string | null
  metadata?: Record<string, any> | null
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const payload: NotificationPayload = await req.json()

    // Validate required fields
    if (!payload.user_id || !payload.type || !payload.title) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id, type, title' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Insert notification
    const { data, error } = await supabaseClient
      .from('notifications')
      .insert({
        user_id: payload.user_id,
        type: payload.type,
        title: payload.title,
        message: payload.message || '',
        link: payload.link || null,
        metadata: payload.metadata || null,
        is_read: false,
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return new Response(
      JSON.stringify({ success: true, notification: data }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
