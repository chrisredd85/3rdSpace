# Revenue Share Settlement Reconciliation

Date: 2026-05-26

Status: review required before implementation. This document records the repo reconciliation for the proposed revenue share settlement, screenshot extraction, Stripe Invoicing, payout surfaces, and venue compliance gate. No implementation code should be written until this is approved.

## Sources Inspected

- `AGENTS.md`
- `lib/types/database.ts`
- `lib/types/database-generated.ts`
- `supabase/migrations/20260420000000_remote_baseline.sql`
- `supabase/migrations/20260424123000_add_ticket_import_system.sql`
- `supabase/migrations/20260430172000_add_builder_payout_accounts.sql`
- `supabase/migrations/20260504000007_add_planner_opportunity_marketplace.sql`
- `supabase/migrations/20260504000010_add_venue_opportunity_queue_flow.sql`
- `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md`
- `app/api/venue/kickbacks/[paymentId]/checkout/route.ts`
- `app/api/venue/kickbacks/summary/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `app/api/venues/route.ts`
- `app/api/planner/plans/[planId]/recommend/route.ts`
- `app/(planner)/planner/payments/page.tsx`
- `app/(dashboard)/venue/payouts/page.tsx`
- `lib/email.ts`
- `lib/planner/opportunityOutreach.ts`
- `lib/ai/client.ts`
- `lib/ai/run-metadata.ts`
- `lib/ai/types.ts`
- `lib/finance/eventPlanningEconomics.ts`

## Architecture Rules Confirmed

- `AGENTS.md` says no new routes under `app/(dashboard)/**`; all new feature work should go under `app/(planner)`.
- Minimal edits to an existing dashboard file are allowed only where explicitly approved. For this work, `app/(dashboard)/venue/payouts/page.tsx` may be modified for venue notices and amount-due UI, but no new dashboard files should be added.
- Builder payout UI should use the existing planner surface at `app/(planner)/planner/payments/page.tsx`.
- The agent must not auto-execute bookings or payments. Payment actions need explicit user approval.
- All new monetary fields should use integer cents.
- Existing Stripe checkout/payment-intent flows must coexist with the new invoice settlement flow.
- Venue/vendor listings do not require accounts at MVP.

## Schema Source Of Truth

`lib/types/database.ts` is not complete for this feature. It does not include `event_kickback_agreements`, `kickback_payments`, `plans`, or `venue_opportunity_invites`. `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md` states the actual Supabase schema after migrations is the source of truth, so implementation should use `lib/types/database-generated.ts` plus migrations for this reconciliation.

## Schema Mapping Table

| Spec field or table | Current real schema | Migration needed | Notes |
|---|---|---:|---|
| `event_kickback_agreements` | Exists | Yes | Generated type has many settlement-adjacent fields but not proof/extraction fields or `plan_id`. |
| `event_kickback_agreements.plan_id` | Missing | Yes | Add nullable `plan_id uuid` plus index. This becomes the canonical plan-to-settlement link. Do not create new `events` rows. |
| `per_head_kickback_amount` | `event_kickback_agreements.per_head_amount` | No | Use existing agreement column name. Treat spec name as product label only. |
| `bar_revenue_share_percent` | No same-name agreement column. Closest current agreement field is `lift_share_percentage`; venue catalog has `bar_rev_share_pct` / `bar_revenue_share_percent`. | Maybe | Settlement code should use existing agreement fields. If bar-share semantics need to be distinct from lift-share semantics, request approval before adding a dedicated agreement column. |
| `ticket_revenue_share_percent` | No same-name agreement column. Venue catalog has `ticket_sales_share_pct` / `ticket_sales_share_percent`. | Maybe | Use existing names when deriving terms. Do not rename existing columns. |
| `actual_attendance` | Exists on `event_kickback_agreements` | No | Headcount upload may update this field after owner verification. |
| `reported_revenue_cents` | Missing | Yes | Add integer cents field. Leave existing `actual_sales` unchanged. |
| `actual_sales` | Exists on `event_kickback_agreements` | No | Current field likely stores reported sales in the legacy model. New invoice flow should not silently reinterpret it as cents. |
| `attendance_proof_url` | Missing | Yes | Private Supabase Storage signed URL/source pointer for OCR. |
| `attendance_extracted_value` | Missing | Yes | Integer people count from extraction. |
| `attendance_extraction_confidence` | Missing | Yes | Text confidence: `high`, `medium`, `low`. |
| `attendance_submitted_at` | Missing | Yes | Timestamp. |
| `revenue_proof_url` | Missing | Yes | Private proof source pointer for venue revenue report. |
| `revenue_extracted_value_cents` | Missing | Yes | Integer cents extracted by vision agent. |
| `revenue_extraction_confidence` | Missing | Yes | Text confidence: `high`, `medium`, `low`. |
| `revenue_submitted_at` | Missing | Yes | Timestamp. |
| `kickback_payments.amount` | Exists | No | Existing checkout route reads this as dollars and converts to cents. Do not change semantics in this PR. |
| `kickback_payments.amount_cents` | Missing | Yes | New invoice settlement writes this field only. |
| `kickback_payments.settlement_method` | Missing | Yes | Add `'checkout' | 'invoice'`. Existing records remain checkout-compatible. New invoice records use `invoice`. |
| `kickback_payments.stripe_invoice_id` | Missing | Yes | Needed for Stripe Invoicing. |
| `kickback_payments.invoice_hosted_url` | Missing | Yes | Needed for venue pay links and emails. |
| `kickback_payments.processing_fee_cents` | Missing | Yes | ACH/card processing fee charged to venue as separate invoice item. |
| `kickback_payments.builder_payout_cents` | Missing | Yes | Principal transferred to builder. |
| `kickback_payments.paid_at` | Missing | Yes | Needed for paid status and compliance. |
| `kickback_payments.due_date` | Missing | Yes | Part 11 references invoice due dates. Add this so compliance can evaluate unpaid expired invoices without pulling Stripe. |
| `kickback_payments.stripe_transfer_id` | Exists | No | Existing column can store the builder transfer id. |
| `kickback_payments.agreement_id` | Exists | Maybe | Spec wants upsert keyed by agreement. Current migration has unique index on `kickback_payments(event_id)`, not `agreement_id`. Add a unique partial index for invoice settlements on `agreement_id`; review whether the current event-level uniqueness blocks multiple venue agreements per event. |
| `venues.stripe_customer_id` | Missing | Yes | Needed for invoice customer reuse. |
| `venues.last_overdue_count_notified` | Missing | Yes | Needed for daily overdue threshold emails. |
| Storage bucket `event-reports` | Missing from inspected migrations | Yes | Private bucket. No direct user upload policy. Server route uploads with service role after auth check. |
| Storage bucket `venue-spend-reports` | Missing from inspected migrations | Yes | Private bucket. No direct user upload policy. Server route uploads with service role after auth check. |
| `opportunity_invites` | Actual table is `venue_opportunity_invites` | Yes | Spec should target `venue_opportunity_invites`, not a non-existent `opportunity_invites` table. |
| `venue_opportunity_invites.status = 'venue_blocked_compliance'` | Missing | Yes | Add status value to existing status check constraint. |
| `venue_opportunity_invites.blocked_reason` | Missing | Yes | Add text column or use an existing notes field. Spec asks for `blocked_reason`; migration should add it. |

## Existing Agreement Columns

Current generated `event_kickback_agreements` columns:

`actual_attendance`, `actual_kickback_amount`, `actual_qualified_attendance`, `actual_sales`, `agreement_date`, `attendance_lock_time`, `auto_locked`, `base_fee_amount`, `baseline_calculation_method`, `baseline_sales`, `bonus_amount`, `bonus_per_person`, `bonus_threshold`, `builder_approved`, `builder_approved_at`, `builder_id`, `created_at`, `data_entry_logs`, `dispute_notes`, `dispute_reason`, `disputed_at`, `disputed_by`, `event_date`, `event_id`, `expected_attendance`, `expected_kickback_amount`, `flat_base_fee`, `id`, `kickback_model`, `lift_share_percentage`, `maximum_payout`, `minimum_attendees`, `minimum_lift_amount`, `payment_completed_at`, `payment_due_date`, `payment_method`, `per_head_amount`, `sales_lift_amount`, `status`, `stripe_transfer_id`, `updated_at`, `venue_approved`, `venue_approved_at`, `venue_id`, `venue_owner_id`.

## Existing Payment Columns

Current generated `kickback_payments` columns:

`agreement_id`, `amount`, `completed_at`, `created_at`, `currency`, `event_id`, `failed_at`, `failure_reason`, `id`, `initiated_at`, `notes`, `payer_id`, `receipt_url`, `recipient_id`, `status`, `stripe_charge_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_payout_id`, `stripe_transfer_id`, `stripe_transfer_reversal_id`.

## Plan And Event Relationship

- `plans` and `events` are separate today.
- `plans` has `id`, `user_id`, planner lifecycle fields, and does not have `event_id`.
- `events` has `id`, `builder_id`, `event_name`, `event_date`, attendance and lifecycle fields, and does not reference `plans`.
- The correct low-risk bridge for this PR is a nullable `event_kickback_agreements.plan_id`. New endpoints should find agreements through `plan_id`, not try to materialize or backfill `events` from planner plans.

## Money Unit Table

| Field | Current unit | PR convention | Action |
|---|---|---|---|
| `kickback_payments.amount` | Dollars in existing checkout path | Preserve as-is | Existing checkout uses `dollarsToCents(Number(payment.amount))`. Do not write this from new invoice code. |
| `kickback_payments.amount_cents` | Missing | Integer cents | Add and use for all new invoice settlement writes. |
| `kickback_payments.processing_fee_cents` | Missing | Integer cents | Add. Fee charged to venue as a separate invoice item. |
| `kickback_payments.builder_payout_cents` | Missing | Integer cents | Add. Should equal the principal transferred to the builder. |
| `event_kickback_agreements.per_head_amount` | Existing numeric amount; likely dollars in legacy UI | Existing convention | Do not silently switch. If used for new cent math, explicitly normalize at the boundary and document it in code. |
| `event_kickback_agreements.actual_sales` | Existing numeric amount; likely dollars/legacy sales value | Preserve as-is | New revenue screenshot flow should store cents in `reported_revenue_cents`. |
| `event_kickback_agreements.reported_revenue_cents` | Missing | Integer cents | Add for the new venue report flow. |
| `venues.per_head_kickback_amount` | Existing venue commercial field | Existing convention | Use only after confirming whether it is dollars or cents in the current UI/API. |
| `venues.per_head_kickback_cents` | Existing venue commercial field | Integer cents | Prefer when deriving new per-head projections if populated. |
| `venues.bar_rev_share_pct`, `venues.bar_revenue_share_percent` | Percent | Percent | Use as rates, not money. |
| `venues.ticket_sales_share_pct`, `venues.ticket_sales_share_percent` | Percent | Percent | Use as rates, not money. |
| `eventPlanningEconomics` revenue/cost outputs | Integer cents | Integer cents | Add `kickback_projection_cents`; map spec's `gross_ticket_revenue_cents` language to existing `ticket_revenue_cents` unless a rename is explicitly approved. |

## Status Enum Diff

Current `kickback_payments.status` values from the baseline check constraint:

- `pending`
- `processing`
- `completed`
- `failed`
- `refunded`

Proposed added invoice-settlement values:

- `pending_venue_approval`
- `invoice_sent`
- `paid`
- `invoice_failed`

Preservation plan:

- Preserve all existing values for checkout and PaymentIntent flows.
- Add the new values to the same check constraint.
- Add `settlement_method` so old rows and old webhook handlers are not forced into the invoice lifecycle.
- Existing checkout records should use `settlement_method = 'checkout'` by default.
- New screenshot/invoice records should use `settlement_method = 'invoice'`.

Current `venue_opportunity_invites.status` values include:

- `queued`
- `sent`
- `viewed`
- `accepted`
- `declined`
- `countered`
- `expired`
- `concierge_followup`
- `draft`
- `pending_organizer_approval`
- `concierge_queue`
- `cancelled`

Proposed added compliance value:

- `venue_blocked_compliance`

## Existing Checkout Route Reconciliation

Actual route path:

- `app/api/venue/kickbacks/[paymentId]/checkout/route.ts`

Current behavior:

- Authenticates with `getAuthenticatedVenueOwner`.
- Verifies the selected payment belongs to the venue owner through `payer_id`.
- Allows existing statuses `pending` and `failed`.
- Reads `kickback_payments.amount` as dollars and converts to cents.
- Creates a Stripe Checkout Session with PaymentIntent transfer data to the builder connected account.
- Updates the payment to `processing`.
- Updates the agreement to `payment_processing`.

Implementation implication:

- Do not replace this route outright.
- Add invoice behavior only when the DB payment has `settlement_method = 'invoice'`.
- Existing checkout behavior remains for legacy rows with `settlement_method = 'checkout'` or no method during transition.

## Webhook Routing Plan

Current webhook behavior:

- `checkout.session.completed` handles venue-builder kickbacks when `session.metadata.payment_kind === 'venue_builder_kickback'`.
- `payment_intent.succeeded` and `payment_intent.payment_failed` include kickback-specific handling for the existing PaymentIntent/Checkout model.
- `invoice.payment_succeeded` currently routes to builder subscription billing through `applyInvoicePayment`.
- `invoice.payment_failed` currently routes to builder subscription billing through `applyInvoicePaymentFailed`.

Kickback invoice metadata required:

- `kickback_payment_id`
- `settlement_method = invoice`
- `principal_cents`
- `builder_stripe_account_id`

Recommended optional metadata:

- `agreement_id`
- `venue_id`
- `event_id`

Safe routing rules:

1. In every invoice webhook branch, first read `invoice.metadata?.kickback_payment_id`.
2. If no `kickback_payment_id` exists, route to the current builder subscription billing handler unchanged.
3. If `kickback_payment_id` exists, load `kickback_payments` and require `settlement_method = 'invoice'` before doing any kickback transfer or status update.
4. If the DB row is missing, has a non-invoice method, lacks `builder_stripe_account_id`, or has invalid `principal_cents`, log and stop without touching builder subscription billing.
5. For `invoice.paid` / `invoice.payment_succeeded`, transfer 100% of `principal_cents` to the builder connected account and update the invoice settlement fields.
6. For `invoice.payment_failed`, update only invoice-method kickback rows to `invoice_failed`.

Builder subscription invoices are distinguished by the absence of `metadata.kickback_payment_id` and should continue through the existing builder billing code path.

## Email Helper Reconciliation

`lib/email.ts` is the existing email abstraction. It exports:

- `sendResendEmail`
- `sendEmailNotification`
- `buildNotificationEmailHtml`

Implementation should import from `@/lib/email`. Do not create a parallel Resend client or unrelated email abstraction. A new `lib/email/kickbackNotifications.ts` module is acceptable only if it wraps the existing exports.

## AI Agent Reconciliation

- `lib/ai/client.ts` exports the shared `openai` client and `assertOpenAIConfigured`.
- `lib/ai/run-metadata.ts` exports `buildAgentRunMetadata`.
- `lib/ai/types.ts` defines `AgentResult<T>`, but the current `agentNameSchema` does not include a document extraction agent name.

Implementation implication:

- Either add a new `agentNameSchema` value such as `document_extraction` or use an approved existing agent name. Adding a specific value is cleaner and should be included in the implementation scope after approval.

## Venue Visibility And Outreach Reconciliation

Venue catalog API:

- `app/api/venues/route.ts` is the builder-facing venue listing API.
- It currently selects published venues and strips sensitive contact email from public results.
- It caches non-planner catalog responses.

Compliance implication:

- Non-compliant venues should be filtered out by default in this route.
- Because compliance is dynamic, this API may need `no-store` behavior or cache invalidation when compliance-sensitive results are requested.

Recommendation pipeline:

- `app/api/planner/plans/[planId]/recommend/route.ts` loads venue candidates in `loadVenueAgentCandidates`.
- Compliance filtering should happen after candidate loading and before ranking.
- If fewer than the target recommendation count remains, log a warning and continue with the smaller set.

Outreach:

- `lib/planner/opportunityOutreach.ts` creates outreach drafts and invite records after approval gating.
- The provided Part 11 text references `sendVenueInvite`, but that exact function is not present in the inspected file.
- Implementation should enforce compliance before draft creation in `opportunityOutreach.ts` and also locate the actual invite send path during implementation so non-compliant venues cannot receive emails.
- The actual table is `venue_opportunity_invites`, not `opportunity_invites`.

## Routes Added Vs Modified

| File | Add or modify | AGENTS.md status | Purpose |
|---|---|---|---|
| `RECONCILIATION.md` | Added now | Allowed | Required pre-implementation reconciliation report. |
| `lib/ai/agents/documentExtractionAgent.ts` | Add later | Allowed | New shared AI helper, not a route. |
| `app/api/planner/plans/[planId]/event-report/route.ts` | Add later | Allowed | New planner API route under `(planner)` data model context; not under `(dashboard)`. |
| `app/api/venue/kickbacks/[paymentId]/spend-report/route.ts` | Add later | Needs review | API route is outside `(dashboard)`, but naming should match existing `[paymentId]` route convention. |
| `app/api/venue/kickbacks/[paymentId]/checkout/route.ts` | Modify later | Allowed | Existing route; add invoice branch while preserving checkout branch. |
| `app/api/webhooks/stripe/route.ts` | Modify later | Allowed | Add invoice settlement routing without breaking builder billing. |
| `lib/email/kickbackNotifications.ts` | Add later | Allowed | Wrap existing `@/lib/email` exports. |
| `lib/finance/eventPlanningEconomics.ts` | Modify later | Allowed | Add kickback projection line item. |
| `lib/ai/agents/economicsAgent.ts` | Modify later | Allowed | Pass through and explain kickback projection. |
| `app/api/planner/plans/[planId]/recommend/route.ts` | Modify later | Allowed | Add commercial model inputs and venue compliance filtering. |
| `components/planner/PostEventReportCard.tsx` | Add later | Allowed | Planner component. |
| `app/(planner)/planner/page.tsx` | Modify later | Allowed | Render post-event report UI in planner. |
| `app/(planner)/planner/payments/page.tsx` | Modify later | Allowed | Builder payouts surface belongs in planner, not dashboard. |
| `app/(dashboard)/venue/payouts/page.tsx` | Modify later | Explicitly limited | Existing dashboard file only. Add amount-due and compliance banners without creating new dashboard routes/files. |
| `lib/planner/venueComplianceGate.ts` | Add later | Allowed | Pure helper for compliance gating. |
| `app/api/venues/route.ts` | Modify later | Allowed | Filter non-compliant venues out of public listing. |
| `app/api/internal/cron/venue-overdue-check/route.ts` | Add later | Needs approval check | New API route outside `(dashboard)`. Required by Part 11, but it is a new route and should be confirmed as acceptable before implementation. |
| `vercel.json` | Modify later | Allowed if existing project uses it | Add daily cron schedule if no conflicting cron config exists. |
| `supabase/migrations/<timestamp>_kickback_settlement.sql` | Add later | Allowed | One idempotent migration with commented down block. |

## Storage Security Plan

- Create private Supabase Storage buckets only.
- Do not add user-facing insert policies for these buckets.
- Uploads must go through server-side API routes using the service-role client after verifying plan owner or venue owner.
- Generate signed read URLs server-side for the extraction agent.
- MVP accepted MIME types: `image/png`, `image/jpeg`, `image/heic`.
- Reject CSV, XLSX, and PDF with: "Please upload a screenshot or photo. CSV and PDF support is coming soon."

## Compliance Gate Reconciliation

Part 11 requires blocking venues with 3 or more overdue obligations.

Fields needed for this to work:

- `event_kickback_agreements.reported_revenue_cents`
- `kickback_payments.paid_at`
- `kickback_payments.due_date`
- `kickback_payments.settlement_method`
- `venues.last_overdue_count_notified`
- `venue_opportunity_invites.status = 'venue_blocked_compliance'`
- `venue_opportunity_invites.blocked_reason`

Compliance definition should combine:

- Event date grace period: event is more than 7 days in the past.
- Unreported revenue: invoice-method payment is `pending_venue_approval` and agreement has no `reported_revenue_cents`.
- Unpaid invoice: payment is `invoice_sent`, `paid_at IS NULL`, and `due_date < now()`.

The user-facing rule says venues are blocked at 3 or more. A venue that resolves one of three overdue items should drop below threshold and be automatically eligible again on the next listing/recommendation/outreach run.

## Migration Strategy

Implementation should use one idempotent migration file for the settlement feature, including Part 11 fields.

Required migration characteristics:

- `ADD COLUMN IF NOT EXISTS` for all new columns.
- Private storage buckets with `ON CONFLICT DO NOTHING`.
- No direct user upload policies for proof buckets.
- Constraint updates should preserve existing status values.
- Add a default `settlement_method = 'checkout'` for existing payment rows if safe.
- Add indexes for `event_kickback_agreements.plan_id`, invoice lookups, and compliance queries.
- Include a commented down block at the bottom for reversibility.

## Open Questions For Review

1. Should agreement-level bar revenue share use existing `lift_share_percentage`, or should this PR add a dedicated agreement column for bar share percent? The binding decision says use existing names, but the current semantics may differ.
2. Current `kickback_payments` has a unique index on `event_id`. If an event can have multiple venue agreements, invoice payments keyed by `agreement_id` may conflict unless the index is revised or invoice records omit/handle `event_id` carefully.
3. `per_head_amount` appears to be a legacy numeric amount, while newer venue fields include both amount and cents variants. Implementation needs one explicit normalization rule before calculating new invoice amounts.
4. The Part 11 cron route is a new route outside `(dashboard)`. It appears consistent with the spec, but it should be explicitly approved because AGENTS.md says new feature work belongs under `(planner)` and the cron is not a user-facing planner route.
5. `lib/planner/opportunityOutreach.ts` does not directly call a `sendVenueInvite` function. The implementation pass needs to locate the actual email send path and gate both draft creation and final send.

## Proposed Implementation Order After Approval

1. Add the idempotent migration with all settlement, invoice, proof, storage, and compliance fields.
2. Add the document extraction agent and `document_extraction` agent result name.
3. Add planner event-report upload endpoint using `plan_id` agreement lookup.
4. Add venue spend-report upload endpoint using existing agreement column names and `amount_cents`.
5. Add invoice-method branch to the existing kickback checkout route.
6. Add safe invoice webhook routing that falls through to builder billing only when no kickback metadata exists.
7. Add kickback email wrappers using `@/lib/email`.
8. Add kickback projection to deterministic economics and the economics agent.
9. Add compliance helper, recommendation filtering, venue listing filtering, outreach blocking, and overdue cron.
10. Update planner payments UI, venue payouts UI, and post-event report card without adding new dashboard files.
11. Run type-check, lint, and targeted tests.

## Approved Decisions

### Answers to Open Questions

**1. Bar revenue share semantics — add new columns**

Add to `event_kickback_agreements`:
- `bar_revenue_share_percent numeric` (nullable)
- `ticket_revenue_share_percent numeric` (nullable)

`lift_share_percentage` is preserved unchanged. Settlement logic order:
1. If `bar_revenue_share_percent` is set, use it on `reported_revenue_cents`
2. Else if `ticket_revenue_share_percent` is set, use it on ticket revenue
3. Else if `lift_share_percentage` is set, use it on `(actual_sales - baseline_sales)` as the legacy lift formula
4. Else if `per_head_amount` is set, use `dollarsToCents(per_head_amount) * actual_attendance`

**2. `kickback_payments` unique index conflict — change index**

In the migration:
- Drop the existing unique index/constraint on `kickback_payments(event_id)`
- Add unique index on `kickback_payments(agreement_id)`
- Keep `event_id` as a regular indexed FK

This is forward-compatible: today, one agreement per event means behavior is unchanged. When multi-vendor agreements per event become real, the schema already supports them.

**3. Money unit normalization rule**

Binding for this PR:
- Every legacy column **without** a `_cents` suffix is treated as **dollars**
- Every new column gets the `_cents` suffix and stores **integer cents**
- At any boundary between the two, use explicit `dollarsToCents()` or `centsToDollars()`. No implicit casts. No silent `* 100`.

For per-head projections in `lib/finance/eventPlanningEconomics.ts`:
- Prefer `venues.per_head_kickback_cents` when populated
- Else `dollarsToCents(venues.per_head_kickback_amount)`

**4. Cron route approved**

`app/api/internal/cron/venue-overdue-check/route.ts` is approved.

Guardrails:
- Require `Authorization: Bearer ${CRON_SECRET}` header; return 401 without it
- Vercel cron in `vercel.json` injects the secret
- Document `CRON_SECRET` in `.env.example`

The AGENTS.md "no new dashboard files" rule applies to user-facing surfaces, not backend infrastructure. `app/api/internal/cron/` is the correct home.

**5. Outreach compliance gate — gate at two layers**

The compliance gate must be enforced at both:
- **Draft creation** in `lib/planner/opportunityOutreach.ts` — do not create `venue_opportunity_invites` rows for non-compliant venues
- **Send time** in whatever job runner dispatches the email — re-check compliance even if a draft slipped through (defensive, idempotent)

Locate the actual send path during implementation. Likely candidates: `app/api/internal/jobs/run/route.ts`, queue-processor files. Do not assume `sendVenueInvite` exists by that name.

### Additional Binding Decisions

**A. `app/api/venues/route.ts` caching with compliance filter**

- For requests where compliance filtering is applied, return `Cache-Control: no-store`
- For public unauthenticated browsing without compliance filtering, accept up to 60s of staleness
- Do not invalidate on every compliance change — not worth the complexity

**B. Extend `agentNameSchema`**

Add `'document_extraction'` to `agentNameSchema` in `lib/ai/types.ts`. Do not reuse an existing agent name — vision tokens have distinct cost characteristics that need clean analytics.

**C. `event_kickback_agreements.plan_id` cascade and indexing**

- Column is nullable
- Foreign key uses `ON DELETE SET NULL`
- Add composite index on `(plan_id, status)` for the post-event card query pattern
- Do not require a plan link for legacy agreements

## Additional In-Scope Features Approved

### Parts 12-14

The implementation scope now includes:

- Auto-pulling post-event attendance from ticketing platforms when real data is available.
- CSV, XLSX, XLS, and PDF extraction support in addition to screenshots/photos.
- Venue-initiated refund requests with builder approval, Stripe transfer reversal, and Stripe refund execution.

### Part 12 Binding Decisions

- Eventbrite can provide actual check-in counts and should be labeled high confidence.
- Luma can provide RSVP counts only and must be labeled as registered, not verified check-in.
- Partiful and Posh have no auto-pull path in this PR; do not fabricate or estimate.
- Organizer override remains available for every auto-pulled result.
- Platform API failure must fall back to manual upload/entry.

### Part 13 Binding Decisions

- Proof uploads now support `image/png`, `image/jpeg`, `image/heic`, `application/pdf`, `text/csv`, `text/tab-separated-values`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and `application/vnd.ms-excel`.
- File size remains capped at 10 MB.
- Empty tabular files, encrypted PDFs, and unextractable files should return low-confidence extraction results rather than fabricated metrics.
- The storage bucket MIME allow-list must include these file types, while still avoiding direct user upload policies.

### Part 14 Binding Decisions

Add refund fields and statuses to the same schema migration:

- `refund_amount_cents`
- `refund_reason`
- `refund_requested_at`
- `refund_requested_by`
- `refund_approved_at`
- `refund_approved_by`
- `stripe_refund_id`
- `stripe_transfer_reversal_id`

Add payment statuses:

- `refund_requested`
- `refund_approved`
- `refund_processing`
- `refunded_full`
- `refunded_partial`

Refund execution must not refund `processing_fee_cents`.

### Final Out Of Scope

- POS integrations for venue revenue auto-pull.
- Partiful and Posh attendance auto-pull.
- In-app invoice void/cancel UI.
- Migrating existing `kickback_payments.amount` records from dollars to cents.
- Changing builder subscription billing behavior.
- Multi-currency support.
- Platform-admin dispute escalation.

## Approval Gate

Stop here. Human review is required before writing implementation code.
