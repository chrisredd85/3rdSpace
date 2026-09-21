export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: []
      }
      admin_tasks: {
        Row: {
          agent_action_id: string | null
          approval_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          outcome_payload: Json
          plan_id: string
          priority: string
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          agent_action_id?: string | null
          approval_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description: string
          due_at?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          outcome_payload?: Json
          plan_id: string
          priority?: string
          status?: string
          task_type: string
          updated_at?: string
        }
        Update: {
          agent_action_id?: string | null
          approval_id?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string
          due_at?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          outcome_payload?: Json
          plan_id?: string
          priority?: string
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_tasks_action_plan_consistency_fkey"
            columns: ["agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "admin_tasks_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_tasks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_action_audit_log: {
        Row: {
          action_id: string | null
          actor_id: string | null
          actor_role: string
          created_at: string
          from_status: string | null
          id: string
          metadata: Json
          plan_id: string | null
          reason: string
          to_status: string
        }
        Insert: {
          action_id?: string | null
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          plan_id?: string | null
          reason: string
          to_status: string
        }
        Update: {
          action_id?: string | null
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          plan_id?: string | null
          reason?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_audit_log_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_audit_log_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_actions: {
        Row: {
          action_type: string
          amount_cents: number | null
          approval_id: string | null
          created_at: string
          currency: string
          description: string
          executed_at: string | null
          id: string
          last_retry_completed_at: string | null
          last_retry_idempotency_key: string | null
          last_retry_result: Json | null
          last_retry_started_at: string | null
          last_retry_status: string | null
          payload_json: Json
          plan_id: string
          provider: string | null
          result_metadata: Json
          status: string
          target_id: string | null
          target_type: string | null
          updated_at: string
        }
        Insert: {
          action_type: string
          amount_cents?: number | null
          approval_id?: string | null
          created_at?: string
          currency?: string
          description: string
          executed_at?: string | null
          id?: string
          last_retry_completed_at?: string | null
          last_retry_idempotency_key?: string | null
          last_retry_result?: Json | null
          last_retry_started_at?: string | null
          last_retry_status?: string | null
          payload_json?: Json
          plan_id: string
          provider?: string | null
          result_metadata?: Json
          status?: string
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          amount_cents?: number | null
          approval_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          executed_at?: string | null
          id?: string
          last_retry_completed_at?: string | null
          last_retry_idempotency_key?: string | null
          last_retry_result?: Json | null
          last_retry_started_at?: string | null
          last_retry_status?: string | null
          payload_json?: Json
          plan_id?: string
          provider?: string | null
          result_metadata?: Json
          status?: string
          target_id?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_authorizations: {
        Row: {
          approved_vendor_ids: string[]
          auto_approve_under_cents: number | null
          created_at: string
          id: string
          monthly_spend_cap_cents: number | null
          pause_agent_spending: boolean
          plan_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_vendor_ids?: string[]
          auto_approve_under_cents?: number | null
          created_at?: string
          id?: string
          monthly_spend_cap_cents?: number | null
          pause_agent_spending?: boolean
          plan_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_vendor_ids?: string[]
          auto_approve_under_cents?: number | null
          created_at?: string
          id?: string
          monthly_spend_cap_cents?: number | null
          pause_agent_spending?: boolean
          plan_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_authorizations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_authorizations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_name: string
          completion_tokens: number | null
          created_at: string
          duration_ms: number
          error: string | null
          event_id: string | null
          id: string
          input_payload: Json
          messages_payload: Json | null
          model: string
          output_payload: Json | null
          plan_id: string | null
          prompt_tokens: number | null
          quality_label: string | null
          raw_model_output: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          agent_name: string
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number
          error?: string | null
          event_id?: string | null
          id?: string
          input_payload?: Json
          messages_payload?: Json | null
          model?: string
          output_payload?: Json | null
          plan_id?: string | null
          prompt_tokens?: number | null
          quality_label?: string | null
          raw_model_output?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          agent_name?: string
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number
          error?: string | null
          event_id?: string | null
          id?: string
          input_payload?: Json
          messages_payload?: Json | null
          model?: string
          output_payload?: Json | null
          plan_id?: string | null
          prompt_tokens?: number | null
          quality_label?: string | null
          raw_model_output?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
      approvals: {
        Row: {
          action_label: string
          agent_action_id: string
          approval_type: string | null
          approved_at: string | null
          approved_by: string | null
          authorized_amount_cents: number | null
          authorized_at: string | null
          authorized_by: string | null
          cancellation_terms: string | null
          created_at: string
          delivery_email: string | null
          event_date: string | null
          expires_at: string | null
          fees_cents: number | null
          id: string
          notes: string | null
          package_details: string | null
          payment_method_id: string | null
          plan_id: string
          price_cents: number | null
          provider: string | null
          refund_terms: string | null
          requested_amount_cents: number
          root_approval_id: string
          settlement_run_id: string | null
          snapshot_hash: string | null
          snapshot_json: Json | null
          snapshot_schema_version: number | null
          status: string
          superseded_at: string | null
          superseded_by_approval_id: string | null
          superseded_by_revision_id: string | null
          superseded_reason: string | null
          supersedes_approval_id: string | null
          updated_at: string
          version_created_by: string | null
          version_number: number
          version_reason: string | null
        }
        Insert: {
          action_label: string
          agent_action_id: string
          approval_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorized_amount_cents?: number | null
          authorized_at?: string | null
          authorized_by?: string | null
          cancellation_terms?: string | null
          created_at?: string
          delivery_email?: string | null
          event_date?: string | null
          expires_at?: string | null
          fees_cents?: number | null
          id?: string
          notes?: string | null
          package_details?: string | null
          payment_method_id?: string | null
          plan_id: string
          price_cents?: number | null
          provider?: string | null
          refund_terms?: string | null
          requested_amount_cents?: number
          root_approval_id: string
          settlement_run_id?: string | null
          snapshot_hash?: string | null
          snapshot_json?: Json | null
          snapshot_schema_version?: number | null
          status?: string
          superseded_at?: string | null
          superseded_by_approval_id?: string | null
          superseded_by_revision_id?: string | null
          superseded_reason?: string | null
          supersedes_approval_id?: string | null
          updated_at?: string
          version_created_by?: string | null
          version_number?: number
          version_reason?: string | null
        }
        Update: {
          action_label?: string
          agent_action_id?: string
          approval_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorized_amount_cents?: number | null
          authorized_at?: string | null
          authorized_by?: string | null
          cancellation_terms?: string | null
          created_at?: string
          delivery_email?: string | null
          event_date?: string | null
          expires_at?: string | null
          fees_cents?: number | null
          id?: string
          notes?: string | null
          package_details?: string | null
          payment_method_id?: string | null
          plan_id?: string
          price_cents?: number | null
          provider?: string | null
          refund_terms?: string | null
          requested_amount_cents?: number
          root_approval_id?: string
          settlement_run_id?: string | null
          snapshot_hash?: string | null
          snapshot_json?: Json | null
          snapshot_schema_version?: number | null
          status?: string
          superseded_at?: string | null
          superseded_by_approval_id?: string | null
          superseded_by_revision_id?: string | null
          superseded_reason?: string | null
          supersedes_approval_id?: string | null
          updated_at?: string
          version_created_by?: string | null
          version_number?: number
          version_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_action_plan_consistency_fkey"
            columns: ["agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "approvals_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_root_plan_fkey"
            columns: ["root_approval_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "approvals_settlement_run_id_fkey"
            columns: ["settlement_run_id"]
            isOneToOne: false
            referencedRelation: "settlement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_superseded_by_plan_fkey"
            columns: ["superseded_by_approval_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "approvals_superseded_by_revision_id_fkey"
            columns: ["superseded_by_revision_id"]
            isOneToOne: false
            referencedRelation: "plan_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_supersedes_plan_fkey"
            columns: ["supersedes_approval_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "plan_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          plan_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          plan_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          plan_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      builder_event_access_consumptions: {
        Row: {
          amount: number
          amount_cents: number
          builder_id: string
          created_at: string
          event_id: string
          id: string
          source: string
          source_metadata: Json
          updated_at: string
        }
        Insert: {
          amount?: number
          amount_cents?: number
          builder_id: string
          created_at?: string
          event_id: string
          id?: string
          source: string
          source_metadata?: Json
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_cents?: number
          builder_id?: string
          created_at?: string
          event_id?: string
          id?: string
          source?: string
          source_metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_event_access_consumptions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_event_access_consumptions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_event_materializations: {
        Row: {
          builder_id: string
          consumption_id: string | null
          created_at: string
          event_id: string | null
          id: string
          idempotency_key: string
          materialized_at: string | null
          payload_hash: string
          plan_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          builder_id: string
          consumption_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          idempotency_key: string
          materialized_at?: string | null
          payload_hash: string
          plan_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          builder_id?: string
          consumption_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          idempotency_key?: string
          materialized_at?: string | null
          payload_hash?: string
          plan_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_event_materializations_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_event_materializations_consumption_id_fkey"
            columns: ["consumption_id"]
            isOneToOne: true
            referencedRelation: "builder_event_access_consumptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_event_materializations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_event_materializations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_event_materializations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_event_usage: {
        Row: {
          builder_id: string | null
          could_have_saved: number | null
          events_booked: number | null
          id: string
          month: string
          total_fees_paid: number | null
        }
        Insert: {
          builder_id?: string | null
          could_have_saved?: number | null
          events_booked?: number | null
          id?: string
          month: string
          total_fees_paid?: number | null
        }
        Update: {
          builder_id?: string | null
          could_have_saved?: number | null
          events_booked?: number | null
          id?: string
          month?: string
          total_fees_paid?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_event_usage_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_payment_methods: {
        Row: {
          builder_id: string | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          stripe_payment_method_id: string
          updated_at: string | null
        }
        Insert: {
          builder_id?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          stripe_payment_method_id: string
          updated_at?: string | null
        }
        Update: {
          builder_id?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          stripe_payment_method_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_payment_methods_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_profiles: {
        Row: {
          billing_tier: string | null
          bio: string | null
          bulk_booking_enabled: boolean
          created_at: string | null
          event_types: string[] | null
          eventbrite_connected: boolean | null
          eventbrite_organizer_id: string | null
          free_events_granted: number | null
          free_events_used: number | null
          id: string
          invite_collaborators: string[]
          luma_calendar_id: string | null
          luma_connected: boolean | null
          name: string
          organization_name: string | null
          organization_type: string | null
          paid_event_credits: number | null
          phone: string | null
          photo_url: string | null
          posh_connected: boolean | null
          posh_organizer_id: string | null
          preferred_ticket_platforms: string[] | null
          priorities: string[] | null
          signup_metadata: Json
          social_handle: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_started_at: string | null
          subscription_status: string | null
          total_attendance: number | null
          total_events_hosted: number | null
          typical_attendance_max: number | null
          typical_attendance_min: number | null
          updated_at: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          billing_tier?: string | null
          bio?: string | null
          bulk_booking_enabled?: boolean
          created_at?: string | null
          event_types?: string[] | null
          eventbrite_connected?: boolean | null
          eventbrite_organizer_id?: string | null
          free_events_granted?: number | null
          free_events_used?: number | null
          id?: string
          invite_collaborators?: string[]
          luma_calendar_id?: string | null
          luma_connected?: boolean | null
          name: string
          organization_name?: string | null
          organization_type?: string | null
          paid_event_credits?: number | null
          phone?: string | null
          photo_url?: string | null
          posh_connected?: boolean | null
          posh_organizer_id?: string | null
          preferred_ticket_platforms?: string[] | null
          priorities?: string[] | null
          signup_metadata?: Json
          social_handle?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          total_attendance?: number | null
          total_events_hosted?: number | null
          typical_attendance_max?: number | null
          typical_attendance_min?: number | null
          updated_at?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          billing_tier?: string | null
          bio?: string | null
          bulk_booking_enabled?: boolean
          created_at?: string | null
          event_types?: string[] | null
          eventbrite_connected?: boolean | null
          eventbrite_organizer_id?: string | null
          free_events_granted?: number | null
          free_events_used?: number | null
          id?: string
          invite_collaborators?: string[]
          luma_calendar_id?: string | null
          luma_connected?: boolean | null
          name?: string
          organization_name?: string | null
          organization_type?: string | null
          paid_event_credits?: number | null
          phone?: string | null
          photo_url?: string | null
          posh_connected?: boolean | null
          posh_organizer_id?: string | null
          preferred_ticket_platforms?: string[] | null
          priorities?: string[] | null
          signup_metadata?: Json
          social_handle?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_started_at?: string | null
          subscription_status?: string | null
          total_attendance?: number | null
          total_events_hosted?: number | null
          typical_attendance_max?: number | null
          typical_attendance_min?: number | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
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
          disabled_reason: string | null
          id: string
          last_webhook_at: string | null
          last_webhook_event_id: string | null
          last_webhook_event_type: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
          builder_id: string | null
          cancel_at: string | null
          cancel_at_period_end: boolean | null
          canceled_at: string | null
          cancelled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          events_used_this_period: number | null
          id: string
          plan_id: string | null
          plan_type: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          builder_id?: string | null
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          events_used_this_period?: number | null
          id?: string
          plan_id?: string | null
          plan_type?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          builder_id?: string | null
          cancel_at?: string | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          events_used_this_period?: number | null
          id?: string
          plan_id?: string | null
          plan_type?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_subscriptions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
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
          last_webhook_event_type: string | null
          last_webhook_received_at: string | null
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
          last_webhook_event_type?: string | null
          last_webhook_received_at?: string | null
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
          last_webhook_event_type?: string | null
          last_webhook_received_at?: string | null
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
      canonical_booking_partner_bindings: {
        Row: {
          agent_action_id: string
          approval_id: string
          approval_snapshot_hash: string
          binding_source: string
          booking_kind: string
          bound_at: string
          bound_by: string | null
          discovery_partner_id: string
          id: string
          physical_partner_id: string
          plan_id: string
        }
        Insert: {
          agent_action_id: string
          approval_id: string
          approval_snapshot_hash: string
          binding_source?: string
          booking_kind: string
          bound_at?: string
          bound_by?: string | null
          discovery_partner_id: string
          id?: string
          physical_partner_id: string
          plan_id: string
        }
        Update: {
          agent_action_id?: string
          approval_id?: string
          approval_snapshot_hash?: string
          binding_source?: string
          booking_kind?: string
          bound_at?: string
          bound_by?: string | null
          discovery_partner_id?: string
          id?: string
          physical_partner_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_booking_partner_bindings_action_plan_fkey"
            columns: ["agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "canonical_booking_partner_bindings_approval_plan_fkey"
            columns: ["approval_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "canonical_booking_partner_bindings_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      chi_network_defaults: {
        Row: {
          archetype: string
          created_at: string
          id: string
          neighborhood: string
          per_attendee_cents: number
          sample_size: number
          source: string
          updated_at: string
          venue_type: string
        }
        Insert: {
          archetype: string
          created_at?: string
          id?: string
          neighborhood: string
          per_attendee_cents: number
          sample_size?: number
          source?: string
          updated_at?: string
          venue_type: string
        }
        Update: {
          archetype?: string
          created_at?: string
          id?: string
          neighborhood?: string
          per_attendee_cents?: number
          sample_size?: number
          source?: string
          updated_at?: string
          venue_type?: string
        }
        Relationships: []
      }
      chi_rate_history: {
        Row: {
          archetype: string
          created_at: string
          derived_from_event_count: number
          effective_from: string
          id: string
          movement_bucket: string | null
          movement_pct: number | null
          organizer_id: string
          per_attendee_cents: number
          superseded_at: string | null
          venue_type: string
        }
        Insert: {
          archetype: string
          created_at?: string
          derived_from_event_count: number
          effective_from?: string
          id?: string
          movement_bucket?: string | null
          movement_pct?: number | null
          organizer_id: string
          per_attendee_cents: number
          superseded_at?: string | null
          venue_type: string
        }
        Update: {
          archetype?: string
          created_at?: string
          derived_from_event_count?: number
          effective_from?: string
          id?: string
          movement_bucket?: string | null
          movement_pct?: number | null
          organizer_id?: string
          per_attendee_cents?: number
          superseded_at?: string | null
          venue_type?: string
        }
        Relationships: []
      }
      chi_trueup_manual_review: {
        Row: {
          applied: boolean
          applied_rate_cents: number | null
          archetype: string
          created_at: string
          current_rate_cents: number
          derived_from_event_count: number
          id: string
          movement_bucket: string
          movement_pct: number
          organizer_id: string
          proposed_rate_cents: number
          reason: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          triggering_settlement_run_id: string | null
          venue_id: string
          venue_type: string
        }
        Insert: {
          applied?: boolean
          applied_rate_cents?: number | null
          archetype: string
          created_at?: string
          current_rate_cents: number
          derived_from_event_count?: number
          id?: string
          movement_bucket: string
          movement_pct: number
          organizer_id: string
          proposed_rate_cents: number
          reason: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          triggering_settlement_run_id?: string | null
          venue_id: string
          venue_type: string
        }
        Update: {
          applied?: boolean
          applied_rate_cents?: number | null
          archetype?: string
          created_at?: string
          current_rate_cents?: number
          derived_from_event_count?: number
          id?: string
          movement_bucket?: string
          movement_pct?: number
          organizer_id?: string
          proposed_rate_cents?: number
          reason?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          triggering_settlement_run_id?: string | null
          venue_id?: string
          venue_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chi_trueup_manual_review_triggering_settlement_run_id_fkey"
            columns: ["triggering_settlement_run_id"]
            isOneToOne: false
            referencedRelation: "settlement_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chi_trueup_manual_review_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      community_host_incentive_agreements: {
        Row: {
          agreement_type: string
          approval_id: string | null
          approved_at: string | null
          approved_by_venue_user_id: string | null
          base_amount_cents: number | null
          created_at: string
          dispute_deadline_at: string | null
          dispute_status: string
          event_id: string | null
          fixed_amount_cents: number | null
          id: string
          is_legacy_consumption_share: boolean
          is_legacy_revenue_share: boolean
          metadata: Json
          organizer_user_id: string
          payout_cap_cents: number | null
          payout_floor_cents: number | null
          per_head_rate_cents: number | null
          plan_id: string | null
          settlement_due_at: string | null
          settlement_mode: string
          status: string
          threshold_attendees: number | null
          updated_at: string
          venue_approved: boolean
          venue_id: string
          venue_owner_user_id: string
        }
        Insert: {
          agreement_type: string
          approval_id?: string | null
          approved_at?: string | null
          approved_by_venue_user_id?: string | null
          base_amount_cents?: number | null
          created_at?: string
          dispute_deadline_at?: string | null
          dispute_status?: string
          event_id?: string | null
          fixed_amount_cents?: number | null
          id?: string
          is_legacy_consumption_share?: boolean
          is_legacy_revenue_share?: boolean
          metadata?: Json
          organizer_user_id: string
          payout_cap_cents?: number | null
          payout_floor_cents?: number | null
          per_head_rate_cents?: number | null
          plan_id?: string | null
          settlement_due_at?: string | null
          settlement_mode?: string
          status?: string
          threshold_attendees?: number | null
          updated_at?: string
          venue_approved?: boolean
          venue_id: string
          venue_owner_user_id: string
        }
        Update: {
          agreement_type?: string
          approval_id?: string | null
          approved_at?: string | null
          approved_by_venue_user_id?: string | null
          base_amount_cents?: number | null
          created_at?: string
          dispute_deadline_at?: string | null
          dispute_status?: string
          event_id?: string | null
          fixed_amount_cents?: number | null
          id?: string
          is_legacy_consumption_share?: boolean
          is_legacy_revenue_share?: boolean
          metadata?: Json
          organizer_user_id?: string
          payout_cap_cents?: number | null
          payout_floor_cents?: number | null
          per_head_rate_cents?: number | null
          plan_id?: string | null
          settlement_due_at?: string | null
          settlement_mode?: string
          status?: string
          threshold_attendees?: number | null
          updated_at?: string
          venue_approved?: boolean
          venue_id?: string
          venue_owner_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_host_incentive_agreeme_approved_by_venue_user_id_fkey"
            columns: ["approved_by_venue_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_venue_owner_user_id_fkey"
            columns: ["venue_owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_host_incentive_settlements: {
        Row: {
          agreement_id: string
          applied_cap: boolean
          applied_floor: boolean
          approval_id: string | null
          calculation_basis: string
          created_at: string
          due_at: string | null
          event_id: string | null
          id: string
          is_legacy_consumption_share: boolean
          is_legacy_revenue_share: boolean
          metadata: Json
          organizer_payout_cents: number
          paid_at: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_transfer_id: string | null
          updated_at: string
          verification_source: string
          verification_source_id: string | null
          verified_attendees: number
        }
        Insert: {
          agreement_id: string
          applied_cap?: boolean
          applied_floor?: boolean
          approval_id?: string | null
          calculation_basis: string
          created_at?: string
          due_at?: string | null
          event_id?: string | null
          id?: string
          is_legacy_consumption_share?: boolean
          is_legacy_revenue_share?: boolean
          metadata?: Json
          organizer_payout_cents: number
          paid_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
          verification_source: string
          verification_source_id?: string | null
          verified_attendees: number
        }
        Update: {
          agreement_id?: string
          applied_cap?: boolean
          applied_floor?: boolean
          approval_id?: string | null
          calculation_basis?: string
          created_at?: string
          due_at?: string | null
          event_id?: string | null
          id?: string
          is_legacy_consumption_share?: boolean
          is_legacy_revenue_share?: boolean
          metadata?: Json
          organizer_payout_cents?: number
          paid_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_transfer_id?: string | null
          updated_at?: string
          verification_source?: string
          verification_source_id?: string | null
          verified_attendees?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_host_incentive_settlements_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "community_host_incentive_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_settlements_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_actions: {
        Row: {
          action_type: string
          admin_user_id: string | null
          created_at: string
          id: string
          invite_id: string
          notes: string | null
          outcome_payload: Json
        }
        Insert: {
          action_type: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          invite_id: string
          notes?: string | null
          outcome_payload?: Json
        }
        Update: {
          action_type?: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          invite_id?: string
          notes?: string | null
          outcome_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "concierge_actions_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "venue_opportunity_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_email_accounts: {
        Row: {
          created_at: string
          email_address: string
          history_id: string | null
          id: string
          label_id: string | null
          oauth_access_token: string
          oauth_refresh_token: string
          provider: string
          revoked_at: string | null
          token_expires_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email_address: string
          history_id?: string | null
          id?: string
          label_id?: string | null
          oauth_access_token: string
          oauth_refresh_token: string
          provider?: string
          revoked_at?: string | null
          token_expires_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email_address?: string
          history_id?: string | null
          id?: string
          label_id?: string | null
          oauth_access_token?: string
          oauth_refresh_token?: string
          provider?: string
          revoked_at?: string | null
          token_expires_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_email_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_outreach_policies: {
        Row: {
          allowed_autonomous_actions: string[]
          blacklisted_keywords: string[]
          blacklisted_venue_ids: string[]
          created_at: string
          id: string
          irreversible_autonomous_actions: string[]
          max_followups_per_thread: number
          max_inquiries_per_event: number
          max_unattended_budget_cents: number
          quiet_hours_end_local: string | null
          quiet_hours_start_local: string | null
          require_approval_for_first_contact: boolean
          trust_level: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          allowed_autonomous_actions?: string[]
          blacklisted_keywords?: string[]
          blacklisted_venue_ids?: string[]
          created_at?: string
          id?: string
          irreversible_autonomous_actions?: string[]
          max_followups_per_thread?: number
          max_inquiries_per_event?: number
          max_unattended_budget_cents?: number
          quiet_hours_end_local?: string | null
          quiet_hours_start_local?: string | null
          require_approval_for_first_contact?: boolean
          trust_level?: number
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          allowed_autonomous_actions?: string[]
          blacklisted_keywords?: string[]
          blacklisted_venue_ids?: string[]
          created_at?: string
          id?: string
          irreversible_autonomous_actions?: string[]
          max_followups_per_thread?: number
          max_inquiries_per_event?: number
          max_unattended_budget_cents?: number
          quiet_hours_end_local?: string | null
          quiet_hours_start_local?: string | null
          require_approval_for_first_contact?: boolean
          trust_level?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "creator_outreach_policies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_outreach_trust_history: {
        Row: {
          computed_at: string
          id: string
          metrics_json: Json
          policy_id: string | null
          policy_version: number | null
          trust_level: number
          user_id: string
        }
        Insert: {
          computed_at?: string
          id?: string
          metrics_json?: Json
          policy_id?: string | null
          policy_version?: number | null
          trust_level?: number
          user_id: string
        }
        Update: {
          computed_at?: string
          id?: string
          metrics_json?: Json
          policy_id?: string | null
          policy_version?: number | null
          trust_level?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_outreach_trust_history_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "creator_outreach_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_outreach_trust_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_phone_numbers: {
        Row: {
          a2p_registration_status: string
          created_at: string
          e164_number: string
          id: string
          twilio_sid: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          a2p_registration_status?: string
          created_at?: string
          e164_number: string
          id?: string
          twilio_sid?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          a2p_registration_status?: string
          created_at?: string
          e164_number?: string
          id?: string
          twilio_sid?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_phone_numbers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          cooling_off_ends_at: string
          created_at: string
          email: string
          executed_at: string | null
          executed_by: string | null
          execution_log: Json | null
          id: string
          reason: string | null
          rejected_reason: string | null
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cooling_off_ends_at: string
          created_at?: string
          email: string
          executed_at?: string | null
          executed_by?: string | null
          execution_log?: Json | null
          id?: string
          reason?: string | null
          rejected_reason?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cooling_off_ends_at?: string
          created_at?: string
          email?: string
          executed_at?: string | null
          executed_by?: string | null
          execution_log?: Json | null
          id?: string
          reason?: string | null
          rejected_reason?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discovery_change_log: {
        Row: {
          actor_id: string | null
          applied: boolean
          applied_at: string | null
          cascade_impact: Json | null
          confidence: number
          created_at: string
          entity_id: string
          entity_type: string
          field_name: string
          id: string
          new_value: Json | null
          old_value: Json | null
          review_notes: string | null
          reviewed_by: string | null
          source: string
          source_evidence: string | null
        }
        Insert: {
          actor_id?: string | null
          applied?: boolean
          applied_at?: string | null
          cascade_impact?: Json | null
          confidence?: number
          created_at?: string
          entity_id: string
          entity_type: string
          field_name: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          review_notes?: string | null
          reviewed_by?: string | null
          source: string
          source_evidence?: string | null
        }
        Update: {
          actor_id?: string | null
          applied?: boolean
          applied_at?: string | null
          cascade_impact?: Json | null
          confidence?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          review_notes?: string | null
          reviewed_by?: string | null
          source?: string
          source_evidence?: string | null
        }
        Relationships: []
      }
      discovery_notification_log: {
        Row: {
          entity_id: string
          entity_type: string
          id: string
          notification_type: string
          sent_at: string
          source: string
          user_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          id?: string
          notification_type: string
          sent_at?: string
          source: string
          user_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          id?: string
          notification_type?: string
          sent_at?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      discovery_vendor_claims: {
        Row: {
          binding_source: string
          bound_at: string
          bound_by: string | null
          discovery_vendor_id: string
          vendor_profile_id: string
        }
        Insert: {
          binding_source?: string
          bound_at?: string
          bound_by?: string | null
          discovery_vendor_id: string
          vendor_profile_id: string
        }
        Update: {
          binding_source?: string
          bound_at?: string
          bound_by?: string | null
          discovery_vendor_id?: string
          vendor_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_vendor_claims_discovery_vendor_id_fkey"
            columns: ["discovery_vendor_id"]
            isOneToOne: true
            referencedRelation: "discovery_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_vendor_claims_vendor_profile_id_fkey"
            columns: ["vendor_profile_id"]
            isOneToOne: true
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "discovery_vendor_claims_vendor_profile_id_fkey"
            columns: ["vendor_profile_id"]
            isOneToOne: true
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_vendors: {
        Row: {
          business_status: string | null
          city: string | null
          contact_email: string | null
          created_at: string | null
          data_freshness_status: string
          extracted_contact_forms: Json
          extracted_emails: Json | null
          formatted_address: string | null
          google_place_id: string | null
          google_price_level: string | null
          google_rating: number | null
          google_user_rating_count: number | null
          id: string
          inferred_hourly_rate_cents: number | null
          inferred_minimum_cents: number | null
          inferred_package_rate_cents: number | null
          last_meaningful_change_at: string | null
          last_places_refresh_at: string | null
          last_refreshed_at: string | null
          name: string
          organizer_provided_email: string | null
          phone: string | null
          photos: Json | null
          place_types: Json | null
          rate_inference_admin_status: string | null
          rate_inference_confidence: number | null
          rate_inference_extracted_at: string | null
          rate_inference_model: string | null
          rate_inference_source_quote: string | null
          service_type: string
          source: string
          source_external_id: string | null
          state: string | null
          updated_at: string | null
          website: string | null
          website_extraction_attempted_at: string | null
          website_extraction_attempts: number
          website_extraction_metadata: Json | null
          website_extraction_status: string | null
        }
        Insert: {
          business_status?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string | null
          data_freshness_status?: string
          extracted_contact_forms?: Json
          extracted_emails?: Json | null
          formatted_address?: string | null
          google_place_id?: string | null
          google_price_level?: string | null
          google_rating?: number | null
          google_user_rating_count?: number | null
          id?: string
          inferred_hourly_rate_cents?: number | null
          inferred_minimum_cents?: number | null
          inferred_package_rate_cents?: number | null
          last_meaningful_change_at?: string | null
          last_places_refresh_at?: string | null
          last_refreshed_at?: string | null
          name: string
          organizer_provided_email?: string | null
          phone?: string | null
          photos?: Json | null
          place_types?: Json | null
          rate_inference_admin_status?: string | null
          rate_inference_confidence?: number | null
          rate_inference_extracted_at?: string | null
          rate_inference_model?: string | null
          rate_inference_source_quote?: string | null
          service_type: string
          source?: string
          source_external_id?: string | null
          state?: string | null
          updated_at?: string | null
          website?: string | null
          website_extraction_attempted_at?: string | null
          website_extraction_attempts?: number
          website_extraction_metadata?: Json | null
          website_extraction_status?: string | null
        }
        Update: {
          business_status?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string | null
          data_freshness_status?: string
          extracted_contact_forms?: Json
          extracted_emails?: Json | null
          formatted_address?: string | null
          google_place_id?: string | null
          google_price_level?: string | null
          google_rating?: number | null
          google_user_rating_count?: number | null
          id?: string
          inferred_hourly_rate_cents?: number | null
          inferred_minimum_cents?: number | null
          inferred_package_rate_cents?: number | null
          last_meaningful_change_at?: string | null
          last_places_refresh_at?: string | null
          last_refreshed_at?: string | null
          name?: string
          organizer_provided_email?: string | null
          phone?: string | null
          photos?: Json | null
          place_types?: Json | null
          rate_inference_admin_status?: string | null
          rate_inference_confidence?: number | null
          rate_inference_extracted_at?: string | null
          rate_inference_model?: string | null
          rate_inference_source_quote?: string | null
          service_type?: string
          source?: string
          source_external_id?: string | null
          state?: string | null
          updated_at?: string | null
          website?: string | null
          website_extraction_attempted_at?: string | null
          website_extraction_attempts?: number
          website_extraction_metadata?: Json | null
          website_extraction_status?: string | null
        }
        Relationships: []
      }
      discovery_venue_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          discovery_venue_id: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          discovery_venue_id: string
          event_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          discovery_venue_id?: string
          event_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discovery_venue_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_venue_events_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_venue_signals: {
        Row: {
          created_at: string
          discovery_venue_id: string | null
          event_type: string
          id: string
          latency_seconds: number | null
          thread_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          discovery_venue_id?: string | null
          event_type: string
          id?: string
          latency_seconds?: number | null
          thread_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          discovery_venue_id?: string | null
          event_type?: string
          id?: string
          latency_seconds?: number | null
          thread_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_venue_signals_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_venue_signals_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_venue_signals_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_venues: {
        Row: {
          address: string | null
          alcohol_policy: string | null
          av_available: boolean | null
          business_status: string | null
          capacity_cocktail: number | null
          capacity_inference_admin_status: string | null
          capacity_inference_confidence: number | null
          capacity_inference_extracted_at: string | null
          capacity_inference_model: string | null
          capacity_inference_source_quote: string | null
          capacity_seated: number | null
          capacity_standing: number | null
          city: string
          claimed_venue_id: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          data_freshness_status: string
          extracted_contact_forms: Json
          extracted_emails: Json | null
          google_photo_names: string[]
          google_rating: number | null
          google_user_ratings_total: number | null
          id: string
          inferred_capacity_seated: number | null
          inferred_capacity_standing: number | null
          instagram_handle: string | null
          is_claimed: boolean
          last_enriched_at: string | null
          last_meaningful_change_at: string | null
          last_places_refresh_at: string | null
          last_rescue_at: string | null
          last_verified_at: string | null
          lat: number | null
          lng: number | null
          metadata: Json
          name: string
          neighborhood: string | null
          opening_hours_json: Json
          organizer_provided_emails: Json | null
          organizer_rescue_count: number
          parking_notes: string | null
          photos: Json | null
          price_hint_cents_high: number | null
          price_hint_cents_low: number | null
          price_hint_note: string | null
          source: string
          source_external_id: string | null
          state: string
          updated_at: string
          vibe_tags: string[]
          website: string | null
          website_extraction_attempted_at: string | null
          website_extraction_attempts: number | null
          website_extraction_metadata: Json | null
          website_extraction_status: string | null
        }
        Insert: {
          address?: string | null
          alcohol_policy?: string | null
          av_available?: boolean | null
          business_status?: string | null
          capacity_cocktail?: number | null
          capacity_inference_admin_status?: string | null
          capacity_inference_confidence?: number | null
          capacity_inference_extracted_at?: string | null
          capacity_inference_model?: string | null
          capacity_inference_source_quote?: string | null
          capacity_seated?: number | null
          capacity_standing?: number | null
          city?: string
          claimed_venue_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          data_freshness_status?: string
          extracted_contact_forms?: Json
          extracted_emails?: Json | null
          google_photo_names?: string[]
          google_rating?: number | null
          google_user_ratings_total?: number | null
          id?: string
          inferred_capacity_seated?: number | null
          inferred_capacity_standing?: number | null
          instagram_handle?: string | null
          is_claimed?: boolean
          last_enriched_at?: string | null
          last_meaningful_change_at?: string | null
          last_places_refresh_at?: string | null
          last_rescue_at?: string | null
          last_verified_at?: string | null
          lat?: number | null
          lng?: number | null
          metadata?: Json
          name: string
          neighborhood?: string | null
          opening_hours_json?: Json
          organizer_provided_emails?: Json | null
          organizer_rescue_count?: number
          parking_notes?: string | null
          photos?: Json | null
          price_hint_cents_high?: number | null
          price_hint_cents_low?: number | null
          price_hint_note?: string | null
          source?: string
          source_external_id?: string | null
          state?: string
          updated_at?: string
          vibe_tags?: string[]
          website?: string | null
          website_extraction_attempted_at?: string | null
          website_extraction_attempts?: number | null
          website_extraction_metadata?: Json | null
          website_extraction_status?: string | null
        }
        Update: {
          address?: string | null
          alcohol_policy?: string | null
          av_available?: boolean | null
          business_status?: string | null
          capacity_cocktail?: number | null
          capacity_inference_admin_status?: string | null
          capacity_inference_confidence?: number | null
          capacity_inference_extracted_at?: string | null
          capacity_inference_model?: string | null
          capacity_inference_source_quote?: string | null
          capacity_seated?: number | null
          capacity_standing?: number | null
          city?: string
          claimed_venue_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          data_freshness_status?: string
          extracted_contact_forms?: Json
          extracted_emails?: Json | null
          google_photo_names?: string[]
          google_rating?: number | null
          google_user_ratings_total?: number | null
          id?: string
          inferred_capacity_seated?: number | null
          inferred_capacity_standing?: number | null
          instagram_handle?: string | null
          is_claimed?: boolean
          last_enriched_at?: string | null
          last_meaningful_change_at?: string | null
          last_places_refresh_at?: string | null
          last_rescue_at?: string | null
          last_verified_at?: string | null
          lat?: number | null
          lng?: number | null
          metadata?: Json
          name?: string
          neighborhood?: string | null
          opening_hours_json?: Json
          organizer_provided_emails?: Json | null
          organizer_rescue_count?: number
          parking_notes?: string | null
          photos?: Json | null
          price_hint_cents_high?: number | null
          price_hint_cents_low?: number | null
          price_hint_note?: string | null
          source?: string
          source_external_id?: string | null
          state?: string
          updated_at?: string
          vibe_tags?: string[]
          website?: string | null
          website_extraction_attempted_at?: string | null
          website_extraction_attempts?: number | null
          website_extraction_metadata?: Json | null
          website_extraction_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_venues_claimed_venue_id_fkey"
            columns: ["claimed_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string | null
          document_group_id: string | null
          document_type: string | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          mime_type: string | null
          original_file_name: string | null
          related_id: string | null
          related_type: string | null
          uploader_id: string
          version: number
        }
        Insert: {
          created_at?: string | null
          document_group_id?: string | null
          document_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          mime_type?: string | null
          original_file_name?: string | null
          related_id?: string | null
          related_type?: string | null
          uploader_id: string
          version?: number
        }
        Update: {
          created_at?: string | null
          document_group_id?: string | null
          document_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          mime_type?: string | null
          original_file_name?: string | null
          related_id?: string | null
          related_type?: string | null
          uploader_id?: string
          version?: number
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
      error_logs: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json
          path: string | null
          source: string
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          path?: string | null
          source: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          path?: string | null
          source?: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      event_archetype_aliases: {
        Row: {
          archetype_key: string
          phrase: string
        }
        Insert: {
          archetype_key: string
          phrase: string
        }
        Update: {
          archetype_key?: string
          phrase?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_archetype_aliases_archetype_key_fkey"
            columns: ["archetype_key"]
            isOneToOne: false
            referencedRelation: "event_archetypes"
            referencedColumns: ["key"]
          },
        ]
      }
      event_archetypes: {
        Row: {
          config: Json
          created_at: string | null
          description: string | null
          display_name: string
          key: string
          updated_at: string | null
        }
        Insert: {
          config: Json
          created_at?: string | null
          description?: string | null
          display_name: string
          key: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          description?: string | null
          display_name?: string
          key?: string
          updated_at?: string | null
        }
        Relationships: []
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
      event_cost_commitments: {
        Row: {
          amount_cents: number
          category: string
          committed_at: string | null
          confidence: string
          created_at: string
          currency: string
          description: string | null
          event_id: string
          evidence_type: string
          evidence_url: string | null
          id: string
          metadata: Json
          org_id: string
          paid_at: string | null
          party_id: string | null
          party_name: string | null
          plan_id: string | null
          source: string
          source_ref: string | null
          state: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          category: string
          committed_at?: string | null
          confidence?: string
          created_at?: string
          currency?: string
          description?: string | null
          event_id: string
          evidence_type?: string
          evidence_url?: string | null
          id?: string
          metadata?: Json
          org_id: string
          paid_at?: string | null
          party_id?: string | null
          party_name?: string | null
          plan_id?: string | null
          source?: string
          source_ref?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          category?: string
          committed_at?: string | null
          confidence?: string
          created_at?: string
          currency?: string
          description?: string | null
          event_id?: string
          evidence_type?: string
          evidence_url?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          paid_at?: string | null
          party_id?: string | null
          party_name?: string | null
          plan_id?: string | null
          source?: string
          source_ref?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_cost_commitments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_cost_commitments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_cost_commitments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
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
      event_import_sessions: {
        Row: {
          builder_id: string
          created_at: string
          created_by: string | null
          event_id: string | null
          event_url: string | null
          finalized_at: string | null
          id: string
          payload: Json
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          builder_id: string
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          event_url?: string | null
          finalized_at?: string | null
          id?: string
          payload?: Json
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          builder_id?: string
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          event_url?: string | null
          finalized_at?: string | null
          id?: string
          payload?: Json
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_import_sessions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_import_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_import_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
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
          attendance_extracted_value: number | null
          attendance_extraction_confidence: string | null
          attendance_lock_time: string | null
          attendance_proof_url: string | null
          attendance_submitted_at: string | null
          auto_locked: boolean | null
          bar_revenue_share_percent: number | null
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
          event_id: string | null
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
          plan_id: string | null
          reported_revenue_cents: number | null
          revenue_extracted_value_cents: number | null
          revenue_extraction_confidence: string | null
          revenue_proof_url: string | null
          revenue_submitted_at: string | null
          sales_lift_amount: number | null
          status: string
          stripe_transfer_id: string | null
          ticket_revenue_share_percent: number | null
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
          attendance_extracted_value?: number | null
          attendance_extraction_confidence?: string | null
          attendance_lock_time?: string | null
          attendance_proof_url?: string | null
          attendance_submitted_at?: string | null
          auto_locked?: boolean | null
          bar_revenue_share_percent?: number | null
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
          event_id?: string | null
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
          plan_id?: string | null
          reported_revenue_cents?: number | null
          revenue_extracted_value_cents?: number | null
          revenue_extraction_confidence?: string | null
          revenue_proof_url?: string | null
          revenue_submitted_at?: string | null
          sales_lift_amount?: number | null
          status?: string
          stripe_transfer_id?: string | null
          ticket_revenue_share_percent?: number | null
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
          attendance_extracted_value?: number | null
          attendance_extraction_confidence?: string | null
          attendance_lock_time?: string | null
          attendance_proof_url?: string | null
          attendance_submitted_at?: string | null
          auto_locked?: boolean | null
          bar_revenue_share_percent?: number | null
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
          event_id?: string | null
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
          plan_id?: string | null
          reported_revenue_cents?: number | null
          revenue_extracted_value_cents?: number | null
          revenue_extraction_confidence?: string | null
          revenue_proof_url?: string | null
          revenue_submitted_at?: string | null
          sales_lift_amount?: number | null
          status?: string
          stripe_transfer_id?: string | null
          ticket_revenue_share_percent?: number | null
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
            foreignKeyName: "event_kickback_agreements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
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
      event_revenue_terms: {
        Row: {
          applies_to: string
          confidence: string
          created_at: string
          event_id: string
          flat_cents: number | null
          id: string
          notes: string | null
          org_id: string
          party_id: string | null
          party_name: string | null
          rate: number | null
          source: string
          term_type: string
          updated_at: string
        }
        Insert: {
          applies_to: string
          confidence?: string
          created_at?: string
          event_id: string
          flat_cents?: number | null
          id?: string
          notes?: string | null
          org_id: string
          party_id?: string | null
          party_name?: string | null
          rate?: number | null
          source?: string
          term_type: string
          updated_at?: string
        }
        Update: {
          applies_to?: string
          confidence?: string
          created_at?: string
          event_id?: string
          flat_cents?: number | null
          id?: string
          notes?: string | null
          org_id?: string
          party_id?: string | null
          party_name?: string | null
          rate?: number | null
          source?: string
          term_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_revenue_terms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_revenue_terms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sales_data: {
        Row: {
          agreement_id: string | null
          baseline_sales: number | null
          created_at: string | null
          currency: string
          data_source: string
          discount_code: string | null
          entered_by: string
          event_id: string
          fees: number | null
          fees_cents: number | null
          field_confidence: Json
          gross_cents: number | null
          id: string
          integration_id: string | null
          is_refund: boolean | null
          is_verified: boolean | null
          notes: string | null
          order_id: string | null
          platform: string | null
          purchase_timestamp: string | null
          raw_data: Json
          raw_ticket_class_id: string | null
          receipt_urls: string[] | null
          received_at: string | null
          sales_channel: string | null
          sales_lift: number | null
          source: string | null
          submitted_at: string | null
          ticket_buyer_email: string | null
          ticket_buyer_name: string | null
          ticket_price: number | null
          ticket_price_cents: number | null
          ticket_quantity: number | null
          ticket_tier_category: string
          ticket_tier_name: string | null
          ticket_type: string | null
          tier_name: string | null
          total_amount: number | null
          total_amount_cents: number | null
          total_sales: number
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          agreement_id?: string | null
          baseline_sales?: number | null
          created_at?: string | null
          currency?: string
          data_source: string
          discount_code?: string | null
          entered_by: string
          event_id: string
          fees?: number | null
          fees_cents?: number | null
          field_confidence?: Json
          gross_cents?: number | null
          id?: string
          integration_id?: string | null
          is_refund?: boolean | null
          is_verified?: boolean | null
          notes?: string | null
          order_id?: string | null
          platform?: string | null
          purchase_timestamp?: string | null
          raw_data?: Json
          raw_ticket_class_id?: string | null
          receipt_urls?: string[] | null
          received_at?: string | null
          sales_channel?: string | null
          sales_lift?: number | null
          source?: string | null
          submitted_at?: string | null
          ticket_buyer_email?: string | null
          ticket_buyer_name?: string | null
          ticket_price?: number | null
          ticket_price_cents?: number | null
          ticket_quantity?: number | null
          ticket_tier_category?: string
          ticket_tier_name?: string | null
          ticket_type?: string | null
          tier_name?: string | null
          total_amount?: number | null
          total_amount_cents?: number | null
          total_sales: number
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          agreement_id?: string | null
          baseline_sales?: number | null
          created_at?: string | null
          currency?: string
          data_source?: string
          discount_code?: string | null
          entered_by?: string
          event_id?: string
          fees?: number | null
          fees_cents?: number | null
          field_confidence?: Json
          gross_cents?: number | null
          id?: string
          integration_id?: string | null
          is_refund?: boolean | null
          is_verified?: boolean | null
          notes?: string | null
          order_id?: string | null
          platform?: string | null
          purchase_timestamp?: string | null
          raw_data?: Json
          raw_ticket_class_id?: string | null
          receipt_urls?: string[] | null
          received_at?: string | null
          sales_channel?: string | null
          sales_lift?: number | null
          source?: string | null
          submitted_at?: string | null
          ticket_buyer_email?: string | null
          ticket_buyer_name?: string | null
          ticket_price?: number | null
          ticket_price_cents?: number | null
          ticket_quantity?: number | null
          ticket_tier_category?: string
          ticket_tier_name?: string | null
          ticket_type?: string | null
          tier_name?: string | null
          total_amount?: number | null
          total_amount_cents?: number | null
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
      event_tasks: {
        Row: {
          completed: boolean
          created_at: string
          due_date: string | null
          event_id: string
          id: string
          priority: string
          text: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          due_date?: string | null
          event_id: string
          id?: string
          priority?: string
          text: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          due_date?: string | null
          event_id?: string
          id?: string
          priority?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_tasks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_team_members: {
        Row: {
          created_at: string
          email: string
          event_id: string
          id: string
          invited_at: string
          role: string
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          id?: string
          invited_at?: string
          role: string
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          id?: string
          invited_at?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_team_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
      event_type_candidates: {
        Row: {
          created_at: string
          event_components: Json
          example_plan_ids: string[]
          frequency_count: number
          id: string
          inferred_archetype: string
          normalized_phrase: string
          plan_id: string | null
          raw_phrase: string
          status: string
          suggested_event_type: string | null
          suggested_questions: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_components?: Json
          example_plan_ids?: string[]
          frequency_count?: number
          id?: string
          inferred_archetype: string
          normalized_phrase: string
          plan_id?: string | null
          raw_phrase: string
          status?: string
          suggested_event_type?: string | null
          suggested_questions?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_components?: Json
          example_plan_ids?: string[]
          frequency_count?: number
          id?: string
          inferred_archetype?: string
          normalized_phrase?: string
          plan_id?: string | null
          raw_phrase?: string
          status?: string
          suggested_event_type?: string | null
          suggested_questions?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_type_candidates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
          ends_at: string | null
          event_date: string
          event_description: string | null
          event_name: string
          event_time: string | null
          event_type: string
          eventbrite_event_id: string | null
          expected_attendance: number | null
          expected_attendance_max: number | null
          expected_attendance_min: number | null
          field_confidence: Json
          id: string
          is_recurring: boolean | null
          kickback_agreement_id: string | null
          latest_venue_hold_outcome: Json | null
          outcome_recorded_at: string | null
          outcome_summary: Json | null
          parent_event_id: string | null
          plan_id: string | null
          platform_fee_id: string | null
          platform_fee_paid: boolean | null
          posh_event_id: string | null
          recurring_frequency: string | null
          recurring_occurrences: number | null
          start_time: string
          starts_at: string | null
          status: string | null
          time_zone: string | null
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
          ends_at?: string | null
          event_date: string
          event_description?: string | null
          event_name: string
          event_time?: string | null
          event_type: string
          eventbrite_event_id?: string | null
          expected_attendance?: number | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          field_confidence?: Json
          id?: string
          is_recurring?: boolean | null
          kickback_agreement_id?: string | null
          latest_venue_hold_outcome?: Json | null
          outcome_recorded_at?: string | null
          outcome_summary?: Json | null
          parent_event_id?: string | null
          plan_id?: string | null
          platform_fee_id?: string | null
          platform_fee_paid?: boolean | null
          posh_event_id?: string | null
          recurring_frequency?: string | null
          recurring_occurrences?: number | null
          start_time: string
          starts_at?: string | null
          status?: string | null
          time_zone?: string | null
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
          ends_at?: string | null
          event_date?: string
          event_description?: string | null
          event_name?: string
          event_time?: string | null
          event_type?: string
          eventbrite_event_id?: string | null
          expected_attendance?: number | null
          expected_attendance_max?: number | null
          expected_attendance_min?: number | null
          field_confidence?: Json
          id?: string
          is_recurring?: boolean | null
          kickback_agreement_id?: string | null
          latest_venue_hold_outcome?: Json | null
          outcome_recorded_at?: string | null
          outcome_summary?: Json | null
          parent_event_id?: string | null
          plan_id?: string | null
          platform_fee_id?: string | null
          platform_fee_paid?: boolean | null
          posh_event_id?: string | null
          recurring_frequency?: string | null
          recurring_occurrences?: number | null
          start_time?: string
          starts_at?: string | null
          status?: string | null
          time_zone?: string | null
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
            foreignKeyName: "events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "plans"
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
      exports: {
        Row: {
          created_at: string
          export_type: string
          file_url: string | null
          id: string
          plan_id: string
          sent_to_email: string | null
        }
        Insert: {
          created_at?: string
          export_type: string
          file_url?: string | null
          id?: string
          plan_id: string
          sent_to_email?: string | null
        }
        Update: {
          created_at?: string
          export_type?: string
          file_url?: string | null
          id?: string
          plan_id?: string
          sent_to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exports_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
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
      historical_event_signals: {
        Row: {
          created_at: string
          event_date: string | null
          event_type: string | null
          external_id: string | null
          guest_count: number | null
          id: string
          neighborhood: string | null
          raw_data: Json
          revenue_cents: number | null
          rsvp_rate: number | null
          show_rate: number | null
          signal_scope: string
          source: string
          ticket_price_cents: number | null
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          event_type?: string | null
          external_id?: string | null
          guest_count?: number | null
          id?: string
          neighborhood?: string | null
          raw_data?: Json
          revenue_cents?: number | null
          rsvp_rate?: number | null
          show_rate?: number | null
          signal_scope?: string
          source: string
          ticket_price_cents?: number | null
        }
        Update: {
          created_at?: string
          event_date?: string | null
          event_type?: string | null
          external_id?: string | null
          guest_count?: number | null
          id?: string
          neighborhood?: string | null
          raw_data?: Json
          revenue_cents?: number | null
          rsvp_rate?: number | null
          show_rate?: number | null
          signal_scope?: string
          source?: string
          ticket_price_cents?: number | null
        }
        Relationships: []
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
          field_confidence: Json
          first_name: string | null
          id: string
          integration_id: string
          last_name: string | null
          order_id: string | null
          raw_data: Json | null
          raw_ticket_class_id: string | null
          ticket_class: string | null
          ticket_price: number | null
          ticket_price_cents: number | null
          ticket_tier_category: string
          ticket_tier_name: string | null
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
          field_confidence?: Json
          first_name?: string | null
          id?: string
          integration_id: string
          last_name?: string | null
          order_id?: string | null
          raw_data?: Json | null
          raw_ticket_class_id?: string | null
          ticket_class?: string | null
          ticket_price?: number | null
          ticket_price_cents?: number | null
          ticket_tier_category?: string
          ticket_tier_name?: string | null
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
          field_confidence?: Json
          first_name?: string | null
          id?: string
          integration_id?: string
          last_name?: string | null
          order_id?: string | null
          raw_data?: Json | null
          raw_ticket_class_id?: string | null
          ticket_class?: string | null
          ticket_price?: number | null
          ticket_price_cents?: number | null
          ticket_tier_category?: string
          ticket_tier_name?: string | null
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
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          agreement_id: string
          amount: number | null
          amount_cents: number | null
          builder_payout_cents: number | null
          completed_at: string | null
          created_at: string | null
          currency: string | null
          due_date: string | null
          event_id: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          initiated_at: string | null
          invoice_hosted_url: string | null
          notes: string | null
          paid_at: string | null
          payer_id: string
          processing_fee_cents: number | null
          receipt_url: string | null
          recipient_id: string
          refund_amount_cents: number | null
          refund_approved_at: string | null
          refund_approved_by: string | null
          refund_reason: string | null
          refund_requested_at: string | null
          refund_requested_by: string | null
          settlement_method: string
          status: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payout_id: string | null
          stripe_refund_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          agreement_id: string
          amount?: number | null
          amount_cents?: number | null
          builder_payout_cents?: number | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          event_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          invoice_hosted_url?: string | null
          notes?: string | null
          paid_at?: string | null
          payer_id: string
          processing_fee_cents?: number | null
          receipt_url?: string | null
          recipient_id: string
          refund_amount_cents?: number | null
          refund_approved_at?: string | null
          refund_approved_by?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_requested_by?: string | null
          settlement_method?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          agreement_id?: string
          amount?: number | null
          amount_cents?: number | null
          builder_payout_cents?: number | null
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          event_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          invoice_hosted_url?: string | null
          notes?: string | null
          paid_at?: string | null
          payer_id?: string
          processing_fee_cents?: number | null
          receipt_url?: string | null
          recipient_id?: string
          refund_amount_cents?: number | null
          refund_approved_at?: string | null
          refund_approved_by?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_requested_by?: string | null
          settlement_method?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payout_id?: string | null
          stripe_refund_id?: string | null
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
          {
            foreignKeyName: "kickback_payments_refund_approved_by_fkey"
            columns: ["refund_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kickback_payments_refund_requested_by_fkey"
            columns: ["refund_requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      live_recommendations: {
        Row: {
          agent_narrative: string
          created_at: string
          event_id: string
          evidence: Json
          id: string
          org_id: string
          severity: string
          state: string
          suggested_action: string
          trigger_key: string
          updated_at: string
        }
        Insert: {
          agent_narrative?: string
          created_at?: string
          event_id: string
          evidence?: Json
          id?: string
          org_id: string
          severity: string
          state?: string
          suggested_action: string
          trigger_key: string
          updated_at?: string
        }
        Update: {
          agent_narrative?: string
          created_at?: string
          event_id?: string
          evidence?: Json
          id?: string
          org_id?: string
          severity?: string
          state?: string
          suggested_action?: string
          trigger_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_recommendations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
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
          canonical_venue_confirmation_booking_id: string | null
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
          canonical_venue_confirmation_booking_id?: string | null
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
          canonical_venue_confirmation_booking_id?: string | null
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
            foreignKeyName: "notifications_canonical_venue_confirmation_booking_id_fkey"
            columns: ["canonical_venue_confirmation_booking_id"]
            isOneToOne: false
            referencedRelation: "venue_bookings"
            referencedColumns: ["id"]
          },
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
      organizer_vendor_relationships: {
        Row: {
          created_at: string
          first_worked_at: string | null
          id: string
          notes: string | null
          organizer_user_id: string
          source: string
          trust_tier: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          first_worked_at?: string | null
          id?: string
          notes?: string | null
          organizer_user_id: string
          source: string
          trust_tier?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          first_worked_at?: string | null
          id?: string
          notes?: string | null
          organizer_user_id?: string
          source?: string
          trust_tier?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_vendor_relationships_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "organizer_vendor_relationships_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_venue_relationships: {
        Row: {
          created_at: string
          first_worked_at: string | null
          id: string
          notes: string | null
          organizer_user_id: string
          source: string
          trust_tier: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          first_worked_at?: string | null
          id?: string
          notes?: string | null
          organizer_user_id: string
          source: string
          trust_tier?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          first_worked_at?: string | null
          id?: string
          notes?: string | null
          organizer_user_id?: string
          source?: string
          trust_tier?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_venue_relationships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_compliance_events: {
        Row: {
          channel: string
          created_at: string
          event_type: string
          id: string
          message_id: string | null
          metadata: Json
          severity: string
          thread_id: string | null
          user_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          event_type: string
          id?: string
          message_id?: string | null
          metadata?: Json
          severity?: string
          thread_id?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          severity?: string
          thread_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_compliance_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "outreach_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_compliance_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_compliance_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_messages: {
        Row: {
          agent_action_id: string | null
          approval_id: string | null
          attachments_json: Json
          autonomous_send_after: string | null
          autonomy_policy_id: string | null
          autonomy_policy_version: number | null
          autonomy_status: string
          body_html: string | null
          body_text: string
          cancelled_at: string | null
          channel_external_id: string | null
          classification_json: Json | null
          created_at: string
          delivery_status: string | null
          direction: string
          dispatch_idempotency_key: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          headers_json: Json
          id: string
          last_send_error: string | null
          provider_cost_cents: number | null
          provider_metadata_json: Json
          received_at: string | null
          recording_url: string | null
          rfc_message_id: string | null
          scheduled_send_at: string | null
          send_started_at: string | null
          sent_at: string | null
          sent_manually: boolean
          subject: string
          thread_id: string
          transcript_text: string | null
          undo_expires_at: string | null
        }
        Insert: {
          agent_action_id?: string | null
          approval_id?: string | null
          attachments_json?: Json
          autonomous_send_after?: string | null
          autonomy_policy_id?: string | null
          autonomy_policy_version?: number | null
          autonomy_status?: string
          body_html?: string | null
          body_text: string
          cancelled_at?: string | null
          channel_external_id?: string | null
          classification_json?: Json | null
          created_at?: string
          delivery_status?: string | null
          direction: string
          dispatch_idempotency_key?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          headers_json?: Json
          id?: string
          last_send_error?: string | null
          provider_cost_cents?: number | null
          provider_metadata_json?: Json
          received_at?: string | null
          recording_url?: string | null
          rfc_message_id?: string | null
          scheduled_send_at?: string | null
          send_started_at?: string | null
          sent_at?: string | null
          sent_manually?: boolean
          subject: string
          thread_id: string
          transcript_text?: string | null
          undo_expires_at?: string | null
        }
        Update: {
          agent_action_id?: string | null
          approval_id?: string | null
          attachments_json?: Json
          autonomous_send_after?: string | null
          autonomy_policy_id?: string | null
          autonomy_policy_version?: number | null
          autonomy_status?: string
          body_html?: string | null
          body_text?: string
          cancelled_at?: string | null
          channel_external_id?: string | null
          classification_json?: Json | null
          created_at?: string
          delivery_status?: string | null
          direction?: string
          dispatch_idempotency_key?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          headers_json?: Json
          id?: string
          last_send_error?: string | null
          provider_cost_cents?: number | null
          provider_metadata_json?: Json
          received_at?: string | null
          recording_url?: string | null
          rfc_message_id?: string | null
          scheduled_send_at?: string | null
          send_started_at?: string | null
          sent_at?: string | null
          sent_manually?: boolean
          subject?: string
          thread_id?: string
          transcript_text?: string | null
          undo_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_messages_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_messages_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_notifications: {
        Row: {
          created_at: string
          id: string
          notification_type: string
          payload_json: Json
          read_at: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_type: string
          payload_json?: Json
          read_at?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_type?: string
          payload_json?: Json
          read_at?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_notifications_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_policy_audit_logs: {
        Row: {
          action: string
          context_json: Json
          created_at: string
          decision: string
          human_intervened: boolean
          id: string
          message_id: string | null
          model_name: string | null
          policy_id: string | null
          policy_version: number | null
          reason: string
          required_approval_type: string | null
          result_json: Json
          retention_expires_at: string
          reversible_until: string | null
          thread_id: string | null
          undone_at: string | null
          user_id: string
        }
        Insert: {
          action: string
          context_json?: Json
          created_at?: string
          decision: string
          human_intervened?: boolean
          id?: string
          message_id?: string | null
          model_name?: string | null
          policy_id?: string | null
          policy_version?: number | null
          reason: string
          required_approval_type?: string | null
          result_json?: Json
          retention_expires_at?: string
          reversible_until?: string | null
          thread_id?: string | null
          undone_at?: string | null
          user_id: string
        }
        Update: {
          action?: string
          context_json?: Json
          created_at?: string
          decision?: string
          human_intervened?: boolean
          id?: string
          message_id?: string | null
          model_name?: string | null
          policy_id?: string | null
          policy_version?: number | null
          reason?: string
          required_approval_type?: string | null
          result_json?: Json
          retention_expires_at?: string
          reversible_until?: string | null
          thread_id?: string | null
          undone_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_policy_audit_logs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "outreach_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_policy_audit_logs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "creator_outreach_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_policy_audit_logs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_policy_audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_threads: {
        Row: {
          channel: string
          channel_strategy: Json
          created_at: string
          discovery_vendor_id: string | null
          discovery_venue_id: string | null
          follow_up_count: number
          id: string
          last_event_at: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          needs_attention: boolean
          next_action_at: string | null
          plan_id: string
          source_agent_action_id: string | null
          state: string
          target_email: string | null
          target_id: string | null
          target_instagram_handle: string | null
          target_name: string
          target_phone: string | null
          target_source: string
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          channel_strategy?: Json
          created_at?: string
          discovery_vendor_id?: string | null
          discovery_venue_id?: string | null
          follow_up_count?: number
          id?: string
          last_event_at?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          needs_attention?: boolean
          next_action_at?: string | null
          plan_id: string
          source_agent_action_id?: string | null
          state?: string
          target_email?: string | null
          target_id?: string | null
          target_instagram_handle?: string | null
          target_name: string
          target_phone?: string | null
          target_source?: string
          target_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          channel_strategy?: Json
          created_at?: string
          discovery_vendor_id?: string | null
          discovery_venue_id?: string | null
          follow_up_count?: number
          id?: string
          last_event_at?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          needs_attention?: boolean
          next_action_at?: string | null
          plan_id?: string
          source_agent_action_id?: string | null
          state?: string
          target_email?: string | null
          target_id?: string | null
          target_instagram_handle?: string | null
          target_name?: string
          target_phone?: string | null
          target_source?: string
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_threads_discovery_vendor_id_fkey"
            columns: ["discovery_vendor_id"]
            isOneToOne: false
            referencedRelation: "discovery_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_threads_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_threads_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_threads_source_agent_action_id_fkey"
            columns: ["source_agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      partnership_documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          signed_at: string | null
          thread_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          signed_at?: string | null
          thread_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          signed_at?: string | null
          thread_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnership_documents_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "partnership_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      partnership_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          id: string
          sender_kind: string
          thread_id: string
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          sender_kind: string
          thread_id: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          sender_kind?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnership_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "partnership_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      partnership_milestones: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          label: string
          thread_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          label: string
          thread_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnership_milestones_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "partnership_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      partnership_threads: {
        Row: {
          created_at: string
          id: string
          partner_id: string
          partner_kind: string
          plan_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          partner_id: string
          partner_kind: string
          plan_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          partner_id?: string
          partner_kind?: string
          plan_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partnership_threads_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          account_state_blocked_previous_status: string | null
          account_state_blocked_stripe_account_id: string | null
          amount_cents: number
          approval_id: string
          authorized_at: string | null
          capture_attempt_id: string | null
          capture_effects_completed_at: string | null
          capture_effects_started_at: string | null
          capture_started_at: string | null
          captured_at: string | null
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          last_refund_event_id: string | null
          partner_id: string
          partner_kind: string
          plan_id: string
          platform_fee_cents: number
          refund_terms: string
          refund_updated_at: string | null
          refunded_amount_cents: number
          status: string
          stripe_payment_intent_id: string | null
          stripe_payment_method_id: string | null
          updated_at: string
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_previous_status?: string | null
          account_state_blocked_stripe_account_id?: string | null
          amount_cents: number
          approval_id: string
          authorized_at?: string | null
          capture_attempt_id?: string | null
          capture_effects_completed_at?: string | null
          capture_effects_started_at?: string | null
          capture_started_at?: string | null
          captured_at?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          last_refund_event_id?: string | null
          partner_id: string
          partner_kind: string
          plan_id: string
          platform_fee_cents?: number
          refund_terms?: string
          refund_updated_at?: string | null
          refunded_amount_cents?: number
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_previous_status?: string | null
          account_state_blocked_stripe_account_id?: string | null
          amount_cents?: number
          approval_id?: string
          authorized_at?: string | null
          capture_attempt_id?: string | null
          capture_effects_completed_at?: string | null
          capture_effects_started_at?: string | null
          capture_started_at?: string | null
          captured_at?: string | null
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          last_refund_event_id?: string | null
          partner_id?: string
          partner_kind?: string
          plan_id?: string
          platform_fee_cents?: number
          refund_terms?: string
          refund_updated_at?: string | null
          refunded_amount_cents?: number
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_approval_plan_consistency_fkey"
            columns: ["approval_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "payment_intents_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          partner_id: string
          partner_kind: string
          payment_intent_id: string
          status: string
          stripe_payout_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          partner_id: string
          partner_kind: string
          payment_intent_id: string
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          partner_id?: string
          partner_kind?: string
          payment_intent_id?: string
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_activity: {
        Row: {
          created_at: string
          id: string
          kind: string
          occurred_at: string
          payload: Json
          plan_id: string
          summary: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          occurred_at?: string
          payload?: Json
          plan_id: string
          summary: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          occurred_at?: string
          payload?: Json
          plan_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_activity_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_budget: {
        Row: {
          buffer_target_cents: number | null
          created_at: string
          metadata: Json
          notes: string | null
          plan_id: string
          target_cents: number | null
          updated_at: string
        }
        Insert: {
          buffer_target_cents?: number | null
          created_at?: string
          metadata?: Json
          notes?: string | null
          plan_id: string
          target_cents?: number | null
          updated_at?: string
        }
        Update: {
          buffer_target_cents?: number | null
          created_at?: string
          metadata?: Json
          notes?: string | null
          plan_id?: string
          target_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_budget_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_budget_lines: {
        Row: {
          category: string
          created_at: string
          high_cents: number
          id: string
          label: string
          low_cents: number
          metadata: Json
          plan_id: string
          source: string
          source_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          high_cents?: number
          id?: string
          label: string
          low_cents?: number
          metadata?: Json
          plan_id: string
          source?: string
          source_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          high_cents?: number
          id?: string
          label?: string
          low_cents?: number
          metadata?: Json
          plan_id?: string
          source?: string
          source_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_budget_lines_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_derived_state: {
        Row: {
          authorization_cards: Json
          baseline_n_events: number | null
          baseline_source: string
          brief_render_version: number
          computed_at: string
          plan_id: string
          profit_assumptions: Json
          shopping_list: Json
        }
        Insert: {
          authorization_cards?: Json
          baseline_n_events?: number | null
          baseline_source?: string
          brief_render_version?: number
          computed_at?: string
          plan_id: string
          profit_assumptions?: Json
          shopping_list?: Json
        }
        Update: {
          authorization_cards?: Json
          baseline_n_events?: number | null
          baseline_source?: string
          brief_render_version?: number
          computed_at?: string
          plan_id?: string
          profit_assumptions?: Json
          shopping_list?: Json
        }
        Relationships: [
          {
            foreignKeyName: "plan_derived_state_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_discovery_vendor_candidates: {
        Row: {
          created_at: string
          discovery_vendor_id: string
          dismissed_at: string | null
          fit_score: number | null
          id: string
          outreach_approval_created_at: string | null
          places_request_json: Json
          plan_id: string
          search_query: string
          searched_by_user_id: string | null
          service_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discovery_vendor_id: string
          dismissed_at?: string | null
          fit_score?: number | null
          id?: string
          outreach_approval_created_at?: string | null
          places_request_json?: Json
          plan_id: string
          search_query: string
          searched_by_user_id?: string | null
          service_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discovery_vendor_id?: string
          dismissed_at?: string | null
          fit_score?: number | null
          id?: string
          outreach_approval_created_at?: string | null
          places_request_json?: Json
          plan_id?: string
          search_query?: string
          searched_by_user_id?: string | null
          service_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_discovery_vendor_candidates_discovery_vendor_id_fkey"
            columns: ["discovery_vendor_id"]
            isOneToOne: false
            referencedRelation: "discovery_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_discovery_vendor_candidates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_discovery_vendor_candidates_searched_by_user_id_fkey"
            columns: ["searched_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_discovery_venue_candidates: {
        Row: {
          archetype_id: string | null
          created_at: string
          discovery_venue_id: string
          dismissed_at: string | null
          fit_score: number | null
          id: string
          neighborhood: string | null
          outreach_approval_created_at: string | null
          places_request_json: Json
          plan_id: string
          search_query: string
          searched_by_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          archetype_id?: string | null
          created_at?: string
          discovery_venue_id: string
          dismissed_at?: string | null
          fit_score?: number | null
          id?: string
          neighborhood?: string | null
          outreach_approval_created_at?: string | null
          places_request_json?: Json
          plan_id: string
          search_query: string
          searched_by_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          archetype_id?: string | null
          created_at?: string
          discovery_venue_id?: string
          dismissed_at?: string | null
          fit_score?: number | null
          id?: string
          neighborhood?: string | null
          outreach_approval_created_at?: string | null
          places_request_json?: Json
          plan_id?: string
          search_query?: string
          searched_by_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_discovery_venue_candidates_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_discovery_venue_candidates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_discovery_venue_candidates_searched_by_user_id_fkey"
            columns: ["searched_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          message_type: string
          metadata: Json
          plan_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          message_type?: string
          metadata?: Json
          plan_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          message_type?: string
          metadata?: Json
          plan_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_messages_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_revisions: {
        Row: {
          applied_at: string
          audit_log_id: string | null
          id: string
          impact_summary: Json
          plan_id: string
          rediscovery_triggered_for: string[]
          source_message_id: string | null
          trigger_payload: Json
          trigger_type: string
          triggered_by_user_id: string | null
        }
        Insert: {
          applied_at?: string
          audit_log_id?: string | null
          id?: string
          impact_summary: Json
          plan_id: string
          rediscovery_triggered_for?: string[]
          source_message_id?: string | null
          trigger_payload: Json
          trigger_type: string
          triggered_by_user_id?: string | null
        }
        Update: {
          applied_at?: string
          audit_log_id?: string | null
          id?: string
          impact_summary?: Json
          plan_id?: string
          rediscovery_triggered_for?: string[]
          source_message_id?: string | null
          trigger_payload?: Json
          trigger_type?: string
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_revisions_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_revisions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_revisions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "plan_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_status_transitions: {
        Row: {
          actor_id: string
          event_id: string | null
          from_status: Database["public"]["Enums"]["planner_plan_status"]
          id: string
          metadata: Json
          plan_id: string
          to_status: Database["public"]["Enums"]["planner_plan_status"]
          transition_trigger: string
          transitioned_at: string
        }
        Insert: {
          actor_id: string
          event_id?: string | null
          from_status: Database["public"]["Enums"]["planner_plan_status"]
          id?: string
          metadata?: Json
          plan_id: string
          to_status: Database["public"]["Enums"]["planner_plan_status"]
          transition_trigger: string
          transitioned_at?: string
        }
        Update: {
          actor_id?: string
          event_id?: string | null
          from_status?: Database["public"]["Enums"]["planner_plan_status"]
          id?: string
          metadata?: Json
          plan_id?: string
          to_status?: Database["public"]["Enums"]["planner_plan_status"]
          transition_trigger?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_status_transitions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_status_transitions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_supply_intents: {
        Row: {
          activity_type: string | null
          category: string
          confidence: number
          created_at: string
          id: string
          label: string
          plan_id: string
          requirements: Json
          source: string
          updated_at: string
        }
        Insert: {
          activity_type?: string | null
          category: string
          confidence?: number
          created_at?: string
          id?: string
          label: string
          plan_id: string
          requirements?: Json
          source?: string
          updated_at?: string
        }
        Update: {
          activity_type?: string | null
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          label?: string
          plan_id?: string
          requirements?: Json
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_supply_intents_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_versions: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          id: string
          plan_id: string
          snapshot: Json
          version_number: number
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          plan_id: string
          snapshot?: Json
          version_number: number
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          plan_id?: string
          snapshot?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_versions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_versions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      planner_event_taxonomy: {
        Row: {
          archetype_key: string
          created_at: string
          display_name: string
          event_type: string
        }
        Insert: {
          archetype_key: string
          created_at?: string
          display_name: string
          event_type: string
        }
        Update: {
          archetype_key?: string
          created_at?: string
          display_name?: string
          event_type?: string
        }
        Relationships: []
      }
      planner_plan_updates: {
        Row: {
          created_at: string
          field: string
          id: string
          new_value: Json | null
          old_value: Json | null
          plan_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          plan_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planner_plan_updates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          agent_action: string | null
          brief_render_version: number
          budget_cap_cents: number | null
          committed_vendors: Json | null
          committed_venue_at: string | null
          committed_venue_id: string | null
          committed_venue_quoted_deal_model: string | null
          committed_venue_quoted_price_cents: number | null
          committed_venue_quoted_terms: Json | null
          created_at: string
          date_window_end: string | null
          date_window_start: string | null
          derived_state_recomputed_at: string | null
          event_city: string | null
          event_type: string | null
          excluded_cuisines: string[]
          excluded_vendor_attributes: Json
          food_responsibility: string | null
          guest_count: number | null
          id: string
          latest_venue_hold_outcome: Json | null
          materialized_event_id: string | null
          metadata: Json
          neighborhood: string | null
          notes: string | null
          plan_revision_count: number
          preferred_vendor_attributes: Json
          profit_goal_cents: number | null
          special_supply_radius_miles: number
          status: Database["public"]["Enums"]["planner_plan_status"]
          ticketed: boolean
          ticketing_model: string | null
          title: string
          updated_at: string
          user_id: string
          vendor_approved_adjacent_cities: string[]
          vendor_out_of_city_approved: boolean
          vendor_same_city_required: boolean
          venue_terms: string | null
        }
        Insert: {
          agent_action?: string | null
          brief_render_version?: number
          budget_cap_cents?: number | null
          committed_vendors?: Json | null
          committed_venue_at?: string | null
          committed_venue_id?: string | null
          committed_venue_quoted_deal_model?: string | null
          committed_venue_quoted_price_cents?: number | null
          committed_venue_quoted_terms?: Json | null
          created_at?: string
          date_window_end?: string | null
          date_window_start?: string | null
          derived_state_recomputed_at?: string | null
          event_city?: string | null
          event_type?: string | null
          excluded_cuisines?: string[]
          excluded_vendor_attributes?: Json
          food_responsibility?: string | null
          guest_count?: number | null
          id?: string
          latest_venue_hold_outcome?: Json | null
          materialized_event_id?: string | null
          metadata?: Json
          neighborhood?: string | null
          notes?: string | null
          plan_revision_count?: number
          preferred_vendor_attributes?: Json
          profit_goal_cents?: number | null
          special_supply_radius_miles?: number
          status?: Database["public"]["Enums"]["planner_plan_status"]
          ticketed?: boolean
          ticketing_model?: string | null
          title: string
          updated_at?: string
          user_id: string
          vendor_approved_adjacent_cities?: string[]
          vendor_out_of_city_approved?: boolean
          vendor_same_city_required?: boolean
          venue_terms?: string | null
        }
        Update: {
          agent_action?: string | null
          brief_render_version?: number
          budget_cap_cents?: number | null
          committed_vendors?: Json | null
          committed_venue_at?: string | null
          committed_venue_id?: string | null
          committed_venue_quoted_deal_model?: string | null
          committed_venue_quoted_price_cents?: number | null
          committed_venue_quoted_terms?: Json | null
          created_at?: string
          date_window_end?: string | null
          date_window_start?: string | null
          derived_state_recomputed_at?: string | null
          event_city?: string | null
          event_type?: string | null
          excluded_cuisines?: string[]
          excluded_vendor_attributes?: Json
          food_responsibility?: string | null
          guest_count?: number | null
          id?: string
          latest_venue_hold_outcome?: Json | null
          materialized_event_id?: string | null
          metadata?: Json
          neighborhood?: string | null
          notes?: string | null
          plan_revision_count?: number
          preferred_vendor_attributes?: Json
          profit_goal_cents?: number | null
          special_supply_radius_miles?: number
          status?: Database["public"]["Enums"]["planner_plan_status"]
          ticketed?: boolean
          ticketing_model?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          vendor_approved_adjacent_cities?: string[]
          vendor_out_of_city_approved?: boolean
          vendor_same_city_required?: boolean
          venue_terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_committed_venue_id_fkey"
            columns: ["committed_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_materialized_event_id_fkey"
            columns: ["materialized_event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fee_transactions: {
        Row: {
          amount: number
          amount_cents: number
          approval_id: string | null
          billing_period_end: string | null
          billing_period_start: string | null
          booking_id: string | null
          builder_id: string | null
          created_at: string | null
          failed_at: string | null
          fee_type: string
          id: string
          paid_at: string | null
          refunded_at: string | null
          status: string | null
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          amount_cents: number
          approval_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          booking_id?: string | null
          builder_id?: string | null
          created_at?: string | null
          failed_at?: string | null
          fee_type: string
          id?: string
          paid_at?: string | null
          refunded_at?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          amount_cents?: number
          approval_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          booking_id?: string | null
          builder_id?: string | null
          created_at?: string | null
          failed_at?: string | null
          fee_type?: string
          id?: string
          paid_at?: string | null
          refunded_at?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_fee_transactions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fee_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "vendor_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fee_transactions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
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
      provider_connections: {
        Row: {
          builder_id: string | null
          config: Json
          created_at: string
          encrypted_credentials: Json
          external_account_id: string | null
          id: string
          last_connected_at: string | null
          last_error: string | null
          plan_id: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          builder_id?: string | null
          config?: Json
          created_at?: string
          encrypted_credentials?: Json
          external_account_id?: string | null
          id?: string
          last_connected_at?: string | null
          last_error?: string | null
          plan_id?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          builder_id?: string | null
          config?: Json
          created_at?: string
          encrypted_credentials?: Json
          external_account_id?: string | null
          id?: string
          last_connected_at?: string | null
          last_error?: string | null
          plan_id?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_connections_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_connections_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          created_at: string
          external_name: string | null
          id: string
          is_best_fit: boolean
          metadata: Json
          notes: string | null
          plan_id: string
          plan_revision_at_creation: number
          price_cents: number | null
          rank: number
          reference_id: string | null
          status: string
          superseded_at: string | null
          superseded_by_revision_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          external_name?: string | null
          id?: string
          is_best_fit?: boolean
          metadata?: Json
          notes?: string | null
          plan_id: string
          plan_revision_at_creation?: number
          price_cents?: number | null
          rank: number
          reference_id?: string | null
          status?: string
          superseded_at?: string | null
          superseded_by_revision_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          external_name?: string | null
          id?: string
          is_best_fit?: boolean
          metadata?: Json
          notes?: string | null
          plan_id?: string
          plan_revision_at_creation?: number
          price_cents?: number | null
          rank?: number
          reference_id?: string | null
          status?: string
          superseded_at?: string | null
          superseded_by_revision_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_superseded_by_revision_id_fkey"
            columns: ["superseded_by_revision_id"]
            isOneToOne: false
            referencedRelation: "plan_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      release_runtime_controls: {
        Row: {
          changed_by: string
          control_key: string
          enabled: boolean
          enabled_at: string | null
          reason: string | null
          revision: number
          state: string
          updated_at: string
        }
        Insert: {
          changed_by?: string
          control_key: string
          enabled?: boolean
          enabled_at?: string | null
          reason?: string | null
          revision?: number
          state?: string
          updated_at?: string
        }
        Update: {
          changed_by?: string
          control_key?: string
          enabled?: boolean
          enabled_at?: string | null
          reason?: string | null
          revision?: number
          state?: string
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
      settlement_attendance_evidence: {
        Row: {
          attendee_count: number | null
          created_at: string
          evidence_kind: string
          external_ref: string | null
          id: string
          notes: string | null
          settlement_run_id: string
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          attendee_count?: number | null
          created_at?: string
          evidence_kind: string
          external_ref?: string | null
          id?: string
          notes?: string | null
          settlement_run_id: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          attendee_count?: number | null
          created_at?: string
          evidence_kind?: string
          external_ref?: string | null
          id?: string
          notes?: string | null
          settlement_run_id?: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_attendance_evidence_settlement_run_id_fkey"
            columns: ["settlement_run_id"]
            isOneToOne: false
            referencedRelation: "settlement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_attendance_webhook_cache: {
        Row: {
          applied_at: string | null
          attendance_count: number
          created_at: string
          event_id: string
          id: string
          payload: Json
          received_at: string
          source: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          attendance_count: number
          created_at?: string
          event_id: string
          id?: string
          payload?: Json
          received_at?: string
          source: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          attendance_count?: number
          created_at?: string
          event_id?: string
          id?: string
          payload?: Json
          received_at?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_attendance_webhook_cache_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: []
      }
      settlement_charges: {
        Row: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          account_state_blocked_event_id: string | null
          amount_cents: number
          approval_id: string | null
          blocked_at: string | null
          blocked_previous_status: string | null
          blocked_stripe_account_id: string | null
          checkout_url: string | null
          created_at: string
          currency: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          initiated_at: string
          metadata: Json
          organizer_id: string
          organizer_payout_cents: number
          paid_at: string | null
          platform_fee_cents: number
          settlement_run_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_connected_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          transfer_completed_at: string | null
          trueup_processed_at: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_event_id?: string | null
          amount_cents: number
          approval_id?: string | null
          blocked_at?: string | null
          blocked_previous_status?: string | null
          blocked_stripe_account_id?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          metadata?: Json
          organizer_id: string
          organizer_payout_cents: number
          paid_at?: string | null
          platform_fee_cents?: number
          settlement_run_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          transfer_completed_at?: string | null
          trueup_processed_at?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_event_id?: string | null
          amount_cents?: number
          approval_id?: string | null
          blocked_at?: string | null
          blocked_previous_status?: string | null
          blocked_stripe_account_id?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          metadata?: Json
          organizer_id?: string
          organizer_payout_cents?: number
          paid_at?: string | null
          platform_fee_cents?: number
          settlement_run_id?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_connected_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          transfer_completed_at?: string | null
          trueup_processed_at?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_charges_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_charges_approval_run_consistency_fkey"
            columns: ["approval_id", "settlement_run_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "settlement_run_id"]
          },
          {
            foreignKeyName: "settlement_charges_settlement_run_id_fkey"
            columns: ["settlement_run_id"]
            isOneToOne: false
            referencedRelation: "settlement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_runs: {
        Row: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          account_state_blocked_event_id: string | null
          archetype: string
          attendance_count: number | null
          attendance_recorded_at: string | null
          attendance_source: string | null
          blocked_at: string | null
          blocked_previous_status: string | null
          blocked_stripe_account_id: string | null
          created_at: string
          dispute_reason: string | null
          disputed_at: string | null
          event_id: string
          id: string
          neighborhood: string
          organizer_id: string
          organizer_reviewed_at: string | null
          organizer_reviewed_by: string | null
          per_attendee_cents: number | null
          rate_derived_from_event_count: number | null
          rate_source: string | null
          scheduled_settle_at: string
          status: string
          stripe_account_recovery_notified_at: string | null
          total_cents: number | null
          updated_at: string
          venue_id: string
          venue_type: string
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_event_id?: string | null
          archetype: string
          attendance_count?: number | null
          attendance_recorded_at?: string | null
          attendance_source?: string | null
          blocked_at?: string | null
          blocked_previous_status?: string | null
          blocked_stripe_account_id?: string | null
          created_at?: string
          dispute_reason?: string | null
          disputed_at?: string | null
          event_id: string
          id?: string
          neighborhood: string
          organizer_id: string
          organizer_reviewed_at?: string | null
          organizer_reviewed_by?: string | null
          per_attendee_cents?: number | null
          rate_derived_from_event_count?: number | null
          rate_source?: string | null
          scheduled_settle_at: string
          status?: string
          stripe_account_recovery_notified_at?: string | null
          total_cents?: number | null
          updated_at?: string
          venue_id: string
          venue_type: string
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          account_state_blocked_event_id?: string | null
          archetype?: string
          attendance_count?: number | null
          attendance_recorded_at?: string | null
          attendance_source?: string | null
          blocked_at?: string | null
          blocked_previous_status?: string | null
          blocked_stripe_account_id?: string | null
          created_at?: string
          dispute_reason?: string | null
          disputed_at?: string | null
          event_id?: string
          id?: string
          neighborhood?: string
          organizer_id?: string
          organizer_reviewed_at?: string | null
          organizer_reviewed_by?: string | null
          per_attendee_cents?: number | null
          rate_derived_from_event_count?: number | null
          rate_source?: string | null
          scheduled_settle_at?: string
          status?: string
          stripe_account_recovery_notified_at?: string | null
          total_cents?: number | null
          updated_at?: string
          venue_id?: string
          venue_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_funnel_events: {
        Row: {
          anonymous_id: string | null
          created_at: string
          event_name: string
          id: string
          metadata: Json
          method: string | null
          role: string
          step: number | null
          total_steps: number | null
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json
          method?: string | null
          role: string
          step?: number | null
          total_steps?: number | null
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json
          method?: string | null
          role?: string
          step?: number | null
          total_steps?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_funnel_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      stripe_setup_notifications: {
        Row: {
          channel: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          organizer_id: string | null
          plan_id: string | null
          reason: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          organizer_id?: string | null
          plan_id?: string | null
          reason: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          organizer_id?: string | null
          plan_id?: string | null
          reason?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_setup_notifications_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_setup_notifications_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          completed_at: string | null
          created_at: string | null
          duplicate_count: number
          endpoint_path: string
          error: string | null
          event_type: string
          id: string
          in_flight: boolean
          last_error: string | null
          livemode: boolean
          maintenance_deferred_at: string | null
          metadata: Json
          payload: Json
          processed: boolean | null
          processed_at: string | null
          processing_outcome: string | null
          received_at: string
          reservation_token: string | null
          reserved_at: string | null
          source: string
          stripe_event_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          duplicate_count?: number
          endpoint_path: string
          error?: string | null
          event_type: string
          id?: string
          in_flight?: boolean
          last_error?: string | null
          livemode: boolean
          maintenance_deferred_at?: string | null
          metadata?: Json
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_outcome?: string | null
          received_at?: string
          reservation_token?: string | null
          reserved_at?: string | null
          source: string
          stripe_event_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          duplicate_count?: number
          endpoint_path?: string
          error?: string | null
          event_type?: string
          id?: string
          in_flight?: boolean
          last_error?: string | null
          livemode?: boolean
          maintenance_deferred_at?: string | null
          metadata?: Json
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_outcome?: string | null
          received_at?: string
          reservation_token?: string | null
          reserved_at?: string | null
          source?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          amount: number
          billing_interval: string | null
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
          plan_name: string | null
          plan_type: string | null
          platform_fee_discount: number | null
          price: number | null
          slug: string
          sort_order: number | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          billing_interval?: string | null
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
          plan_name?: string | null
          plan_type?: string | null
          platform_fee_discount?: number | null
          price?: number | null
          slug: string
          sort_order?: number | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          billing_interval?: string | null
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
          plan_name?: string | null
          plan_type?: string | null
          platform_fee_discount?: number | null
          price?: number | null
          slug?: string
          sort_order?: number | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      supply_scout_venue_leads: {
        Row: {
          address: string
          booking_likelihood: string
          booking_signals: string[]
          capacity_hint: number | null
          captured_at: string
          city: string
          confidence: number
          created_at: string
          created_by: string | null
          discovery_venue_id: string | null
          disqualifiers: string[]
          duplicate_of_lead_id: string | null
          event_title: string | null
          event_type: string | null
          evidence_summary: string
          id: string
          metadata: Json
          name: string
          neighborhood: string | null
          normalized_address: string
          normalized_name: string
          price_hint_cents_high: number | null
          price_hint_cents_low: number | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_platform: string
          source_url: string | null
          state: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address: string
          booking_likelihood?: string
          booking_signals?: string[]
          capacity_hint?: number | null
          captured_at?: string
          city?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          discovery_venue_id?: string | null
          disqualifiers?: string[]
          duplicate_of_lead_id?: string | null
          event_title?: string | null
          event_type?: string | null
          evidence_summary: string
          id?: string
          metadata?: Json
          name: string
          neighborhood?: string | null
          normalized_address: string
          normalized_name: string
          price_hint_cents_high?: number | null
          price_hint_cents_low?: number | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_platform: string
          source_url?: string | null
          state?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string
          booking_likelihood?: string
          booking_signals?: string[]
          capacity_hint?: number | null
          captured_at?: string
          city?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          discovery_venue_id?: string | null
          disqualifiers?: string[]
          duplicate_of_lead_id?: string | null
          event_title?: string | null
          event_type?: string | null
          evidence_summary?: string
          id?: string
          metadata?: Json
          name?: string
          neighborhood?: string | null
          normalized_address?: string
          normalized_name?: string
          price_hint_cents_high?: number | null
          price_hint_cents_low?: number | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_platform?: string
          source_url?: string | null
          state?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_scout_venue_leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_scout_venue_leads_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_scout_venue_leads_duplicate_of_lead_id_fkey"
            columns: ["duplicate_of_lead_id"]
            isOneToOne: false
            referencedRelation: "supply_scout_venue_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_scout_venue_leads_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string
          description: string
          email: string
          id: string
          metadata: Json
          name: string | null
          related_plan_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          subject: string
          ticket_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          email: string
          id?: string
          metadata?: Json
          name?: string | null
          related_plan_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          status?: string
          subject: string
          ticket_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          email?: string
          id?: string
          metadata?: Json
          name?: string | null
          related_plan_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          subject?: string
          ticket_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_related_plan_id_fkey"
            columns: ["related_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
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
      template_runs: {
        Row: {
          budget_override_cents: number | null
          created_at: string
          expected_guest_count: number | null
          id: string
          new_date: string | null
          plan_id: string
          status: string
          template_id: string
          use_same_vendors: boolean
          use_same_venue: boolean
        }
        Insert: {
          budget_override_cents?: number | null
          created_at?: string
          expected_guest_count?: number | null
          id?: string
          new_date?: string | null
          plan_id: string
          status?: string
          template_id: string
          use_same_vendors?: boolean
          use_same_venue?: boolean
        }
        Update: {
          budget_override_cents?: number | null
          created_at?: string
          expected_guest_count?: number | null
          id?: string
          new_date?: string | null
          plan_id?: string
          status?: string
          template_id?: string
          use_same_vendors?: boolean
          use_same_venue?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "template_runs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          approval_checklist: Json
          budget_model: Json
          created_at: string
          email_copy: string | null
          event_type: string | null
          export_copy: string | null
          guest_count_max: number | null
          guest_count_min: number | null
          historical_performance: Json
          id: string
          kickback_model: Json
          name: string
          profit_assumptions: Json
          run_of_show: Json
          shopping_list: Json
          source_event_id: string | null
          source_plan_id: string | null
          target_audience: string | null
          ticket_price_model: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_checklist?: Json
          budget_model?: Json
          created_at?: string
          email_copy?: string | null
          event_type?: string | null
          export_copy?: string | null
          guest_count_max?: number | null
          guest_count_min?: number | null
          historical_performance?: Json
          id?: string
          kickback_model?: Json
          name: string
          profit_assumptions?: Json
          run_of_show?: Json
          shopping_list?: Json
          source_event_id?: string | null
          source_plan_id?: string | null
          target_audience?: string | null
          ticket_price_model?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_checklist?: Json
          budget_model?: Json
          created_at?: string
          email_copy?: string | null
          event_type?: string | null
          export_copy?: string | null
          guest_count_max?: number | null
          guest_count_min?: number | null
          historical_performance?: Json
          id?: string
          kickback_model?: Json
          name?: string
          profit_assumptions?: Json
          run_of_show?: Json
          shopping_list?: Json
          source_event_id?: string | null
          source_plan_id?: string | null
          target_audience?: string | null
          ticket_price_model?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_source_plan_id_fkey"
            columns: ["source_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      unlinked_ticket_events: {
        Row: {
          builder_id: string
          created_at: string
          external_event_id: string
          id: string
          linked_at: string | null
          linked_event_id: string | null
          payload: Json
          platform: string
          received_at: string
          updated_at: string
          webhook_event_id: string | null
          webhook_type: string | null
        }
        Insert: {
          builder_id: string
          created_at?: string
          external_event_id: string
          id?: string
          linked_at?: string | null
          linked_event_id?: string | null
          payload?: Json
          platform: string
          received_at?: string
          updated_at?: string
          webhook_event_id?: string | null
          webhook_type?: string | null
        }
        Update: {
          builder_id?: string
          created_at?: string
          external_event_id?: string
          id?: string
          linked_at?: string | null
          linked_event_id?: string | null
          payload?: Json
          platform?: string
          received_at?: string
          updated_at?: string
          webhook_event_id?: string | null
          webhook_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unlinked_ticket_events_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unlinked_ticket_events_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
          signup_terms_accepted_at: string | null
          signup_terms_version: string | null
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
          signup_terms_accepted_at?: string | null
          signup_terms_version?: string | null
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
          signup_terms_accepted_at?: string | null
          signup_terms_version?: string | null
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
          agent_action_id: string | null
          approval_id: string | null
          approved_terms_snapshot: Json | null
          booking_date: string
          cancellation_reason: string | null
          cancelled_at: string | null
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
          plan_id: string | null
          platform_fee_amount: number | null
          platform_fee_percentage: number | null
          quantity: number | null
          quoted_price: number | null
          quoted_price_cents: number | null
          refund_amount: number | null
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
          agent_action_id?: string | null
          approval_id?: string | null
          approved_terms_snapshot?: Json | null
          booking_date: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
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
          plan_id?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quantity?: number | null
          quoted_price?: number | null
          quoted_price_cents?: number | null
          refund_amount?: number | null
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
          agent_action_id?: string | null
          approval_id?: string | null
          approved_terms_snapshot?: Json | null
          booking_date?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
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
          plan_id?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quantity?: number | null
          quoted_price?: number | null
          quoted_price_cents?: number | null
          refund_amount?: number | null
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
            foreignKeyName: "vendor_bookings_action_plan_consistency_fkey"
            columns: ["agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "vendor_bookings_approval_action_plan_consistency_fkey"
            columns: ["approval_id", "agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "agent_action_id", "plan_id"]
          },
          {
            foreignKeyName: "vendor_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_bookings_event_plan_consistency_fkey"
            columns: ["event_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "plan_id"]
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
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
      vendor_invoice_sequences: {
        Row: {
          invoice_year: number
          last_value: number
        }
        Insert: {
          invoice_year: number
          last_value?: number
        }
        Update: {
          invoice_year?: number
          last_value?: number
        }
        Relationships: []
      }
      vendor_invoices: {
        Row: {
          booking_generation_key: string | null
          booking_id: string
          builder_id: string
          created_at: string
          deposit_amount: number
          deposit_due_date: string | null
          deposit_paid: boolean
          deposit_paid_at: string | null
          event_id: string
          final_amount: number
          final_due_date: string | null
          final_paid: boolean
          final_paid_at: string | null
          id: string
          invoice_number: string
          line_items: Json
          pdf_url: string | null
          sent_at: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          booking_generation_key?: string | null
          booking_id: string
          builder_id: string
          created_at?: string
          deposit_amount?: number
          deposit_due_date?: string | null
          deposit_paid?: boolean
          deposit_paid_at?: string | null
          event_id: string
          final_amount?: number
          final_due_date?: string | null
          final_paid?: boolean
          final_paid_at?: string | null
          id?: string
          invoice_number: string
          line_items?: Json
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          booking_generation_key?: string | null
          booking_id?: string
          builder_id?: string
          created_at?: string
          deposit_amount?: number
          deposit_due_date?: string | null
          deposit_paid?: boolean
          deposit_paid_at?: string | null
          event_id?: string
          final_amount?: number
          final_due_date?: string | null
          final_paid?: boolean
          final_paid_at?: string | null
          id?: string
          invoice_number?: string
          line_items?: Json
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "vendor_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_message_threads: {
        Row: {
          booking_id: string
          builder_id: string
          created_at: string | null
          id: string
          last_message_at: string | null
          status: string
          subject: string
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          booking_id: string
          builder_id: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          subject?: string
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          booking_id?: string
          builder_id?: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          subject?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_message_threads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "vendor_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_message_threads_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_message_threads_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_message_threads_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_message_typing_indicators: {
        Row: {
          sender_type: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          sender_type: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          sender_type?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_message_typing_indicators_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "vendor_message_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_message_typing_indicators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_messages: {
        Row: {
          attachments: Json | null
          created_at: string | null
          id: string
          message: string
          read_at: string | null
          sender_id: string
          sender_type: string
          thread_id: string
        }
        Insert: {
          attachments?: Json | null
          created_at?: string | null
          id?: string
          message?: string
          read_at?: string | null
          sender_id: string
          sender_type: string
          thread_id: string
        }
        Update: {
          attachments?: Json | null
          created_at?: string | null
          id?: string
          message?: string
          read_at?: string | null
          sender_id?: string
          sender_type?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "vendor_message_threads"
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_offerings_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_opportunity_briefs: {
        Row: {
          approval_status: string
          budget_range_cents: unknown
          created_at: string
          date_needed: string | null
          id: string
          organizer_user_id: string
          outreach_message: Json | null
          package_type: string
          plan_id: string
          quote_requested: boolean
          requirements: Json
          response_deadline: string | null
          summary: string
        }
        Insert: {
          approval_status?: string
          budget_range_cents?: unknown
          created_at?: string
          date_needed?: string | null
          id?: string
          organizer_user_id: string
          outreach_message?: Json | null
          package_type: string
          plan_id: string
          quote_requested?: boolean
          requirements?: Json
          response_deadline?: string | null
          summary: string
        }
        Update: {
          approval_status?: string
          budget_range_cents?: unknown
          created_at?: string
          date_needed?: string | null
          id?: string
          organizer_user_id?: string
          outreach_message?: Json | null
          package_type?: string
          plan_id?: string
          quote_requested?: boolean
          requirements?: Json
          response_deadline?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_opportunity_briefs_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_opportunity_briefs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_opportunity_invites: {
        Row: {
          brief_id: string
          created_at: string
          id: string
          magic_link_expires_at: string | null
          magic_link_token: string | null
          quoted_amount_cents: number | null
          response_at: string | null
          response_payload: Json
          sent_at: string | null
          status: string
          vendor_id: string
          viewed_at: string | null
        }
        Insert: {
          brief_id: string
          created_at?: string
          id?: string
          magic_link_expires_at?: string | null
          magic_link_token?: string | null
          quoted_amount_cents?: number | null
          response_at?: string | null
          response_payload?: Json
          sent_at?: string | null
          status?: string
          vendor_id: string
          viewed_at?: string | null
        }
        Update: {
          brief_id?: string
          created_at?: string
          id?: string
          magic_link_expires_at?: string | null
          magic_link_token?: string | null
          quoted_amount_cents?: number | null
          response_at?: string | null
          response_payload?: Json
          sent_at?: string | null
          status?: string
          vendor_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_opportunity_invites_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "vendor_opportunity_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_opportunity_invites_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_opportunity_invites_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_outreach_responses: {
        Row: {
          availability_confirmed: boolean | null
          classification: string | null
          classification_confidence: number | null
          conditions: Json | null
          created_at: string | null
          discovery_vendor_id: string
          extracted_at: string | null
          gmail_thread_id: string | null
          id: string
          model: string | null
          outreach_thread_id: string | null
          plan_id: string
          quoted_deposit_pct: number | null
          quoted_hourly_cents: number | null
          quoted_minimum_cents: number | null
          quoted_package_cents: number | null
          raw_response_excerpt: string | null
          updated_at: string | null
        }
        Insert: {
          availability_confirmed?: boolean | null
          classification?: string | null
          classification_confidence?: number | null
          conditions?: Json | null
          created_at?: string | null
          discovery_vendor_id: string
          extracted_at?: string | null
          gmail_thread_id?: string | null
          id?: string
          model?: string | null
          outreach_thread_id?: string | null
          plan_id: string
          quoted_deposit_pct?: number | null
          quoted_hourly_cents?: number | null
          quoted_minimum_cents?: number | null
          quoted_package_cents?: number | null
          raw_response_excerpt?: string | null
          updated_at?: string | null
        }
        Update: {
          availability_confirmed?: boolean | null
          classification?: string | null
          classification_confidence?: number | null
          conditions?: Json | null
          created_at?: string | null
          discovery_vendor_id?: string
          extracted_at?: string | null
          gmail_thread_id?: string | null
          id?: string
          model?: string | null
          outreach_thread_id?: string | null
          plan_id?: string
          quoted_deposit_pct?: number | null
          quoted_hourly_cents?: number | null
          quoted_minimum_cents?: number | null
          quoted_package_cents?: number | null
          raw_response_excerpt?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_outreach_responses_discovery_vendor_id_fkey"
            columns: ["discovery_vendor_id"]
            isOneToOne: false
            referencedRelation: "discovery_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_outreach_responses_outreach_thread_id_fkey"
            columns: ["outreach_thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_outreach_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
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
          cancellation_terms: string | null
          claim_status: string
          claimed_user_id: string | null
          compatible_features: string[] | null
          contact_email: string | null
          created_at: string | null
          default_tax_rate: number | null
          deposit_amount: number | null
          deposit_percentage: number | null
          deposit_refundable: boolean | null
          deposit_required: number | null
          deposit_terms: string | null
          deposit_type: string | null
          discovery_vendor_id: string | null
          emergency_available: boolean | null
          emergency_rate_uplift: number | null
          hourly_rate: number | null
          id: string
          invited_at: string | null
          invited_by_user_id: string | null
          is_admin_seeded: boolean
          is_claimed: boolean
          is_published: boolean | null
          languages: string[] | null
          lead_time_days: number | null
          minimum_hours: number | null
          name: string
          payout_enabled: boolean | null
          per_head_kickback: number | null
          per_person_rate: number | null
          phone: string | null
          photo_url: string | null
          portfolio_url: string | null
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
          stripe_skipped_at: string | null
          total_bookings: number | null
          total_earnings: number | null
          total_gigs: number | null
          travel_radius: string | null
          updated_at: string | null
          user_id: string | null
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
          cancellation_terms?: string | null
          claim_status?: string
          claimed_user_id?: string | null
          compatible_features?: string[] | null
          contact_email?: string | null
          created_at?: string | null
          default_tax_rate?: number | null
          deposit_amount?: number | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: number | null
          deposit_terms?: string | null
          deposit_type?: string | null
          discovery_vendor_id?: string | null
          emergency_available?: boolean | null
          emergency_rate_uplift?: number | null
          hourly_rate?: number | null
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          is_admin_seeded?: boolean
          is_claimed?: boolean
          is_published?: boolean | null
          languages?: string[] | null
          lead_time_days?: number | null
          minimum_hours?: number | null
          name: string
          payout_enabled?: boolean | null
          per_head_kickback?: number | null
          per_person_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          portfolio_url?: string | null
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
          stripe_skipped_at?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          total_gigs?: number | null
          travel_radius?: string | null
          updated_at?: string | null
          user_id?: string | null
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
          cancellation_terms?: string | null
          claim_status?: string
          claimed_user_id?: string | null
          compatible_features?: string[] | null
          contact_email?: string | null
          created_at?: string | null
          default_tax_rate?: number | null
          deposit_amount?: number | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_required?: number | null
          deposit_terms?: string | null
          deposit_type?: string | null
          discovery_vendor_id?: string | null
          emergency_available?: boolean | null
          emergency_rate_uplift?: number | null
          hourly_rate?: number | null
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          is_admin_seeded?: boolean
          is_claimed?: boolean
          is_published?: boolean | null
          languages?: string[] | null
          lead_time_days?: number | null
          minimum_hours?: number | null
          name?: string
          payout_enabled?: boolean | null
          per_head_kickback?: number | null
          per_person_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          portfolio_url?: string | null
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
          stripe_skipped_at?: string | null
          total_bookings?: number | null
          total_earnings?: number | null
          total_gigs?: number | null
          travel_radius?: string | null
          updated_at?: string | null
          user_id?: string | null
          vendor_type?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_profiles_discovery_vendor_id_fkey"
            columns: ["discovery_vendor_id"]
            isOneToOne: false
            referencedRelation: "discovery_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_rate_agreements: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string
          currency: string
          id: string
          organizer_user_id: string
          proposed_at: string
          rate_type: string
          source_event_id: string | null
          status: string
          vendor_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          organizer_user_id: string
          proposed_at?: string
          rate_type: string
          source_event_id?: string | null
          status?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          organizer_user_id?: string
          proposed_at?: string
          rate_type?: string
          source_event_id?: string | null
          status?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_rate_agreements_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_rate_agreements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_rate_agreements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
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
          disabled_reason: string | null
          id: string
          last_webhook_at: string | null
          last_webhook_event_id: string | null
          last_webhook_event_type: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_stripe_accounts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_transactions: {
        Row: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          amount: number
          amount_cents: number
          approval_id: string | null
          booking_id: string
          builder_id: string
          created_at: string
          id: string
          paid_at: string | null
          payment_type: string
          platform_fee: number
          platform_fee_cents: number
          status: string
          stripe_charge_id: string | null
          stripe_fee: number
          stripe_fee_cents: number
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          vendor_id: string
          vendor_payout: number
          vendor_payout_cents: number
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          amount: number
          amount_cents: number
          approval_id?: string | null
          booking_id: string
          builder_id: string
          created_at?: string
          id?: string
          paid_at?: string | null
          payment_type: string
          platform_fee?: number
          platform_fee_cents?: number
          status?: string
          stripe_charge_id?: string | null
          stripe_fee?: number
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          vendor_id: string
          vendor_payout?: number
          vendor_payout_cents?: number
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          amount?: number
          amount_cents?: number
          approval_id?: string | null
          booking_id?: string
          builder_id?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          payment_type?: string
          platform_fee?: number
          platform_fee_cents?: number
          status?: string
          stripe_charge_id?: string | null
          stripe_fee?: number
          stripe_fee_cents?: number
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          vendor_id?: string
          vendor_payout?: number
          vendor_payout_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_transactions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "vendor_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_transactions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "builder_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
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
          canonical_confirmation_booking_id: string | null
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
          canonical_confirmation_booking_id?: string | null
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
          canonical_confirmation_booking_id?: string | null
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
            foreignKeyName: "venue_booking_approval_audit_canonical_confirmation_bookin_fkey"
            columns: ["canonical_confirmation_booking_id"]
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
          agent_action_id: string | null
          approval_id: string | null
          approval_source: string | null
          approved_at: string | null
          approved_terms_snapshot: Json | null
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
          plan_id: string | null
          platform_fee_amount: number | null
          platform_fee_percentage: number | null
          quoted_price: number | null
          quoted_price_cents: number | null
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
          agent_action_id?: string | null
          approval_id?: string | null
          approval_source?: string | null
          approved_at?: string | null
          approved_terms_snapshot?: Json | null
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
          plan_id?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quoted_price?: number | null
          quoted_price_cents?: number | null
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
          agent_action_id?: string | null
          approval_id?: string | null
          approval_source?: string | null
          approved_at?: string | null
          approved_terms_snapshot?: Json | null
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
          plan_id?: string | null
          platform_fee_amount?: number | null
          platform_fee_percentage?: number | null
          quoted_price?: number | null
          quoted_price_cents?: number | null
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
            foreignKeyName: "venue_bookings_action_plan_consistency_fkey"
            columns: ["agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id", "plan_id"]
          },
          {
            foreignKeyName: "venue_bookings_approval_action_plan_consistency_fkey"
            columns: ["approval_id", "agent_action_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id", "agent_action_id", "plan_id"]
          },
          {
            foreignKeyName: "venue_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_bookings_event_plan_consistency_fkey"
            columns: ["event_id", "plan_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "plan_id"]
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
      venue_contact_profiles: {
        Row: {
          contact_name: string | null
          created_at: string
          discovery_venue_id: string | null
          email: string | null
          id: string
          instagram_handle: string | null
          phone_e164: string | null
          preferred_channel: string
          sms_opted_out_at: string | null
          source: string
          updated_at: string
          venue_id: string | null
          verified_at: string | null
          voice_allowed: boolean
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          discovery_venue_id?: string | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          phone_e164?: string | null
          preferred_channel?: string
          sms_opted_out_at?: string | null
          source?: string
          updated_at?: string
          venue_id?: string | null
          verified_at?: string | null
          voice_allowed?: boolean
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          discovery_venue_id?: string | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          phone_e164?: string | null
          preferred_channel?: string
          sms_opted_out_at?: string | null
          source?: string
          updated_at?: string
          venue_id?: string | null
          verified_at?: string | null
          voice_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "venue_contact_profiles_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_contact_profiles_venue_id_fkey"
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
      venue_opportunity_briefs: {
        Row: {
          approval_status: string
          budget_cents: number | null
          budget_range_cents: unknown
          created_at: string
          date_window: unknown
          date_window_end: string | null
          date_window_start: string | null
          deposit_target_cents: number | null
          event_components: Json
          event_type: string | null
          guest_count: number | null
          id: string
          must_haves: Json
          neighborhood: string | null
          organizer_user_id: string
          outreach_message: Json | null
          plan_id: string
          requested_terms: Json
          requirements: Json
          response_deadline: string | null
          status: string
          summary: string | null
          time_preference: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          budget_cents?: number | null
          budget_range_cents?: unknown
          created_at?: string
          date_window?: unknown
          date_window_end?: string | null
          date_window_start?: string | null
          deposit_target_cents?: number | null
          event_components?: Json
          event_type?: string | null
          guest_count?: number | null
          id?: string
          must_haves?: Json
          neighborhood?: string | null
          organizer_user_id: string
          outreach_message?: Json | null
          plan_id: string
          requested_terms?: Json
          requirements?: Json
          response_deadline?: string | null
          status?: string
          summary?: string | null
          time_preference?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          budget_cents?: number | null
          budget_range_cents?: unknown
          created_at?: string
          date_window?: unknown
          date_window_end?: string | null
          date_window_start?: string | null
          deposit_target_cents?: number | null
          event_components?: Json
          event_type?: string | null
          guest_count?: number | null
          id?: string
          must_haves?: Json
          neighborhood?: string | null
          organizer_user_id?: string
          outreach_message?: Json | null
          plan_id?: string
          requested_terms?: Json
          requirements?: Json
          response_deadline?: string | null
          status?: string
          summary?: string | null
          time_preference?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_opportunity_briefs_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opportunity_briefs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_opportunity_invites: {
        Row: {
          admin_notes: string | null
          blocked_reason: string | null
          brief_id: string
          budget_fit: boolean
          capacity_fit: boolean
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          expires_at: string | null
          id: string
          is_claimed: boolean
          magic_link_expires_at: string | null
          magic_link_token: string | null
          match_score: number
          opportunity_id: string
          payment_confirmation_requested_at: string | null
          proposed_deposit_cents: number | null
          quoted_price_cents: number | null
          requirement_fit: Json
          responded_at: string | null
          response_at: string | null
          response_payload: Json
          route_to_concierge: boolean
          sent_at: string | null
          status: string
          stripe_ready_at: string | null
          stripe_setup_started_at: string | null
          target_type: string
          updated_at: string
          vendor_profile_id: string | null
          venue_id: string | null
          venue_response_json: Json
          viewed_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          blocked_reason?: string | null
          brief_id: string
          budget_fit?: boolean
          capacity_fit?: boolean
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at?: string | null
          id?: string
          is_claimed?: boolean
          magic_link_expires_at?: string | null
          magic_link_token?: string | null
          match_score?: number
          opportunity_id: string
          payment_confirmation_requested_at?: string | null
          proposed_deposit_cents?: number | null
          quoted_price_cents?: number | null
          requirement_fit?: Json
          responded_at?: string | null
          response_at?: string | null
          response_payload?: Json
          route_to_concierge?: boolean
          sent_at?: string | null
          status?: string
          stripe_ready_at?: string | null
          stripe_setup_started_at?: string | null
          target_type: string
          updated_at?: string
          vendor_profile_id?: string | null
          venue_id?: string | null
          venue_response_json?: Json
          viewed_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          blocked_reason?: string | null
          brief_id?: string
          budget_fit?: boolean
          capacity_fit?: boolean
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at?: string | null
          id?: string
          is_claimed?: boolean
          magic_link_expires_at?: string | null
          magic_link_token?: string | null
          match_score?: number
          opportunity_id?: string
          payment_confirmation_requested_at?: string | null
          proposed_deposit_cents?: number | null
          quoted_price_cents?: number | null
          requirement_fit?: Json
          responded_at?: string | null
          response_at?: string | null
          response_payload?: Json
          route_to_concierge?: boolean
          sent_at?: string | null
          status?: string
          stripe_ready_at?: string | null
          stripe_setup_started_at?: string | null
          target_type?: string
          updated_at?: string
          vendor_profile_id?: string | null
          venue_id?: string | null
          venue_response_json?: Json
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_opportunity_invites_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "venue_opportunity_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opportunity_invites_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "venue_opportunity_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opportunity_invites_vendor_profile_id_fkey"
            columns: ["vendor_profile_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "venue_opportunity_invites_vendor_profile_id_fkey"
            columns: ["vendor_profile_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_opportunity_invites_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_outreach_responses: {
        Row: {
          availability_confirmed: boolean | null
          capacity_confirmed: number | null
          classification: string | null
          classification_confidence: number | null
          conditions: Json | null
          created_at: string | null
          discovery_venue_id: string
          extracted_at: string | null
          gmail_thread_id: string | null
          id: string
          model: string | null
          outreach_thread_id: string | null
          plan_id: string
          quoted_deal_model: string | null
          quoted_price_cents: number | null
          raw_response_excerpt: string | null
          updated_at: string | null
        }
        Insert: {
          availability_confirmed?: boolean | null
          capacity_confirmed?: number | null
          classification?: string | null
          classification_confidence?: number | null
          conditions?: Json | null
          created_at?: string | null
          discovery_venue_id: string
          extracted_at?: string | null
          gmail_thread_id?: string | null
          id?: string
          model?: string | null
          outreach_thread_id?: string | null
          plan_id: string
          quoted_deal_model?: string | null
          quoted_price_cents?: number | null
          raw_response_excerpt?: string | null
          updated_at?: string | null
        }
        Update: {
          availability_confirmed?: boolean | null
          capacity_confirmed?: number | null
          classification?: string | null
          classification_confidence?: number | null
          conditions?: Json | null
          created_at?: string | null
          discovery_venue_id?: string
          extracted_at?: string | null
          gmail_thread_id?: string | null
          id?: string
          model?: string | null
          outreach_thread_id?: string | null
          plan_id?: string
          quoted_deal_model?: string | null
          quoted_price_cents?: number | null
          raw_response_excerpt?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_outreach_responses_discovery_venue_id_fkey"
            columns: ["discovery_venue_id"]
            isOneToOne: false
            referencedRelation: "discovery_venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_outreach_responses_outreach_thread_id_fkey"
            columns: ["outreach_thread_id"]
            isOneToOne: false
            referencedRelation: "outreach_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_outreach_responses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_payment_transactions: {
        Row: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          amount_cents: number
          application_fee_cents: number
          approval_id: string | null
          builder_id: string
          created_at: string
          currency: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          paid_at: string | null
          payment_method_type: string
          plan_id: string
          processing_fee_cents: number
          refund_amount_cents: number | null
          refund_approved_at: string | null
          refund_approved_by: string | null
          refund_reason: string | null
          refund_requested_at: string | null
          refund_requested_by: string | null
          status: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          stripe_transfer_id: string | null
          stripe_transfer_reversal_id: string | null
          transfer_completed_at: string | null
          updated_at: string
          venue_booking_id: string | null
          venue_id: string
          venue_owner_id: string
          venue_payout_cents: number
        }
        Insert: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          amount_cents: number
          application_fee_cents?: number
          approval_id?: string | null
          builder_id: string
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          payment_method_type: string
          plan_id: string
          processing_fee_cents?: number
          refund_amount_cents?: number | null
          refund_approved_at?: string | null
          refund_approved_by?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_requested_by?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
          transfer_completed_at?: string | null
          updated_at?: string
          venue_booking_id?: string | null
          venue_id: string
          venue_owner_id: string
          venue_payout_cents: number
        }
        Update: {
          account_state_block_reason?: string | null
          account_state_blocked_at?: string | null
          amount_cents?: number
          application_fee_cents?: number
          approval_id?: string | null
          builder_id?: string
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          paid_at?: string | null
          payment_method_type?: string
          plan_id?: string
          processing_fee_cents?: number
          refund_amount_cents?: number | null
          refund_approved_at?: string | null
          refund_approved_by?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_requested_by?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_id?: string | null
          stripe_transfer_reversal_id?: string | null
          transfer_completed_at?: string | null
          updated_at?: string
          venue_booking_id?: string | null
          venue_id?: string
          venue_owner_id?: string
          venue_payout_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "venue_payment_transactions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_builder_id_fkey"
            columns: ["builder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_refund_approved_by_fkey"
            columns: ["refund_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_refund_requested_by_fkey"
            columns: ["refund_requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_venue_booking_id_fkey"
            columns: ["venue_booking_id"]
            isOneToOne: false
            referencedRelation: "venue_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_payment_transactions_venue_owner_id_fkey"
            columns: ["venue_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      venue_settlement_tokens: {
        Row: {
          created_at: string
          expires_at: string
          first_viewed_at: string | null
          id: string
          last_viewed_at: string | null
          revoked_at: string | null
          settlement_run_id: string
          token_hash: string
          updated_at: string
          venue_email: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          first_viewed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          settlement_run_id: string
          token_hash: string
          updated_at?: string
          venue_email?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          first_viewed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          settlement_run_id?: string
          token_hash?: string
          updated_at?: string
          venue_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_settlement_tokens_settlement_run_id_fkey"
            columns: ["settlement_run_id"]
            isOneToOne: false
            referencedRelation: "settlement_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_stripe_accounts: {
        Row: {
          account_status: string
          charges_enabled: boolean
          created_at: string
          disabled_reason: string | null
          id: string
          last_webhook_at: string | null
          last_webhook_event_id: string | null
          last_webhook_event_type: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
          disabled_reason?: string | null
          id?: string
          last_webhook_at?: string | null
          last_webhook_event_id?: string | null
          last_webhook_event_type?: string | null
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
      venue_term_agreements: {
        Row: {
          amount_cents: number | null
          confirmed_at: string | null
          created_at: string
          currency: string
          id: string
          organizer_user_id: string
          proposed_at: string
          source_event_id: string | null
          status: string
          term_type: string
          venue_id: string
        }
        Insert: {
          amount_cents?: number | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          organizer_user_id: string
          proposed_at?: string
          source_event_id?: string | null
          status?: string
          term_type: string
          venue_id: string
        }
        Update: {
          amount_cents?: number | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          organizer_user_id?: string
          proposed_at?: string
          source_event_id?: string | null
          status?: string
          term_type?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_term_agreements_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_term_agreements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          auto_approve_conditions: Json | null
          auto_approve_threshold: number | null
          available_days: string[] | null
          average_rating: number | null
          bar_rev_share_enabled: boolean
          bar_rev_share_pct: number
          bar_revenue_percentage: number | null
          bar_revenue_share_enabled: boolean | null
          bar_revenue_share_percent: number | null
          bulk_approval_enabled: boolean | null
          cancellation_terms: string | null
          city: string | null
          claim_status: string
          claimed_user_id: string | null
          contact_email: string | null
          contact_name: string | null
          contact_role: string | null
          created_at: string | null
          daily_rate_cents: number | null
          default_kickback_type: string | null
          deposit_amount: number | null
          deposit_amount_cents: number | null
          deposit_due: string | null
          deposit_percentage: number | null
          deposit_refundable: boolean | null
          deposit_terms: string | null
          deposit_type: string | null
          description: string | null
          hourly_rate: number | null
          hourly_rate_cents: number | null
          id: string
          invited_at: string | null
          invited_by_user_id: string | null
          is_admin_seeded: boolean
          is_claimed: boolean
          is_published: boolean | null
          last_overdue_count_notified: number
          latitude: number | null
          loading_address: string | null
          longitude: number | null
          minimum_hours: number | null
          offers_kickbacks: boolean | null
          open_from: string | null
          open_to: string | null
          owner_id: string | null
          per_head_kickback: number | null
          per_head_kickback_amount: number | null
          per_head_kickback_cents: number
          prep_time_hours: number | null
          price_per_night_cents: number | null
          pricing_model: string | null
          requires_deposit: boolean | null
          seated_capacity: number | null
          slug: string | null
          sponsor_rev_share_enabled: boolean
          sponsor_rev_share_pct: number
          square_footage: number | null
          standing_capacity: number | null
          state: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          ticket_sales_share_enabled: boolean | null
          ticket_sales_share_pct: number
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
          available_days?: string[] | null
          average_rating?: number | null
          bar_rev_share_enabled?: boolean
          bar_rev_share_pct?: number
          bar_revenue_percentage?: number | null
          bar_revenue_share_enabled?: boolean | null
          bar_revenue_share_percent?: number | null
          bulk_approval_enabled?: boolean | null
          cancellation_terms?: string | null
          city?: string | null
          claim_status?: string
          claimed_user_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string | null
          daily_rate_cents?: number | null
          default_kickback_type?: string | null
          deposit_amount?: number | null
          deposit_amount_cents?: number | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_terms?: string | null
          deposit_type?: string | null
          description?: string | null
          hourly_rate?: number | null
          hourly_rate_cents?: number | null
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          is_admin_seeded?: boolean
          is_claimed?: boolean
          is_published?: boolean | null
          last_overdue_count_notified?: number
          latitude?: number | null
          loading_address?: string | null
          longitude?: number | null
          minimum_hours?: number | null
          offers_kickbacks?: boolean | null
          open_from?: string | null
          open_to?: string | null
          owner_id?: string | null
          per_head_kickback?: number | null
          per_head_kickback_amount?: number | null
          per_head_kickback_cents?: number
          prep_time_hours?: number | null
          price_per_night_cents?: number | null
          pricing_model?: string | null
          requires_deposit?: boolean | null
          seated_capacity?: number | null
          slug?: string | null
          sponsor_rev_share_enabled?: boolean
          sponsor_rev_share_pct?: number
          square_footage?: number | null
          standing_capacity?: number | null
          state?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          ticket_sales_share_enabled?: boolean | null
          ticket_sales_share_pct?: number
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
          available_days?: string[] | null
          average_rating?: number | null
          bar_rev_share_enabled?: boolean
          bar_rev_share_pct?: number
          bar_revenue_percentage?: number | null
          bar_revenue_share_enabled?: boolean | null
          bar_revenue_share_percent?: number | null
          bulk_approval_enabled?: boolean | null
          cancellation_terms?: string | null
          city?: string | null
          claim_status?: string
          claimed_user_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_role?: string | null
          created_at?: string | null
          daily_rate_cents?: number | null
          default_kickback_type?: string | null
          deposit_amount?: number | null
          deposit_amount_cents?: number | null
          deposit_due?: string | null
          deposit_percentage?: number | null
          deposit_refundable?: boolean | null
          deposit_terms?: string | null
          deposit_type?: string | null
          description?: string | null
          hourly_rate?: number | null
          hourly_rate_cents?: number | null
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          is_admin_seeded?: boolean
          is_claimed?: boolean
          is_published?: boolean | null
          last_overdue_count_notified?: number
          latitude?: number | null
          loading_address?: string | null
          longitude?: number | null
          minimum_hours?: number | null
          offers_kickbacks?: boolean | null
          open_from?: string | null
          open_to?: string | null
          owner_id?: string | null
          per_head_kickback?: number | null
          per_head_kickback_amount?: number | null
          per_head_kickback_cents?: number
          prep_time_hours?: number | null
          price_per_night_cents?: number | null
          pricing_model?: string | null
          requires_deposit?: boolean | null
          seated_capacity?: number | null
          slug?: string | null
          sponsor_rev_share_enabled?: boolean
          sponsor_rev_share_pct?: number
          square_footage?: number | null
          standing_capacity?: number | null
          state?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          ticket_sales_share_enabled?: boolean | null
          ticket_sales_share_pct?: number
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
      webhook_logs: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error: string | null
          event_type: string
          id: string
          outcome: string
          provider: string | null
          request_payload: Json
          response_payload: Json
          source: string
          status_code: number | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_type: string
          id?: string
          outcome: string
          provider?: string | null
          request_payload?: Json
          response_payload?: Json
          source: string
          status_code?: number | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          event_type?: string
          id?: string
          outcome?: string
          provider?: string | null
          request_payload?: Json
          response_payload?: Json
          source?: string
          status_code?: number | null
        }
        Relationships: []
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
      archetype_baselines: {
        Row: {
          archetype: string | null
          avg_attendance_rate: number | null
          avg_margin_cents: number | null
          avg_no_show_rate: number | null
          avg_sell_through: number | null
          n_events: number | null
          neighborhood: string | null
          refreshed_at: string | null
          stddev_margin_cents: number | null
        }
        Relationships: []
      }
      community_host_incentive_payments: {
        Row: {
          agreement_id: string | null
          amount_cents: number | null
          builder_payout_cents: number | null
          created_at: string | null
          due_at: string | null
          event_id: string | null
          id: string | null
          is_legacy_consumption_share: boolean | null
          is_legacy_revenue_share: boolean | null
          metadata: Json | null
          organizer_user_id: string | null
          paid_at: string | null
          plan_id: string | null
          status: string | null
          stripe_invoice_id: string | null
          stripe_transfer_id: string | null
          updated_at: string | null
          venue_id: string | null
          venue_owner_user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_host_incentive_agreements_organizer_user_id_fkey"
            columns: ["organizer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_agreements_venue_owner_user_id_fkey"
            columns: ["venue_owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_settlements_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "community_host_incentive_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_host_incentive_settlements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_sales_rollups: {
        Row: {
          average_ticket_price_cents: number | null
          currency: string | null
          event_id: string | null
          fees_cents: number | null
          first_sale_at: string | null
          gross_revenue_cents: number | null
          last_sale_at: string | null
          net_revenue_cents: number | null
          platform: string | null
          refund_amount_cents: number | null
          ticket_tier_category: string | null
          ticket_tier_name: string | null
          tickets_refunded: number | null
          tickets_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_sales_data_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_baselines: {
        Row: {
          archetype: string | null
          avg_attendance_rate: number | null
          avg_margin_cents: number | null
          avg_no_show_rate: number | null
          avg_sell_through: number | null
          n_events: number | null
          organizer_id: string | null
          refreshed_at: string | null
          stddev_margin_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "builder_profiles_user_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_vendor_relationships_vendor_view: {
        Row: {
          created_at: string | null
          first_worked_at: string | null
          id: string | null
          organizer_user_id: string | null
          source: string | null
          trust_tier: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          first_worked_at?: string | null
          id?: string | null
          organizer_user_id?: string | null
          source?: string | null
          trust_tier?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          first_worked_at?: string | null
          id?: string | null
          organizer_user_id?: string | null
          source?: string | null
          trust_tier?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizer_vendor_relationships_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_analytics"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "organizer_vendor_relationships_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_analytics: {
        Row: {
          acceptance_rate: number | null
          average_rating: number | null
          avg_booking_value: number | null
          avg_response_hours: number | null
          cancellation_rate: number | null
          cancelled_bookings: number | null
          completed_bookings: number | null
          confirmed_bookings: number | null
          conversion_rate: number | null
          refreshed_at: string | null
          total_bookings: number | null
          total_revenue: number | null
          total_reviews: number | null
          vendor_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      annotate_plan_quote_event_lineage: {
        Args: { p_event_id: string; p_plan_id: string }
        Returns: {
          agent_action: string | null
          brief_render_version: number
          budget_cap_cents: number | null
          committed_vendors: Json | null
          committed_venue_at: string | null
          committed_venue_id: string | null
          committed_venue_quoted_deal_model: string | null
          committed_venue_quoted_price_cents: number | null
          committed_venue_quoted_terms: Json | null
          created_at: string
          date_window_end: string | null
          date_window_start: string | null
          derived_state_recomputed_at: string | null
          event_city: string | null
          event_type: string | null
          excluded_cuisines: string[]
          excluded_vendor_attributes: Json
          food_responsibility: string | null
          guest_count: number | null
          id: string
          latest_venue_hold_outcome: Json | null
          materialized_event_id: string | null
          metadata: Json
          neighborhood: string | null
          notes: string | null
          plan_revision_count: number
          preferred_vendor_attributes: Json
          profit_goal_cents: number | null
          special_supply_radius_miles: number
          status: Database["public"]["Enums"]["planner_plan_status"]
          ticketed: boolean
          ticketing_model: string | null
          title: string
          updated_at: string
          user_id: string
          vendor_approved_adjacent_cities: string[]
          vendor_out_of_city_approved: boolean
          vendor_same_city_required: boolean
          venue_terms: string | null
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_plan_revision_atomic: {
        Args: {
          p_impact?: Json
          p_plan_id: string
          p_plan_updates?: Json
          p_reason?: string
          p_source_message_id?: string
          p_trigger: Json
          p_user_id: string
        }
        Returns: {
          impact: Json
          new_revision_count: number
          revision_id: string
        }[]
      }
      apply_planner_deposit_refund: {
        Args: {
          p_charge_amount_captured_cents: number
          p_charge_refunded: boolean
          p_currency: string
          p_event_id: string
          p_refunded_amount_cents: number
          p_stripe_payment_intent_id: string
        }
        Returns: Json
      }
      assert_canonical_booking_partner_binding: {
        Args: {
          p_agent_action_id: string
          p_approval_id: string
          p_booking_kind: string
          p_physical_partner_id: string
          p_plan_id: string
        }
        Returns: undefined
      }
      bind_discovery_vendor_claim: {
        Args: {
          p_actor_id?: string
          p_discovery_vendor_id: string
          p_vendor_profile_id: string
        }
        Returns: Json
      }
      block_inflight_stripe_account_payments: {
        Args: {
          p_event_id: string
          p_reason: string
          p_stripe_account_id: string
        }
        Returns: Json
      }
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
      can_manage_event_cost_commitment_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_event_revenue_term_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_live_recommendation_org: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      can_manage_plan_read_model: {
        Args: { p_plan_id: string }
        Returns: boolean
      }
      cancel_admin_task_execution: {
        Args: {
          p_actor_id: string
          p_host_message?: string
          p_reason?: string
          p_task_id: string
        }
        Returns: {
          agent_action_id: string | null
          approval_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          outcome_payload: Json
          plan_id: string
          priority: string
          status: string
          task_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "admin_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_approved_admin_task: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_host_message?: string
          p_plan_id: string
          p_reason?: string
        }
        Returns: {
          agent_action_id: string | null
          approval_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          outcome_payload: Json
          plan_id: string
          priority: string
          status: string
          task_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "admin_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_executing_canonical_quote_booking: {
        Args: {
          p_actor_id: string
          p_agent_action_id: string
          p_approval_id: string
          p_plan_id: string
          p_reason: string
        }
        Returns: Json
      }
      cancel_executing_canonical_quote_booking_pre_frozen_binding: {
        Args: {
          p_actor_id: string
          p_agent_action_id: string
          p_approval_id: string
          p_plan_id: string
          p_reason: string
        }
        Returns: Json
      }
      cancel_external_checkout_handoff: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_expected_snapshot_hash: string
          p_idempotency_key: string
          p_plan_id: string
          p_reason: string
        }
        Returns: Json
      }
      cancel_staged_plan_quote_booking: {
        Args: {
          p_actor_id: string
          p_plan_id: string
          p_quote_kind: string
          p_response_id: string
        }
        Returns: Json
      }
      canonical_booking_has_execution_provenance: {
        Args: {
          p_agent_action_id: string
          p_approval_id: string
          p_approved_terms_snapshot: Json
          p_booking_kind: string
          p_booking_status: string
          p_event_id: string
          p_organizer_id: string
          p_partner_id: string
          p_plan_id: string
          p_quoted_price_cents: number
        }
        Returns: boolean
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
      claim_canonical_quote_booking_materialization_resume: {
        Args: {
          p_actor_id: string
          p_agent_action_id: string
          p_approval_id: string
          p_expected_snapshot_hash: string
          p_plan_id: string
        }
        Returns: Json
      }
      claim_failed_action_retry: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_expected_snapshot_hash: string
          p_idempotency_key: string
          p_plan_id: string
        }
        Returns: {
          action_status: string
          outcome: string
          result_metadata: Json
        }[]
      }
      complete_admin_task_execution: {
        Args: {
          p_admin_user_id: string
          p_host_message?: string
          p_internal_note?: string
          p_outcome_payload?: Json
          p_task_id: string
        }
        Returns: {
          agent_action_id: string | null
          approval_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          outcome_payload: Json
          plan_id: string
          priority: string
          status: string
          task_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "admin_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_write_pause_drain: {
        Args: {
          p_changed_by: string
          p_expected_revision: number
          p_reason: string
        }
        Returns: Json
      }
      confirm_canonical_booking: {
        Args: {
          p_actor_id: string
          p_booking_id: string
          p_booking_kind: string
          p_confirmation_context?: Json
        }
        Returns: Json
      }
      confirm_canonical_booking_pre_frozen_binding: {
        Args: {
          p_actor_id: string
          p_booking_id: string
          p_booking_kind: string
          p_confirmation_context?: Json
        }
        Returns: Json
      }
      confirm_canonical_venue_bookings_batch: {
        Args: {
          p_actor_id: string
          p_booking_ids: string[]
          p_confirmation_context?: Json
        }
        Returns: Json
      }
      confirm_external_checkout_handoff: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_expected_snapshot_hash: string
          p_plan_id: string
        }
        Returns: Json
      }
      consume_builder_event_access: {
        Args: {
          p_builder_id: string
          p_default_free_events_granted?: number
          p_event_id: string
          p_pay_per_event_amount_cents?: number
          p_pro_monthly_amount_cents?: number
        }
        Returns: {
          amount: number
          amount_cents: number
          builder_id: string
          created_at: string
          event_id: string
          id: string
          source: string
          source_metadata: Json
          updated_at: string
        }[]
      }
      consume_webhook_rate_limit: {
        Args: { p_key: string; p_limit?: number; p_window_seconds?: number }
        Returns: boolean
      }
      create_canonical_booking_from_approval: {
        Args: {
          p_actor_id: string
          p_agent_action_id: string
          p_approval_id: string
          p_plan_id: string
        }
        Returns: Json
      }
      create_vendor_invite: {
        Args: {
          p_amount: number
          p_email: string
          p_organizer_user_id: string
          p_phone: string
          p_rate_type: string
          p_service_type: string
          p_source_event_id?: string
          p_vendor_name: string
        }
        Returns: {
          existing: boolean
          rate_agreement_id: string
          relationship_id: string
          vendor_id: string
        }[]
      }
      create_venue_invite: {
        Args: {
          p_amount_cents?: number
          p_city?: string
          p_contact_email: string
          p_contact_name?: string
          p_contact_role?: string
          p_organizer_user_id: string
          p_seated_capacity?: number
          p_source_event_id?: string
          p_standing_capacity?: number
          p_state?: string
          p_term_type?: string
          p_venue_name: string
          p_venue_type?: string
        }
        Returns: {
          existing: boolean
          relationship_id: string
          term_agreement_id: string
          venue_id: string
        }[]
      }
      decline_canonical_bookings: {
        Args: {
          p_actor_id: string
          p_booking_ids: string[]
          p_booking_kind: string
          p_decline_context?: Json
          p_reason: string
        }
        Returns: Json
      }
      decline_canonical_bookings_pre_frozen_binding: {
        Args: {
          p_actor_id: string
          p_booking_ids: string[]
          p_booking_kind: string
          p_decline_context?: Json
          p_reason: string
        }
        Returns: Json
      }
      defer_stripe_webhook_for_maintenance: {
        Args: {
          p_endpoint_path: string
          p_reservation_token: string
          p_stripe_event_id: string
        }
        Returns: Json
      }
      discovery_venues_search_document: {
        Args: {
          venue_name: string
          venue_neighborhood: string
          venue_vibe_tags: string[]
        }
        Returns: string
      }
      enqueue_approved_admin_task: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_description: string
          p_due_at?: string
          p_host_message?: string
          p_metadata?: Json
          p_plan_id: string
          p_priority?: string
          p_task_type: string
        }
        Returns: {
          agent_action_id: string | null
          approval_id: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string
          due_at: string | null
          event_id: string | null
          id: string
          metadata: Json
          notes: string | null
          outcome_payload: Json
          plan_id: string
          priority: string
          status: string
          task_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "admin_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_canonical_booking_partner_binding: {
        Args: {
          p_agent_action_id: string
          p_approval_id: string
          p_booking_kind: string
          p_physical_partner_id: string
          p_plan_id: string
        }
        Returns: {
          agent_action_id: string
          approval_id: string
          approval_snapshot_hash: string
          binding_source: string
          booking_kind: string
          bound_at: string
          bound_by: string | null
          discovery_partner_id: string
          id: string
          physical_partner_id: string
          plan_id: string
        }
        SetofOptions: {
          from: "*"
          to: "canonical_booking_partner_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_canonical_venue_confirmation_effects: {
        Args: {
          p_actor_id: string
          p_booking_ids: string[]
          p_message?: string
        }
        Returns: Json
      }
      ensure_planner_deposit_payout: {
        Args: { p_payment_intent_id: string }
        Returns: Json
      }
      finalize_approved_action_handoff_retry: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_idempotency_key: string
          p_outcome: string
          p_plan_id: string
          p_result: Json
          p_success_action_status: string
        }
        Returns: {
          action_status: string
          outcome: string
          result_metadata: Json
        }[]
      }
      finalize_failed_action_retry: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_idempotency_key: string
          p_outcome: string
          p_plan_id: string
          p_result: Json
        }
        Returns: {
          action_status: string
          outcome: string
          result_metadata: Json
        }[]
      }
      get_event_kickback_summary: {
        Args: { p_event_id: string }
        Returns: Json
      }
      get_vendor_booking_amount: {
        Args: {
          p_booking: Database["public"]["Tables"]["vendor_bookings"]["Row"]
        }
        Returns: number
      }
      get_vendor_booking_calendar_date: {
        Args: {
          p_booking: Database["public"]["Tables"]["vendor_bookings"]["Row"]
        }
        Returns: string
      }
      get_vendor_bookings_by_month: {
        Args: { p_end_date?: string; p_start_date: string; p_vendor_id: string }
        Returns: {
          bookings: number
          month: string
        }[]
      }
      get_vendor_pending_revenue: {
        Args: { p_start_date?: string; p_vendor_id: string }
        Returns: {
          pending_revenue: number
        }[]
      }
      get_vendor_period_summary: {
        Args: { p_end_date: string; p_start_date: string; p_vendor_id: string }
        Returns: {
          avg_booking_value: number
          bookings: number
          revenue: number
        }[]
      }
      get_vendor_popular_services: {
        Args: { p_end_date: string; p_start_date: string; p_vendor_id: string }
        Returns: {
          bookings: number
          revenue: number
          service_name: string
        }[]
      }
      get_vendor_revenue_by_month: {
        Args: { p_end_date?: string; p_start_date: string; p_vendor_id: string }
        Returns: {
          month: string
          revenue: number
        }[]
      }
      increment_event_usage: {
        Args: { p_builder_id: string; p_fee_paid: number; p_month: string }
        Returns: undefined
      }
      increment_stripe_webhook_duplicate_count:
        | { Args: { p_stripe_event_id: string }; Returns: undefined }
        | {
            Args: { p_endpoint_path?: string; p_stripe_event_id: string }
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
      is_event_builder: { Args: { p_event_id: string }; Returns: boolean }
      is_event_collaborator: { Args: { p_event_id: string }; Returns: boolean }
      materialize_builder_event_with_access: {
        Args: {
          p_budget_cents: number
          p_builder_id: string
          p_description: string
          p_duration_hours: number
          p_end_time: string
          p_event_date: string
          p_event_type: string
          p_expected_attendance: number
          p_idempotency_key: string
          p_payload_hash: string
          p_start_time: string
          p_status: string
          p_title: string
          p_user_id: string
        }
        Returns: {
          access_source: string
          amount_cents: number
          consumption_id: string
          event_id: string
          event_record: Json
          existing: boolean
          plan_id: string
        }[]
      }
      materialize_plan_event: {
        Args: {
          p_actor_id: string
          p_archetype_key: string
          p_duration_minutes: number
          p_event_date: string
          p_plan_id: string
          p_start_time: string
          p_time_zone: string
        }
        Returns: {
          event_id: string
          event_record: Json
          existing: boolean
          plan_status: string
        }[]
      }
      next_vendor_invoice_number: { Args: { p_year: number }; Returns: string }
      prepare_approved_vendor_contact_draft: {
        Args: {
          p_action_id: string
          p_actor_id: string
          p_approval_id: string
          p_plan_id: string
        }
        Returns: Json
      }
      recalculate_vendor_review_stats: {
        Args: { p_vendor_id: string }
        Returns: undefined
      }
      record_plan_event_outcome: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_outcome_summary: Json
        }
        Returns: {
          actual_cost: number | null
          budget: number | null
          builder_id: string
          completion_percentage: number | null
          created_at: string | null
          description: string | null
          duration_hours: number
          end_time: string
          ends_at: string | null
          event_date: string
          event_description: string | null
          event_name: string
          event_time: string | null
          event_type: string
          eventbrite_event_id: string | null
          expected_attendance: number | null
          expected_attendance_max: number | null
          expected_attendance_min: number | null
          field_confidence: Json
          id: string
          is_recurring: boolean | null
          kickback_agreement_id: string | null
          latest_venue_hold_outcome: Json | null
          outcome_recorded_at: string | null
          outcome_summary: Json | null
          parent_event_id: string | null
          plan_id: string | null
          platform_fee_id: string | null
          platform_fee_paid: boolean | null
          posh_event_id: string | null
          recurring_frequency: string | null
          recurring_occurrences: number | null
          start_time: string
          starts_at: string | null
          status: string | null
          time_zone: string | null
          total_budget: number | null
          updated_at: string | null
          venue_confirmed: boolean | null
          venue_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_plan_event_outcome_command: {
        Args: {
          p_actor_id: string
          p_event_id: string
          p_outcome_summary: Json
        }
        Returns: Json
      }
      record_stripe_webhook_event_result:
        | {
            Args: {
              p_endpoint_path: string
              p_error?: string
              p_event_type: string
              p_livemode: boolean
              p_payload: Json
              p_processed: boolean
              p_processing_outcome: string
              p_source: string
              p_stripe_event_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_endpoint_path: string
              p_error: string
              p_event_type: string
              p_livemode: boolean
              p_payload: Json
              p_processed: boolean
              p_processing_outcome: string
              p_reservation_token: string
              p_source: string
              p_stripe_event_id: string
            }
            Returns: Json
          }
      refresh_projection_baselines: {
        Args: never
        Returns: {
          archetype_rows: number
          organizer_rows: number
        }[]
      }
      refresh_vendor_analytics: { Args: never; Returns: undefined }
      release_stale_stripe_webhook_reservations: {
        Args: { p_older_than?: string }
        Returns: {
          released_count: number
        }[]
      }
      repair_vendor_base_rate_atomic: {
        Args: {
          p_admin_user_id?: string
          p_audit_action: string
          p_expected_base_rate: number
          p_metadata?: Json
          p_new_base_rate_cents: number
          p_vendor_id: string
        }
        Returns: Json
      }
      require_canonical_quote_booking_reapproval: {
        Args: {
          p_actor_id: string
          p_agent_action_id: string
          p_approval_id: string
          p_expected_snapshot_hash: string
          p_plan_id: string
          p_reason: string
        }
        Returns: Json
      }
      reserve_planner_deposit_capture: {
        Args: {
          p_approval_id: string
          p_capture_attempt_id: string
          p_expected_amount_cents: number
          p_expected_partner_id: string
          p_expected_partner_kind: string
          p_expected_snapshot_hash: string
          p_payment_intent_id: string
          p_plan_id: string
        }
        Returns: {
          account_state_block_reason: string | null
          account_state_blocked_at: string | null
          account_state_blocked_previous_status: string | null
          account_state_blocked_stripe_account_id: string | null
          amount_cents: number
          approval_id: string
          authorized_at: string | null
          capture_attempt_id: string | null
          capture_effects_completed_at: string | null
          capture_effects_started_at: string | null
          capture_started_at: string | null
          captured_at: string | null
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          last_refund_event_id: string | null
          partner_id: string
          partner_kind: string
          plan_id: string
          platform_fee_cents: number
          refund_terms: string
          refund_updated_at: string | null
          refunded_amount_cents: number
          status: string
          stripe_payment_intent_id: string | null
          stripe_payment_method_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_intents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_stripe_webhook_event:
        | {
            Args: {
              p_endpoint_path: string
              p_event_type: string
              p_livemode?: boolean
              p_payload: Json
              p_source: string
              p_stripe_event_id: string
            }
            Returns: {
              completed: boolean
              existed: boolean
              in_flight: boolean
              processed_at: string
              reserved_now: boolean
            }[]
          }
        | {
            Args: {
              p_endpoint_path: string
              p_event_type: string
              p_livemode: boolean
              p_payload: Json
              p_replay_authorized: boolean
              p_source: string
              p_stripe_event_id: string
            }
            Returns: {
              completed: boolean
              control_state: string
              deferred: boolean
              existed: boolean
              in_flight: boolean
              processed_at: string
              queued_at: string
              reservation_token: string
              reserved_now: boolean
            }[]
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
      stage_plan_quote_booking: {
        Args: {
          p_action_id: string
          p_action_payload: Json
          p_actor_id: string
          p_approval_id: string
          p_expires_at: string
          p_plan_id: string
          p_quote_kind: string
          p_response_id: string
          p_snapshot_hash: string
          p_snapshot_json: Json
        }
        Returns: Json
      }
      supersede_approval_version: {
        Args: {
          p_action_payload_json: Json
          p_actor_id: string
          p_approval_id: string
          p_event_date: string
          p_expected_snapshot_hash: string
          p_expires_at: string
          p_notes: string
          p_plan_id: string
          p_reason: string
          p_requested_amount_cents: number
          p_snapshot_hash: string
          p_snapshot_json: Json
        }
        Returns: {
          action_label: string
          agent_action_id: string
          approval_type: string | null
          approved_at: string | null
          approved_by: string | null
          authorized_amount_cents: number | null
          authorized_at: string | null
          authorized_by: string | null
          cancellation_terms: string | null
          created_at: string
          delivery_email: string | null
          event_date: string | null
          expires_at: string | null
          fees_cents: number | null
          id: string
          notes: string | null
          package_details: string | null
          payment_method_id: string | null
          plan_id: string
          price_cents: number | null
          provider: string | null
          refund_terms: string | null
          requested_amount_cents: number
          root_approval_id: string
          settlement_run_id: string | null
          snapshot_hash: string | null
          snapshot_json: Json | null
          snapshot_schema_version: number | null
          status: string
          superseded_at: string | null
          superseded_by_approval_id: string | null
          superseded_by_revision_id: string | null
          superseded_reason: string | null
          supersedes_approval_id: string | null
          updated_at: string
          version_created_by: string | null
          version_number: number
          version_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_planner_refund_reversal_task: {
        Args: {
          p_event_id: string
          p_payment_intent_id: string
          p_payout_id: string
          p_plan_id: string
          p_refunded_amount_cents: number
          p_stripe_payout_id: string
          p_target_payout_amount_cents: number
        }
        Returns: boolean
      }
      transition_plan_status: {
        Args: {
          p_actor_id: string
          p_context: Json
          p_expected_status: string
          p_plan_id: string
          p_to_status: string
          p_trigger: string
        }
        Returns: {
          agent_action: string | null
          brief_render_version: number
          budget_cap_cents: number | null
          committed_vendors: Json | null
          committed_venue_at: string | null
          committed_venue_id: string | null
          committed_venue_quoted_deal_model: string | null
          committed_venue_quoted_price_cents: number | null
          committed_venue_quoted_terms: Json | null
          created_at: string
          date_window_end: string | null
          date_window_start: string | null
          derived_state_recomputed_at: string | null
          event_city: string | null
          event_type: string | null
          excluded_cuisines: string[]
          excluded_vendor_attributes: Json
          food_responsibility: string | null
          guest_count: number | null
          id: string
          latest_venue_hold_outcome: Json | null
          materialized_event_id: string | null
          metadata: Json
          neighborhood: string | null
          notes: string | null
          plan_revision_count: number
          preferred_vendor_attributes: Json
          profit_goal_cents: number | null
          special_supply_radius_miles: number
          status: Database["public"]["Enums"]["planner_plan_status"]
          ticketed: boolean
          ticketing_model: string | null
          title: string
          updated_at: string
          user_id: string
          vendor_approved_adjacent_cities: string[]
          vendor_out_of_city_approved: boolean
          vendor_same_city_required: boolean
          venue_terms: string | null
        }
        SetofOptions: {
          from: "*"
          to: "plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_release_runtime_control: {
        Args: {
          p_changed_by: string
          p_expected_revision: number
          p_reason: string
          p_target_state: string
        }
        Returns: Json
      }
      transition_settlement_charge_status: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_actor_type?: string
          p_charge_id: string
          p_from_status: string
          p_metadata?: Json
          p_patch?: Json
          p_reason?: string
          p_to_status: string
        }
        Returns: {
          charge: Json
          failure_reason: string
          success: boolean
        }[]
      }
      transition_settlement_run_status: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_actor_type?: string
          p_from_status: string
          p_metadata?: Json
          p_patch?: Json
          p_reason?: string
          p_run_id: string
          p_to_status: string
        }
        Returns: {
          failure_reason: string
          run: Json
          success: boolean
        }[]
      }
      unblock_stripe_account_settlements: {
        Args: { p_event_id: string; p_stripe_account_id: string }
        Returns: Json
      }
    }
    Enums: {
      planner_plan_status:
        | "drafting"
        | "ready"
        | "approved"
        | "executing"
        | "complete"
        | "archived"
        | "booked"
        | "completed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      planner_plan_status: [
        "drafting",
        "ready",
        "approved",
        "executing",
        "complete",
        "archived",
        "booked",
        "completed",
      ],
    },
  },
} as const
