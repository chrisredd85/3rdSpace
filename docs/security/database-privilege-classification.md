# Database privilege classification

This is the reviewed allowlist for every `public` `SECURITY DEFINER` function
realized after the July 2026 P0 database migrations. The migration
`20260709120000_lock_down_function_and_view_privileges.sql` revokes `PUBLIC`,
`anon`, and inherited `authenticated` execution first, then grants only the
roles in this table. The realized-database test fails when a privileged
function is added without updating this classification.

## Function classification

| Function signature | Classification | Allowed API roles | Identity or caller boundary | Verified caller |
|---|---|---|---|---|
| `apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)` | User-callable aggregate RPC | `authenticated`, `service_role` | `auth.uid()` must match the supplied user; the plan, source message, recommendations, approvals, and outreach threads must all belong to that plan/user aggregate | Authenticated planner message/revision routes; service discovery invalidation |
| `block_inflight_stripe_account_payments(text,text,text)` | Service-only money mutation | `service_role` | Stripe account state is webhook-controlled | `lib/stripe/connect-webhook.ts`, with the webhook route's service client |
| `calculate_event_kickback(uuid)` | Service-only money mutation | `service_role` | Although the legacy body checks event access, it creates/updates settlement payment state and is not a user read RPC | Check-in upload route, with `createServiceRoleClient()` |
| `can_manage_event_cost_commitment_org(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Derives organizer identity from `auth.uid()` | `event_cost_commitments` RLS policies |
| `can_manage_event_revenue_term_org(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Derives organizer identity from `auth.uid()` | `event_revenue_terms` RLS policies |
| `can_manage_live_recommendation_org(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Derives organizer identity from `auth.uid()` | `live_recommendations` RLS policies |
| `can_manage_plan_read_model(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Proves the plan belongs to `auth.uid()` | Mobile planner read-model RLS policies |
| `claim_app_jobs(integer,text)` | Service-only worker mutation | `service_role` | Worker identity is server-generated and the function claims global queue rows | Internal jobs runner, with `createServiceRoleClient()` |
| `consume_builder_event_access(uuid,uuid,integer,integer,integer)` | User-callable aggregate RPC | `authenticated`, `service_role` | Authenticated caller must own the builder; the plan must belong to that builder for every role; authenticated pricing inputs must equal canonical constants | Planner product-access activation currently passes a service client |
| `consume_webhook_rate_limit(text,integer,integer)` | Service-only webhook mutation | `service_role` | Rate-limit keys and limits are accepted only from webhook handlers | Stripe, Eventbrite, Posh, Luma, and Partiful webhook routes, all with service clients |
| `create_vendor_invite(uuid,text,text,text,text,text,numeric,uuid)` | User-callable aggregate RPC | `authenticated`, `service_role` | Organizer must equal `auth.uid()` unless service role; optional source event must belong to the organizer | Vendor invite server action currently uses a service client after session authentication |
| `create_venue_invite(uuid,text,text,text,text,text,text,text,integer,integer,text,integer,uuid)` | User-callable aggregate RPC | `authenticated`, `service_role` | Organizer must equal `auth.uid()` unless service role; optional source event must belong to the organizer | Venue invite server action currently uses a service client after session authentication |
| `get_event_kickback_summary(uuid)` | User-callable scoped read RPC | `authenticated`, `service_role` | Body permits only the event organizer, collaborator, venue owner, or service role | No TypeScript caller found; retained for direct authenticated RPC compatibility |
| `handle_new_user()` | Trigger-only | `service_role` | Runs only from the auth-user trigger | Database trigger/hook |
| `increment_stripe_webhook_duplicate_count(text,text)` | Service-only webhook mutation | `service_role` | Stripe delivery ledger is controlled by verified webhook paths | Stripe webhook ledger, with a service client |
| `increment_stripe_webhook_duplicate_count(text)` | Service-only legacy webhook mutation | `service_role` | Legacy overload remains server-only | No active TypeScript caller; retained for migration compatibility |
| `insert_grouped_notification(uuid,text,text,text,text,uuid,jsonb,text)` | Service/trigger-only notification mutation | `service_role` | May target a user other than the request caller; server helper no longer falls back to a session client | Notification server helper and notification trigger functions |
| `is_event_builder(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Compares event builder to `auth.uid()` | Event/collaborator RLS policies |
| `is_event_collaborator(uuid)` | Authenticated RLS helper | `authenticated`, `service_role` | Compares collaborator to `auth.uid()` | Event/collaborator RLS policies |
| `next_vendor_invoice_number(integer)` | Service-only financial mutation | `service_role` | Allocates a global invoice sequence | Vendor invoice service, with an admin client |
| `notify_review_events()` | Trigger-only | `service_role` | Trigger function for review writes | `reviews` trigger |
| `notify_vendor_booking_events()` | Trigger-only | `service_role` | Trigger function for vendor booking writes | `vendor_bookings` trigger |
| `notify_vendor_transaction_events()` | Trigger-only | `service_role` | Trigger function for vendor transaction writes | `vendor_transactions` trigger |
| `recalculate_vendor_review_stats(uuid)` | Service/trigger-only derived mutation | `service_role` | Recomputes another table and is invoked by the review-stat trigger | `sync_vendor_review_stats()` and migration maintenance |
| `record_stripe_webhook_event_result(text,text,jsonb,text,text,boolean,text,boolean,text)` | Service-only webhook mutation | `service_role` | Writes verified Stripe payload/result state | Stripe webhook ledger, with a service client |
| `refresh_projection_baselines()` | Service-only analytics refresh | `service_role` | Refreshes global financial materialized views | Secret-protected baseline cron, with a service client |
| `refresh_vendor_analytics()` | Service-only analytics refresh | `service_role` | Refreshes a global financial materialized view | Database cron/maintenance path |
| `release_stale_stripe_webhook_reservations(interval)` | Service-only webhook mutation | `service_role` | Releases global Stripe delivery reservations | Stripe webhook ledger/recovery, with a service client |
| `reserve_stripe_webhook_event(text,text,jsonb,text,text,boolean)` | Service-only webhook mutation | `service_role` | Reserves global Stripe delivery ids | Signed Stripe webhook routes, with a service client |
| `sync_vendor_review_stats()` | Trigger-only | `service_role` | Trigger wrapper for review-stat recomputation | `reviews` trigger |
| `transition_settlement_charge_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)` | Service-only money mutation | `service_role` | Mutates settlement charge state and writes its audit log | Settlement finance helpers; all API entry routes pass an authenticated/authorized service client |
| `transition_settlement_run_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)` | Service-only money mutation | `service_role` | Mutates settlement run state and writes its audit log | Settlement finance helpers; all API entry routes pass an authenticated/authorized service client |
| `unblock_stripe_account_settlements(text,text)` | Service-only money mutation | `service_role` | Stripe account state is webhook-controlled | `lib/stripe/connect-webhook.ts`, with the webhook route's service client |
| `validate_event_cost_commitment_scope()` | Trigger-only invariant | `service_role` | Enforces event/organizer/plan aggregate consistency on every write | `event_cost_commitments` trigger |
| `validate_event_revenue_term_scope()` | Trigger-only invariant | `service_role` | Enforces event/organizer aggregate consistency on every write | `event_revenue_terms` trigger |
| `validate_live_recommendation_scope()` | Trigger-only invariant | `service_role` | Enforces event/organizer aggregate consistency on every write | `live_recommendations` trigger |

No `SECURITY DEFINER` function is executable by `anon`. Trigger functions do
not need API-role `EXECUTE` grants to fire as table triggers.

## Financial view classification

| Relation | Storage | Allowed roles | Enforcement |
|---|---|---|---|
| `event_ticket_sales_rollups` | Regular view | `authenticated`, `service_role` | `security_invoker=true` applies `event_sales_data` RLS to the authenticated caller; anonymous select is revoked |
| `organizer_baselines` | Materialized view | `service_role` | Materialized views cannot apply source RLS; commit, revision, and planner-message flows prove plan ownership with the session client, then pass a separate service client only to the organizer-scoped baseline lookup |
| `vendor_analytics` | Materialized view | `service_role` | Vendor analytics resolves the session-owned vendor id first, then performs the single-vendor read with a service client |

## Trusted table classification

Migration `20260709130000_server_owned_execution_control_plane.sql` classifies
execution and provenance tables separately from ordinary user-authored planner
data. Authenticated roles have no direct `INSERT`, `UPDATE`, or `DELETE`
privilege on any relation in this section.

| Classification | Relations | Authenticated access | Mutation authority |
|---|---|---|---|
| Planner authorization | `agent_actions`, `approvals`, `agent_authorizations`, `payment_intents` | Owner-scoped `SELECT` | Caller-validating service routes |
| Planner provenance and caches | `plan_messages`, `plan_versions`, `plan_revisions`, `planner_plan_updates`, `plan_derived_state`, `plan_activity`, `audit_logs`, `agent_action_audit_log`, `agent_runs` | Owner-scoped `SELECT` | Service routes; `apply_plan_revision_atomic` remains the reviewed aggregate RPC |
| Outreach execution | `outreach_threads`, `outreach_messages`, `creator_outreach_policies`, `venue_opportunity_briefs`, `venue_opportunity_invites`, `vendor_opportunity_briefs`, `vendor_opportunity_invites` | Owner/participant-scoped `SELECT` | Caller-validating service routes and workers |
| Approval and financial ledgers | `venue_booking_approval_audit`, `vendor_transactions`, `platform_fee_transactions`, `settlement_charges` | Existing participant-scoped `SELECT` | Service routes, workers, and verified webhooks |
| Internal/service-only | `admin_tasks`, `kickback_payments` | No base-table access | Service routes and workers only |

`admin_tasks` is intentionally not owner-readable at the base table because it
contains internal notes, metadata, assignments, and operator status. Any
host-facing progress is an explicit server projection. `kickback_payments` had
no authenticated SELECT policy before this migration; removing its inherited
table privileges makes that existing service-only behavior explicit.

The invariant functions `enforce_approval_execution_invariants()` and
`enforce_agent_action_approval_consistency()` are `SECURITY INVOKER` trigger
functions. They are not API RPCs and do not expand the `SECURITY DEFINER`
classification above.

## Caller-audit conclusion

All application callers of service-only RPCs construct or receive a
service-role Supabase client. Two unsafe fallbacks were removed as part of the
lockdown: vendor analytics no longer selects its materialized view with the
session client, and grouped notifications no longer fall back to a session
client when the service key is unavailable.

Planner derived-state recomputes now accept a distinct baseline client. The
plan, recommendations, approvals, and derived-state writes continue through
the caller's session client; only the organizer/archetype materialized-view
lookup uses the service client, and routes provide it after proving plan
ownership. This prevents the view lockdown from silently downgrading personal
projections to defaults.

`calculate_event_kickback` is deliberately service-only despite its legacy
caller check because it writes payment state. `get_event_kickback_summary`
remains authenticated-callable because it is read-only and scopes the event to
the caller in its body.
