// Money convention: all monetary values are integer cents unless noted.
// UI layer divides by 100 for display. Never store or pass dollar decimals.

import type { Json } from '@/lib/types/database'
import type { ServiceType, VenueType } from '@/lib/types/enums'

/** Lifecycle states for an Agent Planner plan. */
export type PlanStatus = 'drafting' | 'ready' | 'approved' | 'executing' | 'complete' | 'archived'

/** Author roles for planner timeline messages. */
export type PlanMessageRole = 'user' | 'agent' | 'system'

/** Message categories used to render chat, cards, recommendations, and status updates. */
export type PlanMessageType =
  | 'text'
  | 'confirmation_card'
  | 'recommendation'
  | 'approval_request'
  | 'status_update'

/** Recommendation categories supported by the Agent Planner. */
export type RecommendationType = 'venue' | 'vendor' | 'ticket' | 'external'

/** Selection state for a recommendation. */
export type RecommendationStatus =
  | 'pending'
  | 'selected'
  | 'rejected'
  | 'superseded'
  | 'invalidated_entity_closed'

/** Canonical planner assessment of whether an event needs vendor sourcing. */
export type VendorNeedStatus = 'none' | 'optional' | 'required' | 'unknown'

/** Planner assessment of whether normal venue/vendor matching is enough. */
export type EventComplexity = 'standard' | 'special_supply_required'

/** Specialized supply packs for events that require quote-first scouting. */
export type SpecialSupplyKind =
  | 'yacht_charter'
  | 'warehouse_party'
  | 'private_estate'
  | 'outdoor_park'
  | 'rooftop_buyout'
  | 'nonstandard'

/** Existing execution modes allowed for special supply once terms are verified. */
export type SpecialSupplyExecutionMode = 'concierge_queue' | 'external_checkout' | 'controlled_payment'

/** Executable action categories created by the planner. */
export type AgentActionType =
  | 'payment'
  | 'external_link'
  | 'concierge_queue'
  | 'email'
  | 'export'
  | 'hold'
  | 'hold_request'
  | 'vendor_contact'
  | 'external_checkout'
  | 'ai_query'
  | 'opportunity_send_venues'
  | 'opportunity_send_vendors'

/** Lifecycle states for planner actions. */
export type AgentActionStatus = 'pending' | 'proposed' | 'approved' | 'executing' | 'complete' | 'cancelled' | 'failed'

/** Approval states for confirmation cards. */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'authorized'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 're_approval_required'
  | 'superseded'

/** Material planner changes that can invalidate recommendations or approvals. */
export type PlanRevisionTriggerType =
  | 'negative_preference'
  | 'positive_preference'
  | 'vendor_stack_addition'
  | 'vendor_stack_removal'
  | 'date_change'
  | 'guest_count_change'
  | 'budget_change'
  | 'venue_swap'
  | 'scope_change'
  | 'discovery_data_changed'

/** Lifecycle states for a template rebook run. */
export type TemplateRunStatus = 'pending' | 'confirmed' | 'cancelled'

/** Export formats and delivery channels for final planner artifacts. */
export type PlannerExportType = 'pdf' | 'ics' | 'email' | 'csv'

/** Internal operation task categories for unsupported or concierge execution. */
export type AdminTaskType = 'concierge_booking' | 'receipt_upload' | 'vendor_confirm' | 'coi_collect' | 'catalog_gap'

/** Lifecycle states for internal operations tasks. */
export type AdminTaskStatus = 'pending' | 'open' | 'in_progress' | 'complete' | 'cancelled'

/** Internal task priority for admin triage. */
export type AdminTaskPriority = 'low' | 'normal' | 'high' | 'urgent'

/** Historical data sources used for foot traffic and profit assumptions. */
export type HistoricalEventSignalSource = 'eventbrite' | 'luma' | 'posh' | 'manual'

/** Target categories for planner opportunity outreach. */
export type OpportunityTargetType = 'venue' | 'vendor' | 'concierge'

/** Lifecycle states for a planner opportunity brief. */
export type VenueOpportunityStatus =
  | 'draft'
  | 'approval_requested'
  | 'proposed'
  | 'collecting_offers'
  | 'offer_selected'
  | 'closed'
  | 'cancelled'

/** Venue/vendor response statuses for an opportunity invite. */
export type VenueOpportunityInviteStatus =
  | 'queued'
  | 'draft'
  | 'pending_organizer_approval'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'countered'
  | 'declined'
  | 'expired'
  | 'concierge_followup'
  | 'concierge_queue'
  | 'cancelled'

/** Partner categories that can become booked workspaces. */
export type PartnershipPartnerKind = 'venue' | 'vendor'

/** Lifecycle state for a booked partner workspace. */
export type PartnershipThreadStatus = 'pending_deposit' | 'active' | 'complete' | 'cancelled'

/** Sender categories for booked partner messages. */
export type PartnershipMessageSenderKind = 'host' | 'partner' | 'agent' | 'concierge'

/** Document categories stored on booked partner workspaces. */
export type PartnershipDocumentKind = 'contract' | 'coi' | 'invoice' | 'receipt'

/** Agent Planner source-of-truth record for an event or group-experience plan. */
export interface Plan {
  /** Unique identifier for the plan. */
  id: string
  /** Owner of the plan; references public.users.id. */
  user_id: string
  /** Human-readable title shown in planner lists and exports. */
  title: string
  /** Planner-facing event category such as mixer, dinner, outing, or offsite. */
  event_type: string | null
  /** Current lifecycle state of the plan. */
  status: PlanStatus
  /** Expected number of guests or attendees. */
  guest_count: number | null
  /** Maximum target spend for the plan, stored as integer cents. */
  budget_cap_cents: number | null
  /** Preferred Bay Area neighborhood or local area. */
  neighborhood: string | null
  /** Earliest acceptable event date in ISO date format. */
  date_window_start: string | null
  /** Latest acceptable event date in ISO date format. */
  date_window_end: string | null
  /** Whether the experience is expected to sell tickets. */
  ticketed: boolean
  /** Planner intake answer for ticketing, such as free RSVP or paid admission. */
  ticketing_model?: string | null
  /** Planner intake answer for food and beverage responsibility. */
  food_responsibility?: string | null
  /** Planner intake answer for preferred venue deal structure. */
  venue_terms?: string | null
  /** Planner intake answer for what the agent may do after recommendations. */
  agent_action?: string | null
  /** Profit target or breakeven target for the event, stored as integer cents. */
  profit_goal_cents: number | null
  /** Freeform planner notes, assumptions, or unresolved constraints. */
  notes: string | null
  /** Organizer-declared cuisines to exclude from vendor discovery. */
  excluded_cuisines?: string[]
  /** Organizer-declared vendor constraints to exclude from vendor discovery. */
  excluded_vendor_attributes?: Json
  /** Organizer-declared vendor attributes to prefer in vendor discovery. */
  preferred_vendor_attributes?: Json
  /** Monotonic count of material plan revisions. */
  plan_revision_count?: number
  /** Planner-owned metadata cache for generated agent summaries and timelines. */
  metadata?: Json
  /** Timestamp when the plan was created. */
  created_at: string
  /** Timestamp when the plan was last updated. */
  updated_at: string
}

/** Conversation or card timeline entry for an Agent Planner plan. */
export interface PlanMessage {
  /** Unique identifier for the message. */
  id: string
  /** Plan that owns this message. */
  plan_id: string
  /** Author role for the message. */
  role: PlanMessageRole
  /** Displayed message body. */
  content: string
  /** Structured category for rendering the message. */
  message_type: PlanMessageType
  /** Structured card data, recommendation options, approval details, or parser output. */
  metadata: Json
  /** Timestamp when the message was created. */
  created_at: string
}

/** Immutable structured snapshot of a plan. */
export interface PlanVersion {
  /** Unique identifier for the saved version. */
  id: string
  /** Plan that owns this version. */
  plan_id: string
  /** Monotonic version number within the plan. */
  version_number: number
  /** Full structured plan snapshot at the time of this version. */
  snapshot: Json
  /** User who caused the change, when known. */
  changed_by: string | null
  /** Human-readable reason for the version. */
  change_reason: string | null
  /** Timestamp when the version was created. */
  created_at: string
}

/** Ranked venue, vendor, ticket, or external recommendation for a plan. */
export interface Recommendation {
  /** Unique identifier for the recommendation. */
  id: string
  /** Plan receiving this recommendation. */
  plan_id: string
  /** Recommendation category. */
  type: RecommendationType
  /** Polymorphic reference to venues.id or vendor_profiles.id depending on type. */
  reference_id: string | null
  /** Display name for external or non-platform recommendations. */
  external_name: string | null
  /** Estimated or quoted price, stored as integer cents. */
  price_cents: number | null
  /** Explanation, caveats, or fit notes shown to the user. */
  notes: string | null
  /** Rank order within the recommendation set, usually 1 through 3. */
  rank: 1 | 2 | 3
  /** Whether this recommendation is currently the best fit. */
  is_best_fit: boolean
  /** Selection lifecycle for the recommendation. */
  status: RecommendationStatus
  /** Scoring inputs, source records, confidence values, or external links. */
  metadata: Json
  /** Timestamp when the recommendation was created. */
  created_at: string
  /** Timestamp when a material plan revision superseded this recommendation. */
  superseded_at?: string | null
  /** Plan revision that superseded this recommendation. */
  superseded_by_revision_id?: string | null
  /** Plan revision count when this recommendation was created. */
  plan_revision_at_creation?: number
}

/** Audit row for organizer, admin, or discovery-data changes to a plan. */
export interface PlanRevision {
  /** Unique identifier for the revision. */
  id: string
  /** Plan that owns this revision. */
  plan_id: string
  /** User who triggered the revision, when known. */
  triggered_by_user_id: string | null
  /** Revision trigger category. */
  trigger_type: PlanRevisionTriggerType
  /** Structured trigger details. */
  trigger_payload: Json
  /** User message that produced the revision, when applicable. */
  source_message_id: string | null
  /** Supersession and rediscovery impact summary. */
  impact_summary: Json
  /** Service types or venue targets that should be rediscovered. */
  rediscovery_triggered_for: string[]
  /** Timestamp when the revision was applied. */
  applied_at: string
  /** Audit log row linked to this revision, when available. */
  audit_log_id: string | null
}

/** Proposed, approved, or executed action prepared by Agent Planner. */
export interface AgentAction {
  /** Unique identifier for the action. */
  id: string
  /** Plan that owns this action. */
  plan_id: string
  /** Action category used by execution workers and UI cards. */
  action_type: AgentActionType
  /** User-facing summary of what the action will do. */
  description: string
  /** External or internal provider involved in the action. */
  provider: string | null
  /** Optional target category for the action, such as venue, vendor, or recommendation. */
  target_type: string | null
  /** Optional target row id for the action target. */
  target_id: string | null
  /** Structured request payload captured from the planner UI. */
  payload_json: Json
  /** Amount in integer cents for payment-like actions. */
  amount_cents: number | null
  /** ISO currency code for amount. */
  currency: string
  /** Execution lifecycle state. */
  status: AgentActionStatus
  /** Approval record authorizing this action, when required. */
  approval_id: string | null
  /** Timestamp when the action was executed. */
  executed_at: string | null
  /** Provider response, export result, payment receipt, or execution error details. */
  result_metadata: Json
  /** Timestamp when the action was created. */
  created_at: string
  /** Timestamp when the action was last updated. */
  updated_at: string
}

/** User confirmation record for a payment, booking, hold, export, or external action. */
export interface Approval {
  /** Unique identifier for the approval. */
  id: string
  /** Plan that owns this approval. */
  plan_id: string
  /** Action this approval authorizes. */
  agent_action_id: string
  /** Short label displayed in the confirmation window. */
  action_label: string
  /** Venue, vendor, ticketing platform, or payment provider for the action. */
  provider: string | null
  /** Date of the event or purchase being approved in ISO date format. */
  event_date: string | null
  /** Base price in integer cents shown at approval time. */
  price_cents: number | null
  /** Fees in integer cents shown at approval time. */
  fees_cents: number | null
  /** Refund terms shown to the user before approval. */
  refund_terms: string | null
  /** Cancellation terms shown to the user before approval. */
  cancellation_terms: string | null
  /** Seats, packages, menu, venue hold, or other approved item details. */
  package_details: string | null
  /** Email address where confirmation details should be delivered. */
  delivery_email: string | null
  /** Stripe PaymentMethod id or other payment method reference. */
  payment_method_id: string | null
  /** Approval lifecycle state. */
  status: ApprovalStatus
  /** Amount in integer cents requested when the approval was created. */
  requested_amount_cents: number
  /** Amount in integer cents explicitly authorized by the user. */
  authorized_amount_cents: number | null
  /** User who authorized the action. */
  authorized_by: string | null
  /** Timestamp when the action was authorized. */
  authorized_at: string | null
  /** User who approved the action. */
  approved_by: string | null
  /** Timestamp when the action was approved. */
  approved_at: string | null
  /** Timestamp after which the approval can no longer be used. */
  expires_at: string | null
  /** Hash of important approval fields for detecting price, date, or provider changes. */
  snapshot_hash: string | null
  /** Timestamp when the approval was created. */
  created_at: string
  /** Timestamp when the approval was last updated. */
  updated_at: string
  /** Timestamp when a material plan revision superseded this approval. */
  superseded_at?: string | null
  /** Plan revision that superseded this approval. */
  superseded_by_revision_id?: string | null
  /** Human-readable reason explaining why execution is blocked. */
  superseded_reason?: string | null
}

/** User-defined spending guardrail for Agent Planner execution. */
export interface AgentAuthorization {
  /** Unique identifier for the authorization. */
  id: string
  /** User granting this authorization. */
  user_id: string
  /** Optional plan that scopes this authorization. */
  plan_id: string | null
  /** Maximum cent amount the agent can auto-approve for one action. */
  auto_approve_under_cents: number | null
  /** Monthly cent cap for agent-initiated spend. */
  monthly_spend_cap_cents: number | null
  /** Vendors that are explicitly approved for agent spending. */
  approved_vendor_ids: string[]
  /** Emergency stop that blocks agent spending even when caps would allow it. */
  pause_agent_spending: boolean
  /** Timestamp when the authorization was created. */
  created_at: string
  /** Timestamp when the authorization was last updated. */
  updated_at: string
}

/** Reusable event plan template for future rebooking. */
export interface PlannerTemplate {
  /** Unique identifier for the template. */
  id: string
  /** User who owns the template. */
  user_id: string
  /** Original plan this template was created from, when applicable. */
  source_plan_id: string | null
  /** Template name displayed in the rebook flow. */
  name: string
  /** Event category this template supports. */
  event_type: string | null
  /** Intended audience or attendee profile. */
  target_audience: string | null
  /** Minimum suggested guest count. */
  guest_count_min: number | null
  /** Maximum suggested guest count. */
  guest_count_max: number | null
  /** Reusable budget structure, line items, and cost assumptions. */
  budget_model: Json
  /** Suggested ticket pricing tiers and sales assumptions. */
  ticket_price_model: Json
  /** Profit forecast assumptions from the source or template model. */
  profit_assumptions: Json
  /** Per-head, consumption-share, or hybrid CHI assumptions. */
  chi_model: Json
  /** Reusable event timeline and run-of-show. */
  run_of_show: Json
  /** Reusable venue, vendor, staffing, ticketing, and supplies checklist. */
  shopping_list: Json
  /** Reusable outbound email copy for venues, vendors, sponsors, or attendees. */
  email_copy: string | null
  /** Reusable export copy for final plan documents or itineraries. */
  export_copy: string | null
  /** Required approvals before the template can be rebooked. */
  approval_checklist: Json
  /** Actual performance from prior runs, such as attendance, revenue, and margin. */
  historical_performance: Json
  /** Timestamp when the template was created. */
  created_at: string
  /** Timestamp when the template was last updated. */
  updated_at: string
}

/** Instance of a template being rebooked into a new plan. */
export interface TemplateRun {
  /** Unique identifier for the template run. */
  id: string
  /** Template used to create the run. */
  template_id: string
  /** Plan created or updated from this template run. */
  plan_id: string
  /** New target date for the rebooked event in ISO date format. */
  new_date: string | null
  /** Expected attendance for this run. */
  expected_guest_count: number | null
  /** Budget override in integer cents for this run. */
  budget_override_cents: number | null
  /** Whether the rebook should try to use the same venue. */
  use_same_venue: boolean
  /** Whether the rebook should try to use the same vendors. */
  use_same_vendors: boolean
  /** Rebook lifecycle state. */
  status: TemplateRunStatus
  /** Timestamp when the template run was created. */
  created_at: string
}

/** Exported planner artifact such as an email, PDF, calendar file, or CSV. */
export interface PlannerExport {
  /** Unique identifier for the export. */
  id: string
  /** Plan that owns this export. */
  plan_id: string
  /** Export format or delivery channel. */
  export_type: PlannerExportType
  /** Storage URL for file-based exports. */
  file_url: string | null
  /** Email address that received the export, when sent by email. */
  sent_to_email: string | null
  /** Timestamp when the export was created or sent. */
  created_at: string
}

/** Immutable audit log entry for Agent Planner operations. */
export interface AuditLog {
  /** Unique identifier for the audit log entry. */
  id: string
  /** User associated with the audited action. */
  user_id: string
  /** Optional plan associated with the audited action. */
  plan_id: string | null
  /** Human-readable action name such as approval.created or action.executed. */
  action: string
  /** Entity type affected by the action. */
  entity_type: string
  /** Entity id affected by the action. */
  entity_id: string | null
  /** JSON snapshot before the action. */
  before_state: Json | null
  /** JSON snapshot after the action. */
  after_state: Json | null
  /** Request IP address when available. */
  ip_address: string | null
  /** Timestamp when the audit entry was created. */
  created_at: string
}

/** Internal concierge and operations task for planner actions that need human execution. */
export interface AdminTask {
  /** Unique identifier for the admin task. */
  id: string
  /** Plan that requires administrative or concierge work. */
  plan_id: string
  /** User assigned to complete the task. */
  assigned_to: string | null
  /** Operational category for the task. */
  task_type: AdminTaskType
  /** User-facing or operator-facing description of the task. */
  description: string
  /** Task lifecycle state. */
  status: AdminTaskStatus
  /** Operator triage priority. */
  priority?: AdminTaskPriority
  /** Structured metadata for task-specific queue payloads. */
  metadata?: Json
  /** Optional due date for the task. */
  due_at: string | null
  /** Timestamp when the task was completed. */
  completed_at: string | null
  /** Internal task notes or completion details. */
  notes: string | null
  /** Timestamp when the task was created. */
  created_at: string
  /** Timestamp when the task was last updated. */
  updated_at: string
}

/** Organizer-approved event opportunity sent to venue/vendor targets. */
export interface VenueOpportunityBrief {
  /** Unique identifier for the opportunity brief. */
  id: string
  /** Planner plan that produced this opportunity. */
  plan_id: string
  /** Community builder who owns the plan. */
  organizer_user_id: string
  /** Human-readable opportunity title. */
  title: string
  /** Event type or raw custom event phrase. */
  event_type: string | null
  /** Compound event components preserved for target fit, such as run plus mocktails. */
  event_components: Json
  /** Expected attendance or capacity target. */
  guest_count: number | null
  /** Earliest acceptable event date in ISO date format. */
  date_window_start: string | null
  /** Latest acceptable event date in ISO date format. */
  date_window_end: string | null
  /** Human-readable daypart or schedule preference. */
  time_preference: string | null
  /** Preferred neighborhood, city, or local area. */
  neighborhood: string | null
  /** Target total budget in integer cents. */
  budget_cents: number | null
  /** Structured must-haves sent to targets. */
  must_haves: Json
  /** Structured requested terms, such as exclusive use, bar share, or BYO alcohol. */
  requested_terms: Json
  /** Suggested initial deposit exposure in integer cents. */
  deposit_target_cents: number | null
  /** Opportunity lifecycle status. */
  status: VenueOpportunityStatus
  /** Host-facing brief summary for selected venue outreach. */
  summary?: string | null
  /** Structured requirements sent to selected venues. */
  requirements?: Json
  /** Budget range in integer cents, encoded by Postgres int4range. */
  budget_range_cents?: string | null
  /** Date window encoded by Postgres daterange. */
  date_window?: string | null
  /** Deadline for venue responses. */
  response_deadline?: string | null
  /** Human approval state for generated outreach drafts. */
  approval_status?: 'pending' | 'approved' | 'rejected'
  /** Structured approval-ready outreach draft generated before any send action. */
  outreach_message?: Json | null
  /** Creation timestamp. */
  created_at: string
  /** Last update timestamp. */
  updated_at: string
}

/** Venue/vendor invitation created from an opportunity brief. */
export interface VenueOpportunityInvite {
  /** Unique identifier for the invite. */
  id: string
  /** Opportunity brief this invite belongs to. */
  opportunity_id: string
  /** Alias for opportunity_id used by the venue queue API. */
  brief_id?: string
  /** Target category. */
  target_type: OpportunityTargetType
  /** Venue id when target_type is venue. */
  venue_id: string | null
  /** Vendor profile id when target_type is vendor. */
  vendor_profile_id: string | null
  /** Current invitation or response status. */
  status: VenueOpportunityInviteStatus
  /** Whether the target has claimed its catalog listing. */
  is_claimed: boolean
  /** Whether this invite needs internal concierge handling. */
  route_to_concierge: boolean
  /** Deterministic fit score, 0 to 100. */
  match_score: number
  /** Whether the target can support the plan guest count. */
  capacity_fit: boolean
  /** Whether the target appears to fit the budget. */
  budget_fit: boolean
  /** Requirement match details for event must-haves. */
  requirement_fit: Json
  /** Proposed deposit for this target in integer cents. */
  proposed_deposit_cents: number | null
  /** Estimated or quoted price in integer cents. */
  quoted_price_cents: number | null
  /** Structured accepted/countered/declined response from the target. */
  venue_response_json: Json
  /** Random token for future public response pages. */
  magic_link_token?: string | null
  /** Expiration timestamp for the magic link token. */
  magic_link_expires_at?: string | null
  /** Timestamp when the future response page is viewed. */
  viewed_at?: string | null
  /** Timestamp when a future venue response is submitted. */
  response_at?: string | null
  /** Future venue accept/decline/counter payload. */
  response_payload?: Json
  /** Internal concierge notes. */
  admin_notes: string | null
  /** Timestamp when the invite was sent. */
  sent_at: string | null
  /** Timestamp when the target responded. */
  responded_at: string | null
  /** Timestamp when this invite expires. */
  expires_at: string | null
  /** Creation timestamp. */
  created_at: string
  /** Last update timestamp. */
  updated_at: string
}

/** Host-owned coordination workspace for one accepted venue or vendor. */
export interface PartnershipThread {
  /** Unique workspace id. */
  id: string
  /** Planner plan this workspace belongs to. */
  plan_id: string
  /** Whether the partner is a venue or vendor. */
  partner_kind: PartnershipPartnerKind
  /** Venue or vendor profile id. */
  partner_id: string
  /** Current workspace lifecycle state. */
  status: PartnershipThreadStatus
  /** Creation timestamp. */
  created_at: string
}

/** Message inside a booked partner workspace. */
export interface PartnershipMessage {
  /** Unique message id. */
  id: string
  /** Thread that owns this message. */
  thread_id: string
  /** Sender category. */
  sender_kind: PartnershipMessageSenderKind
  /** Message body. */
  body: string
  /** JSON attachment list. */
  attachments: Json
  /** Creation timestamp. */
  created_at: string
}

/** Timeline item for booked partner execution. */
export interface PartnershipMilestone {
  /** Unique milestone id. */
  id: string
  /** Thread that owns this milestone. */
  thread_id: string
  /** User-facing milestone label. */
  label: string
  /** Optional due date. */
  due_date: string | null
  /** Completion timestamp, when done. */
  completed_at: string | null
  /** Creation timestamp. */
  created_at: string
}

/** Document attached to a booked partner workspace. */
export interface PartnershipDocument {
  /** Unique document id. */
  id: string
  /** Thread that owns this document. */
  thread_id: string
  /** Document category. */
  kind: PartnershipDocumentKind
  /** Storage or external URL. */
  url: string
  /** Signature timestamp, when applicable. */
  signed_at: string | null
  /** Creation timestamp. */
  created_at: string
}

/** Historical comp signal used for foot traffic and profit assumptions. */
export interface HistoricalEventSignal {
  /** Unique identifier for the historical signal. */
  id: string
  /** Signal visibility scope: global benchmark data or user-imported private data. */
  signal_scope: 'global' | 'user'
  /** Source platform or manual entry source. */
  source: HistoricalEventSignalSource
  /** External source id, when present. */
  external_id: string | null
  /** Event category used for matching comparable events. */
  event_type: string | null
  /** Neighborhood or local area for the historical event. */
  neighborhood: string | null
  /** Actual or reported guest count. */
  guest_count: number | null
  /** Average or listed ticket price in integer cents. */
  ticket_price_cents: number | null
  /** RSVP conversion rate used for planning assumptions. */
  rsvp_rate: number | null
  /** Show-up rate used for attendance assumptions. */
  show_rate: number | null
  /** Gross revenue in integer cents from the historical event. */
  revenue_cents: number | null
  /** Date of the historical event in ISO date format. */
  event_date: string | null
  /** Original imported payload or manual source details. */
  raw_data: Json
  /** Timestamp when the historical signal was created. */
  created_at: string
}

/** Supported deterministic event categories extracted from planner messages. */
export type PlanIntentEventType =
  | 'hackathon'
  | 'concert'
  | 'dinner'
  | 'mixer'
  | 'conference'
  | 'popup'
  | 'party'
  | 'outing'
  | 'retreat'
  | 'tennis'

/** Fallback planning archetypes used when an event phrase is not yet supported. */
export type EventPlanningArchetype =
  | 'social'
  | 'sports'
  | 'competitive_social'
  | 'food'
  | 'music'
  | 'professional'
  | 'education'
  | 'market'
  | 'private'
  | 'performance'
  | 'wellness'
  | 'custom'

/** Review status for unsupported event phrases captured by the planner. */
export type EventTypeCandidateStatus = 'pending' | 'approved' | 'rejected' | 'merged'

/** Structured piece of a compound event phrase such as "night run with mocktails". */
export interface EventComponent {
  /** User-facing component label, such as "night run" or "mocktails". */
  label: string
  /** Component role in the compound event. */
  role: 'primary' | 'secondary'
  /** Planning archetype inferred for this component. */
  archetype: EventPlanningArchetype
  /** Practical planning requirements implied by this component. */
  requirements: string[]
}

/** Classification result from the event taxonomy fallback layer. */
export interface EventTaxonomyClassification {
  /** Raw unsupported event phrase extracted from the user message. */
  raw_event_type: string
  /** Normalized lowercase event phrase used for grouping candidates. */
  normalized_phrase: string
  /** Nearest planning archetype used for fallback recommendations. */
  planning_archetype: EventPlanningArchetype
  /** Parsed compound event components, preserving primary and secondary parts. */
  event_components: EventComponent[]
  /** Primary activity component for planning and venue search. */
  primary_component: string
  /** Secondary components such as hospitality, music, or activities. */
  secondary_components: string[]
  /** Suggested taxonomy label for admin review. */
  suggested_event_type: string
  /** Draft intake questions an admin or AI worker can refine before promotion. */
  suggested_questions: string[]
  /** Whether the phrase is unsupported but still safe to plan with generic heuristics. */
  is_unsupported_but_plannable: boolean
  /** Confidence in the phrase extraction and archetype mapping. */
  confidence: 'high' | 'medium' | 'low'
}

/** Row shape for unsupported event phrases captured for taxonomy review. */
export interface EventTypeCandidate {
  /** Unique identifier for the captured candidate. */
  id: string
  /** User who triggered the candidate capture. */
  user_id: string | null
  /** Plan where the candidate appeared. */
  plan_id: string | null
  /** Original unsupported event phrase. */
  raw_phrase: string
  /** Normalized phrase used for grouping. */
  normalized_phrase: string
  /** Fallback planning archetype used at runtime. */
  inferred_archetype: EventPlanningArchetype
  /** Suggested taxonomy name for admin review. */
  suggested_event_type: string | null
  /** Draft questions proposed for this event type. */
  suggested_questions: string[]
  /** Parsed components for compound event phrases. */
  event_components?: EventComponent[]
  /** Example plans associated with this candidate. */
  example_plan_ids: string[]
  /** Occurrence count for this candidate row. */
  frequency_count: number
  /** Review status. */
  status: EventTypeCandidateStatus
  /** Creation timestamp. */
  created_at: string
  /** Last update timestamp. */
  updated_at: string
}

/** Field names that can be extracted by the deterministic planner parser. */
export type PlanIntentField =
  | 'event_type'
  | 'raw_event_type'
  | 'planning_archetype'
  | 'guest_count'
  | 'budget_cap'
  | 'neighborhood'
  | 'areas'
  | 'date_window'
  | 'ticketed'
  | 'food_responsibility'
  | 'profit_goal'

/** Confidence values for each extracted intent field, from 0 to 1. */
export type PlanIntentConfidence = Partial<Record<PlanIntentField, number>>

/** Parsed planning intent from a freeform user message. */
export interface PlanIntent {
  /** Extracted event category, when a supported keyword is present. */
  event_type?: PlanIntentEventType
  /** Raw unsupported event phrase, when the message names a plannable custom event. */
  raw_event_type?: string
  /** Fallback archetype used for unsupported but plannable events. */
  planning_archetype?: EventPlanningArchetype
  /** Parsed components for compound unsupported event phrases. */
  event_components?: EventComponent[]
  /** Whether the event phrase matched the supported taxonomy directly. */
  is_supported_event_type?: boolean
  /** Taxonomy review payload for unsupported event phrases. */
  taxonomy_candidate?: EventTaxonomyClassification
  /** Extracted expected attendance or capacity target. */
  guest_count?: number
  /** Extracted maximum spend, normalized to integer cents. */
  budget_cap?: number
  /** Extracted Bay Area neighborhood or district. */
  neighborhood?: string
  /** Extracted Bay Area neighborhoods, districts, or cities when the user gives alternatives. */
  areas?: string[]
  /** Human-readable date phrase that caused a date match. */
  date_hint?: string
  /** Earliest parsed date in ISO date format, when deterministic enough. */
  date_window_start?: string
  /** Latest parsed date in ISO date format, when deterministic enough. */
  date_window_end?: string
  /** Whether the plan appears to be ticketed or paid. */
  ticketed?: boolean
  /** Parsed food and beverage payment responsibility. */
  food_responsibility?: string
  /** Extracted profit target, normalized to integer cents. */
  profit_goal?: number
  /** Parser confidence by extracted field. */
  confidence?: PlanIntentConfidence
}

/** Deterministic Agent Planner state used by the MVP response engine. */
export type AgentPlannerState =
  | 'intake'
  | 'clarifying'
  | 'recommending'
  | 'awaiting_approval'
  | 'executing'
  | 'complete'

/** Draft plan message returned by the deterministic response engine before insertion. */
export interface AgentResponseDraft {
  /** Message category ready for insertion into plan_messages.message_type. */
  message_type: PlanMessageType
  /** User-facing response body. */
  content: string
  /** Structured renderer data, missing fields, extracted updates, or action hints. */
  metadata: Json
}

/** Response returned after creating a plan from the initial user message. */
export interface PlannerCreatePlanResponse {
  /** Newly created plan. */
  plan: Plan
  /** Initial user message and deterministic agent reply. */
  messages: PlanMessage[]
  /** Fields extracted from the initial message. */
  intent: Partial<PlanIntent>
  /** When true the client should POST to /trigger-recommendations after plan creation. */
  needs_recommendations?: boolean
}

/** Response returned when listing planner plans for the authenticated user. */
export interface PlannerListPlansResponse {
  /** Plans owned by the authenticated community builder. */
  plans: Plan[]
  /** Number of plans returned in this page. */
  count: number
}

/** Response returned when loading a full planner plan detail. */
export interface PlannerFullPlanResponse {
  /** Loaded plan. */
  plan: Plan
  /** Ordered conversation messages for the plan. */
  messages: PlanMessage[]
  /** Persisted recommendations for the plan. */
  recommendations: Recommendation[]
  /** Persisted approvals for the plan. */
  approvals: Approval[]
  /** Cached or freshly generated workspace operational summary. */
  workspace_summary: {
    workspace_summary: string
    current_status: 'on_track' | 'at_risk' | 'blocked'
    blockers: string[]
    overdue_items: string[]
    recommended_next_actions: string[]
    approvals_needed: string[]
  } | null
  /** Cached or freshly generated planning and day-of timeline. */
  timeline: {
    planning_milestones: Array<{
      title: string
      due_date: string
      category: string
      is_blocking: boolean
    }>
    day_of_timeline: Array<{
      time: string
      activity: string
      owner: string
      notes: string | null
    }>
    staffing_needs: string[]
    reminders: string[]
    dependency_warnings: string[]
    impossible_timeline: boolean
  } | null
}

/** Response returned when reading a plan conversation. */
export interface PlannerMessagesResponse {
  /** Ordered conversation messages for the plan. */
  messages: PlanMessage[]
}

/** Response returned after posting a user message and receiving an agent reply. */
export interface PlannerPostMessageResponse {
  /** Plan after deterministic field updates from the latest message. */
  plan: Plan
  /** Newly inserted user message. */
  user_message: PlanMessage
  /** Newly inserted deterministic agent message. */
  agent_message: PlanMessage
  /** Optional system follow-up messages, such as generated opportunity approvals. */
  follow_up_messages?: PlanMessage[]
  /**
   * When true the client should POST to /trigger-recommendations to run the AI
   * recommendation pipeline and fetch the resulting messages. This flag exists
   * because running the pipeline inline in this route would cause serverless
   * function timeouts.
   */
  needs_recommendations?: boolean
}

/** Draft opportunity brief produced before database insertion. */
export interface PlannerOpportunityBriefDraft {
  /** Planner plan that produced this brief. */
  plan_id: string
  /** Community builder who owns the plan. */
  organizer_user_id: string
  /** Human-readable opportunity title. */
  title: string
  /** Event type or raw custom event phrase. */
  event_type: string | null
  /** Compound event components preserved for venue/vendor matching. */
  event_components: EventComponent[]
  /** Expected guest count. */
  guest_count: number | null
  /** Earliest acceptable event date. */
  date_window_start: string | null
  /** Latest acceptable event date. */
  date_window_end: string | null
  /** Human-readable daypart or schedule preference. */
  time_preference: string | null
  /** Preferred neighborhood, city, or local area. */
  neighborhood: string | null
  /** Target budget in integer cents. */
  budget_cents: number | null
  /** Event requirements extracted from the conversation. */
  must_haves: string[]
  /** Terms the organizer is asking venues/vendors to consider. */
  requested_terms: Record<string, Json>
  /** Suggested initial deposit exposure in integer cents. */
  deposit_target_cents: number | null
  /** Initial brief lifecycle status. */
  status: VenueOpportunityStatus
}

/** Ranked venue/vendor match prepared for opportunity outreach. */
export interface PlannerOpportunityMatchTarget {
  /** Target category. */
  target_type: OpportunityTargetType
  /** Venue or vendor id when present. */
  target_id: string | null
  /** Display name for the target. */
  name: string
  /** Neighborhood, city, or service area. */
  area: string | null
  /** Whether the target has claimed its listing. */
  is_claimed: boolean
  /** Whether concierge/admin must handle outreach. */
  route_to_concierge: boolean
  /** Deterministic fit score, 0 to 100. */
  match_score: number
  /** Whether the target satisfies the capacity target. */
  capacity_fit: boolean
  /** Whether the target satisfies budget constraints. */
  budget_fit: boolean
  /** Requirement fit details sent to the UI and DB. */
  requirement_fit: {
    /** Requirements that matched target metadata. */
    matched: string[]
    /** Requirements not found in target metadata. */
    missing: string[]
  }
  /** Estimated or quoted total price in integer cents. */
  quoted_price_cents: number | null
  /** Proposed initial deposit in integer cents. */
  proposed_deposit_cents: number | null
  /** Human-readable reason this target was selected. */
  fit_reason: string
  /** Operational status the invite should start with. */
  invite_status: VenueOpportunityInviteStatus
}

/** Approval-card payload for sending an opportunity to venues/vendors. */
export interface PlannerOpportunityApprovalDraft {
  /** User-facing approval title. */
  action_label: string
  /** Provider shown on the approval card. */
  provider: string
  /** Estimated deposit exposure in integer cents. */
  requested_amount_cents: number
  /** Approval-card package details. */
  package_details: string
  /** Refund terms shown before organizer authorization. */
  refund_terms: string
  /** Cancellation terms shown before organizer authorization. */
  cancellation_terms: string
  /** Delivery email copy or placeholder. */
  delivery_email: string | null
  /** Number of venue targets. */
  venue_count: number
  /** Number of vendor targets. */
  vendor_count: number
  /** Number of unclaimed targets routed to concierge. */
  concierge_count: number
}

/** Response returned by planner opportunity routes. */
export interface PlannerOpportunityResponse {
  /** Created or existing opportunity brief. */
  opportunity: VenueOpportunityBrief
  /** Invite rows attached to the opportunity. */
  invites: VenueOpportunityInvite[]
  /** Approval message created for organizer authorization, when newly generated. */
  approval_message?: PlanMessage
}

/** Venue fields attached to venue recommendations for API consumers. */
export interface PlannerVenueRecommendationDetails {
  /** Venue id from public.venues. */
  id: string
  /** Venue display name. */
  name: string
  /** Venue neighborhood, city, or address-derived local label. */
  neighborhood: string | null
  /** Maximum standing or seated capacity used for scoring. */
  capacity: number | null
  /** Hourly rate in integer cents when available. */
  hourly_rate: number | null
  /** Minimum booking hours used for estimated rental price. */
  minimum_hours: number | null
  /** Feature tags used for AV and fit scoring. */
  feature_tags: string[]
}

/** Recommendation row enriched with venue details when the type is venue. */
export interface PlannerRecommendationWithVenue extends Recommendation {
  /** Joined venue details for platform venue recommendations. */
  venue: PlannerVenueRecommendationDetails | null
}

/** Response returned by planner recommendations routes. */
export interface PlannerRecommendationsResponse {
  /** Ranked recommendation rows, optionally enriched with venue details. */
  recommendations: PlannerRecommendationWithVenue[]
}

/** Response returned by planner approval routes. */
export interface PlannerApprovalsResponse {
  /** Approval rows for the requested plan. */
  approvals: Approval[]
}

/** Standard planner API error payload. */
export interface PlannerApiErrorResponse {
  /** User-facing error message. */
  error: string
  /** Optional structured validation or service details. */
  details?: Json
  /** True when the request requires plan/event billing activation before continuing. */
  billingRequired?: boolean
  /** Optional billing summary used by clients to render product-access gates. */
  billing?: Json
}

/** Coarse vendor price band for admin-seeded catalog listings. */
export type PriceBand = 'budget' | 'mid' | 'premium'

/** Admin-only request body for seeding an unclaimed venue catalog listing. */
export interface AdminVenueSeedInput {
  /** Venue display name shown in internal catalog review and host-facing discovery. */
  name: string
  /** SF neighborhood label such as SoMa, Mission, or Hayes Valley. */
  neighborhood: string
  /** Venue street address. */
  address: string
  /** City for the venue; defaults to San Francisco in the API route. */
  city: string
  /** State for the venue; defaults to CA in the API route. */
  state: string
  /** Venue ZIP code. */
  zip_code: string
  /** Venue category using the app's existing venue type enum. */
  venue_type: VenueType
  /** Maximum headcount supported by the venue. */
  capacity: number
  /** Rental fee per hour in integer cents; null when unknown. */
  hourly_rate: number | null
  /** Minimum spend requirement in integer cents; null when none or unknown. */
  minimum_spend: number | null
  /** Internal claim-flow email; never shown to hosts. */
  contact_email: string
  /** Whether baseline AV is included in the venue package. */
  av_included: boolean
  /** Per-head CHI amount in integer cents; null when none or unknown. */
  per_head_chi_cents: number | null
  /** Internal notes for admin/concierge context. */
  notes: string | null
}

/** Admin-only request body for seeding an unclaimed vendor catalog listing. */
export interface AdminVendorSeedInput {
  /** Vendor display name shown in internal catalog review and host-facing discovery. */
  name: string
  /** Vendor service type using the app's existing service type enum. */
  service_type: ServiceType
  /** SF neighborhood or service area label; null when citywide or unknown. */
  neighborhood: string | null
  /** Coarse price band used for early MVP filtering. */
  price_band: PriceBand
  /** Internal claim-flow email; never shown to hosts. */
  contact_email: string
  /** Short package summary, such as "6-meal catering package from $560". */
  package_summary: string | null
  /** Minimum lead time in days; null when unknown. */
  lead_time_days: number | null
  /** Internal notes for admin/concierge context. */
  notes: string | null
}

/** Admin catalog row returned for an unclaimed or claimed venue listing. */
export interface CatalogVenueRow {
  /** Unique identifier for the venue listing. */
  id: string
  /** Owner account id after claim completion; null for admin-seeded unclaimed rows. */
  owner_id: string | null
  /** Venue display name shown in the catalog. */
  venue_name: string
  /** Internal or public venue description. */
  description: string | null
  /** Venue street address. */
  address: string | null
  /** Venue city. */
  city: string | null
  /** Venue state. */
  state: string | null
  /** Venue ZIP code. */
  zip_code: string | null
  /** Existing venue category value. */
  venue_type: VenueType | null
  /** Standing capacity used for host matching. */
  standing_capacity: number | null
  /** Hourly rental fee stored as integer cents at the API boundary. */
  hourly_rate: number | null
  /** Internal claim-flow email; never shown to hosts. */
  contact_email: string | null
  /** Whether the owner has claimed this venue listing. */
  is_claimed: boolean
  /** Linked auth user id after claim completion. */
  claimed_user_id: string | null
  /** Whether the listing was inserted by the admin catalog API. */
  is_admin_seeded: boolean
  /** Whether the catalog row is visible through existing public venue discovery. */
  is_published: boolean | null
  /** Stored admin seeding details such as minimum spend and AV inclusion. */
  auto_approve_conditions: Json | null
  /** Timestamp when the venue row was created. */
  created_at: string | null
  /** Timestamp when the venue row was last updated. */
  updated_at: string | null
}

/** Admin catalog row returned for an unclaimed or claimed vendor listing. */
export interface CatalogVendorRow {
  /** Unique identifier for the vendor listing. */
  id: string
  /** Vendor account id after claim completion; null for admin-seeded unclaimed rows. */
  user_id: string | null
  /** Vendor display name shown in the catalog. */
  name: string
  /** Human-readable vendor category label. */
  vendor_type: string
  /** Existing vendor service type value. */
  service_type: ServiceType | null
  /** SF neighborhood or service area label. */
  regions_served: string | null
  /** Internal claim-flow email; never shown to hosts. */
  contact_email: string | null
  /** Whether the vendor has claimed this listing. */
  is_claimed: boolean
  /** Linked auth user id after claim completion. */
  claimed_user_id: string | null
  /** Whether the listing was inserted by the admin catalog API. */
  is_admin_seeded: boolean
  /** Public/internal package summary and vendor notes. */
  bio: string | null
  /** Operational availability notes for admin review. */
  availability_notes: string | null
  /** Timestamp when the vendor row was created. */
  created_at: string | null
  /** Timestamp when the vendor row was last updated. */
  updated_at: string | null
}
