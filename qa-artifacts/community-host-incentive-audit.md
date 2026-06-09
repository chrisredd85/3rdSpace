# Community Host Incentive Audit

Audit-only PR for the 3rdPlace Community Host Incentive (CHI) migration.

- Branch: `codex/community-host-incentive-audit`
- Base: `origin/main` at `fc61e49e5426caf1c9139349bfa7a6f3db503114`
- Scope: read-only audit and plan
- Product-code changes: none
- Artifact added: `qa-artifacts/community-host-incentive-audit.md`
- Primary compliance constraint: remove active venue-to-organizer settlement language and mechanics that frame payment as kickback, revenue share, bar split, POS share, or any percentage of venue alcohol/F&B/POS/revenue.

## Executive Summary

The current venue-to-organizer payout model is not CHI-ready. Active code still has a venue-to-builder `kickback` namespace, customer-facing "Revenue share" labels, Stripe invoice copy that says "Revenue share", Stripe metadata and transfer groups with `kickback`, and an active spend-report route that calculates money owed as reported venue revenue or ticket revenue multiplied by percent fields.

Top launch blockers:

1. `app/api/venue/kickbacks/[id]/spend-report/route.ts:279-300` calculates payout from `reported_revenue_cents`, `bar_revenue_share_percent`, `ticket_revenue_share_percent`, and `lift_share_percentage`.
2. `app/api/venue/kickbacks/[id]/checkout/route.ts:281-286` creates a Stripe invoice item with description `Revenue share ... of $X`.
3. `app/api/venue/kickbacks/[id]/checkout/route.ts:154-190` creates Stripe Checkout metadata, success/cancel URLs, product names, and idempotency keys using `kickback`.
4. `app/api/webhooks/stripe/route.ts:37-72` and `:207-241` recognize and create transfers under `venue_builder_kickback` and `kickback_payment_id`.
5. `app/(dashboard)/venue/payouts/page.tsx:812-817` exposes "Revenue share" and "venue-to-builder revenue share payments" in the venue UI.
6. `components/planner/PlannerLivePlanPanel.tsx:1188-1208` exposes "per-head kickback", "bar share", "ticket share", and "Revenue share" in planner comparison copy.
7. The database schema and generated types still center on `event_kickback_agreements`, `kickback_payments`, percentage fields, and `calculate_event_kickback`.
8. There is no settlement-mode field or room/subtype mechanism that can reliably distinguish hybrid venues (`hotel`, `retail`, `market_hall`, `outdoor_park`) at booking time.

The migration should be phased. Do not try to rename everything and change settlement logic in one PR. The safe path is: schema/types/calculation engine first; wire one dark-launched entry point; migrate all active callers and UI labels; then archive legacy tables and remove shims after one settlement cycle.

## Commands Run

```bash
git status --short --branch
git fetch origin
git rev-parse origin/main
git branch --show-current

grep -rIn "kickback\|rev_share\|revenue_share\|revShare\|barSplit\|bar_split\|salesShare\|venueSplit\|pos_share" \
  lib app components __tests__ supabase 2>/dev/null

grep -rnE "(revenue|pos|alcohol|fnb|bar|venue_spend|sales)_?(amount|cents|revenue|total).*\*.*(percentage|pct|share|rate)" \
  lib app 2>/dev/null

grep -rnE "payment_type:\s*['\"](revenue_share|rev_share|kickback|bar_split|pos_share)" \
  lib app 2>/dev/null

grep -rnE "calculation_basis|settlement_basis|payout_basis" lib app 2>/dev/null

grep -rnE "Kickback|Revenue share|Rev share|Bar split|% of POS|% of bar|% of alcohol|% of F&B" \
  components app/\(planner\) app/\(dashboard\) 2>/dev/null
```

Scan results:

| Scan | Result |
|---|---:|
| Forbidden term grep | 1,303 matching lines |
| Required percentage regex | 0 matching lines |
| Forbidden Stripe `payment_type` regex | 0 matching lines |
| `calculation_basis` / `settlement_basis` / `payout_basis` grep | 0 matching lines |
| Forbidden UI-label grep | 57 matching lines |

The required percentage regex missed real money-moving percentage logic because the expressions use local variables such as `reportedCents`, `barSharePercent`, and `ticketSharePercent`. The route inspection below identifies those manually.

## Section 1 - Current Settlement Model In Code

### Agreement Storage

The current agreement table is `event_kickback_agreements`. It stores both attendance-based fields and revenue-percentage fields.

Evidence:

| File:Line | Evidence | Risk |
|---|---|---|
| `supabase/migrations/20260527000002_kickback_settlement.sql:9-22` | Adds `bar_revenue_share_percent`, `ticket_revenue_share_percent`, `reported_revenue_cents`, and proof fields to `event_kickback_agreements`. | P0 schema |
| `supabase/migrations/20260527000002_kickback_settlement.sql:65-68` | Adds 0-100 constraints for bar and ticket revenue share percent. | P0 schema |
| `lib/types/database-generated.ts:2210-2381` | Generated types include `event_kickback_agreements` and percentage columns. | P1 generated type |

### Payment Storage

The current payment table is `kickback_payments`.

Evidence:

| File:Line | Evidence | Risk |
|---|---|---|
| `supabase/migrations/20260527000002_kickback_settlement.sql:94-112` | Adds invoice, processing fee, refund, and transfer fields to `kickback_payments`. | P0 schema |
| `app/api/venue/kickbacks/summary/route.ts:81-89` | Venue payout summary reads `kickback_payments` by `payer_id`. | P0 active API |
| `app/api/builder/payouts/summary/route.ts:63-69` | Builder payout summary reads `kickback_payments` by `recipient_id`. | P0 active API |

### Amount Calculation Paths

Current active money calculation has two variants:

1. Legacy check-in RPC: verified check-ins x per-head amount, with a maximum payout.
2. Newer spend-report route: revenue or sales basis x percentage, then creates an invoice settlement.

Evidence:

| File:Line | Calculation | Drives money? | Severity |
|---|---|---:|---|
| `supabase/migrations/20260527000002_kickback_settlement.sql:280-285` | `v_actual_attendees * per_head_amount`, capped by `maximum_payout`. | Yes, inserts `kickback_payments`. | P0 naming, P1 mechanics |
| `supabase/migrations/20260527000002_kickback_settlement.sql:296-317` | Inserts `kickback_payments` when amount is positive. | Yes. | P0 |
| `app/api/events/[eventId]/upload-checkins/route.ts:233-240` | Calls `calculate_event_kickback` after CSV check-ins. | Yes, through RPC. | P0 naming |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:279-288` | `reportedCents * (barSharePercent / 100)`. | Yes, upserts invoice payment. | P0 compliance |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:290-294` | `ticketRevenueCents * (ticketSharePercent / 100)`. | Yes, upserts invoice payment. | P0 compliance |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:296-300` | `(actualSales - baselineSales) * (liftSharePercent / 100)`. | Yes, upserts invoice payment. | P0 compliance |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:303-307` | `perHeadCents * attendance`. | Yes, upserts invoice payment. | P0 naming, CHI-compatible mechanics after rename |

### Stripe Outputs

Current Stripe objects are created from the forbidden namespace and labels.

| File:Line | Stripe object | Current metadata/copy | Severity |
|---|---|---|---|
| `app/api/venue/kickbacks/[id]/checkout/route.ts:154-161` | Checkout / PI metadata | `payment_kind: 'venue_builder_kickback'`, `kickback_payment_id`. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:171-183` | Checkout item and PI | Product name `3rdPlace kickback: ${eventName}` and metadata. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:186-190` | Checkout URLs and idempotency | `?kickback=...`, `kickback_checkout_${payment.id}_${payment.amount}`. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:281-286` | Invoice item | `Revenue share for "${eventLabel.title}" - ${percentLabel} of ${formatCents(reportedRevenueCents)}`. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:286-294` | Invoice item metadata | `kickback_payment_id`, `settlement_method`. | P0 |
| `app/api/webhooks/stripe/route.ts:231-240` | Transfer | `transfer_group: kickback_${paymentId}`, `payment_kind_namespace: venue_builder_kickback`, `kickback_payment_id`. | P0 |
| `app/api/planner/plans/[planId]/refund-decision/route.ts:200-216` | Transfer reversal and refund | `kickback_payment_id`, `settlement_method: 'invoice'`. | P0 |

### User-Facing Copy

| File:Line | Copy | Severity |
|---|---|---|
| `app/(dashboard)/venue/payouts/page.tsx:812-817` | "Revenue share" and "Venue-to-builder revenue share payments after verified attendance." | P0 |
| `app/(dashboard)/venue/payouts/page.tsx:862` | "Revenue share settlements will appear..." | P0 |
| `components/planner/PlannerLivePlanPanel.tsx:1188-1208` | "per-head kickback", "bar share", "ticket share", "Revenue share", "12% of net ticket sales..." | P0 |
| `components/venue/BookingDetailModal.tsx:383-384` | "Per-Head Kickback" | P0 |
| `app/(planner)/planner/payments/page.tsx:172` | "Kickback payouts tied to event agreements" | P0 |
| `app/(marketing)/page.tsx:41` | "kickbacks reconciled" | P0 |
| `app/(marketing)/faq/page.tsx:29` | "kickbacks" | P0 |

## Section 2 - Forbidden Language Inventory

Raw forbidden-term grep returned 1,303 matching lines.

Term counts inside matching lines:

| Term | Count |
|---|---:|
| `kickback` / `Kickback` / `KICKBACK` | 1,480 |
| `revenue_share` | 235 |
| `rev_share` | 90 |
| `revShare` | 2 |
| `salesShare` | 1 |

Highest-risk P0 findings:

| File:Line | Term | Context | Severity |
|---|---|---|---|
| `app/api/venue/kickbacks/[id]/checkout/route.ts:52` | `kickback` | Creates a Stripe Checkout session for venue-to-builder kickback payment. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:155-156` | `kickback` | Stripe metadata uses `venue_builder_kickback` and `kickback_payment_id`. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:172` | `kickback` | Stripe product name is `3rdPlace kickback: ...`. | P0 |
| `app/api/venue/kickbacks/[id]/checkout/route.ts:281-286` | `Revenue share` | Invoice item says revenue share of reported revenue. | P0 |
| `app/api/webhooks/stripe/route.ts:37` | `kickback` | Transfer namespace is `venue_builder_kickback`. | P0 |
| `app/api/webhooks/stripe/route.ts:231-240` | `kickback` | Transfer group and metadata use kickback. | P0 |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:285-300` | `revenue_share` | Active revenue percentage calculations. | P0 |
| `app/(dashboard)/venue/payouts/page.tsx:812-817` | `Revenue share` | Venue UI label and explanatory copy. | P0 |
| `components/planner/PlannerLivePlanPanel.tsx:1190-1208` | `kickback`, `Revenue share` | Planner deal comparison copy. | P0 |
| `components/auth/SignupExperience.tsx:1165` | `bar_kickback_pct` | Signup sends bar percentage setting. | P0 |
| `components/auth/VenueListingInfoPage.tsx:9` | `kickback` | Venue onboarding copy. | P0 |
| `components/settings/AccountSettingsClient.tsx:50-51` | `kickbacks` | Builder Stripe copy references receiving venue kickbacks. | P0 |
| `lib/email.ts:141-142` | `revenue_share` | Email data model includes bar and ticket revenue share percent. | P0 |
| `lib/email.ts:463-485` | `kickback` | Email loader queries `kickback_payments` and errors with kickback wording. | P0 |
| `supabase/migrations/20260527000002_kickback_settlement.sql:85-90` | `revenue_share` | DB comments define revenue share percent fields. | P0/P1 |
| `lib/planner/commercialModelRanker.ts:63-68` | `kickback`, `revenue_share` | Model labels return forbidden copy. | P1 internal and potentially P0 if surfaced |
| `lib/planner/mockAgentResponses.ts:1348-1354` | `kickback`, `bar revenue share` | Planner mock agent detects and returns forbidden model strings. | P1/P0 if surfaced |
| `lib/types/helpers.ts:97` | `Revenue Share` | User-facing type helper label. | P0 if rendered |
| `app/(dashboard)/vendor/pricing/page.tsx:334-340` | `Revenue Share & Kickback` | Vendor UI label. | P0 |

Complete file-level inventory by count:

| Count | File |
|---:|---|
| 130 | `supabase/migrations/20260420000000_remote_baseline.sql` |
| 130 | `supabase/archive/20260420000000_remote_baseline_with_storage.sql` |
| 117 | `supabase/migrations/20260527000002_kickback_settlement.sql` |
| 91 | `lib/types/database-generated.ts` |
| 49 | `__tests__/integration/stripe-kickback-invoice-webhook.test.ts` |
| 37 | `supabase/migrations/20260424123000_add_ticket_import_system.sql` |
| 36 | `app/api/venue/kickbacks/[id]/checkout/route.ts` |
| 30 | `lib/planner/mockAgentResponses.ts` |
| 30 | `lib/planner/commercialModelRanker.ts` |
| 29 | `app/api/webhooks/stripe/route.ts` |
| 28 | `app/api/planner/plans/[planId]/recommend/route.ts` |
| 27 | `lib/venues/venue-adapter.ts` |
| 21 | `__tests__/integration/kickback-refund-routes.test.ts` |
| 20 | `app/(dashboard)/venue/pricing/page.tsx` |
| 19 | `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql` |
| 18 | `app/api/venue/kickbacks/[id]/spend-report/route.ts` |
| 17 | `supabase/seed.sql` |
| 16 | `lib/finance/__tests__/revenueTerms.test.ts` |
| 16 | `app/api/venue/kickbacks/summary/route.ts` |
| 15 | `lib/finance/eventPlanningEconomics.ts` |
| 15 | `app/(dashboard)/venue/payouts/page.tsx` |
| 13 | `app/api/events/[eventId]/upload-checkins/route.ts` |
| 13 | `__tests__/integration/venue-kickback-checkout-route.test.ts` |
| 12 | `supabase/migrations/20260430172000_add_builder_payout_accounts.sql` |
| 12 | `components/planner/PlannerLivePlanPanel.tsx` |
| 12 | `app/(dashboard)/vendor/pricing/page.tsx` |
| 12 | `__tests__/integration/venue-spend-report-route.test.ts` |
| 11 | `lib/finance/revenueTerms.ts` |
| 11 | `lib/finance/calculate-event-financials.ts` |
| 10 | `lib/planner/catalogRanker.ts` |
| 10 | `lib/email.ts` |
| 9 | `supabase/migrations/20260428123000_add_venue_ticket_sales_share.sql` |
| 9 | `lib/finance/eventActuals.ts` |
| 9 | `components/planner/RevenueTermsTab.tsx` |
| 9 | `app/api/venue/kickbacks/[id]/refund-request/route.ts` |
| 8 | `supabase/migrations/20260504000004_venues_add_rev_share_fields.sql` |
| 8 | `app/api/planner/plans/[planId]/refund-decision/route.ts` |
| 8 | `__tests__/integration/venue-kickbacks-summary-route.test.ts` |
| 7 | `lib/planner/__tests__/venueComplianceGate.test.ts` |
| 7 | `lib/finance/__tests__/eventPlanningEconomics.test.ts` |
| 7 | `lib/ai/agents/__tests__/economicsAgent.test.ts` |
| 7 | `app/api/builder/payouts/summary/route.ts` |
| 7 | `__tests__/schema/kickback-settlement-migration.test.ts` |
| 6 | `lib/venues/venueRanker.ts` |
| 6 | `lib/venues/__tests__/venueRanker.test.ts` |
| 6 | `lib/venues/__tests__/venue-adapter.test.ts` |
| 6 | `lib/planner/archetypes/data.ts` |
| 6 | `lib/ai/agents/economicsAgent.ts` |
| 6 | `components/dashboard/PayoutOverviewPanel.tsx` |
| 6 | `app/(planner)/planner/venues/page.tsx` |
| 6 | `__tests__/planner/catalogRanker.test.ts` |
| 5 | `lib/venues/venuePreFilter.ts` |
| 5 | `lib/venues/__tests__/venuePreFilter.test.ts` |
| 5 | `lib/types/database.ts` |
| 5 | `app/api/venues/route.ts` |
| 5 | `app/api/planner/plans/[planId]/event-report/route.ts` |
| 5 | `__tests__/integration/venue-payouts-rental-ui.test.tsx` |
| 5 | `__tests__/integration/builder-payouts-summary-route.test.ts` |
| 5 | `__tests__/email/kickback-notifications.test.ts` |
| 4 | `lib/types/planner.ts` |
| 4 | `lib/planner/venueComplianceGate.ts` |
| 4 | `lib/bookings/venue-booking-adapter.ts` |
| 4 | `lib/ai/agents/venueMatchingAgent.ts` |
| 4 | `components/venue/BookingDetailModal.tsx` |
| 4 | `components/planner/LiveEventDashboard.tsx` |
| 4 | `app/api/planner/templates/route.ts` |
| 4 | `app/api/auth/signup/route.ts` |
| 3 | `supabase/migrations/20260602000007_add_event_revenue_terms.sql` |
| 3 | `lib/vendors/profile-adapter.ts` |
| 3 | `lib/server/account-setup.ts` |
| 3 | `lib/planner/archetypes/intakeQuestions.ts` |
| 3 | `lib/ai/agents/__tests__/venueMatchingAgent.test.ts` |
| 3 | `lib/ai/__tests__/agents.test.ts` |
| 3 | `components/planner/planner-page/draftMode.ts` |
| 3 | `components/auth/SignupExperience.tsx` |
| 3 | `app/api/planner/templates/[id]/apply/route.ts` |
| 3 | `app/(planner)/planner/analytics/page.tsx` |
| 3 | `app/(marketing)/page.tsx` |
| 3 | `__tests__/integration/planner-recommend-agent-route.test.ts` |
| 3 | `__tests__/integration/planner-event-report-route.test.ts` |
| 2 | `supabase/migrations/20260504000002_agent_planner_schema.sql` |
| 2 | `lib/types/enums.ts` |
| 2 | `lib/ticketing/__tests__/attendancePoll.test.ts` |
| 2 | `lib/planner/archetypes/types.ts` |
| 2 | `components/settings/AccountSettingsClient.tsx` |
| 2 | `app/api/admin/catalog/venues/route.ts` |
| 2 | `__tests__/schema/money-cents-migration.test.ts` |
| 2 | `__tests__/integration/venue-overdue-cron-route.test.ts` |
| 1 | `supabase/migrations/20260428151000_enhance_vendor_offerings_services.sql` |
| 1 | `supabase/migrations/20260428144000_standardize_vendor_profiles.sql` |
| 1 | `supabase/migrations/20260428112000_add_posh_luma_financial_webhooks.sql` |
| 1 | `lib/types/helpers.ts` |
| 1 | `lib/ticketing/attendancePoll.ts` |
| 1 | `lib/server/admin-ops.ts` |
| 1 | `lib/live-events/triggers.ts` |
| 1 | `lib/live-events/__tests__/triggers.test.ts` |
| 1 | `lib/finance/__tests__/eventActuals.test.ts` |
| 1 | `components/venue/__tests__/VenueSpendReportUpload.test.tsx` |
| 1 | `components/venue/VenueSpendReportUpload.tsx` |
| 1 | `components/builder/event-wizard/EventbriteImportPanel.tsx` |
| 1 | `components/auth/VenueListingInfoPage.tsx` |
| 1 | `components/admin/AdminCatalogConsole.tsx` |
| 1 | `app/api/vendors/search/route.ts` |
| 1 | `app/api/vendors/route.ts` |
| 1 | `app/api/vendors/featured/route.ts` |
| 1 | `app/api/vendors/[id]/route.ts` |
| 1 | `app/api/events/[eventId]/financials/route.ts` |
| 1 | `app/api/builder/stripe/connect/route.ts` |
| 1 | `app/(planner)/planner/payments/page.tsx` |
| 1 | `app/(marketing)/faq/page.tsx` |
| 1 | `__tests__/planner/mockAgentResponses.test.ts` |
| 1 | `__tests__/planner/archetypePipelineCoverage.test.ts` |
| 1 | `__tests__/integration/template-rebook-preferences.test.ts` |
| 1 | `__tests__/integration/live-event-dashboard-route.test.ts` |

Severity definitions used:

- P0: customer-facing, Stripe object, active money movement, active schema that supports current settlement, or user-visible API error.
- P1: internal code, admin-only copy, planner scoring, comments, tests that can re-seed forbidden language into active code.
- P2: historical archive, generated artifacts, or tests that only preserve current behavior.

## Section 3 - Percentage-Of-Revenue Calculation Footprint

The required grep returned zero lines, but manual route inspection found active percentage-of-revenue math.

| File:Line | Calculation | Input basis | Output | Severity |
|---|---|---|---|---|
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:285-288` | `Math.round(reportedCents * (barSharePercent / 100))` | Venue-reported revenue or extracted proof revenue. | Upserted `kickback_payments.amount_cents`; can become Stripe invoice principal. | P0 |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:290-294` | `Math.round(ticketRevenueCents * (ticketSharePercent / 100))` | Imported ticket sales data from `event_sales_data`. | Upserted `kickback_payments.amount_cents`; can become Stripe invoice principal. | P0 |
| `app/api/venue/kickbacks/[id]/spend-report/route.ts:296-300` | `Math.round(max(actualSales - baselineSales, 0) * (liftSharePercent / 100))` | Venue reported revenue and baseline sales. | Upserted `kickback_payments.amount_cents`; can become Stripe invoice principal. | P0 |
| `lib/finance/eventPlanningEconomics.ts:165-172` | Estimated bar/ticket revenue x `venue_kickback_rate`. | Planning inputs. | Analytics/projection only. | P1 |
| `lib/planner/commercialModelRanker.ts:180-186` | Estimated bar/ticket revenue x percent. | Planner recommendation scoring. | Planner recommendation only. | P1 |
| `components/planner/PlannerLivePlanPanel.tsx:624-627` | `ticketRevenueCents * 0.049` fee and `net ticket sales * 0.12` revenue share. | Planner local model. | UI projection only. | P1/P0 copy |
| `lib/finance/revenueTerms.ts:459-472` | Generic basis x rate. | Can include `bar_revenue` and `venue_kickback` term. | Analytics actuals. | P1 unless wired to settlement |

The CHI refactor must preserve POS/revenue data for analytics and planning, but must remove it from settlement amount calculation.

## Section 4 - Venue Type Coverage Matrix

The active venue type enum is in `lib/planner/archetypes/types.ts:21-53`. There is no separate settlement-mode or room/subtype discriminator.

Recommended settlement classification:

| Venue type | Current code treats as | Should be | Gap |
|---|---|---|---|
| `bar` | Can have per-head, bar revenue share, ticket share, or percentage fields through venue/profile adapters. | CHI eligible. | Rename and recalc to verified-attendance incentive. |
| `lounge` | Same as bar via archetype/ranker. | CHI eligible. | Rename and recalc. |
| `restaurant` | Can use minimum spend, private dining, or revenue terms. | CHI eligible when venue is hosting community traffic; rental/minimum spend otherwise. | Needs per-booking settlement mode. |
| `restaurant_buyout` | Treated as venue type in archetypes. | CHI eligible only when venue-to-host incentive is agreed; otherwise rental/minimum spend. | Needs per-booking settlement mode. |
| `private_dining_room` | Treated as dinner venue. | CHI eligible only for venue-paid host incentive; often minimum spend/rental. | Needs per-booking settlement mode. |
| `cafe` | Used for meetup/run club/pop-up. | CHI eligible. | Rename and recalc. |
| `sports_bar` | Used for watch/game outings. | CHI eligible. | Rename and recalc. |
| `club` | Used for nightlife/showcase. | CHI eligible. | Rename and recalc. |
| `rooftop` | Often bar/lounge but not always. | CHI eligible if hospitality/bar model; rental otherwise. | Treat as hybrid unless venue subtype says bar/lounge. |
| `winery` | Used for retreat/offsite. | CHI eligible only when venue-paid host incentive is explicit. | Needs settlement mode. |
| `event_space` | Currently may appear in archetypes that also compare share models. | Rental only. | Audit existing agreements for event_space rows. |
| `event_hall` | Venue type. | Rental only. | Ensure no CHI path without explicit override. |
| `coworking_event_space` | Appears in networking/panel/hackathon. | Rental only unless partner sponsors event with fixed CHI. | Needs guard. |
| `gallery` | Used for launch/gala/showcase. | Rental only by default. | Needs guard. |
| `studio` | Used for class/showcase/wellness. | Rental only by default. | Needs guard. |
| `classroom` | Venue type. | Rental only. | Needs guard. |
| `theater` | Venue type. | Rental only. | Needs guard. |
| `auditorium` | Venue type. | Rental only. | Needs guard. |
| `startup_venue` | Venue type. | Rental only / sponsor-covered. | Needs guard. |
| `expo_space` | Venue type. | Rental only. | Needs guard. |
| `campus` | Venue type. | Rental only / package. | Needs guard. |
| `community_space` | Venue type. | Rental only unless explicitly sponsored. | Needs guard. |
| `ballroom` | Venue type. | Rental only / package. | Needs guard. |
| `showroom` | Venue type. | Rental only. | Needs guard. |
| `warehouse` | Venue type. | Rental only. | Needs guard. |
| `private_estate` | Venue type. | Rental only / package. | Needs guard. |
| `conference_center` | Enum only. | Rental only. | Needs guard. |
| `loft_warehouse` | Enum only. | Rental only. | Needs guard. |
| `hotel` | No subtype. | Hybrid. | Needs room-level designation or per-booking settlement mode. |
| `retail` | No subtype. | Hybrid. | Needs activation subtype and settlement mode. |
| `market_hall` | No subtype. | Hybrid. | Needs stall/market/restaurant designation. |
| `outdoor_park` | No subtype. | Hybrid. | Needs permit/rental/sponsor designation. |

Recommended model for hybrids: add `settlement_mode` on the agreement/booking (`community_host_incentive`, `venue_rental`, `manual_admin_review`) and optional venue room/subtype metadata. Do not infer CHI eligibility from event archetype alone.

Archetype mapping from `lib/planner/archetypes/data.ts`:

- Pure CHI archetypes: Networking mixer, Pop-up / activation, Community meetup, Private dinner / celebration, Day party / brunch party, Nightlife / club night, Watch party / screening, Game / sports outing.
- Pure rental archetypes: Workshop / class, Panel / fireside, Demo day / pitch night, Hackathon, Retreat / offsite.
- Mixed archetypes: Founder/operator dinner, Brand/product launch, Fundraiser / gala, Listening party / showcase, Holiday reception, Fitness / wellness / run club.

## Section 5 - Proposed CHI Data Model

### TypeScript Functional Core

Add `lib/finance/community-host-incentive/types.ts`:

```ts
export type CHIType =
  | 'per_verified_attendee'
  | 'fixed_threshold'
  | 'fixed_flat'
  | 'base_plus_per_attendee'
  | 'manual_venue_approved'

export type CHIVerificationSource =
  | 'ticketing_api'
  | 'ticketing_webhook'
  | 'csv_upload'
  | 'screenshot_ocr'

export type CHIAgreementInput = {
  agreementType: CHIType
  perHeadRateCents?: number
  fixedAmountCents?: number
  thresholdAttendees?: number
  baseAmountCents?: number
  payoutCapCents?: number
  payoutFloorCents?: number
  venueApproved: boolean
  approvedAt: string
  approvedByVenueUserId: string
}

export type CHISettlementInput = {
  agreement: CHIAgreementInput
  verifiedAttendees: number
  verificationSource: CHIVerificationSource
  verificationSourceId?: string
}

export type CHISettlementResult = {
  organizerPayoutCents: number
  calculationBasis:
    | 'verified_attendance'
    | 'fixed_threshold_met'
    | 'fixed_flat'
    | 'base_plus_verified_attendance'
    | 'manual_venue_approved'
  appliedFloor: boolean
  appliedCap: boolean
  complianceFlags: string[]
}
```

Business rule: floor applies before cap. If `payoutFloorCents > payoutCapCents`, the agreement should fail validation and route to admin review.

### Schema

Add new tables in a future implementation PR:

```sql
CREATE TABLE public.community_host_incentive_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  organizer_user_id uuid NOT NULL REFERENCES public.users(id),
  venue_owner_user_id uuid NOT NULL REFERENCES public.users(id),
  approval_id uuid REFERENCES public.approvals(id),
  agreement_type text NOT NULL,
  per_head_rate_cents integer,
  fixed_amount_cents integer,
  threshold_attendees integer,
  base_amount_cents integer,
  payout_floor_cents integer,
  payout_cap_cents integer,
  settlement_mode text NOT NULL DEFAULT 'community_host_incentive',
  status text NOT NULL DEFAULT 'draft',
  venue_approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by_venue_user_id uuid REFERENCES public.users(id),
  dispute_status text NOT NULL DEFAULT 'none',
  dispute_deadline_at timestamptz,
  settlement_due_at timestamptz,
  is_legacy_revenue_share boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_host_incentive_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.community_host_incentive_agreements(id),
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  verified_attendees integer NOT NULL,
  verification_source text NOT NULL,
  verification_source_id text,
  organizer_payout_cents integer NOT NULL,
  calculation_basis text NOT NULL,
  applied_floor boolean NOT NULL DEFAULT false,
  applied_cap boolean NOT NULL DEFAULT false,
  stripe_invoice_id text,
  stripe_transfer_id text,
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  paid_at timestamptz,
  approval_id uuid REFERENCES public.approvals(id),
  is_legacy_revenue_share boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

RLS policies:

- Organizer can select agreements/settlements where `organizer_user_id = auth.uid()`.
- Venue owner can select agreements/settlements where `venue_owner_user_id = auth.uid()`.
- Service role can manage all rows.
- Authenticated users cannot insert/update settlement rows directly.

Legacy plan:

- Rename `event_kickback_agreements` to `event_kickback_agreements_legacy_archived`.
- Rename `kickback_payments` to `kickback_payments_legacy_archived`.
- Add `is_legacy_revenue_share boolean not null default true` to archived tables.
- Preserve rows. Do not convert old revenue-share rows into CHI rows silently.

## Section 6 - Compliance Guardrails

Add a pure guard in `lib/finance/community-host-incentive/compliance.ts`:

```ts
export const FORBIDDEN_CALCULATION_BASES = new Set([
  'percentage_of_pos',
  'percentage_of_bar_sales',
  'percentage_of_fnb',
  'percentage_of_alcohol',
  'percentage_of_total_revenue',
  'percentage_of_venue_revenue',
  'kickback',
  'revenue_share',
  'rev_share',
  'bar_split',
])

export class CHISettlementForbiddenBasisError extends Error {
  constructor(readonly basis: string) {
    super(`Forbidden CHI settlement basis: ${basis}`)
  }
}

export function assertCalculationBasisAllowed(basis: string): void {
  if (FORBIDDEN_CALCULATION_BASES.has(basis)) {
    throw new CHISettlementForbiddenBasisError(basis)
  }
}
```

This guard must be called by the CHI calculation engine and every venue-to-organizer settlement path before amount persistence or Stripe calls.

## Section 7 - Stripe Metadata And Invoice Language

Required metadata for CHI Stripe invoices, payment intents, checkout sessions, transfers, and refunds:

```ts
{
  event_id: string,
  venue_id: string,
  organizer_id: string,
  payment_type: 'community_host_incentive',
  incentive_type: CHIType,
  calculation_basis: 'verified_attendance' | 'fixed_threshold_met' | 'fixed_flat' | 'base_plus_verified_attendance' | 'manual_venue_approved',
  verified_attendees: string,
  per_head_rate_cents: string,
  applied_floor: 'true' | 'false',
  applied_cap: 'true' | 'false',
  is_revenue_share: 'false',
  is_percentage_of_alcohol: 'false',
  is_percentage_of_pos: 'false',
}
```

Required invoice copy:

- `Community Host Incentive - 200 verified attendees x $10.00 = $2,000.00`
- `Community Host Incentive - Fixed compensation after 150-attendee threshold met = $1,000.00`
- `Community Host Incentive - Base $500.00 + (180 verified attendees x $5.00) = $1,400.00`

Files that currently construct Stripe invoice/payment/transfer/refund objects and must be migrated:

- `app/api/venue/kickbacks/[id]/checkout/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.ts`
- `app/api/venue/kickbacks/[id]/refund-request/route.ts`
- Tests under `__tests__/integration/stripe-kickback-invoice-webhook.test.ts`, `__tests__/integration/venue-kickback-checkout-route.test.ts`, and `__tests__/integration/kickback-refund-routes.test.ts`

## Section 8 - Test Coverage Matrix

Existing coverage:

| Requirement | Existing tests | Gap |
|---|---|---|
| Current invoice webhook behavior | `__tests__/integration/stripe-kickback-invoice-webhook.test.ts` | Must be rewritten for CHI metadata and duplicate ledger pattern after PR #60 lands. |
| Current checkout route behavior | `__tests__/integration/venue-kickback-checkout-route.test.ts` | Must assert CHI labels and no forbidden metadata. |
| Current spend report behavior | `__tests__/integration/venue-spend-report-route.test.ts` | Must stop percent-of-revenue settlement and assert POS data is analytics only. |
| Current refund behavior | `__tests__/integration/kickback-refund-routes.test.ts` | Must rename metadata and keep approval-gated refunds. |
| Revenue term analytics | `lib/finance/__tests__/revenueTerms.test.ts` | Must distinguish analytics terms from settlement terms. |
| Planning economics | `lib/finance/__tests__/eventPlanningEconomics.test.ts` | Must rename/adjust projections to CHI. |

Required new coverage:

- Per-verified-attendee calculation for several attendance counts.
- Fixed-flat calculation where attendance does not change result.
- Fixed-threshold calculation below, equal, and above threshold.
- Base-plus-per-attendee calculation.
- Floor applied when formula result is below floor.
- Cap applied when formula result exceeds cap.
- Floor plus cap with formula between them.
- Floor greater than cap rejects agreement.
- Manual venue-approved exact amount.
- Every forbidden basis throws.
- Stripe metadata snapshot for every CHI type.
- Invoice line item snapshot for every CHI type.
- Venue type guard blocks rental-only venue types.
- Hybrid venue requires explicit settlement mode.
- Verified attendee source provenance is stored.
- T+7 settlement window and dispute block.
- Unresolved dispute escalates to `admin_tasks` after 7 days.
- Organizer crossing $600 yearly CHI payout is flagged for tax issuance workflow.

## Section 9 - Legacy Data Migration

This audit did not query production row counts. It is a read-only repo audit with no Supabase production query executed. Before Phase gamma, run production count queries for:

```sql
select count(*) from public.kickback_payments;
select status, count(*) from public.kickback_payments group by status order by status;
select count(*) from public.event_kickback_agreements;
select status, count(*) from public.event_kickback_agreements group by status order by status;
select count(*)
from public.event_kickback_agreements
where event_date >= now()::date
   or status not in ('payment_completed', 'cancelled');
```

Migration plan:

1. Create CHI tables alongside legacy tables.
2. Add CHI calculation engine and compliance guard with no callers.
3. For new CHI agreements, write only `community_host_incentive_agreements`.
4. Treat old rows as historical. Do not silently convert revenue-share rows.
5. Identify in-flight old rows and require product decision: re-approve under CHI terms or explicitly grandfather.
6. Rename old tables with `_legacy_archived` suffix.
7. Add `is_legacy_revenue_share = true` to archived rows.
8. Lock archived tables read-only after final cleanup.

Rollback:

- Rename archived tables back.
- Drop CHI tables, views, and functions.
- Drop `is_legacy_revenue_share` only if no audit process depends on it.

## Section 10 - Risk Assessment

| Finding | Risk | Detection if unfixed | Exposure |
|---|---|---|---|
| Stripe invoice line item says "Revenue share" and references percent of reported revenue. | CA tied house language and mechanics risk. | Venue invoice, Stripe dashboard, accounting export, regulator/auditor/customer review. | High. Launch blocker. |
| Active spend-report settlement calculates payout from reported revenue x percent. | Directly conflicts with CHI product decision. | Stripe invoice principal and DB rows. | High. Launch blocker. |
| Stripe metadata uses `venue_builder_kickback` and `kickback_payment_id`. | Durable third-party audit trail with prohibited language. | Stripe dashboard, webhook logs, exports. | High. Launch blocker. |
| UI labels use "Revenue share", "Kickback", "12% of net ticket sales". | Customer-facing compliance framing risk. | Screenshots, user reports, sales demos. | High. Launch blocker. |
| Schema names and generated types use `kickback` and percentage fields. | Internal and future implementation risk; can reintroduce forbidden model. | Code review, DB introspection. | Medium to high. |
| Planner/ranker still recommends revenue-share models. | Product drift and host expectation mismatch. | Planner UI and agent draft output. | Medium to high. |
| No hybrid venue disambiguation. | Wrong settlement flow for hotels/retail/market halls/parks. | Production booking edge cases. | Medium. |

## Section 11 - Proposed Implementation Phases

### PR alpha - Schema, Types, Calculation Engine

Safe to merge with no behavior change.

Scope:

- Add `community_host_incentive_agreements` and `community_host_incentive_settlements`.
- Add RLS policies.
- Add `lib/finance/community-host-incentive/types.ts`.
- Add `lib/finance/community-host-incentive/compliance.ts`.
- Add pure `calculateCHI`.
- Add `scripts/security/check-tied-house-compliance.sh`.
- Add `npm run security:tied-house`.
- Add pure calculation tests.

Do not wire callers yet.

### PR beta - Wire One Entry Point Behind Feature Flag

Recommended first entry point: `app/api/venue/kickbacks/[id]/spend-report/route.ts` plus invoice creation in `app/api/venue/kickbacks/[id]/checkout/route.ts`.

Reason: it is the clearest active P0 path where POS/revenue proof currently feeds settlement. The new behavior can preserve proof upload for analytics while redirecting settlement to verified attendance CHI.

Scope:

- Feature flag `CHI_NEW_ENGINE_ENABLED`, default off.
- CHI path for one entry point.
- Keep legacy path when flag is off.
- Add CHI metadata and invoice copy snapshots.
- Add idempotent webhook tests using PR #60 ledger pattern.
- Ensure no forbidden metadata/copy in new path.

### PR gamma - Migrate Remaining Callers And Rename Active Surfaces

Largest and riskiest PR.

Scope:

- Migrate all `app/api/venue/kickbacks/*` routes.
- Rename active route namespace to `app/api/venue/community-host-incentive/*`.
- Add temporary 308 redirects only if needed.
- Update builder payout summary, venue payout summary, planner payment UI, venue UI, email loaders, admin catalog, planner/ranker terms, and generated types.
- Rename active UI labels.
- Regenerate database types.
- Add route/component/snapshot tests.
- Archive legacy table names with `_legacy_archived` suffix.

### PR delta - Cleanup And Final Compliance Pass

Start only after PR gamma has been in production for at least 7 days.

Scope:

- Remove feature flag.
- Remove old redirects if no traffic.
- Remove defensive old-metadata shims if no Sentry/Vercel evidence of old events.
- Lock archived tables read-only.
- Add `docs/community-host-incentive.md`.
- Final tied-house grep must return only allowed exemptions.

## Section 12 - Out Of Scope

This audit and the proposed CHI implementation do not change:

- Stripe infrastructure mechanics from PR #60.
- Traditional venue rental flow.
- Organizer subscription billing.
- Event credit purchases.
- Vendor payment flow.
- Deposit holds.
- The archetype definitions themselves, except future forbidden-copy cleanup.
- Full 1099 issuance implementation.

## Stop-Gate Before Implementation

Do not start PR alpha until this audit is reviewed. Decisions needed from product/legal before implementation:

1. Confirm whether archived migration files may retain forbidden historical names beyond `_legacy_archived` table names.
2. Confirm exact tax form path: Stripe 1099-MISC vs 1099-NEC.
3. Confirm whether in-flight revenue-share agreements should be re-approved under CHI or grandfathered.
4. Confirm if old route paths should redirect temporarily or hard fail after gamma.
5. Confirm whether `vendor_rev_share` is in scope for this tied-house cleanup or separate vendor pricing cleanup.

The CHI path itself should remain approval-gated: venue terms and payout formula must be approved before settlement, and re-approval is required if price, date, seats, vendor, venue, or terms change.
