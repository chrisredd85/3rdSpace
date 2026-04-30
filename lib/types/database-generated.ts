export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_type: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          scheduled_at: string
          started_at: string | null
          status: string
          unique_key: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          unique_key?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_type?: string
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          unique_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      availability_blocks: {
        Row: {
          blockable_id: string
          blockable_type: string
          created_at: string | null
          end_date: string
          id: string
          notes: string | null
          reason: string | null
          start_date: string
          updated_at: string | null
        }
        Insert: {
          blockable_id: string
          blockable_type: string
          created_at?: string | null
          end_date: string
          id?: string
          notes?: string | null
          reason?: string | null
          start_date: string
          updated_at?: string | null
        }
        Update: {
          blockable_id?: string
          blockable_type?: string
          created_at?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          reason?: string | null
          start_date?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      baseline_sales_data: {
        Row: {
          created_at: string | null
          data_source: string
          date: string
          day_of_week: number
          entered_by: string | null
          id: string
          notes: string | null
          time_slot_end: string
          time_slot_start: string
          total_sales: number
          transaction_count: number | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          data_source: string
          date: string
          day_of_week: number
          entered_by?: string | null
          id?: string
          notes?: string | null
          time_slot_end: string
          time_slot_start: string
          total_sales: number
          transaction_count?: number | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          data_source?: string
          date?: string
          day_of_week?: number
          entered_by?: string | null
          id?: string
          notes?: string | null
          time_slot_end?: string
          time_slot_start?: string
          total_sales?: number
          transaction_count?: number | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_sales_data_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_sales_data_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          budget_status: string | null
          builder_id: string
          builder_notes: string | null
          cleaning_fee: number | null
          created_at: string | null
          decline_reason: string | null
          event_id: string
          hourly_rate: number
          id: string
          owner_id: string
          owner_notes: string | null
          owner_payout: number
          paid_at: string | null
          payment_status: string | null
          platform_fee: number
          requested_at: string | null
          responded_at: string | null
          selected_requirements: string[] | null
          space_id: string
          status: string | null
          stripe_payment_intent_id: string | null
          subtotal: number
          total_amount: number
          updated_at: string | null
          vendors_cost: number | null
          venue_cost: number | null
        }
        Insert: {
          budget_status?: string | null
          builder_id: string
          builder_notes?: string | null
          cleaning_fee?: number | null
          created_at?: string | null
          decline_reason?: string | null
          event_id: string
          hourly_rate: number
          id?: string
          owner_id: string
          owner_notes?: string | null
          owner_payout: number
          paid_at?: string | null
          payment_status?: string | null
          platform_fee: number
          requested_at?: string | null
          responded_at?: string | null
          selected_requirements?: string[] | null
          space_id: string
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal: number
          total_amount: number
          updated_at?: string | null
          vendors_cost?: number | null
          venue_cost?: number | null
        }
        Update: {
          budget_status?: string | null
          builder_id?: string
          builder_notes?: string | null
          cleaning_fee?: number | null
          created_at?: string | null
          decline_reason?: string | null
          event_id?: string
          hourly_rate?: number
          id?: string
          owner_id?: string
          owner_notes?: string | null
          owner_payout?: number
          paid_at?: string | null
          payment_status?: string | null
          platform_fee?: number
          requested_at?: string | null
          responded_at?: string | null
          selected_requirements?: string[] | null
          space_id?: string
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number
          total_amount?: number
          updated_at?: string | null
          vendors_cost?: number | null
          venue_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owner_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_profiles: {
        Row: {
          created_at: string | null
          event_types: string[] | null
          eventbrite_connected: boolean | null
          eventbrite_organizer_id: string | null
          id: string
          luma_calendar_id: string | null
          luma_connected: boolean | null
          name: string
          phone: string | null
          photo_url: string | null
          posh_connected: boolean | null
          posh_organizer_id: string | null
          preferred_ticket_platforms: string[] | null
          priorities: string[] | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_started_at: string | null
          subscription_status: string | null
          total_attendance: number | null
          total_events_hosted: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_types?: string[] | null
          eventbrite_connected?: boolean | null
          eventbrite_organizer_id?: string | null
          id?: string
          luma_calendar_id?: string | null
          luma_connected?: boolean | null
          name: string
          phone?: string | null
          photo_url?: string | null
          posh_connected?: boolean | null
          posh_organizer_id?: string | null
          preferred_ticket_platforms?: string[] | null
          priorities?: string[] | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          total_attendance?: number | null
          total_events_hosted?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_types?: string[] | null
          eventbrite_connected?: boolean | null
          eventbrite_organizer_id?: string | null
          id?: string
          luma_calendar_id?: string | null
          luma_connected?: boolean | null
          name?: string
          phone?: string | null
          photo_url?: string | null
          posh_connected?: boolean | null
          posh_organizer_id?: string | null
          preferred_ticket_platforms?: string[] | null
          priorities?: string[] | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          total_attendance?: number | null
          total_events_hosted?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_stripe_accounts: {
        Row: {
          account_status: string
          builder_id: string | null
          charges_enabled: boolean
          created_at: string
          id: string
          payouts_enabled: boolean
          requirements_due: Json
          stripe_account_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string
          builder_id?: string | null
          charges_enabled?: boolean
          created_at?: string
          id?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string
          builder_id?: string | null
          charges_enabled?: boolean
          created_at?: string
          id?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_stripe_accounts_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: true
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_stripe_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_subscriptions: {
        Row: {
          cancel_at: string | null
          cancel_at_period_end: boolean | null
          canceled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          events_used_this_period: number | null
          id: string
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          events_used_this_period?: number | null
          id?: string
          plan_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          events_used_this_period?: number | null
          id?: string
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_ticketing_connections: {
        Row: {
          access_token_encrypted: string | null
          account_label: string | null
          builder_id: string
          config: Json
          created_at: string
          external_account_id: string | null
          id: string
          last_connected_at: string | null
          last_error: string | null
          platform: string
          refresh_token_encrypted: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          webhook_secret_encrypted: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token_encrypted?: string | null
          account_label?: string | null
          builder_id: string
          config?: Json
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_connected_at?: string | null
          last_error?: string | null
          platform: string
          refresh_token_encrypted?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret_encrypted?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token_encrypted?: string | null
          account_label?: string | null
          builder_id?: string
          config?: Json
          created_at?: string
          external_account_id?: string | null
          id?: string
          last_connected_at?: string | null
          last_error?: string | null
          platform?: string
          refresh_token_encrypted?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret_encrypted?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_ticketing_connections_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          event_id: string
          id: string
          invited_at: string | null
          invited_by: string
          responded_at: string | null
          role: string
          status: string | null
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          invited_at?: string | null
          invited_by: string
          responded_at?: string | null
          role: string
          status?: string | null
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          invited_at?: string | null
          invited_by?: string
          responded_at?: string | null
          role?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborators_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string | null
          document_type: string | null
          file_name: string | null
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          related_id: string | null
          related_type: string | null
          uploader_id: string
        }
        Insert: {
          created_at?: string | null
          document_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          related_id?: string | null
          related_type?: string | null
          uploader_id: string
        }
        Update: {
          created_at?: string | null
          document_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          related_id?: string | null
          related_type?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_check_ins: {
        Row: {
          attendee_email: string | null
          attendee_name: string | null
          attendee_phone: string | null
          check_in_time: string
          counted_for_payment: boolean | null
          created_at: string | null
          event_id: string
          external_attendee_id: string | null
          external_platform: string
          external_ticket_id: string | null
          id: string
          is_valid: boolean | null
          notes: string | null
          ticket_type: string | null
          updated_at: string | null
        }
        Insert: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          check_in_time: string
          counted_for_payment?: boolean | null
          created_at?: string | null
          event_id: string
          external_attendee_id?: string | null
          external_platform: string
          external_ticket_id?: string | null
          id?: string
          is_valid?: boolean | null
          notes?: string | null
          ticket_type?: string | null
          updated_at?: string | null
        }
        Update: {
          attendee_email?: string | null
          attendee_name?: string | null
          attendee_phone?: string | null
          check_in_time?: string
          counted_for_payment?: boolean | null
          created_at?: string | null
          event_id?: string
          external_attendee_id?: string | null
          external_platform?: string
          external_ticket_id?: string | null
          id?: string
          is_valid?: boolean | null
          notes?: string | null
          ticket_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_check_ins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_financial_summary: {
        Row: {
          average_ticket_price: number | null
          break_even_tickets: number | null
          calculated_at: string | null
          created_at: string | null
          current_attendance: number | null
          event_id: string
          expected_profit: number | null
          gross_revenue: number | null
          id: string
          net_revenue: number | null
          per_attendee_value: number | null
          profit_margin: number | null
          projected_attendance: number | null
          projected_revenue: number | null
          tickets_sold: number | null
          total_costs: number | null
          total_fees: number | null
          total_refunds: number | null
          updated_at: string | null
          vendor_cost: number | null
          venue_cost: number | null
          venue_kickback_projection: number | null
          venue_sales_share_projection: number | null
        }
        Insert: {
          average_ticket_price?: number | null
          break_even_tickets?: number | null
          calculated_at?: string | null
          created_at?: string | null
          current_attendance?: number | null
          event_id: string
          expected_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_revenue?: number | null
          per_attendee_value?: number | null
          profit_margin?: number | null
          projected_attendance?: number | null
          projected_revenue?: number | null
          tickets_sold?: number | null
          total_costs?: number | null
          total_fees?: number | null
          total_refunds?: number | null
          updated_at?: string | null
          vendor_cost?: number | null
          venue_cost?: number | null
          venue_kickback_projection?: number | null
          venue_sales_share_projection?: number | null
        }
        Update: {
          average_ticket_price?: number | null
          break_even_tickets?: number | null
          calculated_at?: string | null
          created_at?: string | null
          current_attendance?: number | null
          event_id?: string
          expected_profit?: number | null
          gross_revenue?: number | null
          id?: string
          net_revenue?: number | null
          per_attendee_value?: number | null
          profit_margin?: number | null
          projected_attendance?: number | null
          projected_revenue?: number | null
          tickets_sold?: number | null
          total_costs?: number | null
          total_fees?: number | null
          total_refunds?: number | null
          updated_at?: string | null
          vendor_cost?: number | null
          venue_cost?: number | null
          venue_kickback_projection?: number | null
          venue_sales_share_projection?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_financial_summary_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_kickback_agreements: {
        Row: {
          actual_attendance: number | null
          actual_kickback_amount: number | null
          actual_qualified_attendance: number | null
          actual_sales: number | null
          agreement_date: string | null
          attendance_lock_time: string | null
          auto_locked: boolean | null
          base_fee_amount: number | null
          baseline_calculation_method: string | null
          baseline_sales: number | null
          bonus_amount: number | null
          bonus_per_person: number | null
          bonus_threshold: number | null
          builder_approved: boolean | null
          builder_approved_at: string | null
          builder_id: string
          created_at: string | null
          data_entry_logs: Json | null
          dispute_notes: string | null
          dispute_reason: string | null
          disputed_at: string | null
          disputed_by: string | null
          event_date: string | null
          event_id: string
          expected_attendance: number | null
          expected_kickback_amount: number | null
          flat_base_fee: number | null
          id: string
          kickback_model: string
          lift_share_percentage: number | null
          maximum_payout: number | null
          minimum_attendees: number | null
          minimum_lift_amount: number | null
          payment_completed_at: string | null
          payment_due_date: string | null
          payment_method: string | null
          per_head_amount: number | null
          sales_lift_amount: number | null
          status: string
          stripe_transfer_id: string | null
          updated_at: string | null
          venue_approved: boolean | null
          venue_approved_at: string | null
          venue_id: string
          venue_owner_id: string
        }
        Insert: {
          actual_attendance?: number | null
          actual_kickback_amount?: number | null
          actual_qualified_attendance?: number | null
          actual_sales?: number | null
          agreement_date?: string | null
          attendance_lock_time?: string | null
          auto_locked?: boolean | null
          base_fee_amount?: number | null
          baseline_calculation_method?: string | null
          baseline_sales?: number | null
          bonus_amount?: number | null
          bonus_per_person?: number | null
          bonus_threshold?: number | null
          builder_approved?: boolean | null
          builder_approved_at?: string | null
          builder_id: string
          created_at?: string | null
          data_entry_logs?: Json | null
          dispute_notes?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          event_date?: string | null
          event_id: string
          expected_attendance?: number | null
          expected_kickback_amount?: number | null
          flat_base_fee?: number | null
          id?: string
          kickback_model: string
          lift_share_percentage?: number | null
          maximum_payout?: number | null
          minimum_attendees?: number | null
          minimum_lift_amount?: number | null
          payment_completed_at?: string | null
          payment_due_date?: string | null
          payment_method?: string | null
          per_head_amount?: number | null
          sales_lift_amount?: number | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string | null
          venue_approved?: boolean | null
          venue_approved_at?: string | null
          venue_id: string
          venue_owner_id: string
        }
        Update: {
          actual_attendance?: number | null
          actual_kickback_amount?: number | null
          actual_qualified_attendance?: number | null
          actual_sales?: number | null
          agreement_date?: string | null
          attendance_lock_time?: string | null
          auto_locked?: boolean | null
          base_fee_amount?: number | null
          baseline_calculation_method?: string | null
          baseline_sales?: number | null
          bonus_amount?: number | null
          bonus_per_person?: number | null
          bonus_threshold?: number | null
          builder_approved?: boolean | null
          builder_approved_at?: string | null
          builder_id?: string
          created_at?: string | null
          data_entry_logs?: Json | null
          dispute_notes?: string | null
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          event_date?: string | null
          event_id?: string
          expected_attendance?: number | null
          expected_kickback_amount?: number | null
          flat_base_fee?: number | null
          id?: string
          kickback_model?: string
          lift_share_percentage?: number | null
          maximum_payout?: number | null
          minimum_attendees?: number | null
          minimum_lift_amount?: number | null
          payment_completed_at?: string | null
          payment_due_date?: string | null
          payment_method?: string | null
          per_head_amount?: number | null
          sales_lift_amount?: number | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string | null
          venue_approved?: boolean | null
          venue_approved_at?: string | null
          venue_id?: string
          venue_owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_kickback_agreements_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_kickback_agreements_disputed_by_fkey"
            columns: ["disputed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_kickback_agreements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_kickback_agreements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_kickback_agreements_venue_owner_id_fkey"
            columns: ["venue_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sales_data: {
        Row: {
          agreement_id: string | null
          baseline_sales: number | null
          created_at: string | null
          data_source: string
          discount_code: string | null
          entered_by: string
          event_id: string
          fees: number | null
          id: string
          integration_id: string | null
          is_refund: boolean | null
          is_verified: boolean | null
          notes: string | null
          order_id: string | null
          platform: string | null
          purchase_timestamp: string | null
          raw_data: Json
          receipt_urls: string[] | null
          sales_lift: number | null
          submitted_at: string | null
          ticket_buyer_email: string | null
          ticket_buyer_name: string | null
          ticket_price: number | null
          ticket_quantity: number | null
          ticket_type: string | null
          total_amount: number | null
          total_sales: number
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          agreement_id?: string | null
          baseline_sales?: number | null
          created_at?: string | null
          data_source: string
          discount_code?: string | null
          entered_by: string
          event_id: string
          fees?: number | null
          id?: string
          integration_id?: string | null
          is_refund?: boolean | null
          is_verified?: boolean | null
          notes?: string | null
          order_id?: string | null
          platform?: string | null
          purchase_timestamp?: string | null
          raw_data?: Json
          receipt_urls?: string[] | null
          sales_lift?: number | null
          submitted_at?: string | null
          ticket_buyer_email?: string | null
          ticket_buyer_name?: string | null
          ticket_price?: number | null
          ticket_quantity?: number | null
          ticket_type?: string | null
          total_amount?: number | null
          total_sales: number
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          agreement_id?: string | null
          baseline_sales?: number | null
          created_at?: string | null
          data_source?: string
          discount_code?: string | null
          entered_by?: string
          event_id?: string
          fees?: number | null
          id?: string
          integration_id?: string | null
          is_refund?: boolean | null
          is_verified?: boolean | null
          notes?: string | null
          order_id?: string | null
          platform?: string | null
          purchase_timestamp?: string | null
          raw_data?: Json
          receipt_urls?: string[] | null
          sales_lift?: number | null
          submitted_at?: string | null
          ticket_buyer_email?: string | null
          ticket_buyer_name?: string | null
          ticket_price?: number | null
          ticket_quantity?: number | null
          ticket_type?: string | null
          total_amount?: number | null
          total_sales?: number
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_sales_data_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "event_kickback_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sales_data_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sales_data_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sales_data_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "external_event_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sales_data_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          created_at: string | null
          creator_id: string
          description: string | null
          estimated_budget: number | null
          event_type: string | null
          expected_attendance_max: number | null
          expected_attendance_min: number | null
          id: string
          is_public: boolean | null
          preferred_venue_types: Json | null
          required_vendor_types: Json | null
          template_data: Json | null
          template_name: string
          times_used: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          creator_id: string
          description?: string | null
          estimated_budget?: number | null
          event_type?: string | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          id?: string
          is_public?: boolean | null
          preferred_venue_types?: Json | null
          required_vendor_types?: Json | null
          template_data?: Json | null
          template_name: string
          times_used?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          creator_id?: string
          description?: string | null
          estimated_budget?: number | null
          event_type?: string | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          id?: string
          is_public?: boolean | null
          preferred_venue_types?: Json | null
          required_vendor_types?: Json | null
          template_data?: Json | null
          template_name?: string
          times_used?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_templates_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_vendor_bookings: {
        Row: {
          booking_id: string | null
          created_at: string | null
          event_id: string
          hourly_rate: number
          hours: number
          id: string
          status: string | null
          total_cost: number
          updated_at: string | null
          vendor_id: string
          vendor_type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          event_id: string
          hourly_rate: number
          hours: number
          id?: string
          status?: string | null
          total_cost: number
          updated_at?: string | null
          vendor_id: string
          vendor_type: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          event_id?: string
          hourly_rate?: number
          hours?: number
          id?: string
          status?: string | null
          total_cost?: number
          updated_at?: string | null
          vendor_id?: string
          vendor_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_vendor_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_vendor_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_vendor_bookings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_vendors: {
        Row: {
          created_at: string | null
          event_id: string
          final_price: number | null
          id: string
          notes: string | null
          quoted_price: number | null
          setup_time: string | null
          status: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          final_price?: number | null
          id?: string
          notes?: string | null
          quoted_price?: number | null
          setup_time?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          final_price?: number | null
          id?: string
          notes?: string | null
          quoted_price?: number | null
          setup_time?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_vendors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_webhook_events: {
        Row: {
          created_at: string | null
          event_id: string | null
          external_event_id: string | null
          headers: Json
          id: string
          integration_id: string | null
          payload: Json
          platform: string
          processed_at: string | null
          processing_error: string | null
          webhook_event_id: string | null
          webhook_type: string | null
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          external_event_id?: string | null
          headers?: Json
          id?: string
          integration_id?: string | null
          payload?: Json
          platform: string
          processed_at?: string | null
          processing_error?: string | null
          webhook_event_id?: string | null
          webhook_type?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          external_event_id?: string | null
          headers?: Json
          id?: string
          integration_id?: string | null
          payload?: Json
          platform?: string
          processed_at?: string | null
          processing_error?: string | null
          webhook_event_id?: string | null
          webhook_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_webhook_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_webhook_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "external_event_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actual_cost: number | null
          budget: number | null
          builder_id: string
          completion_percentage: number | null
          created_at: string | null
          description: string | null
          duration_hours: number
          end_time: string
          event_date: string
          event_description: string | null
          event_name: string
          event_time: string | null
          event_type: string
          expected_attendance: number | null
          expected_attendance_max: number | null
          expected_attendance_min: number | null
          id: string
          is_recurring: boolean | null
          kickback_agreement_id: string | null
          parent_event_id: string | null
          platform_fee_id: string | null
          platform_fee_paid: boolean | null
          recurring_frequency: string | null
          recurring_occurrences: number | null
          start_time: string
          status: string | null
          total_budget: number | null
          updated_at: string | null
          venue_confirmed: boolean | null
          venue_id: string | null
        }
        Insert: {
          actual_cost?: number | null
          budget?: number | null
          builder_id: string
          completion_percentage?: number | null
          created_at?: string | null
          description?: string | null
          duration_hours: number
          end_time: string
          event_date: string
          event_description?: string | null
          event_name: string
          event_time?: string | null
          event_type: string
          expected_attendance?: number | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          id?: string
          is_recurring?: boolean | null
          kickback_agreement_id?: string | null
          parent_event_id?: string | null
          platform_fee_id?: string | null
          platform_fee_paid?: boolean | null
          recurring_frequency?: string | null
          recurring_occurrences?: number | null
          start_time: string
          status?: string | null
          total_budget?: number | null
          updated_at?: string | null
          venue_confirmed?: boolean | null
          venue_id?: string | null
        }
        Update: {
          actual_cost?: number | null
          budget?: number | null
          builder_id?: string
          completion_percentage?: number | null
          created_at?: string | null
          description?: string | null
          duration_hours?: number
          end_time?: string
          event_date?: string
          event_description?: string | null
          event_name?: string
          event_time?: string | null
          event_type?: string
          expected_attendance?: number | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          id?: string
          is_recurring?: boolean | null
          kickback_agreement_id?: string | null
          parent_event_id?: string | null
          platform_fee_id?: string | null
          platform_fee_paid?: boolean | null
          recurring_frequency?: string | null
          recurring_occurrences?: number | null
          start_time?: string
          status?: string | null
          total_budget?: number | null
          updated_at?: string | null
          venue_confirmed?: boolean | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_kickback_agreement_id_fkey"
            columns: ["kickback_agreement_id"]
            isOneToOne: false
            referencedRelation: "event_kickback_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_platform_fee_id_fkey"
            columns: ["platform_fee_id"]
            isOneToOne: false
            referencedRelation: "platform_fees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      external_event_integrations: {
        Row: {
          access_token_encrypted: string | null
          api_key_encrypted: string | null
          auto_sync_enabled: boolean | null
          config: Json | null
          created_at: string | null
          event_id: string
          external_event_id: string | null
          external_event_url: string | null
          id: string
          integration_metadata: Json | null
          is_active: boolean | null
          last_attendance_count: number | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          platform: string
          refresh_token_encrypted: string | null
          sync_error: string | null
          sync_frequency_minutes: number | null
          sync_status: string | null
          token_expires_at: string | null
          total_checked_in: number | null
          total_tickets_sold: number | null
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token_encrypted?: string | null
          api_key_encrypted?: string | null
          auto_sync_enabled?: boolean | null
          config?: Json | null
          created_at?: string | null
          event_id: string
          external_event_id?: string | null
          external_event_url?: string | null
          id?: string
          integration_metadata?: Json | null
          is_active?: boolean | null
          last_attendance_count?: number | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          platform: string
          refresh_token_encrypted?: string | null
          sync_error?: string | null
          sync_frequency_minutes?: number | null
          sync_status?: string | null
          token_expires_at?: string | null
          total_checked_in?: number | null
          total_tickets_sold?: number | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token_encrypted?: string | null
          api_key_encrypted?: string | null
          auto_sync_enabled?: boolean | null
          config?: Json | null
          created_at?: string | null
          event_id?: string
          external_event_id?: string | null
          external_event_url?: string | null
          id?: string
          integration_metadata?: Json | null
          is_active?: boolean | null
          last_attendance_count?: number | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          platform?: string
          refresh_token_encrypted?: string | null
          sync_error?: string | null
          sync_frequency_minutes?: number | null
          sync_status?: string | null
          token_expires_at?: string | null
          total_checked_in?: number | null
          total_tickets_sold?: number | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_event_integrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_attendees: {
        Row: {
          check_in_method: string | null
          check_in_time: string | null
          checked_in: boolean | null
          created_at: string | null
          email: string | null
          event_id: string
          external_attendee_id: string
          first_name: string | null
          id: string
          integration_id: string
          last_name: string | null
          order_id: string | null
          raw_data: Json | null
          ticket_class: string | null
          ticket_price: number | null
          ticket_type: string | null
          updated_at: string | null
        }
        Insert: {
          check_in_method?: string | null
          check_in_time?: string | null
          checked_in?: boolean | null
          created_at?: string | null
          email?: string | null
          event_id: string
          external_attendee_id: string
          first_name?: string | null
          id?: string
          integration_id: string
          last_name?: string | null
          order_id?: string | null
          raw_data?: Json | null
          ticket_class?: string | null
          ticket_price?: number | null
          ticket_type?: string | null
          updated_at?: string | null
        }
        Update: {
          check_in_method?: string | null
          check_in_time?: string | null
          checked_in?: boolean | null
          created_at?: string | null
          email?: string | null
          event_id?: string
          external_attendee_id?: string
          first_name?: string | null
          id?: string
          integration_id?: string
          last_name?: string | null
          order_id?: string | null
          raw_data?: Json | null
          ticket_class?: string | null
          ticket_price?: number | null
          ticket_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imported_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imported_attendees_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "external_event_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      kickback_disputes: {
        Row: {
          agreement_id: string
          created_at: string | null
          dispute_type: string
          disputed_value_actual: number | null
          disputed_value_claimed: number | null
          evidence_urls: string[] | null
          final_amount: number | null
          id: string
          initiated_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          agreement_id: string
          created_at?: string | null
          dispute_type: string
          disputed_value_actual?: number | null
          disputed_value_claimed?: number | null
          evidence_urls?: string[] | null
          final_amount?: number | null
          id?: string
          initiated_by: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          agreement_id?: string
          created_at?: string | null
          dispute_type?: string
          disputed_value_actual?: number | null
          disputed_value_claimed?: number | null
          evidence_urls?: string[] | null
          final_amount?: number | null
          id?: string
          initiated_by?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kickback_disputes_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "event_kickback_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_disputes_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      kickback_payments: {
        Row: {
          agreement_id: string
          amount: number
          completed_at: string | null
          created_at: string | null
          currency: string | null
          event_id: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          initiated_at: string | null
          notes: string | null
          payer_id: string
          receipt_url: string | null
          recipient_id: string
          status: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
        }
        Insert: {
          agreement_id: string
          amount: number
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          event_id: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          notes?: string | null
          payer_id: string
          receipt_url?: string | null
          recipient_id: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
        }
        Update: {
          agreement_id?: string
          amount?: number
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          event_id?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          notes?: string | null
          payer_id?: string
          receipt_url?: string | null
          recipient_id?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kickback_payments_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "event_kickback_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_payments_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_payments_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      message_threads: {
        Row: {
          booking_id: string | null
          booking_type: string | null
          created_at: string | null
          event_id: string | null
          id: string
          last_message_at: string | null
          participant_1_id: string
          participant_2_id: string
          unread_count_participant_1: number | null
          unread_count_participant_2: number | null
          updated_at: string | null
        }
        Insert: {
          booking_id?: string | null
          booking_type?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          last_message_at?: string | null
          participant_1_id: string
          participant_2_id: string
          unread_count_participant_1?: number | null
          unread_count_participant_2?: number | null
          updated_at?: string | null
        }
        Update: {
          booking_id?: string | null
          booking_type?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          last_message_at?: string | null
          participant_1_id?: string
          participant_2_id?: string
          unread_count_participant_1?: number | null
          unread_count_participant_2?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_threads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_participant_1_id_fkey"
            columns: ["participant_1_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_participant_2_id_fkey"
            columns: ["participant_2_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: string[] | null
          booking_id: string | null
          content: string
          created_at: string | null
          id: string
          read: boolean | null
          read_at: string | null
          receiver_id: string
          sender_id: string
          thread_id: string | null
          vendor_booking_id: string | null
          venue_booking_id: string | null
        }
        Insert: {
          attachments?: string[] | null
          booking_id?: string | null
          content: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          read_at?: string | null
          receiver_id: string
          sender_id: string
          thread_id?: string | null
          vendor_booking_id?: string | null
          venue_booking_id?: string | null
        }
        Update: {
          attachments?: string[] | null
          booking_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          read_at?: string | null
          receiver_id?: string
          sender_id?: string
          thread_id?: string | null
          vendor_booking_id?: string | null
          venue_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_venue_booking_id_fkey"
            columns: ["venue_booking_id"]
            isOneToOne: false
            referencedRelation: "venue_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          preferences: Json
          push_enabled: boolean
          sound_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          preferences?: Json
          push_enabled?: boolean
          sound_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          preferences?: Json
          push_enabled?: boolean
          sound_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          group_key: string | null
          id: string
          is_read: boolean | null
          link: string | null
          link_url: string | null
          message: string | null
          metadata: Json | null
          notification_type: string | null
          read_at: string | null
          related_id: string | null
          title: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          group_key?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          link_url?: string | null
          message?: string | null
          metadata?: Json | null
          notification_type?: string | null
          read_at?: string | null
          related_id?: string | null
          title?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          group_key?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          link_url?: string | null
          message?: string | null
          metadata?: Json | null
          notification_type?: string | null
          read_at?: string | null
          related_id?: string | null
          title?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_pending_connections: {
        Row: {
          access_token: string | null
          available_events: Json | null
          created_at: string | null
          event_id: string
          expires_at: string | null
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          available_events?: Json | null
          created_at?: string | null
          event_id: string
          expires_at?: string | null
          id?: string
          platform: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          available_events?: Json | null
          created_at?: string | null
          event_id?: string
          expires_at?: string | null
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_pending_connections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_profiles: {
        Row: {
          acceptance_rate: number | null
          average_response_time: number | null
          business_name: string | null
          business_type: string | null
          created_at: string | null
          id: string
          name: string
          payout_enabled: boolean | null
          phone: string | null
          photo_url: string | null
          stripe_account_id: string | null
          stripe_account_status: string | null
          total_bookings: number | null
          total_earnings: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          acceptance_rate?: number | null
          average_response_time?: number | null
          business_name?: string | null
          business_type?: string | null
          created_at?: string | null
          id?: string
          name: string
          payout_enabled?: boolean | null
          phone?: string | null
          photo_url?: string | null
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          acceptance_rate?: number | null
          average_response_time?: number | null
          business_name?: string | null
          business_type?: string | null
          created_at?: string | null
          id?: string
          name?: string
          payout_enabled?: boolean | null
          phone?: string | null
          photo_url?: string | null
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fees: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          description: string | null
          event_id: string | null
          failure_reason: string | null
          fee_type: string
          id: string
          paid_at: string | null
          refunded_at: string | null
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          event_id?: string | null
          failure_reason?: string | null
          fee_type: string
          id?: string
          paid_at?: string | null
          refunded_at?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          event_id?: string | null
          failure_reason?: string | null
          fee_type?: string
          id?: string
          paid_at?: string | null
          refunded_at?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_fees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fees_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "builder_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string | null
          builder_id: string | null
          created_at: string | null
          event_type: string | null
          id: string
          rating: number
          responded_at: string | null
          response_date: string | null
          response_text: string | null
          review_text: string | null
          reviewee_id: string
          reviewer_id: string
          status: string | null
          updated_at: string | null
          vendor_booking_id: string | null
          vendor_id: string | null
          vendor_response: string | null
        }
        Insert: {
          booking_id?: string | null
          builder_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string
          rating: number
          responded_at?: string | null
          response_date?: string | null
          response_text?: string | null
          review_text?: string | null
          reviewee_id: string
          reviewer_id: string
          status?: string | null
          updated_at?: string | null
          vendor_booking_id?: string | null
          vendor_id?: string | null
          vendor_response?: string | null
        }
        Update: {
          booking_id?: string | null
          builder_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string
          rating?: number
          responded_at?: string | null
          response_date?: string | null
          response_text?: string | null
          review_text?: string | null
          reviewee_id?: string
          reviewer_id?: string
          status?: string | null
          updated_at?: string | null
          vendor_booking_id?: string | null
          vendor_id?: string | null
          vendor_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_spaces: {
        Row: {
          builder_id: string
          created_at: string | null
          space_id: string
        }
        Insert: {
          builder_id: string
          created_at?: string | null
          space_id: string
        }
        Update: {
          builder_id?: string
          created_at?: string | null
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_spaces_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_spaces_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_vendors: {
        Row: {
          builder_id: string
          created_at: string | null
          vendor_id: string
        }
        Insert: {
          builder_id: string
          created_at?: string | null
          vendor_id: string
        }
        Update: {
          builder_id?: string
          created_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_vendors_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_venues: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          user_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          user_id: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_venues_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_venues_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      spaces: {
        Row: {
          address: string
          amenities: string[] | null
          available: boolean | null
          capacity: number
          city: string
          cleaning_fee: number | null
          country: string | null
          created_at: string | null
          description: string | null
          event_types: string[] | null
          hourly_rate: number
          id: string
          instant_booking: boolean | null
          latitude: number | null
          longitude: number | null
          minimum_hours: number | null
          name: string
          owner_id: string
          photos: string[] | null
          rating: number | null
          review_count: number | null
          security_deposit: number | null
          space_type: string
          square_footage: number | null
          state: string
          status: string | null
          total_bookings: number | null
          updated_at: string | null
          venue_features: string[] | null
          zip_code: string
        }
        Insert: {
          address: string
          amenities?: string[] | null
          available?: boolean | null
          capacity: number
          city: string
          cleaning_fee?: number | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          event_types?: string[] | null
          hourly_rate: number
          id?: string
          instant_booking?: boolean | null
          latitude?: number | null
          longitude?: number | null
          minimum_hours?: number | null
          name: string
          owner_id: string
          photos?: string[] | null
          rating?: number | null
          review_count?: number | null
          security_deposit?: number | null
          space_type: string
          square_footage?: number | null
          state: string
          status?: string | null
          total_bookings?: number | null
          updated_at?: string | null
          venue_features?: string[] | null
          zip_code: string
        }
        Update: {
          address?: string
          amenities?: string[] | null
          available?: boolean | null
          capacity?: number
          city?: string
          cleaning_fee?: number | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          event_types?: string[] | null
          hourly_rate?: number
          id?: string
          instant_booking?: boolean | null
          latitude?: number | null
          longitude?: number | null
          minimum_hours?: number | null
          name?: string
          owner_id?: string
          photos?: string[] | null
          rating?: number | null
          review_count?: number | null
          security_deposit?: number | null
          space_type?: string
          square_footage?: number | null
          state?: string
          status?: string | null
          total_bookings?: number | null
          updated_at?: string | null
          venue_features?: string[] | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owner_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_accounts: {
        Row: {
          account_type: string
          business_type: string | null
          charges_enabled: boolean | null
          country: string | null
          created_at: string | null
          currency: string | null
          details_submitted: boolean | null
          id: string
          payouts_enabled: boolean | null
          stripe_account_id: string
          updated_at: string | null
          user_id: string
          user_type: string
        }
        Insert: {
          account_type?: string
          business_type?: string | null
          charges_enabled?: boolean | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          details_submitted?: boolean | null
          id?: string
          payouts_enabled?: boolean | null
          stripe_account_id: string
          updated_at?: string | null
          user_id: string
          user_type: string
        }
        Update: {
          account_type?: string
          business_type?: string | null
          charges_enabled?: boolean | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          details_submitted?: boolean | null
          id?: string
          payouts_enabled?: boolean | null
          stripe_account_id?: string
          updated_at?: string | null
          user_id?: string
          user_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          created_at: string | null
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          stripe_event_id: string
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          stripe_event_id: string
        }
        Update: {
          created_at?: string | null
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          stripe_event_id?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          description: string | null
          events_per_period: number | null
          features: Json | null
          id: string
          interval: string
          is_active: boolean | null
          is_featured: boolean | null
          max_attendees_per_event: number | null
          name: string
          plan_type: string | null
          platform_fee_discount: number | null
          price: number | null
          slug: string
          sort_order: number | null
          stripe_price_id: string
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          events_per_period?: number | null
          features?: Json | null
          id?: string
          interval: string
          is_active?: boolean | null
          is_featured?: boolean | null
          max_attendees_per_event?: number | null
          name: string
          plan_type?: string | null
          platform_fee_discount?: number | null
          price?: number | null
          slug: string
          sort_order?: number | null
          stripe_price_id: string
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          events_per_period?: number | null
          features?: Json | null
          id?: string
          interval?: string
          is_active?: boolean | null
          is_featured?: boolean | null
          max_attendees_per_event?: number | null
          name?: string
          plan_type?: string | null
          platform_fee_discount?: number | null
          price?: number | null
          slug?: string
          sort_order?: number | null
          stripe_price_id?: string
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          created_at: string | null
          error_details: Json | null
          error_message: string | null
          id: string
          integration_id: string
          records_failed: number | null
          records_fetched: number | null
          records_inserted: number | null
          records_updated: number | null
          status: string
          sync_completed_at: string | null
          sync_started_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          integration_id: string
          records_failed?: number | null
          records_fetched?: number | null
          records_inserted?: number | null
          records_updated?: number | null
          status: string
          sync_completed_at?: string | null
          sync_started_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_details?: Json | null
          error_message?: string | null
          id?: string
          integration_id?: string
          records_failed?: number | null
          records_fetched?: number | null
          records_inserted?: number | null
          records_updated?: number | null
          status?: string
          sync_completed_at?: string | null
          sync_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "external_event_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          company_name: string | null
          created_at: string | null
          email: string
          email_verified: boolean | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_payment_date: string | null
          monthly_bookings_count: number | null
          monthly_revenue: number | null
          platform_fee_percentage: number | null
          role: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_id: string | null
          subscription_started_at: string | null
          subscription_status: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
          updated_at: string | null
          user_type: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string | null
          email: string
          email_verified?: boolean | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_payment_date?: string | null
          monthly_bookings_count?: number | null
          monthly_revenue?: number | null
          platform_fee_percentage?: number | null
          role: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_id?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_type?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string | null
          email?: string
          email_verified?: boolean | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_payment_date?: string | null
          monthly_bookings_count?: number | null
          monthly_revenue?: number | null
          platform_fee_percentage?: number | null
          role?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_id?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "builder_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_availability: {
        Row: {
          booking_id: string | null
          created_at: string | null
          date: string
          id: string
          notes: string | null
          status: string
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          date: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_availability_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "vendor_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_availability_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_bookings: {
        Row: {
          booking_date: string
          confirmed_date: string | null
          confirmed_end_time: string | null
          confirmed_start_time: string | null
          created_at: string | null
          decline_reason: string | null
          deposit_amount: number | null
          deposit_paid: boolean | null
          end_time: string | null
          event_id: string
          final_price: number | null
          guest_count: number | null
          id: string
          notes: string | null
          organizer_id: string
          paid_at: string | null
          payment_status: string | null
          platform_fee_amount: number | null
          platform_fee_percentage: number | null
          quantity: number | null
          quoted_price: number | null
          requested_date: string | null
          requested_end_time: string | null
          requested_start_time: string | null
          requirements: Json | null
          responded_at: string | null
          setup_time: string | null
          start_time: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          subtotal: number | null
          total_amount: number | null
          updated_at: string | null
          vendor_id: string
          vendor_offering_id: string | null
          vendor_package_id: string | null
        }
        Insert: {
          booking_date: string
          confirmed_date?: string | null
          confirmed_end_time?: string | null
          confirmed_start_time?: string | null
          created_at?: string | null
          decline_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: boolean | null
          end_time?: string | null
          event_id: string
          final_price?: number | null
          guest_count?: number | null
          id?: string
          notes?: string | null
          organizer_id: string
          paid_at?: string | null
          payment_status?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quantity?: number | null
          quoted_price?: number | null
          requested_date?: string | null
          requested_end_time?: string | null
          requested_start_time?: string | null
          requirements?: Json | null
          responded_at?: string | null
          setup_time?: string | null
          start_time?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id: string
          vendor_offering_id?: string | null
          vendor_package_id?: string | null
        }
        Update: {
          booking_date?: string
          confirmed_date?: string | null
          confirmed_end_time?: string | null
          confirmed_start_time?: string | null
          created_at?: string | null
          decline_reason?: string | null
          deposit_amount?: number | null
          deposit_paid?: boolean | null
          end_time?: string | null
          event_id?: string
          final_price?: number | null
          guest_count?: number | null
          id?: string
          notes?: string | null
          organizer_id?: string
          paid_at?: string | null
          payment_status?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quantity?: number | null
          quoted_price?: number | null
          requested_date?: string | null
          requested_end_time?: string | null
          requested_start_time?: string | null
          requirements?: Json | null
          responded_at?: string | null
          setup_time?: string | null
          start_time?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id?: string
          vendor_offering_id?: string | null
          vendor_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bookings_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bookings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bookings_vendor_offering_id_fkey"
            columns: ["vendor_offering_id"]
            isOneToOne: false
            referencedRelation: "vendor_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bookings_vendor_package_id_fkey"
            columns: ["vendor_package_id"]
            isOneToOne: false
            referencedRelation: "vendor_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_offerings: {
        Row: {
          add_ons: Json
          base_price: number
          created_at: string | null
          description: string | null
          duration_hours: number | null
          equipment_included: string[]
          id: string
          is_active: boolean
          is_included: boolean | null
          max_capacity: number | null
          max_quantity: number | null
          min_quantity: number | null
          offering_name: string | null
          portfolio_images: string[]
          pricing_model: string
          service_category: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          add_ons?: Json
          base_price?: number
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          equipment_included?: string[]
          id?: string
          is_active?: boolean
          is_included?: boolean | null
          max_capacity?: number | null
          max_quantity?: number | null
          min_quantity?: number | null
          offering_name?: string | null
          portfolio_images?: string[]
          pricing_model?: string
          service_category?: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          add_ons?: Json
          base_price?: number
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          equipment_included?: string[]
          id?: string
          is_active?: boolean
          is_included?: boolean | null
          max_capacity?: number | null
          max_quantity?: number | null
          min_quantity?: number | null
          offering_name?: string | null
          portfolio_images?: string[]
          pricing_model?: string
          service_category?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_offerings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_packages: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          duration_hours: number | null
          id: string
          inclusions: Json | null
          is_active: boolean | null
          package_name: string
          price: number | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          duration_hours?: number | null
          id?: string
          inclusions?: Json | null
          is_active?: boolean | null
          package_name: string
          price?: number | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          duration_hours?: number | null
          id?: string
          inclusions?: Json | null
          is_active?: boolean | null
          package_name?: string
          price?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_packages_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_profiles: {
        Row: {
          availability_notes: string | null
          average_rating: number | null
          bank_account_holder_name: string | null
          bank_name: string | null
          base_rate: number | null
          bio: string | null
          compatible_features: string[] | null
          created_at: string | null
          deposit_amount: number | null
          deposit_percentage: number | null
          deposit_refundable: boolean | null
          deposit_required: number | null
          deposit_terms: string | null
          deposit_type: string | null
          hourly_rate: number | null
          id: string
          is_published: boolean | null
          languages: string[] | null
          minimum_hours: number | null
          name: string
          payout_enabled: boolean | null
          per_head_kickback: number | null
          per_person_rate: number | null
          phone: string | null
          photo_url: string | null
          pricing_model: string | null
          rating: number | null
          regions_served: string | null
          requires_deposit: boolean | null
          review_count: number | null
          service_area: string | null
          service_type: string | null
          services_offered: string[] | null
          setup_time_minutes: number | null
          slug: string | null
          stripe_account_id: string | null
          total_bookings: number | null
          total_earnings: number | null
          total_gigs: number | null
          travel_radius: string | null
          updated_at: string | null
          user_id: string
          vendor_type: string
          years_experience: number | null
        }
        Insert: {
          availability_notes?: string | null
          average_rating?: number | null
          bank_account_holder_name?: string | null
          bank_name?: string | null
          base_rate?: number | null
          bio?: string | null
          compatible_features?: string[] | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: number | null
          deposit_terms?: string | null
          deposit_type?: string | null
          hourly_rate?: number | null
          id?: string
          is_published?: boolean | null
          languages?: string[] | null
          minimum_hours?: number | null
          name: string
          payout_enabled?: boolean | null
          per_head_kickback?: number | null
          per_person_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          pricing_model?: string | null
          rating?: number | null
          regions_served?: string | null
          requires_deposit?: boolean | null
          review_count?: number | null
          service_area?: string | null
          service_type?: string | null
          services_offered?: string[] | null
          setup_time_minutes?: number | null
          slug?: string | null
          stripe_account_id?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          total_gigs?: number | null
          travel_radius?: string | null
          updated_at?: string | null
          user_id: string
          vendor_type: string
          years_experience?: number | null
        }
        Update: {
          availability_notes?: string | null
          average_rating?: number | null
          bank_account_holder_name?: string | null
          bank_name?: string | null
          base_rate?: number | null
          bio?: string | null
          compatible_features?: string[] | null
          created_at?: string | null
          deposit_amount?: number | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: number | null
          deposit_terms?: string | null
          deposit_type?: string | null
          hourly_rate?: number | null
          id?: string
          is_published?: boolean | null
          languages?: string[] | null
          minimum_hours?: number | null
          name?: string
          payout_enabled?: boolean | null
          per_head_kickback?: number | null
          per_person_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          pricing_model?: string | null
          rating?: number | null
          regions_served?: string | null
          requires_deposit?: boolean | null
          review_count?: number | null
          service_area?: string | null
          service_type?: string | null
          services_offered?: string[] | null
          setup_time_minutes?: number | null
          slug?: string | null
          stripe_account_id?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          total_gigs?: number | null
          travel_radius?: string | null
          updated_at?: string | null
          user_id?: string
          vendor_type?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_requirements: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_required: boolean | null
          requirement_type: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_required?: boolean | null
          requirement_type?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_required?: boolean | null
          requirement_type?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_requirements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_stripe_accounts: {
        Row: {
          account_status: string
          charges_enabled: boolean
          created_at: string
          id: string
          payouts_enabled: boolean
          requirements_due: Json
          stripe_account_id: string | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          account_status?: string
          charges_enabled?: boolean
          created_at?: string
          id?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          account_status?: string
          charges_enabled?: boolean
          created_at?: string
          id?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_stripe_accounts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_amenities: {
        Row: {
          amenity_name: string | null
          amenity_type: string | null
          amenity_type_id: string | null
          created_at: string | null
          custom_amenity_name: string | null
          description: string | null
          id: string
          venue_id: string
        }
        Insert: {
          amenity_name?: string | null
          amenity_type?: string | null
          amenity_type_id?: string | null
          created_at?: string | null
          custom_amenity_name?: string | null
          description?: string | null
          id?: string
          venue_id: string
        }
        Update: {
          amenity_name?: string | null
          amenity_type?: string | null
          amenity_type_id?: string | null
          created_at?: string | null
          custom_amenity_name?: string | null
          description?: string | null
          id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_amenities_amenity_type_id_fkey"
            columns: ["amenity_type_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenities_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_amenity_types: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          display_order: number
          icon: string
          id: string
          name: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          display_order?: number
          icon?: string
          id?: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          display_order?: number
          icon?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      venue_booking_approval_audit: {
        Row: {
          action: string
          actor_id: string | null
          booking_id: string
          created_at: string | null
          id: string
          message: string | null
          metadata: Json | null
          new_status: string
          previous_status: string | null
          venue_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          booking_id: string
          created_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          new_status: string
          previous_status?: string | null
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          booking_id?: string
          created_at?: string | null
          id?: string
          message?: string | null
          metadata?: Json | null
          new_status?: string
          previous_status?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_booking_approval_audit_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "venue_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_booking_approval_audit_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_bookings: {
        Row: {
          approval_source: string | null
          approved_at: string | null
          booking_date: string
          created_at: string | null
          decline_reason: string | null
          end_time: string | null
          event_id: string
          final_price: number | null
          guest_count_max: number | null
          guest_count_min: number | null
          id: string
          organizer_id: string
          paid_at: string | null
          payment_status: string | null
          platform_fee_amount: number | null
          platform_fee_percentage: number | null
          quoted_price: number | null
          rejection_reason: string | null
          responded_at: string | null
          services_needed: Json | null
          special_requests: string | null
          start_time: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          subtotal: number | null
          total_amount: number | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          approval_source?: string | null
          approved_at?: string | null
          booking_date: string
          created_at?: string | null
          decline_reason?: string | null
          end_time?: string | null
          event_id: string
          final_price?: number | null
          guest_count_max?: number | null
          guest_count_min?: number | null
          id?: string
          organizer_id: string
          paid_at?: string | null
          payment_status?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quoted_price?: number | null
          rejection_reason?: string | null
          responded_at?: string | null
          services_needed?: Json | null
          special_requests?: string | null
          start_time?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          approval_source?: string | null
          approved_at?: string | null
          booking_date?: string
          created_at?: string | null
          decline_reason?: string | null
          end_time?: string | null
          event_id?: string
          final_price?: number | null
          guest_count_max?: number | null
          guest_count_min?: number | null
          id?: string
          organizer_id?: string
          paid_at?: string | null
          payment_status?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quoted_price?: number | null
          rejection_reason?: string | null
          responded_at?: string | null
          services_needed?: Json | null
          special_requests?: string | null
          start_time?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_bookings_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_kickback_configs: {
        Row: {
          active: boolean | null
          applies_to_days_of_week: number[] | null
          applies_to_event_types: string[] | null
          auto_payout_enabled: boolean | null
          baseline_calculation_method: string | null
          baseline_window_weeks: number | null
          bonus_per_person: number | null
          bonus_threshold: number | null
          created_at: string | null
          flat_base_fee: number | null
          id: string
          kickback_model: string
          lift_share_percentage: number | null
          maximum_payout: number | null
          minimum_attendees: number | null
          minimum_lift_amount: number | null
          notes: string | null
          payment_terms: string | null
          per_head_amount: number | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          active?: boolean | null
          applies_to_days_of_week?: number[] | null
          applies_to_event_types?: string[] | null
          auto_payout_enabled?: boolean | null
          baseline_calculation_method?: string | null
          baseline_window_weeks?: number | null
          bonus_per_person?: number | null
          bonus_threshold?: number | null
          created_at?: string | null
          flat_base_fee?: number | null
          id?: string
          kickback_model: string
          lift_share_percentage?: number | null
          maximum_payout?: number | null
          minimum_attendees?: number | null
          minimum_lift_amount?: number | null
          notes?: string | null
          payment_terms?: string | null
          per_head_amount?: number | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          active?: boolean | null
          applies_to_days_of_week?: number[] | null
          applies_to_event_types?: string[] | null
          auto_payout_enabled?: boolean | null
          baseline_calculation_method?: string | null
          baseline_window_weeks?: number | null
          bonus_per_person?: number | null
          bonus_threshold?: number | null
          created_at?: string | null
          flat_base_fee?: number | null
          id?: string
          kickback_model?: string
          lift_share_percentage?: number | null
          maximum_payout?: number | null
          minimum_attendees?: number | null
          minimum_lift_amount?: number | null
          notes?: string | null
          payment_terms?: string | null
          per_head_amount?: number | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_kickback_configs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_photos: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_primary: boolean | null
          photo_url: string
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_primary?: boolean | null
          photo_url: string
          venue_id: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_primary?: boolean | null
          photo_url?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_photos_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_requirements: {
        Row: {
          created_at: string | null
          custom_question: string | null
          description: string | null
          id: string
          is_required: boolean | null
          minimum_liability_coverage: number | null
          requirement_type: string | null
          requires_additional_insured: boolean | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          custom_question?: string | null
          description?: string | null
          id?: string
          is_required?: boolean | null
          minimum_liability_coverage?: number | null
          requirement_type?: string | null
          requires_additional_insured?: boolean | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          custom_question?: string | null
          description?: string | null
          id?: string
          is_required?: boolean | null
          minimum_liability_coverage?: number | null
          requirement_type?: string | null
          requires_additional_insured?: boolean | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_requirements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_rules: {
        Row: {
          applies_to: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_mandatory: boolean | null
          rule_type: string | null
          rules_text: string | null
          title: string | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          applies_to?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_mandatory?: boolean | null
          rule_type?: string | null
          rules_text?: string | null
          title?: string | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          applies_to?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_mandatory?: boolean | null
          rule_type?: string | null
          rules_text?: string | null
          title?: string | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_rules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_stripe_accounts: {
        Row: {
          account_status: string
          charges_enabled: boolean
          created_at: string
          id: string
          owner_id: string
          payouts_enabled: boolean
          requirements_due: Json
          stripe_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          charges_enabled?: boolean
          created_at?: string
          id?: string
          owner_id: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          charges_enabled?: boolean
          created_at?: string
          id?: string
          owner_id?: string
          payouts_enabled?: boolean
          requirements_due?: Json
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_stripe_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          auto_approve_conditions: Json | null
          auto_approve_threshold: number | null
          average_rating: number | null
          bar_revenue_percentage: number | null
          bar_revenue_share_enabled: boolean | null
          bar_revenue_share_percent: number | null
          bulk_approval_enabled: boolean | null
          city: string | null
          created_at: string | null
          default_kickback_type: string | null
          deposit_amount: number | null
          deposit_due: string | null
          deposit_percentage: number | null
          deposit_refundable: boolean | null
          deposit_terms: string | null
          deposit_type: string | null
          description: string | null
          hourly_rate: number | null
          id: string
          is_published: boolean | null
          latitude: number | null
          longitude: number | null
          minimum_hours: number | null
          offers_kickbacks: boolean | null
          owner_id: string
          per_head_kickback: number | null
          per_head_kickback_amount: number | null
          pricing_model: string | null
          requires_deposit: boolean | null
          seated_capacity: number | null
          slug: string | null
          square_footage: number | null
          standing_capacity: number | null
          state: string | null
          stripe_account_id: string | null
          ticket_sales_share_enabled: boolean | null
          ticket_sales_share_percent: number | null
          total_bookings: number | null
          unique_features: string | null
          unique_features_tags: string[] | null
          updated_at: string | null
          venue_name: string
          venue_type: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          auto_approve_conditions?: Json | null
          auto_approve_threshold?: number | null
          average_rating?: number | null
          bar_revenue_percentage?: number | null
          bar_revenue_share_enabled?: boolean | null
          bar_revenue_share_percent?: number | null
          bulk_approval_enabled?: boolean | null
          city?: string | null
          created_at?: string | null
          default_kickback_type?: string | null
          deposit_amount?: number | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_terms?: string | null
          deposit_type?: string | null
          description?: string | null
          hourly_rate?: number | null
          id?: string
          is_published?: boolean | null
          latitude?: number | null
          longitude?: number | null
          minimum_hours?: number | null
          offers_kickbacks?: boolean | null
          owner_id: string
          per_head_kickback?: number | null
          per_head_kickback_amount?: number | null
          pricing_model?: string | null
          requires_deposit?: boolean | null
          seated_capacity?: number | null
          slug?: string | null
          square_footage?: number | null
          standing_capacity?: number | null
          state?: string | null
          stripe_account_id?: string | null
          ticket_sales_share_enabled?: boolean | null
          ticket_sales_share_percent?: number | null
          total_bookings?: number | null
          unique_features?: string | null
          unique_features_tags?: string[] | null
          updated_at?: string | null
          venue_name: string
          venue_type?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          auto_approve_conditions?: Json | null
          auto_approve_threshold?: number | null
          average_rating?: number | null
          bar_revenue_percentage?: number | null
          bar_revenue_share_enabled?: boolean | null
          bar_revenue_share_percent?: number | null
          bulk_approval_enabled?: boolean | null
          city?: string | null
          created_at?: string | null
          default_kickback_type?: string | null
          deposit_amount?: number | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_terms?: string | null
          deposit_type?: string | null
          description?: string | null
          hourly_rate?: number | null
          id?: string
          is_published?: boolean | null
          latitude?: number | null
          longitude?: number | null
          minimum_hours?: number | null
          offers_kickbacks?: boolean | null
          owner_id?: string
          per_head_kickback?: number | null
          per_head_kickback_amount?: number | null
          pricing_model?: string | null
          requires_deposit?: boolean | null
          seated_capacity?: number | null
          slug?: string | null
          square_footage?: number | null
          standing_capacity?: number | null
          state?: string | null
          stripe_account_id?: string | null
          ticket_sales_share_enabled?: boolean | null
          ticket_sales_share_percent?: number | null
          total_bookings?: number | null
          unique_features?: string | null
          unique_features_tags?: string[] | null
          updated_at?: string | null
          venue_name?: string
          venue_type?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_rate_limits: {
        Row: {
          rate_limit_key: string
          request_count: number
          reset_at: string
        }
        Insert: {
          rate_limit_key: string
          request_count?: number
          reset_at: string
        }
        Update: {
          rate_limit_key?: string
          request_count?: number
          reset_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_builder_savings: {
        Args: { p_builder_id: string; p_month: string }
        Returns: number
      }
      calculate_event_kickback: { Args: { p_event_id: string }; Returns: Json }
      calculate_platform_fee: {
        Args: { booking_amount: number; user_id: string }
        Returns: {
          fee_amount: number
          fee_percentage: number
          total_amount: number
        }[]
      }
      claim_app_jobs: {
        Args: { p_limit?: number; p_worker_id?: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_type: string
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          scheduled_at: string
          started_at: string | null
          status: string
          unique_key: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "app_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_webhook_rate_limit: {
        Args: { p_key: string; p_limit?: number; p_window_seconds?: number }
        Returns: boolean
      }
      get_event_kickback_summary: {
        Args: { p_event_id: string }
        Returns: Json
      }
      get_vendor_booking_calendar_date: {
        Args: {
          p_booking: Database["public"]["Tables"]["vendor_bookings"]["Row"]
        }
        Returns: string
      }
      increment_event_usage: {
        Args: { p_builder_id: string; p_fee_paid: number; p_month: string }
        Returns: undefined
      }
      insert_grouped_notification: {
        Args: {
          p_group_key?: string
          p_link?: string
          p_message: string
          p_metadata?: Json
          p_related_id?: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      recalculate_vendor_review_stats: {
        Args: { p_vendor_id: string }
        Returns: undefined
      }
      save_vendor_manual_availability: {
        Args: {
          p_dates: string[]
          p_notes?: string
          p_status: string
          p_vendor_id: string
        }
        Returns: {
          booking_id: string | null
          created_at: string | null
          date: string
          id: string
          notes: string | null
          status: string
          updated_at: string | null
          vendor_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "vendor_availability"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

