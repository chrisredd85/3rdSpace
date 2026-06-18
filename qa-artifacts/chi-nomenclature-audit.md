# CHI Nomenclature Audit

Generated from `qa-artifacts/tied-house-violations.txt` on 2026-06-17T23:17:27.939Z.

## Summary

The strict tied-house grep found 771 occurrences across 68 files. This is expected for Phase delta.1: the strict script is intentionally not CI-blocking yet.

| Track | Occurrences | Files affected | Estimated PR size |
| --- | ---: | ---: | --- |
| Track A: Database Schema | 17 | 4 | small |
| Track B: API Contracts | 147 | 16 | large |
| Track C: Type Names + Variable Names | 532 | 40 | large |
| Track D: UI Strings | 61 | 12 | medium |
| Track E: Internal-Only References | 14 | 3 | small |

## Proposed Naming Map

- `kickback` -> `chi` or `Community Host Incentive` in user-facing copy.
- `per_head_kickback_amount` / `per_head_kickback_cents` -> `per_head_chi_cents`.
- `bar_kickback_pct` -> `bar_chi_pct`.
- `headcount_kickback` -> `headcount_chi`.
- `event_kickback_agreements` -> prefer `community_host_incentive_agreements` for schema clarity.
- `calculate_event_kickback` -> `calculate_event_chi`.
- `KickbackAgreementRow` -> `ChiAgreementRow`.
- `rev_share` / `revenue_share` -> `consumption_share` where it describes consumption economics; otherwise map to CHI-specific names.

## Track A: Database Schema

Total occurrences: 17. Files affected: 4. Estimated PR size: small.

| path:line | kind | current name/context | proposed CHI name | owning migration file |
| --- | --- | --- | --- | --- |
| supabase/migrations/20260602000007_add_event_revenue_terms.sql:3 | column | -- Context: Store event-scoped tax, ticketing fee, service fee, venue kickback, | -- Context: Store event-scoped tax, ticketing fee, service fee, venue chi, | supabase/migrations/20260602000007_add_event_revenue_terms.sql |
| supabase/migrations/20260602000007_add_event_revenue_terms.sql:17 | column | 'venue_kickback', | 'venue_chi', | supabase/migrations/20260602000007_add_event_revenue_terms.sql |
| supabase/migrations/20260602000007_add_event_revenue_terms.sql:19 | schema text | 'vendor_rev_share', | 'vendor_consumption_share', | supabase/migrations/20260602000007_add_event_revenue_terms.sql |
| supabase/migrations/20260616000000_add_community_host_incentive_payments_view.sql:25 | schema text | false::boolean AS is_legacy_revenue_share | false::boolean AS is_legacy_consumption_share | supabase/migrations/20260616000000_add_community_host_incentive_payments_view.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:184 | table | ALTER TABLE public.kickback_payments | ALTER TABLE public.community_host_incentive_payments | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:185 | column | DROP CONSTRAINT IF EXISTS kickback_payments_status_check; | DROP CONSTRAINT IF EXISTS community_host_incentive_payments_status_check; | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:186 | table | ALTER TABLE public.kickback_payments | ALTER TABLE public.community_host_incentive_payments | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:187 | column | ADD CONSTRAINT kickback_payments_status_check | ADD CONSTRAINT community_host_incentive_payments_status_check | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:318 | column | v_kickback_payments integer := 0; | v_community_host_incentive_payments integer := 0; | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:368 | column | UPDATE public.kickback_payments | UPDATE public.community_host_incentive_payments | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:376 | column | GET DIAGNOSTICS v_kickback_payments = ROW_COUNT; | GET DIAGNOSTICS v_community_host_incentive_payments = ROW_COUNT; | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260608000000_stripe_connect_business_readiness.sql:394 | column | 'kickback_payments', v_kickback_payments | 'community_host_incentive_payments', v_community_host_incentive_payments | supabase/migrations/20260608000000_stripe_connect_business_readiness.sql |
| supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql:4 | column | -- kickback/revenue-share rows are renamed or converted in this phase. | -- chi/revenue-share rows are renamed or converted in this phase. | supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql |
| supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql:29 | schema text | is_legacy_revenue_share boolean NOT NULL DEFAULT false, | is_legacy_consumption_share boolean NOT NULL DEFAULT false, | supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql |
| supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql:102 | column | COMMENT ON COLUMN public.community_host_incentive_agreements.is_legacy_revenue_share IS | COMMENT ON COLUMN public.community_host_incentive_agreements.is_legacy_consumption_share IS | supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql |
| supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql:146 | schema text | is_legacy_revenue_share boolean NOT NULL DEFAULT false, | is_legacy_consumption_share boolean NOT NULL DEFAULT false, | supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql |
| supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql:186 | column | COMMENT ON COLUMN public.community_host_incentive_settlements.is_legacy_revenue_share IS | COMMENT ON COLUMN public.community_host_incentive_settlements.is_legacy_consumption_share IS | supabase/migrations/20260609000000_add_community_host_incentive_foundation.sql |

## Track B: API Contracts

Total occurrences: 147. Files affected: 16. Estimated PR size: large.

| path:line | route | current key/shape | proposed key | breaking change? |
| --- | --- | --- | --- | --- |
| app/api/vendors/search/route.ts:43 | /vendors/search | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/vendors/[id]/route.ts:29 | /vendors/:id | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/vendors/route.ts:21 | /vendors | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/vendors/featured/route.ts:30 | /vendors/featured | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:54 | /planner/plans/:planId/event-report | type KickbackAgreementRow = { | type ChiAgreementRow = { | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:107 | /planner/plans/:planId/event-report | const agreements = await loadPlanKickbackAgreements(admin, plan.id) | const agreements = await loadPlanKickbackAgreements(admin, plan.id) | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:169 | /planner/plans/:planId/event-report | const agreements = await loadPlanKickbackAgreements(admin, plan.id) | const agreements = await loadPlanKickbackAgreements(admin, plan.id) | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:197 | /planner/plans/:planId/event-report | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:270 | /planner/plans/:planId/event-report | async function loadPlanKickbackAgreements(admin: any, planId: string): Promise&lt;KickbackAgreementRow[]&gt; { | async function loadPlanKickbackAgreements(admin: any, planId: string): Promise&lt;ChiAgreementRow[]&gt; { | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:272 | /planner/plans/:planId/event-report | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:296 | /planner/plans/:planId/event-report | throw new Error(error.message ?? 'Failed to load kickback agreement') | throw new Error(error.message ?? 'Failed to load chi agreement') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:299 | /planner/plans/:planId/event-report | return (data ?? []) as KickbackAgreementRow[] | return (data ?? []) as ChiAgreementRow[] | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:310 | /planner/plans/:planId/event-report | agreements: KickbackAgreementRow[] | agreements: ChiAgreementRow[] | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:355 | /planner/plans/:planId/event-report | async function loadAgreementVenueTypes(admin: any, agreements: KickbackAgreementRow[]) { | async function loadAgreementVenueTypes(admin: any, agreements: ChiAgreementRow[]) { | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/event-report/route.ts:376 | /planner/plans/:planId/event-report | async function loadAgreementVenueNames(admin: any, agreements: KickbackAgreementRow[]) { | async function loadAgreementVenueNames(admin: any, agreements: ChiAgreementRow[]) { | yes, unless aliased during migration |
| app/api/auth/signup/route.ts:30 | /auth/signup | bar_kickback_pct?: number \| null | bar_chi_pct?: number \| null | yes, unless aliased during migration |
| app/api/auth/signup/route.ts:80 | /auth/signup | bar_kickback_pct?: number \| null | bar_chi_pct?: number \| null | yes, unless aliased during migration |
| app/api/auth/signup/route.ts:280 | /auth/signup | bar_kickback_pct: body.bar_kickback_pct ?? null, | bar_chi_pct: body.bar_chi_pct ?? null, | yes, unless aliased during migration |
| app/api/auth/signup/route.ts:382 | /auth/signup | barKickbackPct: venueDetails.bar_kickback_pct ?? null, | barKickbackPct: venueDetails.bar_chi_pct ?? null, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:126 | /planner/plans/:planId/refund-decision | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:148 | /planner/plans/:planId/refund-decision | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:190 | /planner/plans/:planId/refund-decision | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:211 | /planner/plans/:planId/refund-decision | kickback_payment_id: payment.id, | community_host_incentive_payment_id: payment.id, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:217 | /planner/plans/:planId/refund-decision | : `kickback_refund_${payment.id}` | : `chi_refund_${payment.id}` | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:238 | /planner/plans/:planId/refund-decision | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/refund-decision/route.ts:249 | /planner/plans/:planId/refund-decision | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/planner/templates/[id]/apply/route.ts:58 | /planner/templates/:id/apply | kickback_model, | chi_model, | yes, unless aliased during migration |
| app/api/planner/templates/[id]/apply/route.ts:77 | /planner/templates/:id/apply | kickback_model: Json | chi_model: Json | yes, unless aliased during migration |
| app/api/planner/templates/[id]/apply/route.ts:450 | /planner/templates/:id/apply | kickback_model: template.kickback_model, | chi_model: template.chi_model, | yes, unless aliased during migration |
| app/api/planner/templates/route.ts:21 | /planner/templates | kickback_model, | chi_model, | yes, unless aliased during migration |
| app/api/planner/templates/route.ts:41 | /planner/templates | kickback_model: Json | chi_model: Json | yes, unless aliased during migration |
| app/api/planner/templates/route.ts:202 | /planner/templates | kickback_model: row.kickback_model, | chi_model: row.chi_model, | yes, unless aliased during migration |
| app/api/planner/templates/route.ts:275 | /planner/templates | kickback_model: { | chi_model: { | yes, unless aliased during migration |
| app/api/venues/route.ts:259 | /venues | 'bar_rev_share_enabled', | 'bar_consumption_share_enabled', | yes, unless aliased during migration |
| app/api/venues/route.ts:260 | /venues | 'bar_rev_share_pct', | 'bar_consumption_share_pct', | yes, unless aliased during migration |
| app/api/venues/route.ts:261 | /venues | 'sponsor_rev_share_enabled', | 'sponsor_consumption_share_enabled', | yes, unless aliased during migration |
| app/api/venues/route.ts:262 | /venues | 'sponsor_rev_share_pct', | 'sponsor_consumption_share_pct', | yes, unless aliased during migration |
| app/api/venues/route.ts:263 | /venues | 'per_head_kickback_cents', | 'per_head_chi_cents', | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:258 | /planner/plans/:planId/recommend | bar_rev_share_enabled, | bar_consumption_share_enabled, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:259 | /planner/plans/:planId/recommend | bar_rev_share_pct, | bar_consumption_share_pct, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:261 | /planner/plans/:planId/recommend | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:262 | /planner/plans/:planId/recommend | per_head_kickback_cents, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:310 | /planner/plans/:planId/recommend | per_head_kickback, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:311 | /planner/plans/:planId/recommend | per_head_kickback_cents, | per_head_chi_cents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:312 | /planner/plans/:planId/recommend | offers_kickbacks, | offers_chis, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:316 | /planner/plans/:planId/recommend | bar_revenue_share_enabled, | bar_consumption_share_enabled, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:317 | /planner/plans/:planId/recommend | bar_rev_share_pct, | bar_consumption_share_pct, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:318 | /planner/plans/:planId/recommend | bar_revenue_share_percent, | bar_consumption_share_percent, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2426 | /planner/plans/:planId/recommend | revenue_share: readString(summary.revenue_share), | consumption_share: readString(summary.consumption_share), | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2488 | /planner/plans/:planId/recommend | const venueKickback = deriveVenueKickbackEconomics(context.venue) | const venueKickback = deriveVenueKickbackEconomics(context.venue) | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2498 | /planner/plans/:planId/recommend | venue_commercial_model: venueKickback.venue_commercial_model, | venue_commercial_model: venueKickback.venue_commercial_model, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2499 | /planner/plans/:planId/recommend | venue_kickback_rate: venueKickback.venue_kickback_rate ?? 0, | venue_chi_rate: venueKickback.venue_chi_rate ?? 0, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2529 | /planner/plans/:planId/recommend | function deriveVenueKickbackEconomics(venue: VenueMatchingCandidate \| null): Partial&lt;Pick&lt; | function deriveVenueKickbackEconomics(venue: VenueMatchingCandidate \| null): Partial&lt;Pick&lt; | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2531 | /planner/plans/:planId/recommend | 'venue_commercial_model' \| 'venue_kickback_rate' | 'venue_commercial_model' \| 'venue_chi_rate' | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2535 | /planner/plans/:planId/recommend | const barRevenueSharePercent = readNumber(venue.bar_revenue_share_percent) | const barRevenueSharePercent = readNumber(venue.bar_consumption_share_percent) | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2536 | /planner/plans/:planId/recommend | if (venue.bar_revenue_share_enabled && barRevenueSharePercent && barRevenueSharePercent &gt; 0) { | if (venue.bar_consumption_share_enabled && barRevenueSharePercent && barRevenueSharePercent &gt; 0) { | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2538 | /planner/plans/:planId/recommend | venue_commercial_model: 'bar_revenue_share', | venue_commercial_model: 'bar_consumption_share', | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2539 | /planner/plans/:planId/recommend | venue_kickback_rate: barRevenueSharePercent, | venue_chi_rate: barRevenueSharePercent, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2546 | /planner/plans/:planId/recommend | venue_commercial_model: 'ticket_revenue_share', | venue_commercial_model: 'ticket_consumption_share', | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2547 | /planner/plans/:planId/recommend | venue_kickback_rate: ticketSharePercent, | venue_chi_rate: ticketSharePercent, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2551 | /planner/plans/:planId/recommend | const perHeadKickbackCents = readCents(venue.per_head_kickback) | const perHeadKickbackCents = readCents(venue.per_head_chi_cents) | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2552 | /planner/plans/:planId/recommend | if (perHeadKickbackCents && perHeadKickbackCents &gt; 0) { | if (perHeadKickbackCents && perHeadKickbackCents &gt; 0) { | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2554 | /planner/plans/:planId/recommend | venue_commercial_model: 'per_head_kickback', | venue_commercial_model: 'per_head_chi_cents', | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:2555 | /planner/plans/:planId/recommend | venue_kickback_rate: perHeadKickbackCents, | venue_chi_rate: perHeadKickbackCents, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3042 | /planner/plans/:planId/recommend | per_head_kickback: readCents( | per_head_chi_cents: readCents( | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3043 | /planner/plans/:planId/recommend | row.per_head_kickback_cents as number \| string \| null \| undefined, | row.per_head_chi_cents as number \| string \| null \| undefined, | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3044 | /planner/plans/:planId/recommend | row.per_head_kickback as number \| string \| null \| undefined | row.per_head_chi_cents as number \| string \| null \| undefined | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3046 | /planner/plans/:planId/recommend | offers_kickbacks: readBoolean(row.offers_kickbacks), | offers_chis: readBoolean(row.offers_chis), | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3050 | /planner/plans/:planId/recommend | bar_revenue_share_enabled: readBoolean(row.bar_revenue_share_enabled), | bar_consumption_share_enabled: readBoolean(row.bar_consumption_share_enabled), | yes, unless aliased during migration |
| app/api/planner/plans/[planId]/recommend/route.ts:3051 | /planner/plans/:planId/recommend | bar_revenue_share_percent: readNumber(row.bar_revenue_share_percent ?? row.bar_rev_share_pct ?? row.bar_revenue_percentage), | bar_consumption_share_percent: readNumber(row.bar_consumption_share_percent ?? row.bar_consumption_share_pct ?? row.bar_revenue_percentage), | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:9 | /builder/payouts/summary | type KickbackPaymentRow = { | type KickbackPaymentRow = { | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:38 | /builder/payouts/summary | function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) { | function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) { | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:64 | /builder/payouts/summary | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:77 | /builder/payouts/summary | const payments = ((paymentRows \|\| []) as KickbackPaymentRow[]) | const payments = ((paymentRows \|\| []) as KickbackPaymentRow[]) | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:92 | /builder/payouts/summary | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:93 | /builder/payouts/summary | .select('id, event_id, plan_id, venue_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, reported_revenue_cents, bar_revenue_share_percent, ticket_revenue_share_percent, lift_share_percentage, status') | .select('id, event_id, plan_id, venue_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_chi_amount, repor... | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:148 | /builder/payouts/summary | revenue_share_percent: | consumption_share_percent: | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:149 | /builder/payouts/summary | agreement?.bar_revenue_share_percent ?? | agreement?.bar_consumption_share_percent ?? | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:150 | /builder/payouts/summary | agreement?.ticket_revenue_share_percent ?? | agreement?.ticket_consumption_share_percent ?? | yes, unless aliased during migration |
| app/api/builder/payouts/summary/route.ts:177 | /builder/payouts/summary | function getPaymentPrincipalCents(payment: Pick&lt;KickbackPaymentRow, 'amount_cents' \| 'amount'&gt;) { | function getPaymentPrincipalCents(payment: Pick&lt;KickbackPaymentRow, 'amount_cents' \| 'amount'&gt;) { | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:266 | /events/:eventId/upload-checkins | kickback_amount: settlement.legacyAmountForCompatibility, | chi_amount: settlement.legacyAmountForCompatibility, | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:281 | /events/:eventId/upload-checkins | const { data, error } = await admin.rpc('calculate_event_kickback', { | const { data, error } = await admin.rpc('calculate_event_chi', { | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:291 | /events/:eventId/upload-checkins | typeof data === 'object' && data && 'kickback_amount' in data | typeof data === 'object' && data && 'chi_amount' in data | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:292 | /events/:eventId/upload-checkins | ? Number((data as { kickback_amount?: number }).kickback_amount ?? 0) | ? Number((data as { chi_amount?: number }).chi_amount ?? 0) | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:357 | /events/:eventId/upload-checkins | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/events/[eventId]/upload-checkins/route.ts:392 | /events/:eventId/upload-checkins | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/events/[eventId]/financials/route.ts:92 | /events/:eventId/financials | venue_kickback_projection: 0, | venue_chi_projection: 0, | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:41 | /webhooks/stripe | const KICKBACK_TRANSFER_NAMESPACE = 'venue_builder_kickback' | const KICKBACK_TRANSFER_NAMESPACE = 'venue_builder_chi' | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:72 | /webhooks/stripe | function isKickbackTransferEvent(transfer: Stripe.Transfer) { | function isKickbackTransferEvent(transfer: Stripe.Transfer) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:74 | /webhooks/stripe | transfer.metadata?.payment_kind_namespace === KICKBACK_TRANSFER_NAMESPACE \|\| | transfer.metadata?.payment_kind_namespace === KICKBACK_TRANSFER_NAMESPACE \|\| | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:75 | /webhooks/stripe | Boolean(transfer.metadata?.kickback_payment_id) | Boolean(transfer.metadata?.community_host_incentive_payment_id) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:110 | /webhooks/stripe | async function applyKickbackCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session) { | async function applyKickbackCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:111 | /webhooks/stripe | if (session.metadata?.payment_kind !== 'venue_builder_kickback') return false | if (session.metadata?.payment_kind !== 'venue_builder_chi') return false | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:113 | /webhooks/stripe | const paymentId = session.metadata.kickback_payment_id | const paymentId = session.metadata.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:125 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:141 | /webhooks/stripe | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:154 | /webhooks/stripe | async function applyKickbackPaymentIntent(admin: any, paymentIntent: Stripe.PaymentIntent) { | async function applyKickbackPaymentIntent(admin: any, paymentIntent: Stripe.PaymentIntent) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:155 | /webhooks/stripe | if (paymentIntent.metadata?.payment_kind !== 'venue_builder_kickback') return false | if (paymentIntent.metadata?.payment_kind !== 'venue_builder_chi') return false | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:157 | /webhooks/stripe | const paymentId = paymentIntent.metadata.kickback_payment_id | const paymentId = paymentIntent.metadata.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:165 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:180 | /webhooks/stripe | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:193 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:206 | /webhooks/stripe | async function applyKickbackTransferEvent(admin: any, transfer: Stripe.Transfer, status: 'completed' \| 'refunded') { | async function applyKickbackTransferEvent(admin: any, transfer: Stripe.Transfer, status: 'completed' \| 'refunded') { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:209 | /webhooks/stripe | const paymentId = transfer.metadata?.kickback_payment_id | const paymentId = transfer.metadata?.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:211 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:309 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:348 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:432 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:449 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:459 | /webhooks/stripe | async function applyKickbackInvoicePaid(admin: any, invoice: Stripe.Invoice) { | async function applyKickbackInvoicePaid(admin: any, invoice: Stripe.Invoice) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:460 | /webhooks/stripe | const paymentId = invoice.metadata?.kickback_payment_id | const paymentId = invoice.metadata?.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:473 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:488 | /webhooks/stripe | transfer_group: `kickback_${paymentId}`, | transfer_group: `chi_${paymentId}`, | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:490 | /webhooks/stripe | payment_kind_namespace: KICKBACK_TRANSFER_NAMESPACE, | payment_kind_namespace: KICKBACK_TRANSFER_NAMESPACE, | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:491 | /webhooks/stripe | kickback_payment_id: paymentId, | community_host_incentive_payment_id: paymentId, | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:496 | /webhooks/stripe | idempotencyKey: `kickback_invoice_transfer_${paymentId}_${invoice.id}_${principalCents}`, | idempotencyKey: `chi_invoice_transfer_${paymentId}_${invoice.id}_${principalCents}`, | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:502 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:516 | /webhooks/stripe | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:533 | /webhooks/stripe | async function applyKickbackInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice) { | async function applyKickbackInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:534 | /webhooks/stripe | const paymentId = invoice.metadata?.kickback_payment_id | const paymentId = invoice.metadata?.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:539 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:554 | /webhooks/stripe | async function applyKickbackRefundCompleted(admin: any, paymentId: string \| null) { | async function applyKickbackRefundCompleted(admin: any, paymentId: string \| null) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:558 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:573 | /webhooks/stripe | .from('kickback_payments') | .from('community_host_incentive_payments') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:587 | /webhooks/stripe | function getKickbackPaymentIdFromRefundedCharge(charge: Stripe.Charge) { | function getKickbackPaymentIdFromRefundedCharge(charge: Stripe.Charge) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:588 | /webhooks/stripe | const directPaymentId = charge.metadata?.kickback_payment_id | const directPaymentId = charge.metadata?.community_host_incentive_payment_id | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:592 | /webhooks/stripe | const metadataRefund = refunds.find((refund) =&gt; refund.metadata?.kickback_payment_id) | const metadataRefund = refunds.find((refund) =&gt; refund.metadata?.community_host_incentive_payment_id) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:593 | /webhooks/stripe | return metadataRefund?.metadata?.kickback_payment_id ?? null | return metadataRefund?.metadata?.community_host_incentive_payment_id ?? null | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:714 | /webhooks/stripe | if (isKickbackTransferEvent(transfer)) { | if (isKickbackTransferEvent(transfer)) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:716 | /webhooks/stripe | const handledKickbackRefund = await applyKickbackRefundCompleted( | const handledKickbackRefund = await applyKickbackRefundCompleted( | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:719 | /webhooks/stripe | ? transfer.metadata?.kickback_payment_id ?? null | ? transfer.metadata?.community_host_incentive_payment_id ?? null | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:722 | /webhooks/stripe | if (!handledKickbackRefund) { | if (!handledKickbackRefund) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:723 | /webhooks/stripe | await applyKickbackTransferEvent(admin, transfer, 'refunded') | await applyKickbackTransferEvent(admin, transfer, 'refunded') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:728 | /webhooks/stripe | await applyKickbackTransferEvent(admin, transfer, 'completed') | await applyKickbackTransferEvent(admin, transfer, 'completed') | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:827 | /webhooks/stripe | const handledKickback = await applyKickbackCheckoutSessionCompleted(admin as any, session) | const handledKickback = await applyKickbackCheckoutSessionCompleted(admin as any, session) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:828 | /webhooks/stripe | if (!handledKickback) { | if (!handledKickback) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:838 | /webhooks/stripe | const handledKickbackInvoice = await applyKickbackInvoicePaid(admin as any, invoice) | const handledKickbackInvoice = await applyKickbackInvoicePaid(admin as any, invoice) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:839 | /webhooks/stripe | if (!handledKickbackInvoice) { | if (!handledKickbackInvoice) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:847 | /webhooks/stripe | if (!isCommunityHostIncentiveInvoice(invoice) && !invoice.metadata?.kickback_payment_id) { | if (!isCommunityHostIncentiveInvoice(invoice) && !invoice.metadata?.community_host_incentive_payment_id) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:856 | /webhooks/stripe | const handledKickbackInvoice = await applyKickbackInvoicePaymentFailed(admin as any, invoice) | const handledKickbackInvoice = await applyKickbackInvoicePaymentFailed(admin as any, invoice) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:857 | /webhooks/stripe | if (!handledKickbackInvoice) { | if (!handledKickbackInvoice) { | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:885 | /webhooks/stripe | await applyKickbackPaymentIntent(admin as any, paymentIntent) | await applyKickbackPaymentIntent(admin as any, paymentIntent) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:899 | /webhooks/stripe | const handledKickbackRefund = await applyKickbackRefundCompleted( | const handledKickbackRefund = await applyKickbackRefundCompleted( | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:901 | /webhooks/stripe | getKickbackPaymentIdFromRefundedCharge(charge) | getKickbackPaymentIdFromRefundedCharge(charge) | yes, unless aliased during migration |
| app/api/webhooks/stripe/route.ts:903 | /webhooks/stripe | if (!handledKickbackRefund) { | if (!handledKickbackRefund) { | yes, unless aliased during migration |
| app/api/admin/catalog/venues/route.ts:26 | /admin/catalog/venues | per_head_kickback_amount: z.number().int().nonnegative().nullable().default(null), | per_head_chi_cents: z.number().int().nonnegative().nullable().default(null), | yes, unless aliased during migration |
| app/api/admin/catalog/venues/route.ts:75 | /admin/catalog/venues | per_head_kickback_cents: venue.per_head_kickback_amount, | per_head_chi_cents: venue.per_head_chi_cents, | yes, unless aliased during migration |

## Track C: Type Names + Variable Names

Total occurrences: 532. Files affected: 40. Estimated PR size: large.

| path:line | identifier/context | proposed rename | callers count |
| --- | --- | --- | --- |
| app/(planner)/planner/venues/page.tsx:28 | bar_revenue_share_enabled?: boolean \| null | bar_consumption_share_enabled?: boolean \| null | count via rg before rename |
| app/(planner)/planner/venues/page.tsx:29 | per_head_kickback_amount?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| app/(planner)/planner/venues/page.tsx:108 | const revShareReady = venues.filter((venue) =&gt; venue.ticket_sales_share_enabled \|\| venue.bar_revenue_share_enabled \|\| venue.per_head_kickback_amount).length | const consumptionShareReady = venues.filter((venue) =&gt; venue.ticket_sales_share_enabled \|\| venue.bar_consumption_share_enabled \|\| venue.p... | count via rg before rename |
| app/(planner)/planner/venues/page.tsx:114 | { label: 'Flexible terms', value: revShareReady.toLocaleString() }, | { label: 'Flexible terms', value: consumptionShareReady.toLocaleString() }, | count via rg before rename |
| app/(planner)/planner/analytics/page.tsx:42 | venue_kickback_projection?: number \| null | venue_chi_projection?: number \| null | count via rg before rename |
| app/(planner)/planner/analytics/page.tsx:649 | venueKickbackProjectionDollars: readNumber(financial?.venue_kickback_projection) ?? 0, | venueKickbackProjectionDollars: readNumber(financial?.venue_chi_projection) ?? 0, | count via rg before rename |
| app/(planner)/planner/payments/page.tsx:22 | revenue_share_percent?: number \| null | consumption_share_percent?: number \| null | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:40 | pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid']), | pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'consumption_share', 'hybrid']), | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:42 | headcount_kickback: z.boolean().optional(), | headcount_chi: z.boolean().optional(), | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:75 | value: 'revenue_share', | value: 'consumption_share', | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:133 | const storedPerHeadRate = vendor.per_head_kickback ?? 0 | const storedPerHeadRate = vendor.per_head_chi_cents ?? 0 | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:140 | headcount_kickback: storedPerHeadRate &gt; 0, | headcount_chi: storedPerHeadRate &gt; 0, | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:175 | per_head_kickback: data.headcount_kickback ? (data.per_person_rate ?? 0) : 0, | per_head_chi_cents: data.headcount_chi ? (data.per_person_rate ?? 0) : 0, | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:216 | const showRevenueShare = pricingModel === 'revenue_share' \|\| pricingModel === 'hybrid' | const showRevenueShare = pricingModel === 'consumption_share' \|\| pricingModel === 'hybrid' | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:335 | {(showRevenueShare \|\| (!showPerPerson && !showBaseRate)) && ( | {(showRevenueShare \|\| (!showPerPerson && !showBaseRate)) && ( | count via rg before rename |
| app/(dashboard)/vendor/pricing/page.tsx:359 | {headcountKickback && ( | {headcountKickback && ( | count via rg before rename |
| lib/vendors/profile-adapter.ts:36 | if (value === 'per_person' \|\| value === 'hourly' \|\| value === 'revenue_share' \|\| value === 'hybrid') { | if (value === 'per_person' \|\| value === 'hourly' \|\| value === 'consumption_share' \|\| value === 'hybrid') { | count via rg before rename |
| lib/vendors/profile-adapter.ts:84 | per_head_kickback: row.per_head_kickback ?? null, | per_head_chi_cents: row.per_head_chi_cents ?? null, | count via rg before rename |
| lib/vendors/profile-adapter.ts:130 | if (updates.per_head_kickback !== undefined) payload.per_head_kickback = updates.per_head_kickback | if (updates.per_head_chi_cents !== undefined) payload.per_head_chi_cents = updates.per_head_chi_cents | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:79 | type VenueKickbackPayment = { | type VenueKickbackPayment = { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:105 | revenue_share_percent?: number \| null | consumption_share_percent?: number \| null | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:113 | type VenueKickbackSummaryResponse = { | type VenueChiSummaryResponse = { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:121 | payments: VenueKickbackPayment[] | payments: VenueKickbackPayment[] | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:288 | function paymentSettlementCents(payment: VenueKickbackPayment) { | function paymentSettlementCents(payment: VenueKickbackPayment) { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:292 | function calculateSettlementTotals(payments: VenueKickbackPayment[]) { | function calculateSettlementTotals(payments: VenueKickbackPayment[]) { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:372 | const [kickbacks, setKickbacks] = useState&lt;VenueKickbackSummaryResponse \| null&gt;(null) | const [chis, setKickbacks] = useState&lt;VenueChiSummaryResponse \| null&gt;(null) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:373 | const [isLoadingKickbacks, setIsLoadingKickbacks] = useState(true) | const [isLoadingKickbacks, setIsLoadingKickbacks] = useState(true) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:378 | const [refundPayment, setRefundPayment] = useState&lt;VenueKickbackPayment \| null&gt;(null) | const [refundPayment, setRefundPayment] = useState&lt;VenueKickbackPayment \| null&gt;(null) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:412 | const loadKickbacks = useCallback(async () =&gt; { | const loadKickbacks = useCallback(async () =&gt; { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:419 | setKickbacks(data) | setKickbacks(data) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:423 | setIsLoadingKickbacks(false) | setIsLoadingKickbacks(false) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:428 | loadKickbacks() | loadKickbacks() | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:429 | }, [loadKickbacks]) | }, [loadKickbacks]) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:518 | const payKickback = async (paymentId: string) =&gt; { | const payKickback = async (paymentId: string) =&gt; { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:538 | const openRefundRequest = (payment: VenueKickbackPayment) =&gt; { | const openRefundRequest = (payment: VenueKickbackPayment) =&gt; { | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:576 | setIsLoadingKickbacks(true) | setIsLoadingKickbacks(true) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:577 | await loadKickbacks() | await loadKickbacks() | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:586 | setIsLoadingKickbacks(true) | setIsLoadingKickbacks(true) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:587 | await loadKickbacks() | await loadKickbacks() | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:588 | }, [loadKickbacks]) | }, [loadKickbacks]) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:646 | const kickbackPayments = kickbacks?.payments ?? [] | const chiPayments = chis?.payments ?? [] | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:647 | const settlementTotals = calculateSettlementTotals(kickbackPayments) | const settlementTotals = calculateSettlementTotals(chiPayments) | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:874 | {isLoadingKickbacks ? ( | {isLoadingKickbacks ? ( | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:879 | ) : kickbackPayments.length === 0 ? ( | ) : chiPayments.length === 0 ? ( | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:885 | {kickbackPayments.map((payment) =&gt; ( | {chiPayments.map((payment) =&gt; ( | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:890 | onPay={payKickback} | onPay={payKickback} | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:1062 | payment: VenueKickbackPayment | payment: VenueKickbackPayment | count via rg before rename |
| app/(dashboard)/venue/payouts/page.tsx:1065 | onRefund: (payment: VenueKickbackPayment) =&gt; void | onRefund: (payment: VenueKickbackPayment) =&gt; void | count via rg before rename |
| lib/types/enums.ts:51 | \| 'revenue_share' | \| 'consumption_share' | count via rg before rename |
| lib/types/enums.ts:120 | 'revenue_share', | 'consumption_share', | count via rg before rename |
| lib/types/planner.ts:355 | /** Per-head, revenue-share, or hybrid kickback assumptions. */ | /** Per-head, revenue-share, or hybrid chi assumptions. */ | count via rg before rename |
| lib/types/planner.ts:356 | kickback_model: Json | chi_model: Json | count via rg before rename |
| lib/types/planner.ts:1117 | /** Per-head kickback amount in integer cents; null when none or unknown. */ | /** Per-head chi amount in integer cents; null when none or unknown. */ | count via rg before rename |
| lib/types/planner.ts:1118 | per_head_kickback_amount: number \| null | per_head_chi_cents: number \| null | count via rg before rename |
| lib/bookings/venue-booking-adapter.ts:58 | bar_revenue_share_enabled, | bar_consumption_share_enabled, | count via rg before rename |
| lib/bookings/venue-booking-adapter.ts:59 | bar_revenue_share_percent, | bar_consumption_share_percent, | count via rg before rename |
| lib/bookings/venue-booking-adapter.ts:61 | per_head_kickback, | per_head_chi_cents, | count via rg before rename |
| lib/bookings/venue-booking-adapter.ts:62 | per_head_kickback_amount, | per_head_chi_cents, | count via rg before rename |
| lib/types/helpers.ts:97 | revenue_share: 'Revenue Share', | consumption_share: 'Revenue Share', | count via rg before rename |
| lib/types/database.ts:76 | bar_revenue_share_enabled?: boolean \| null | bar_consumption_share_enabled?: boolean \| null | count via rg before rename |
| lib/types/database.ts:77 | bar_revenue_share_percent?: number \| null | bar_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database.ts:78 | per_head_kickback_amount?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database.ts:79 | per_head_kickback_cents?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database.ts:196 | per_head_kickback?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/planner/mockAgentResponses.ts:39 | revenue_share: string \| null | consumption_share: string \| null | count via rg before rename |
| lib/planner/mockAgentResponses.ts:103 | { label: 'House Party', patterns: [/\bhouse party\b/i, /\bkickback\b/i, /\bpregame\b/i, /\bcasual gathering\b/i, /\bapartment party\b/i] }, | { label: 'House Party', patterns: [/\bhouse party\b/i, /\bchi\b/i, /\bpregame\b/i, /\bcasual gathering\b/i, /\bapartment party\b/i] }, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:520 | revenue_share: context.revenue_share, | consumption_share: context.consumption_share, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:568 | revenue_share: context.revenue_share, | consumption_share: context.consumption_share, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:681 | if (!context.revenue_share) { | if (!context.consumption_share) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:683 | field: 'revenue_share', | field: 'consumption_share', | count via rg before rename |
| lib/planner/mockAgentResponses.ts:800 | revenue_share: detectRevenueShare(allText), | consumption_share: detectRevenueShare(allText), | count via rg before rename |
| lib/planner/mockAgentResponses.ts:830 | context.revenue_share ? `Revenue model: ${context.revenue_share}` : null, | context.consumption_share ? `Revenue model: ${context.consumption_share}` : null, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1344 | function detectRevenueShare(text: string): string \| null { | function detectRevenueShare(text: string): string \| null { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1348 | if (/\b(no revenue share\|no rev share\|flat rental\|simple booking terms\|simplest booking terms\|no kickback)\b/i.test(text)) { | if (/\b(no revenue share\|no rev share\|flat rental\|simple booking terms\|simplest booking terms\|no chi)\b/i.test(text)) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1351 | if (/\b(bar revenue share\|bar rev share\|bar split\|bar kickback)\b/i.test(text)) return 'Bar revenue share' | if (/\b(bar revenue share\|bar rev share\|bar split\|bar chi)\b/i.test(text)) return 'Bar revenue share' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1353 | if (/\b(per[-\s]?head kickback\|per attendee\|per confirmed attendee)\b/i.test(text)) return 'Per-head kickback' | if (/\b(per[-\s]?head chi\|per attendee\|per confirmed attendee)\b/i.test(text)) return 'Per-head chi' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1354 | if (/\b(not sure\|recommend\|optimize\|best model\|open to)\b/i.test(text) && /\b(revenue\|economics\|terms\|kickback\|share)\b/i.test(text)) { | if (/\b(not sure\|recommend\|optimize\|best model\|open to)\b/i.test(text) && /\b(revenue\|economics\|terms\|chi\|share)\b/i.test(text)) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1916 | other_placeholder: 'e.g. flexible, per-head kickback, sponsor-covered', | other_placeholder: 'e.g. flexible, per-head chi, sponsor-covered', | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1920 | if (field === 'revenue_share') { | if (field === 'consumption_share') { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1944 | value: 'Per-head kickback', | value: 'Per-head chi', | count via rg before rename |
| lib/planner/mockAgentResponses.ts:1954 | other_placeholder: 'e.g. per-head kickback after 100 attendees', | other_placeholder: 'e.g. per-head chi after 100 attendees', | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2036 | { label: 'Revenue model', value: context.revenue_share ?? 'Need revenue model', confirmed: Boolean(context.revenue_share) }, | { label: 'Revenue model', value: context.consumption_share ?? 'Need revenue model', confirmed: Boolean(context.consumption_share) }, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2067 | const termsTag = getRevenueModelTag(context.revenue_share) | const termsTag = getRevenueModelTag(context.consumption_share) | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2253 | function getRevenueModelTag(revenueShare: string \| null) { | function getRevenueModelTag(consumptionShare: string \| null) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2254 | if (!revenueShare) return 'Terms TBD' | if (!consumptionShare) return 'Terms TBD' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2255 | if (revenueShare === 'No revenue share') return 'Flat/simple terms' | if (consumptionShare === 'No revenue share') return 'Flat/simple terms' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2256 | if (isRecommendBestModel(revenueShare)) return 'Compare commercial models' | if (isRecommendBestModel(consumptionShare)) return 'Compare commercial models' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2257 | return revenueShare | return consumptionShare | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2260 | function isRecommendBestModel(revenueShare: string \| null \| undefined) { | function isRecommendBestModel(consumptionShare: string \| null \| undefined) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2261 | return /\brecommend best model\|recommend model\|compare\b/i.test(revenueShare ?? '') | return /\brecommend best model\|recommend model\|compare\b/i.test(consumptionShare ?? '') | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2265 | if (!isRecommendBestModel(context.revenue_share)) return [] | if (!isRecommendBestModel(context.consumption_share)) return [] | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2267 | const options = ['Flat rental', 'Minimum spend', 'Per-head kickback'] | const options = ['Flat rental', 'Minimum spend', 'Per-head chi'] | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2279 | if (!isRecommendBestModel(context.revenue_share)) return context.revenue_share | if (!isRecommendBestModel(context.consumption_share)) return context.consumption_share | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2282 | return 'Bar revenue share or per-head kickback' | return 'Bar revenue share or per-head chi' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2285 | return 'Ticket revenue share or per-head kickback' | return 'Ticket revenue share or per-head chi' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2287 | if ((context.guest_count ?? 0) &gt; 100) return 'Per-head kickback' | if ((context.guest_count ?? 0) &gt; 100) return 'Per-head chi' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2341 | const terms = (isRecommendBestModel(context.revenue_share) | const terms = (isRecommendBestModel(context.consumption_share) | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2343 | : context.venue_terms ?? context.revenue_share) ?? 'terms still to confirm' | : context.venue_terms ?? context.consumption_share) ?? 'terms still to confirm' | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2347 | const comparison = isRecommendBestModel(context.revenue_share) | const comparison = isRecommendBestModel(context.consumption_share) | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2355 | if (isRecommendBestModel(context.revenue_share)) { | if (isRecommendBestModel(context.consumption_share)) { | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2481 | revenue_share: context.revenue_share, | consumption_share: context.consumption_share, | count via rg before rename |
| lib/planner/mockAgentResponses.ts:2515 | context.revenue_share, | context.consumption_share, | count via rg before rename |
| lib/planner/archetypes/intakeQuestions.ts:682 | bar_rev_share: { | bar_consumption_share: { | count via rg before rename |
| lib/planner/archetypes/intakeQuestions.ts:685 | prompt: 'Do you prefer minimum spend, flat rental, bar revenue share, per-head kickback, or a flexible venue deal?', | prompt: 'Do you prefer minimum spend, flat rental, bar revenue share, per-head chi, or a flexible venue deal?', | count via rg before rename |
| lib/planner/archetypes/intakeQuestions.ts:687 | answer_keywords: ['minimum spend', 'flat rental', 'bar revenue', 'revenue share', 'rev share', 'kickback', 'per-head', 'per head'], | answer_keywords: ['minimum spend', 'flat rental', 'bar revenue', 'revenue share', 'rev share', 'chi', 'per-head', 'per head'], | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:22 | pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid']), | pricing_model: z.enum(['flat_rate', 'per_person', 'hourly', 'consumption_share', 'hybrid']), | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:30 | bar_revenue_share: z.boolean().optional(), | bar_consumption_share: z.boolean().optional(), | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:32 | per_head_kickback: z.number().optional(), | per_head_chi_cents: z.number().optional(), | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:64 | value: 'revenue_share', | value: 'consumption_share', | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:100 | const barRevenueShare = watch('bar_revenue_share') | const barRevenueShare = watch('bar_consumption_share') | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:130 | per_person_rate: venue.per_head_kickback_amount ? centsToDollars(venue.per_head_kickback_amount) : undefined, | per_person_rate: venue.per_head_chi_cents ? centsToDollars(venue.per_head_chi_cents) : undefined, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:134 | bar_revenue_share: venue.bar_revenue_share_enabled \|\| false, | bar_consumption_share: venue.bar_consumption_share_enabled \|\| false, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:135 | bar_revenue_percent: venue.bar_revenue_share_percent ?? 15, | bar_revenue_percent: venue.bar_consumption_share_percent ?? 15, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:136 | per_head_kickback: venue.per_head_kickback_amount ? centsToDollars(venue.per_head_kickback_amount) : 0, | per_head_chi_cents: venue.per_head_chi_cents ? centsToDollars(venue.per_head_chi_cents) : 0, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:168 | bar_revenue_share_enabled: Boolean(data.bar_revenue_share), | bar_consumption_share_enabled: Boolean(data.bar_consumption_share), | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:169 | bar_revenue_share_percent: data.bar_revenue_share ? (data.bar_revenue_percent \|\| 0) : 0, | bar_consumption_share_percent: data.bar_consumption_share ? (data.bar_revenue_percent \|\| 0) : 0, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:170 | per_head_kickback_cents: data.per_head_kickback ? dollarsToCents(data.per_head_kickback) : 0, | per_head_chi_cents: data.per_head_chi_cents ? dollarsToCents(data.per_head_chi_cents) : 0, | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:202 | const showRevenueShare = pricingModel === 'revenue_share' \|\| pricingModel === 'hybrid' | const showRevenueShare = pricingModel === 'consumption_share' \|\| pricingModel === 'hybrid' | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:366 | {showRevenueShare && ( | {showRevenueShare && ( | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:442 | id="bar_revenue_share" | id="bar_consumption_share" | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:443 | {...register('bar_revenue_share')} | {...register('bar_consumption_share')} | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:448 | {barRevenueShare && ( | {barRevenueShare && ( | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:508 | {barRevenueShare && ( | {barRevenueShare && ( | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:519 | ${(100 * perHeadKickback).toLocaleString()} | ${(100 * perHeadKickback).toLocaleString()} | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:527 | (barRevenueShare ? 100 * 50 * (barRevenuePercent / 100) : 0) + | (barRevenueShare ? 100 * 50 * (barRevenuePercent / 100) : 0) + | count via rg before rename |
| app/(dashboard)/venue/pricing/page.tsx:528 | 100 * perHeadKickback | 100 * perHeadKickback | count via rg before rename |
| lib/planner/commercialModelRanker.ts:6 | \| 'per_head_kickback' | \| 'per_head_chi_cents' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:7 | \| 'bar_revenue_share' | \| 'bar_consumption_share' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:8 | \| 'ticket_revenue_share' | \| 'ticket_consumption_share' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:39 | const DEFAULT_PER_HEAD_KICKBACK_CENTS = 800 | const DEFAULT_PER_HEAD_KICKBACK_CENTS = 800 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:40 | const DEFAULT_TICKET_REVENUE_SHARE_PCT = 12 | const DEFAULT_TICKET_REVENUE_SHARE_PCT = 12 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:41 | const DEFAULT_BAR_REVENUE_SHARE_PCT = 10 | const DEFAULT_BAR_REVENUE_SHARE_PCT = 10 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:66 | if (model === 'per_head_kickback') return 'Per-head kickback' | if (model === 'per_head_chi_cents') return 'Per-head chi' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:67 | if (model === 'bar_revenue_share') return 'Bar revenue share' | if (model === 'bar_consumption_share') return 'Bar revenue share' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:128 | (readVenuePerHeadKickbackCents(venue) ?? 0) &gt; 0 | (readVenuePerHeadKickbackCents(venue) ?? 0) &gt; 0 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:130 | models.add('per_head_kickback') | models.add('per_head_chi_cents') | count via rg before rename |
| lib/planner/commercialModelRanker.ts:133 | venue.bar_rev_share_enabled === true \|\| | venue.bar_consumption_share_enabled === true \|\| | count via rg before rename |
| lib/planner/commercialModelRanker.ts:134 | venue.bar_revenue_share_enabled === true \|\| | venue.bar_consumption_share_enabled === true \|\| | count via rg before rename |
| lib/planner/commercialModelRanker.ts:135 | (readNumber(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? 0) &gt; 0 | (readNumber(venue.bar_consumption_share_pct ?? venue.bar_consumption_share_pct ?? venue.bar_revenue_percentage) ?? 0) &gt; 0 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:137 | models.add('bar_revenue_share') | models.add('bar_consumption_share') | count via rg before rename |
| lib/planner/commercialModelRanker.ts:143 | models.add('ticket_revenue_share') | models.add('ticket_consumption_share') | count via rg before rename |
| lib/planner/commercialModelRanker.ts:158 | if (model === 'per_head_kickback') return /\b(per head\|kickback\|attendee)\b/.test(normalized) | if (model === 'per_head_chi_cents') return /\b(per head\|chi\|attendee)\b/.test(normalized) | count via rg before rename |
| lib/planner/commercialModelRanker.ts:159 | if (model === 'bar_revenue_share') return /\b(bar\|drink\|beverage)\b/.test(normalized) && /\b(share\|rev\|revenue\|split)\b/.test(normalized) | if (model === 'bar_consumption_share') return /\b(bar\|drink\|beverage)\b/.test(normalized) && /\b(share\|rev\|revenue\|split)\b/.test(normali... | count via rg before rename |
| lib/planner/commercialModelRanker.ts:160 | if (model === 'ticket_revenue_share') return /\b(ticket\|door)\b/.test(normalized) && /\b(share\|rev\|revenue\|split)\b/.test(normalized) | if (model === 'ticket_consumption_share') return /\b(ticket\|door)\b/.test(normalized) && /\b(share\|rev\|revenue\|split)\b/.test(normalized) | count via rg before rename |
| lib/planner/commercialModelRanker.ts:175 | if (model === 'per_head_kickback') { | if (model === 'per_head_chi_cents') { | count via rg before rename |
| lib/planner/commercialModelRanker.ts:176 | const threshold = readNumber(venue.per_head_kickback_threshold ?? venue.kickback_threshold) ?? 100 | const threshold = readNumber(venue.per_head_chi_cents_threshold ?? venue.chi_threshold) ?? 100 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:177 | const amount = readVenuePerHeadKickbackCents(venue) ?? DEFAULT_PER_HEAD_KICKBACK_CENTS | const amount = readVenuePerHeadKickbackCents(venue) ?? DEFAULT_PER_HEAD_KICKBACK_CENTS | count via rg before rename |
| lib/planner/commercialModelRanker.ts:180 | if (model === 'bar_revenue_share') { | if (model === 'bar_consumption_share') { | count via rg before rename |
| lib/planner/commercialModelRanker.ts:181 | const pct = readPercent(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? DEFAULT_BAR_REVENUE_SHARE_PCT | const pct = readPercent(venue.bar_consumption_share_pct ?? venue.bar_consumption_share_pct ?? venue.bar_revenue_percentage) ?? DEFAULT_BA... | count via rg before rename |
| lib/planner/commercialModelRanker.ts:185 | const pct = readPercent(venue.ticket_sales_share_pct ?? venue.ticket_sales_share_percent) ?? DEFAULT_TICKET_REVENUE_SHARE_PCT | const pct = readPercent(venue.ticket_sales_share_pct ?? venue.ticket_sales_share_percent) ?? DEFAULT_TICKET_REVENUE_SHARE_PCT | count via rg before rename |
| lib/planner/commercialModelRanker.ts:199 | if (model === 'bar_revenue_share') return Math.max(outlayCents, Math.round(barRevenueCents * 0.2)) | if (model === 'bar_consumption_share') return Math.max(outlayCents, Math.round(barRevenueCents * 0.2)) | count via rg before rename |
| lib/planner/commercialModelRanker.ts:200 | if (model === 'ticket_revenue_share') return Math.max(outlayCents, Math.round(ticketRevenueCents * 0.12)) | if (model === 'ticket_consumption_share') return Math.max(outlayCents, Math.round(ticketRevenueCents * 0.12)) | count via rg before rename |
| lib/planner/commercialModelRanker.ts:212 | function readVenuePerHeadKickbackCents(venue: Record&lt;string, unknown&gt;): number \| null { | function readVenuePerHeadKickbackCents(venue: Record&lt;string, unknown&gt;): number \| null { | count via rg before rename |
| lib/planner/commercialModelRanker.ts:214 | venue.per_head_kickback_cents as number \| string \| null \| undefined, | venue.per_head_chi_cents as number \| string \| null \| undefined, | count via rg before rename |
| lib/planner/commercialModelRanker.ts:215 | (venue.per_head_kickback_amount ?? venue.per_head_kickback) as number \| string \| null \| undefined | (venue.per_head_chi_cents ?? venue.per_head_chi_cents) as number \| string \| null \| undefined | count via rg before rename |
| lib/planner/commercialModelRanker.ts:238 | if (model === 'bar_revenue_share' && /\b(bar\|drink\|cocktail\|beer\|wine\|cash bar\|guests pay)\b/.test(text)) return 20 | if (model === 'bar_consumption_share' && /\b(bar\|drink\|cocktail\|beer\|wine\|cash bar\|guests pay)\b/.test(text)) return 20 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:239 | if (model === 'ticket_revenue_share' && /\b(ticket\|paid\|door\|vip\|ga\|early bird)\b/.test(text)) return 20 | if (model === 'ticket_consumption_share' && /\b(ticket\|paid\|door\|vip\|ga\|early bird)\b/.test(text)) return 20 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:240 | if (model === 'per_head_kickback' && (readNumber(plan.headcount ?? plan.guest_count) ?? 0) &gt;= 90) return 18 | if (model === 'per_head_chi_cents' && (readNumber(plan.headcount ?? plan.guest_count) ?? 0) &gt;= 90) return 18 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:255 | if (model === 'per_head_kickback') return 7 | if (model === 'per_head_chi_cents') return 7 | count via rg before rename |
| lib/planner/commercialModelRanker.ts:261 | if (model === 'bar_revenue_share' \|\| model === 'ticket_revenue_share') return 'medium' | if (model === 'bar_consumption_share' \|\| model === 'ticket_consumption_share') return 'medium' | count via rg before rename |
| lib/planner/commercialModelRanker.ts:284 | if (model === 'per_head_kickback') reasons.push('Protects cash before turnout is confirmed') | if (model === 'per_head_chi_cents') reasons.push('Protects cash before turnout is confirmed') | count via rg before rename |
| lib/planner/commercialModelRanker.ts:285 | if (model === 'bar_revenue_share') reasons.push('Aligns venue upside with drink sales') | if (model === 'bar_consumption_share') reasons.push('Aligns venue upside with drink sales') | count via rg before rename |
| lib/planner/commercialModelRanker.ts:286 | if (model === 'ticket_revenue_share') reasons.push('Can reduce deposit pressure for paid events') | if (model === 'ticket_consumption_share') reasons.push('Can reduce deposit pressure for paid events') | count via rg before rename |
| lib/planner/archetypes/data.ts:45 | preferred_commercial_models: ['minimum_spend', 'bar_rev_share', 'per_head'], | preferred_commercial_models: ['minimum_spend', 'bar_consumption_share', 'per_head'], | count via rg before rename |
| lib/planner/archetypes/data.ts:542 | preferred_commercial_models: ['bar_rev_share', 'minimum_spend', 'ticket_split'], | preferred_commercial_models: ['bar_consumption_share', 'minimum_spend', 'ticket_split'], | count via rg before rename |
| lib/planner/archetypes/data.ts:583 | preferred_commercial_models: ['door_split', 'bar_rev_share', 'ticket_share'], | preferred_commercial_models: ['door_split', 'bar_consumption_share', 'ticket_share'], | count via rg before rename |
| lib/planner/archetypes/data.ts:626 | preferred_commercial_models: ['flat_rental', 'ticket_split', 'bar_rev_share'], | preferred_commercial_models: ['flat_rental', 'ticket_split', 'bar_consumption_share'], | count via rg before rename |
| lib/planner/archetypes/data.ts:667 | preferred_commercial_models: ['minimum_spend', 'bar_rev_share', 'ticket_revenue'], | preferred_commercial_models: ['minimum_spend', 'bar_consumption_share', 'ticket_revenue'], | count via rg before rename |
| lib/planner/archetypes/data.ts:748 | preferred_commercial_models: ['external_checkout', 'bar_rev_share'], | preferred_commercial_models: ['external_checkout', 'bar_consumption_share'], | count via rg before rename |
| lib/planner/catalogRanker.ts:25 | revenue_share?: string \| null | consumption_share?: string \| null | count via rg before rename |
| lib/planner/catalogRanker.ts:444 | if (/\brecommend\|compare\|best model\|open\|flexible\b/i.test(plan.revenue_share ?? '')) return plan.revenue_share | if (/\brecommend\|compare\|best model\|open\|flexible\b/i.test(plan.consumption_share ?? '')) return plan.consumption_share | count via rg before rename |
| lib/planner/catalogRanker.ts:445 | return plan.venue_terms ?? plan.revenue_share | return plan.venue_terms ?? plan.consumption_share | count via rg before rename |
| lib/planner/catalogRanker.ts:893 | if (row.ticket_sales_share_enabled === true \|\| row.bar_rev_share_enabled === true) { | if (row.ticket_sales_share_enabled === true \|\| row.bar_consumption_share_enabled === true) { | count via rg before rename |
| lib/planner/catalogRanker.ts:894 | terms.add('revenue_share') | terms.add('consumption_share') | count via rg before rename |
| lib/planner/catalogRanker.ts:898 | row.per_head_kickback_cents as number \| string \| null \| undefined, | row.per_head_chi_cents as number \| string \| null \| undefined, | count via rg before rename |
| lib/planner/catalogRanker.ts:899 | (row.per_head_kickback_amount ?? row.per_head_kickback) as number \| string \| null \| undefined | (row.per_head_chi_cents ?? row.per_head_chi_cents) as number \| string \| null \| undefined | count via rg before rename |
| lib/planner/catalogRanker.ts:902 | terms.add('per_head_kickback') | terms.add('per_head_chi_cents') | count via rg before rename |
| lib/planner/catalogRanker.ts:917 | if (/\b(revenue\|share\|bar rev\|ticket share)\b/.test(normalized)) terms.push('revenue_share') | if (/\b(revenue\|share\|bar rev\|ticket share)\b/.test(normalized)) terms.push('consumption_share') | count via rg before rename |
| lib/planner/catalogRanker.ts:918 | if (/\b(per head\|kickback\|attendee)\b/.test(normalized)) terms.push('per_head_kickback') | if (/\b(per head\|chi\|attendee)\b/.test(normalized)) terms.push('per_head_chi_cents') | count via rg before rename |
| lib/planner/archetypes/types.ts:6 | \| 'bar_rev_share' | \| 'bar_consumption_share' | count via rg before rename |
| lib/planner/archetypes/types.ts:176 | 'bar_rev_share', | 'bar_consumption_share', | count via rg before rename |
| lib/live-events/triggers.ts:68 | rev_share_adjustments: z.array(z.object({ | consumption_share_adjustments: z.array(z.object({ | count via rg before rename |
| lib/server/admin-ops.ts:8 | KICKBACK_DISPUTES: 'kickback_disputes', | KICKBACK_DISPUTES: 'chi_disputes', | count via rg before rename |
| lib/server/admin-ops.ts:106 | .from(TABLES.KICKBACK_DISPUTES) | .from(TABLES.KICKBACK_DISPUTES) | count via rg before rename |
| lib/server/community-host-incentive/refund-request.ts:66 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/refund-request.ts:96 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/refund-request.ts:113 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/refund-request.ts:118 | if (error) throw new Error(error.message ?? 'Failed to load kickback agreement') | if (error) throw new Error(error.message ?? 'Failed to load chi agreement') | count via rg before rename |
| lib/email.ts:115 | // Kickback settlement notifications (Phase 1 rev share PR) | // Kickback settlement notifications (Phase 1 rev share PR) | count via rg before rename |
| lib/email.ts:118 | type KickbackNotificationPayment = { | type KickbackNotificationPayment = { | count via rg before rename |
| lib/email.ts:135 | type KickbackNotificationAgreement = { | type KickbackNotificationAgreement = { | count via rg before rename |
| lib/email.ts:141 | bar_revenue_share_percent?: number \| string \| null | bar_consumption_share_percent?: number \| string \| null | count via rg before rename |
| lib/email.ts:142 | ticket_revenue_share_percent?: number \| string \| null | ticket_consumption_share_percent?: number \| string \| null | count via rg before rename |
| lib/email.ts:147 | type KickbackNotificationContext = { | type KickbackNotificationContext = { | count via rg before rename |
| lib/email.ts:148 | payment: KickbackNotificationPayment | payment: KickbackNotificationPayment | count via rg before rename |
| lib/email.ts:149 | agreement: KickbackNotificationAgreement \| null | agreement: KickbackNotificationAgreement \| null | count via rg before rename |
| lib/email.ts:194 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:215 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:234 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:253 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:278 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:301 | const context = await loadKickbackNotificationContext(paymentId) | const context = await loadKickbackNotificationContext(paymentId) | count via rg before rename |
| lib/email.ts:419 | const admin = await createKickbackEmailAdminClient() | const admin = await createKickbackEmailAdminClient() | count via rg before rename |
| lib/email.ts:460 | async function loadKickbackNotificationContext(paymentId: string): Promise&lt;KickbackNotificationContext&gt; { | async function loadKickbackNotificationContext(paymentId: string): Promise&lt;KickbackNotificationContext&gt; { | count via rg before rename |
| lib/email.ts:461 | const admin = await createKickbackEmailAdminClient() | const admin = await createKickbackEmailAdminClient() | count via rg before rename |
| lib/email.ts:463 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/email.ts:485 | if (paymentError) throw new Error(paymentError.message ?? 'Failed to load kickback payment') | if (paymentError) throw new Error(paymentError.message ?? 'Failed to load chi payment') | count via rg before rename |
| lib/email.ts:486 | if (!payment) throw new Error('Kickback payment not found') | if (!payment) throw new Error('Kickback payment not found') | count via rg before rename |
| lib/email.ts:488 | const typedPayment = payment as KickbackNotificationPayment | const typedPayment = payment as KickbackNotificationPayment | count via rg before rename |
| lib/email.ts:490 | ? await loadKickbackAgreement(admin, typedPayment.agreement_id) | ? await loadKickbackAgreement(admin, typedPayment.agreement_id) | count via rg before rename |
| lib/email.ts:499 | const eventLabel = await loadKickbackEventLabel(admin, typedPayment.event_id \|\| agreement?.event_id \|\| null, agreement?.plan_id ?? null) | const eventLabel = await loadKickbackEventLabel(admin, typedPayment.event_id \|\| agreement?.event_id \|\| null, agreement?.plan_id ?? null) | count via rg before rename |
| lib/email.ts:524 | const admin = await createKickbackEmailAdminClient() | const admin = await createKickbackEmailAdminClient() | count via rg before rename |
| lib/email.ts:572 | async function loadKickbackAgreement(admin: any, agreementId: string): Promise&lt;KickbackNotificationAgreement \| null&gt; { | async function loadKickbackAgreement(admin: any, agreementId: string): Promise&lt;KickbackNotificationAgreement \| null&gt; { | count via rg before rename |
| lib/email.ts:574 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/email.ts:582 | 'bar_revenue_share_percent', | 'bar_consumption_share_percent', | count via rg before rename |
| lib/email.ts:583 | 'ticket_revenue_share_percent', | 'ticket_consumption_share_percent', | count via rg before rename |
| lib/email.ts:591 | if (error) throw new Error(error.message ?? 'Failed to load kickback agreement') | if (error) throw new Error(error.message ?? 'Failed to load chi agreement') | count via rg before rename |
| lib/email.ts:592 | return (data as KickbackNotificationAgreement \| null) ?? null | return (data as KickbackNotificationAgreement \| null) ?? null | count via rg before rename |
| lib/email.ts:633 | async function loadKickbackEventLabel(admin: any, eventId: string \| null, planId: string \| null) { | async function loadKickbackEventLabel(admin: any, eventId: string \| null, planId: string \| null) { | count via rg before rename |
| lib/email.ts:703 | function formatSettlementSource(agreement: KickbackNotificationAgreement \| null) { | function formatSettlementSource(agreement: KickbackNotificationAgreement \| null) { | count via rg before rename |
| lib/email.ts:704 | const barShare = readPositiveNumber(agreement?.bar_revenue_share_percent) | const barShare = readPositiveNumber(agreement?.bar_consumption_share_percent) | count via rg before rename |
| lib/email.ts:707 | const ticketShare = readPositiveNumber(agreement?.ticket_revenue_share_percent) | const ticketShare = readPositiveNumber(agreement?.ticket_consumption_share_percent) | count via rg before rename |
| lib/email.ts:759 | async function createKickbackEmailAdminClient() { | async function createKickbackEmailAdminClient() { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:9 | type KickbackPaymentRow = { | type KickbackPaymentRow = { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:37 | type KickbackAgreementRow = { | type ChiAgreementRow = { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:47 | actual_kickback_amount: number \| null | actual_chi_amount: number \| null | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:53 | bar_revenue_share_percent: number \| null | bar_consumption_share_percent: number \| null | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:54 | ticket_revenue_share_percent: number \| null | ticket_consumption_share_percent: number \| null | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:59 | function getPaymentPrincipalCents(payment: Pick&lt;KickbackPaymentRow, 'amount_cents' \| 'amount'&gt;) { | function getPaymentPrincipalCents(payment: Pick&lt;KickbackPaymentRow, 'amount_cents' \| 'amount'&gt;) { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:63 | function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) { | function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:83 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:93 | const payments = ((paymentRows \|\| []) as KickbackPaymentRow[]) | const payments = ((paymentRows \|\| []) as KickbackPaymentRow[]) | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:95 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:107 | 'actual_kickback_amount', | 'actual_chi_amount', | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:113 | 'bar_revenue_share_percent', | 'bar_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:114 | 'ticket_revenue_share_percent', | 'ticket_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:123 | const ownedAgreements = ((agreementRows \|\| []) as KickbackAgreementRow[]) | const ownedAgreements = ((agreementRows \|\| []) as ChiAgreementRow[]) | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:148 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:149 | .select('id, event_id, plan_id, venue_id, builder_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, reported_revenue_cents, revenue_proof_url, revenue_extracted_value_cents, revenue_extraction_confidence, revenue_submitted_at, bar_revenue_share_percent, ticket_revenue_share_percent, lift_share_percentage, status') | .select('id, event_id, plan_id, venue_id, builder_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_chi_a... | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:175 | const paymentByAgreementId = new Map&lt;string, KickbackPaymentRow&gt;( | const paymentByAgreementId = new Map&lt;string, KickbackPaymentRow&gt;( | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:210 | revenue_share_percent: | consumption_share_percent: | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:211 | agreement?.bar_revenue_share_percent ?? | agreement?.bar_consumption_share_percent ?? | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:212 | agreement?.ticket_revenue_share_percent ?? | agreement?.ticket_consumption_share_percent ?? | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:249 | function shouldSurfaceAgreementForSpendReport(agreement: KickbackAgreementRow) { | function shouldSurfaceAgreementForSpendReport(agreement: ChiAgreementRow) { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:258 | agreement: KickbackAgreementRow \| undefined, | agreement: ChiAgreementRow \| undefined, | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:260 | ): KickbackPaymentRow { | ): KickbackPaymentRow { | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:292 | agreement: KickbackAgreementRow \| null \| undefined, | agreement: ChiAgreementRow \| null \| undefined, | count via rg before rename |
| lib/server/community-host-incentive/summary.ts:293 | payment: KickbackPaymentRow \| null | payment: KickbackPaymentRow \| null | count via rg before rename |
| lib/server/account-setup.ts:36 | barKickbackPct?: number \| null | barKickbackPct?: number \| null | count via rg before rename |
| lib/server/account-setup.ts:298 | bar_revenue_share_enabled: hasBar, | bar_consumption_share_enabled: hasBar, | count via rg before rename |
| lib/server/account-setup.ts:299 | offers_kickbacks: hasBar, | offers_chis: hasBar, | count via rg before rename |
| lib/server/account-setup.ts:300 | bar_revenue_percentage: hasBar ? input.barKickbackPct ?? null : null, | bar_revenue_percentage: hasBar ? input.barKickbackPct ?? null : null, | count via rg before rename |
| lib/server/account-setup.ts:301 | bar_revenue_share_percent: hasBar ? input.perHeadDrinkPct ?? null : null, | bar_consumption_share_percent: hasBar ? input.perHeadDrinkPct ?? null : null, | count via rg before rename |
| lib/venues/venueRanker.ts:194 | venue.bar_rev_share_enabled === true \|\| | venue.bar_consumption_share_enabled === true \|\| | count via rg before rename |
| lib/venues/venueRanker.ts:195 | venue.bar_revenue_share_enabled === true \|\| | venue.bar_consumption_share_enabled === true \|\| | count via rg before rename |
| lib/venues/venueRanker.ts:196 | (readNumber(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? 0) &gt; 0 | (readNumber(venue.bar_consumption_share_pct ?? venue.bar_consumption_share_pct ?? venue.bar_revenue_percentage) ?? 0) &gt; 0 | count via rg before rename |
| lib/venues/venueRanker.ts:198 | models.add('bar_rev_share') | models.add('bar_consumption_share') | count via rg before rename |
| lib/venues/venueRanker.ts:200 | if ((readVenuePerHeadKickbackCents(venue) ?? 0) &gt; 0) { | if ((readVenuePerHeadKickbackCents(venue) ?? 0) &gt; 0) { | count via rg before rename |
| lib/venues/venueRanker.ts:630 | function readVenuePerHeadKickbackCents(venue: Record&lt;string, unknown&gt;): number \| null { | function readVenuePerHeadKickbackCents(venue: Record&lt;string, unknown&gt;): number \| null { | count via rg before rename |
| lib/venues/venueRanker.ts:632 | venue.per_head_kickback_cents as number \| string \| null \| undefined, | venue.per_head_chi_cents as number \| string \| null \| undefined, | count via rg before rename |
| lib/venues/venueRanker.ts:633 | (venue.per_head_kickback_amount ?? venue.per_head_kickback) as number \| string \| null \| undefined | (venue.per_head_chi_cents ?? venue.per_head_chi_cents) as number \| string \| null \| undefined | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:44 | type KickbackAgreementRow = { | type ChiAgreementRow = { | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:64 | bar_revenue_share_percent?: number \| string \| null | bar_consumption_share_percent?: number \| string \| null | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:65 | ticket_revenue_share_percent?: number \| string \| null | ticket_consumption_share_percent?: number \| string \| null | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:113 | const agreement = await loadKickbackAgreement(admin, agreementId) | const agreement = await loadKickbackAgreement(admin, agreementId) | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:166 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:222 | async function loadKickbackAgreement(admin: any, agreementId: string): Promise&lt;KickbackAgreementRow \| null&gt; { | async function loadKickbackAgreement(admin: any, agreementId: string): Promise&lt;ChiAgreementRow \| null&gt; { | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:224 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:246 | 'bar_revenue_share_percent', | 'bar_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:247 | 'ticket_revenue_share_percent', | 'ticket_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:254 | throw new Error(error.message ?? 'Failed to load kickback agreement') | throw new Error(error.message ?? 'Failed to load chi agreement') | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:257 | return (data as KickbackAgreementRow \| null) ?? null | return (data as ChiAgreementRow \| null) ?? null | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:273 | agreement: KickbackAgreementRow, | agreement: ChiAgreementRow, | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:288 | agreement: KickbackAgreementRow | agreement: ChiAgreementRow | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:350 | agreement: KickbackAgreementRow | agreement: ChiAgreementRow | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:355 | const calculatedOwedCents = await calculateKickbackOwedCents(admin, agreement, reportedRevenueCents) | const calculatedOwedCents = await calculateKickbackOwedCents(admin, agreement, reportedRevenueCents) | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:356 | const payment = await upsertKickbackPayment( | const payment = await upsertKickbackPayment( | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:375 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:387 | async function upsertKickbackPayment( | async function upsertKickbackPayment( | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:389 | agreement: KickbackAgreementRow, | agreement: ChiAgreementRow, | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:411 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:427 | async function calculateKickbackOwedCents( | async function calculateKickbackOwedCents( | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:429 | agreement: KickbackAgreementRow, | agreement: ChiAgreementRow, | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:433 | const barSharePercent = readPositiveNumber(agreement.bar_revenue_share_percent) | const barSharePercent = readPositiveNumber(agreement.bar_consumption_share_percent) | count via rg before rename |
| lib/server/community-host-incentive/spend-report.ts:438 | const ticketSharePercent = readPositiveNumber(agreement.ticket_revenue_share_percent) | const ticketSharePercent = readPositiveNumber(agreement.ticket_consumption_share_percent) | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:32 | type KickbackPaymentForCheckout = { | type KickbackPaymentForCheckout = { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:46 | type KickbackAgreementForInvoice = { | type KickbackAgreementForInvoice = { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:58 | bar_revenue_share_percent: number \| string \| null | bar_consumption_share_percent: number \| string \| null | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:59 | ticket_revenue_share_percent: number \| string \| null | ticket_consumption_share_percent: number \| string \| null | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:157 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:165 | const payment = paymentRow as KickbackPaymentForCheckout | const payment = paymentRow as KickbackPaymentForCheckout | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:171 | return createInvoiceForKickback({ | return createInvoiceForKickback({ | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:183 | const paymentAmountCents = resolveKickbackPaymentAmountCents(payment) | const paymentAmountCents = resolveKickbackPaymentAmountCents(payment) | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:239 | payment_kind: 'venue_builder_kickback', | payment_kind: 'venue_builder_chi', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:240 | kickback_payment_id: payment.id, | community_host_incentive_payment_id: payment.id, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:274 | idempotencyKey: `kickback_checkout_${payment.id}_${paymentAmountCents}`, | idempotencyKey: `chi_checkout_${payment.id}_${paymentAmountCents}`, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:279 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:289 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:309 | async function createInvoiceForKickback({ | async function createInvoiceForKickback({ | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:317 | payment: KickbackPaymentForCheckout | payment: KickbackPaymentForCheckout | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:388 | kickback_payment_id: payment.id, | community_host_incentive_payment_id: payment.id, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:401 | metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'principal' }, | metadata: { community_host_incentive_payment_id: payment.id, settlement_method: 'invoice', item_type: 'principal' }, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:403 | { idempotencyKey: `kickback_invoice_item_${payment.id}_principal_${principalCents}` } | { idempotencyKey: `chi_invoice_item_${payment.id}_principal_${principalCents}` } | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:412 | metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'processing_fee' }, | metadata: { community_host_incentive_payment_id: payment.id, settlement_method: 'invoice', item_type: 'processing_fee' }, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:414 | { idempotencyKey: `kickback_invoice_item_${payment.id}_processing_${achFeeCents}` } | { idempotencyKey: `chi_invoice_item_${payment.id}_processing_${achFeeCents}` } | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:428 | { idempotencyKey: `kickback_invoice_${payment.id}_${principalCents}_${achFeeCents}` } | { idempotencyKey: `chi_invoice_${payment.id}_${principalCents}_${achFeeCents}` } | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:433 | { idempotencyKey: `kickback_invoice_finalize_${payment.id}_${invoice.id}` } | { idempotencyKey: `chi_invoice_finalize_${payment.id}_${invoice.id}` } | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:438 | { idempotencyKey: `kickback_invoice_send_${payment.id}_${finalizedInvoice.id}` } | { idempotencyKey: `chi_invoice_send_${payment.id}_${finalizedInvoice.id}` } | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:445 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:462 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:498 | payment: KickbackPaymentForCheckout | payment: KickbackPaymentForCheckout | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:499 | agreement: KickbackAgreementForInvoice | agreement: KickbackAgreementForInvoice | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:659 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:676 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:697 | function resolveVerifiedAttendance(agreement: KickbackAgreementForInvoice): { | function resolveVerifiedAttendance(agreement: KickbackAgreementForInvoice): { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:726 | agreement: KickbackAgreementForInvoice | agreement: KickbackAgreementForInvoice | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:767 | sourceAgreement: KickbackAgreementForInvoice | sourceAgreement: KickbackAgreementForInvoice | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:793 | source_table: 'event_kickback_agreements', | source_table: 'community_host_incentive_agreements', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:840 | agreement: KickbackAgreementForInvoice, | agreement: KickbackAgreementForInvoice, | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:861 | sourceAgreement: KickbackAgreementForInvoice | sourceAgreement: KickbackAgreementForInvoice | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:893 | source_table: 'event_kickback_agreements', | source_table: 'community_host_incentive_agreements', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:945 | function resolveKickbackPaymentAmountCents(payment: KickbackPaymentForCheckout) { | function resolveKickbackPaymentAmountCents(payment: KickbackPaymentForCheckout) { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:950 | async function loadAgreementForInvoice(admin: any, agreementId: string): Promise&lt;KickbackAgreementForInvoice \| null&gt; { | async function loadAgreementForInvoice(admin: any, agreementId: string): Promise&lt;KickbackAgreementForInvoice \| null&gt; { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:952 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:966 | 'bar_revenue_share_percent', | 'bar_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:967 | 'ticket_revenue_share_percent', | 'ticket_consumption_share_percent', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:980 | if (error) throw new Error(error.message ?? 'Failed to load kickback agreement') | if (error) throw new Error(error.message ?? 'Failed to load chi agreement') | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:981 | return (data as KickbackAgreementForInvoice \| null) ?? null | return (data as KickbackAgreementForInvoice \| null) ?? null | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:1087 | payment_kind_namespace: 'venue_builder_kickback', | payment_kind_namespace: 'venue_builder_chi', | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:1112 | async function loadInvoiceEventLabel(admin: any, agreement: KickbackAgreementForInvoice) { | async function loadInvoiceEventLabel(admin: any, agreement: KickbackAgreementForInvoice) { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:1144 | function getSettlementLabel(agreement: KickbackAgreementForInvoice) { | function getSettlementLabel(agreement: KickbackAgreementForInvoice) { | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:1145 | const barShare = readPositiveNumber(agreement.bar_revenue_share_percent) | const barShare = readPositiveNumber(agreement.bar_consumption_share_percent) | count via rg before rename |
| lib/server/community-host-incentive/checkout.ts:1148 | const ticketShare = readPositiveNumber(agreement.ticket_revenue_share_percent) | const ticketShare = readPositiveNumber(agreement.ticket_consumption_share_percent) | count via rg before rename |
| lib/venues/venuePreFilter.ts:43 | per_head_kickback: nullableNonnegativeNumberSchema, | per_head_chi_cents: nullableNonnegativeNumberSchema, | count via rg before rename |
| lib/venues/venuePreFilter.ts:44 | bar_revenue_share_percent: nullableNonnegativeNumberSchema.optional(), | bar_consumption_share_percent: nullableNonnegativeNumberSchema.optional(), | count via rg before rename |
| lib/venues/venuePreFilter.ts:47 | offers_kickbacks: z.boolean().nullable(), | offers_chis: z.boolean().nullable(), | count via rg before rename |
| lib/venues/venuePreFilter.ts:51 | bar_revenue_share_enabled: z.boolean().nullable(), | bar_consumption_share_enabled: z.boolean().nullable(), | count via rg before rename |
| lib/venues/venuePreFilter.ts:320 | if (venue.offers_kickbacks \|\| venue.bar_revenue_share_enabled \|\| (venue.per_head_kickback ?? 0) &gt; 0) { | if (venue.offers_chis \|\| venue.bar_consumption_share_enabled \|\| (venue.per_head_chi_cents ?? 0) &gt; 0) { | count via rg before rename |
| lib/types/database-generated.ts:2386 | venue_kickback_projection: number \| null | venue_chi_projection: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2411 | venue_kickback_projection?: number \| null | venue_chi_projection?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2436 | venue_kickback_projection?: number \| null | venue_chi_projection?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2513 | event_kickback_agreements: { | community_host_incentive_agreements: { | count via rg before rename |
| lib/types/database-generated.ts:2516 | actual_kickback_amount: number \| null | actual_chi_amount: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2526 | bar_revenue_share_percent: number \| null | bar_consumption_share_percent: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2545 | expected_kickback_amount: number \| null | expected_chi_amount: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2548 | kickback_model: string | chi_model: string | count via rg before rename |
| lib/types/database-generated.ts:2566 | ticket_revenue_share_percent: number \| null | ticket_consumption_share_percent: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2575 | actual_kickback_amount?: number \| null | actual_chi_amount?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2585 | bar_revenue_share_percent?: number \| null | bar_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2604 | expected_kickback_amount?: number \| null | expected_chi_amount?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2607 | kickback_model: string | chi_model: string | count via rg before rename |
| lib/types/database-generated.ts:2625 | ticket_revenue_share_percent?: number \| null | ticket_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2634 | actual_kickback_amount?: number \| null | actual_chi_amount?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2644 | bar_revenue_share_percent?: number \| null | bar_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2663 | expected_kickback_amount?: number \| null | expected_chi_amount?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2666 | kickback_model?: string | chi_model?: string | count via rg before rename |
| lib/types/database-generated.ts:2684 | ticket_revenue_share_percent?: number \| null | ticket_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:2693 | foreignKeyName: "event_kickback_agreements_builder_id_fkey" | foreignKeyName: "community_host_incentive_agreements_builder_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2700 | foreignKeyName: "event_kickback_agreements_disputed_by_fkey" | foreignKeyName: "community_host_incentive_agreements_disputed_by_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2707 | foreignKeyName: "event_kickback_agreements_event_id_fkey" | foreignKeyName: "community_host_incentive_agreements_event_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2714 | foreignKeyName: "event_kickback_agreements_plan_id_fkey" | foreignKeyName: "community_host_incentive_agreements_plan_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2721 | foreignKeyName: "event_kickback_agreements_venue_id_fkey" | foreignKeyName: "community_host_incentive_agreements_venue_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2728 | foreignKeyName: "event_kickback_agreements_venue_owner_id_fkey" | foreignKeyName: "community_host_incentive_agreements_venue_owner_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:2943 | referencedRelation: "event_kickback_agreements" | referencedRelation: "community_host_incentive_agreements" | count via rg before rename |
| lib/types/database-generated.ts:3390 | kickback_agreement_id: string \| null | chi_agreement_id: string \| null | count via rg before rename |
| lib/types/database-generated.ts:3425 | kickback_agreement_id?: string \| null | chi_agreement_id?: string \| null | count via rg before rename |
| lib/types/database-generated.ts:3460 | kickback_agreement_id?: string \| null | chi_agreement_id?: string \| null | count via rg before rename |
| lib/types/database-generated.ts:3483 | foreignKeyName: "events_kickback_agreement_id_fkey" | foreignKeyName: "events_chi_agreement_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3484 | columns: ["kickback_agreement_id"] | columns: ["chi_agreement_id"] | count via rg before rename |
| lib/types/database-generated.ts:3486 | referencedRelation: "event_kickback_agreements" | referencedRelation: "community_host_incentive_agreements" | count via rg before rename |
| lib/types/database-generated.ts:3780 | kickback_disputes: { | chi_disputes: { | count via rg before rename |
| lib/types/database-generated.ts:3834 | foreignKeyName: "kickback_disputes_agreement_id_fkey" | foreignKeyName: "chi_disputes_agreement_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3837 | referencedRelation: "event_kickback_agreements" | referencedRelation: "community_host_incentive_agreements" | count via rg before rename |
| lib/types/database-generated.ts:3841 | foreignKeyName: "kickback_disputes_initiated_by_fkey" | foreignKeyName: "chi_disputes_initiated_by_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3848 | foreignKeyName: "kickback_disputes_resolved_by_fkey" | foreignKeyName: "chi_disputes_resolved_by_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3856 | kickback_payments: { | community_host_incentive_payments: { | count via rg before rename |
| lib/types/database-generated.ts:3979 | foreignKeyName: "kickback_payments_agreement_id_fkey" | foreignKeyName: "community_host_incentive_payments_agreement_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3982 | referencedRelation: "event_kickback_agreements" | referencedRelation: "community_host_incentive_agreements" | count via rg before rename |
| lib/types/database-generated.ts:3986 | foreignKeyName: "kickback_payments_event_id_fkey" | foreignKeyName: "community_host_incentive_payments_event_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:3993 | foreignKeyName: "kickback_payments_payer_id_fkey" | foreignKeyName: "community_host_incentive_payments_payer_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:4000 | foreignKeyName: "kickback_payments_recipient_id_fkey" | foreignKeyName: "community_host_incentive_payments_recipient_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:4007 | foreignKeyName: "kickback_payments_refund_approved_by_fkey" | foreignKeyName: "community_host_incentive_payments_refund_approved_by_fkey" | count via rg before rename |
| lib/types/database-generated.ts:4014 | foreignKeyName: "kickback_payments_refund_requested_by_fkey" | foreignKeyName: "community_host_incentive_payments_refund_requested_by_fkey" | count via rg before rename |
| lib/types/database-generated.ts:6521 | kickback_model: Json | chi_model: Json | count via rg before rename |
| lib/types/database-generated.ts:6543 | kickback_model?: Json | chi_model?: Json | count via rg before rename |
| lib/types/database-generated.ts:6565 | kickback_model?: Json | chi_model?: Json | count via rg before rename |
| lib/types/database-generated.ts:7538 | per_head_kickback: number \| null | per_head_chi_cents: number \| null | count via rg before rename |
| lib/types/database-generated.ts:7598 | per_head_kickback?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:7658 | per_head_kickback?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:8287 | venue_kickback_configs: { | venue_chi_configs: { | count via rg before rename |
| lib/types/database-generated.ts:8300 | kickback_model: string | chi_model: string | count via rg before rename |
| lib/types/database-generated.ts:8323 | kickback_model: string | chi_model: string | count via rg before rename |
| lib/types/database-generated.ts:8346 | kickback_model?: string | chi_model?: string | count via rg before rename |
| lib/types/database-generated.ts:8359 | foreignKeyName: "venue_kickback_configs_venue_id_fkey" | foreignKeyName: "venue_chi_configs_venue_id_fkey" | count via rg before rename |
| lib/types/database-generated.ts:8955 | bar_rev_share_enabled: boolean | bar_consumption_share_enabled: boolean | count via rg before rename |
| lib/types/database-generated.ts:8956 | bar_rev_share_pct: number | bar_consumption_share_pct: number | count via rg before rename |
| lib/types/database-generated.ts:8958 | bar_revenue_share_enabled: boolean \| null | bar_consumption_share_enabled: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:8959 | bar_revenue_share_percent: number \| null | bar_consumption_share_percent: number \| null | count via rg before rename |
| lib/types/database-generated.ts:8967 | default_kickback_type: string \| null | default_chi_type: string \| null | count via rg before rename |
| lib/types/database-generated.ts:8987 | offers_kickbacks: boolean \| null | offers_chis: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:8991 | per_head_kickback: number \| null | per_head_chi_cents: number \| null | count via rg before rename |
| lib/types/database-generated.ts:8992 | per_head_kickback_amount: number \| null | per_head_chi_cents: number \| null | count via rg before rename |
| lib/types/database-generated.ts:8993 | per_head_kickback_cents: number | per_head_chi_cents: number | count via rg before rename |
| lib/types/database-generated.ts:9000 | sponsor_rev_share_enabled: boolean | sponsor_consumption_share_enabled: boolean | count via rg before rename |
| lib/types/database-generated.ts:9001 | sponsor_rev_share_pct: number | sponsor_consumption_share_pct: number | count via rg before rename |
| lib/types/database-generated.ts:9024 | bar_rev_share_enabled?: boolean | bar_consumption_share_enabled?: boolean | count via rg before rename |
| lib/types/database-generated.ts:9025 | bar_rev_share_pct?: number | bar_consumption_share_pct?: number | count via rg before rename |
| lib/types/database-generated.ts:9027 | bar_revenue_share_enabled?: boolean \| null | bar_consumption_share_enabled?: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:9028 | bar_revenue_share_percent?: number \| null | bar_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9036 | default_kickback_type?: string \| null | default_chi_type?: string \| null | count via rg before rename |
| lib/types/database-generated.ts:9056 | offers_kickbacks?: boolean \| null | offers_chis?: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:9060 | per_head_kickback?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9061 | per_head_kickback_amount?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9062 | per_head_kickback_cents?: number | per_head_chi_cents?: number | count via rg before rename |
| lib/types/database-generated.ts:9069 | sponsor_rev_share_enabled?: boolean | sponsor_consumption_share_enabled?: boolean | count via rg before rename |
| lib/types/database-generated.ts:9070 | sponsor_rev_share_pct?: number | sponsor_consumption_share_pct?: number | count via rg before rename |
| lib/types/database-generated.ts:9093 | bar_rev_share_enabled?: boolean | bar_consumption_share_enabled?: boolean | count via rg before rename |
| lib/types/database-generated.ts:9094 | bar_rev_share_pct?: number | bar_consumption_share_pct?: number | count via rg before rename |
| lib/types/database-generated.ts:9096 | bar_revenue_share_enabled?: boolean \| null | bar_consumption_share_enabled?: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:9097 | bar_revenue_share_percent?: number \| null | bar_consumption_share_percent?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9105 | default_kickback_type?: string \| null | default_chi_type?: string \| null | count via rg before rename |
| lib/types/database-generated.ts:9125 | offers_kickbacks?: boolean \| null | offers_chis?: boolean \| null | count via rg before rename |
| lib/types/database-generated.ts:9129 | per_head_kickback?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9130 | per_head_kickback_amount?: number \| null | per_head_chi_cents?: number \| null | count via rg before rename |
| lib/types/database-generated.ts:9131 | per_head_kickback_cents?: number | per_head_chi_cents?: number | count via rg before rename |
| lib/types/database-generated.ts:9138 | sponsor_rev_share_enabled?: boolean | sponsor_consumption_share_enabled?: boolean | count via rg before rename |
| lib/types/database-generated.ts:9139 | sponsor_rev_share_pct?: number | sponsor_consumption_share_pct?: number | count via rg before rename |
| lib/types/database-generated.ts:9365 | calculate_event_kickback: { Args: { p_event_id: string }; Returns: Json } | calculate_event_chi: { Args: { p_event_id: string }; Returns: Json } | count via rg before rename |
| lib/types/database-generated.ts:9473 | get_event_kickback_summary: { | get_event_chi_summary: { | count via rg before rename |
| lib/venues/venue-adapter.ts:29 | per_head_kickback, | per_head_chi_cents, | count via rg before rename |
| lib/venues/venue-adapter.ts:37 | offers_kickbacks, | offers_chis, | count via rg before rename |
| lib/venues/venue-adapter.ts:38 | default_kickback_type, | default_chi_type, | count via rg before rename |
| lib/venues/venue-adapter.ts:42 | bar_rev_share_enabled, | bar_consumption_share_enabled, | count via rg before rename |
| lib/venues/venue-adapter.ts:43 | bar_rev_share_pct, | bar_consumption_share_pct, | count via rg before rename |
| lib/venues/venue-adapter.ts:44 | sponsor_rev_share_enabled, | sponsor_consumption_share_enabled, | count via rg before rename |
| lib/venues/venue-adapter.ts:45 | sponsor_rev_share_pct, | sponsor_consumption_share_pct, | count via rg before rename |
| lib/venues/venue-adapter.ts:46 | per_head_kickback_cents, | per_head_chi_cents, | count via rg before rename |
| lib/venues/venue-adapter.ts:82 | per_head_kickback, | per_head_chi_cents, | count via rg before rename |
| lib/venues/venue-adapter.ts:90 | offers_kickbacks, | offers_chis, | count via rg before rename |
| lib/venues/venue-adapter.ts:91 | default_kickback_type, | default_chi_type, | count via rg before rename |
| lib/venues/venue-adapter.ts:110 | const perHeadKickbackCents = | const perHeadKickbackCents = | count via rg before rename |
| lib/venues/venue-adapter.ts:111 | readCents(row.per_head_kickback_cents, row.per_head_kickback_amount ?? row.per_head_kickback) ?? 0 | readCents(row.per_head_chi_cents, row.per_head_chi_cents ?? row.per_head_chi_cents) ?? 0 | count via rg before rename |
| lib/venues/venue-adapter.ts:150 | bar_revenue_share_enabled: | bar_consumption_share_enabled: | count via rg before rename |
| lib/venues/venue-adapter.ts:151 | row.bar_revenue_share_enabled ?? row.bar_rev_share_enabled ?? false, | row.bar_consumption_share_enabled ?? row.bar_consumption_share_enabled ?? false, | count via rg before rename |
| lib/venues/venue-adapter.ts:152 | bar_revenue_share_percent: | bar_consumption_share_percent: | count via rg before rename |
| lib/venues/venue-adapter.ts:153 | row.bar_revenue_share_percent ?? row.bar_rev_share_pct ?? row.bar_revenue_percentage ?? 0, | row.bar_consumption_share_percent ?? row.bar_consumption_share_pct ?? row.bar_revenue_percentage ?? 0, | count via rg before rename |
| lib/venues/venue-adapter.ts:154 | per_head_kickback_amount: | per_head_chi_cents: | count via rg before rename |
| lib/venues/venue-adapter.ts:155 | perHeadKickbackCents, | perHeadKickbackCents, | count via rg before rename |
| lib/venues/venue-adapter.ts:156 | per_head_kickback_cents: perHeadKickbackCents, | per_head_chi_cents: perHeadKickbackCents, | count via rg before rename |
| lib/venues/venue-adapter.ts:229 | if (updates.bar_revenue_share_enabled !== undefined) { | if (updates.bar_consumption_share_enabled !== undefined) { | count via rg before rename |
| lib/venues/venue-adapter.ts:230 | row.bar_revenue_share_enabled = updates.bar_revenue_share_enabled | row.bar_consumption_share_enabled = updates.bar_consumption_share_enabled | count via rg before rename |
| lib/venues/venue-adapter.ts:232 | if (updates.bar_revenue_share_percent !== undefined) { | if (updates.bar_consumption_share_percent !== undefined) { | count via rg before rename |
| lib/venues/venue-adapter.ts:233 | row.bar_revenue_share_percent = updates.bar_revenue_share_percent | row.bar_consumption_share_percent = updates.bar_consumption_share_percent | count via rg before rename |
| lib/venues/venue-adapter.ts:235 | if (updates.per_head_kickback_amount !== undefined) { | if (updates.per_head_chi_cents !== undefined) { | count via rg before rename |
| lib/venues/venue-adapter.ts:236 | row.per_head_kickback_cents = updates.per_head_kickback_amount | row.per_head_chi_cents = updates.per_head_chi_cents | count via rg before rename |
| lib/venues/venue-adapter.ts:238 | if (updates.per_head_kickback_cents !== undefined) { | if (updates.per_head_chi_cents !== undefined) { | count via rg before rename |
| lib/venues/venue-adapter.ts:239 | row.per_head_kickback_cents = updates.per_head_kickback_cents | row.per_head_chi_cents = updates.per_head_chi_cents | count via rg before rename |
| lib/venues/venue-adapter.ts:271 | if (value === 'hourly' \|\| value === 'revenue_share' \|\| value === 'hybrid') { | if (value === 'hourly' \|\| value === 'consumption_share' \|\| value === 'hybrid') { | count via rg before rename |
| lib/ai/agents/venueMatchingAgent.ts:123 | 'Do not invent venue fields. Use only candidate id, venue_name, venue_type, standing_capacity, seated_capacity, city, state, hourly_rate, minimum_hours, per_head_kickback, offers_kickbacks, deposit_percentage, cancellation_terms, available_days, bar_revenue_share_enabled, venue_amenities. Amenity data is from venue_amenities.amenity_name.', | 'Do not invent venue fields. Use only candidate id, venue_name, venue_type, standing_capacity, seated_capacity, city, state, hourly_rate,... | count via rg before rename |
| lib/ai/agents/venueMatchingAgent.ts:237 | per_head_kickback: venue.per_head_kickback, | per_head_chi_cents: venue.per_head_chi_cents, | count via rg before rename |
| lib/ai/agents/venueMatchingAgent.ts:238 | offers_kickbacks: venue.offers_kickbacks, | offers_chis: venue.offers_chis, | count via rg before rename |
| lib/ai/agents/venueMatchingAgent.ts:242 | bar_revenue_share_enabled: venue.bar_revenue_share_enabled, | bar_consumption_share_enabled: venue.bar_consumption_share_enabled, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:8 | calculateVenueKickbackProjectionCents, | calculateVenueKickbackProjectionCents, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:170 | venue_kickback_rate: input.venue_kickback_rate, | venue_chi_rate: input.venue_chi_rate, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:229 | calculations.revenue_scenarios.expected.kickback_projection_cents, | calculations.revenue_scenarios.expected.chi_projection_cents, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:268 | const kickbackProjectionCents = calculateVenueKickbackProjectionCents({ | const chiProjectionCents = calculateVenueKickbackProjectionCents({ | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:270 | kickbackRate: input.venue_kickback_rate, | chiRate: input.venue_chi_rate, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:278 | kickbackProjectionCents | chiProjectionCents | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:417 | expectedKickbackProjectionCents: number, | expectedKickbackProjectionCents: number, | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:422 | const withKickbackLine = expectedKickbackProjectionCents &gt; 0 | const withKickbackLine = expectedKickbackProjectionCents &gt; 0 | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:423 | ? `${narrative} Expected venue kickback: ${formatCurrency(expectedKickbackProjectionCents)}.` | ? `${narrative} Expected venue chi: ${formatCurrency(expectedKickbackProjectionCents)}.` | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:426 | ? `${withKickbackLine} ${formatLiveTriggerEvidence(liveTriggers)}` | ? `${withKickbackLine} ${formatLiveTriggerEvidence(liveTriggers)}` | count via rg before rename |
| lib/ai/agents/economicsAgent.ts:427 | : withKickbackLine | : withKickbackLine | count via rg before rename |
| lib/planner/venueComplianceGate.ts:36 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/planner/venueComplianceGate.ts:41 | throw new Error(agreementError.message ?? 'Failed to load venue kickback agreements') | throw new Error(agreementError.message ?? 'Failed to load venue chi agreements') | count via rg before rename |
| lib/planner/venueComplianceGate.ts:49 | .from('kickback_payments') | .from('community_host_incentive_payments') | count via rg before rename |
| lib/planner/venueComplianceGate.ts:54 | throw new Error(paymentError.message ?? 'Failed to load venue kickback payments') | throw new Error(paymentError.message ?? 'Failed to load venue chi payments') | count via rg before rename |
| lib/finance/revenueTerms.ts:7 | 'venue_kickback', | 'venue_chi', | count via rg before rename |
| lib/finance/revenueTerms.ts:9 | 'vendor_rev_share', | 'vendor_consumption_share', | count via rg before rename |
| lib/finance/revenueTerms.ts:107 | venue_kickback_cents: number | venue_chi_cents: number | count via rg before rename |
| lib/finance/revenueTerms.ts:109 | vendor_rev_share_cents: number | vendor_consumption_share_cents: number | count via rg before rename |
| lib/finance/revenueTerms.ts:275 | venue_kickback_cents: 0, | venue_chi_cents: 0, | count via rg before rename |
| lib/finance/revenueTerms.ts:277 | vendor_rev_share_cents: 0, | vendor_consumption_share_cents: 0, | count via rg before rename |
| lib/finance/revenueTerms.ts:287 | if (impact.term_type === 'venue_kickback') summary.venue_kickback_cents += impact.amount_cents | if (impact.term_type === 'venue_chi') summary.venue_chi_cents += impact.amount_cents | count via rg before rename |
| lib/finance/revenueTerms.ts:289 | if (impact.term_type === 'vendor_rev_share') summary.vendor_rev_share_cents += impact.amount_cents | if (impact.term_type === 'vendor_consumption_share') summary.vendor_consumption_share_cents += impact.amount_cents | count via rg before rename |
| lib/finance/revenueTerms.ts:362 | summary.venue_kickback_cents + | summary.venue_chi_cents + | count via rg before rename |
| lib/finance/revenueTerms.ts:478 | if (termType === 'venue_kickback' \|\| termType === 'sponsor_credit') { | if (termType === 'venue_chi' \|\| termType === 'sponsor_credit') { | count via rg before rename |
| lib/finance/revenueTerms.ts:485 | if (termType === 'vendor_rev_share' \|\| termType === 'venue_minimum_spend') { | if (termType === 'vendor_consumption_share' \|\| termType === 'venue_minimum_spend') { | count via rg before rename |
| lib/finance/calculate-event-financials.ts:19 | venue_kickback_projection: number | venue_chi_projection: number | count via rg before rename |
| lib/finance/calculate-event-financials.ts:107 | venue_kickback_projection: 0, | venue_chi_projection: 0, | count via rg before rename |
| lib/finance/calculate-event-financials.ts:156 | * Loads the per-head venue kickback rate configured for an event. | * Loads the per-head venue chi rate configured for an event. | count via rg before rename |
| lib/finance/calculate-event-financials.ts:158 | * Kickback projections are only projections during sales. Actual kickbacks are | * Kickback projections are only projections during sales. Actual chis are | count via rg before rename |
| lib/finance/calculate-event-financials.ts:161 | * @param supabase - Supabase client with permission to read kickback agreements. | * @param supabase - Supabase client with permission to read chi agreements. | count via rg before rename |
| lib/finance/calculate-event-financials.ts:163 | * @returns Per-attendee kickback amount, or 0 when no agreement exists. | * @returns Per-attendee chi amount, or 0 when no agreement exists. | count via rg before rename |
| lib/finance/calculate-event-financials.ts:165 | async function loadKickbackRate(supabase: SupabaseClient, eventId: string) { | async function loadKickbackRate(supabase: SupabaseClient, eventId: string) { | count via rg before rename |
| lib/finance/calculate-event-financials.ts:167 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/finance/calculate-event-financials.ts:248 | * - Venue kickback projection uses projected attendance, but actual kickback | * - Venue chi projection uses projected attendance, but actual chi | count via rg before rename |
| lib/finance/calculate-event-financials.ts:265 | kickbackRate, | chiRate, | count via rg before rename |
| lib/finance/calculate-event-financials.ts:277 | loadKickbackRate(supabase, eventId), | loadKickbackRate(supabase, eventId), | count via rg before rename |
| lib/finance/calculate-event-financials.ts:323 | const venueKickbackProjection = projectedAttendance * kickbackRate + venueSalesShareProjection | const venueKickbackProjection = projectedAttendance * chiRate + venueSalesShareProjection | count via rg before rename |
| lib/finance/calculate-event-financials.ts:342 | venue_kickback_projection: roundMoney(venueKickbackProjection), | venue_chi_projection: roundMoney(venueKickbackProjection), | count via rg before rename |
| lib/finance/community-host-incentive/stripeMetadata.ts:25 | is_revenue_share: 'false', | is_consumption_share: 'false', | count via rg before rename |
| lib/ticketing/attendancePoll.ts:195 | .from('event_kickback_agreements') | .from('community_host_incentive_agreements') | count via rg before rename |
| lib/finance/community-host-incentive/compliance.ts:8 | 'kickback', | 'chi', | count via rg before rename |
| lib/finance/community-host-incentive/compliance.ts:9 | 'revenue_share', | 'consumption_share', | count via rg before rename |
| lib/finance/community-host-incentive/compliance.ts:10 | 'rev_share', | 'consumption_share', | count via rg before rename |
| lib/finance/community-host-incentive/compliance.ts:11 | 'bar_split', | 'bar_consumption_split', | count via rg before rename |
| lib/finance/eventActuals.ts:58 | rev_share_adjustments: Array&lt;{ | consumption_share_adjustments: Array&lt;{ | count via rg before rename |
| lib/finance/eventActuals.ts:217 | rev_share_adjustments: termCostAdjustments.rev_share_adjustments, | consumption_share_adjustments: termCostAdjustments.consumption_share_adjustments, | count via rg before rename |
| lib/finance/eventActuals.ts:415 | let query = asQuery(supabase.from('event_kickback_agreements')) | let query = asQuery(supabase.from('community_host_incentive_agreements')) | count via rg before rename |
| lib/finance/eventActuals.ts:618 | const adjustments: EventPnL['rev_share_adjustments'] = [] | const adjustments: EventPnL['consumption_share_adjustments'] = [] | count via rg before rename |
| lib/finance/eventActuals.ts:623 | if (term.term_type !== 'vendor_rev_share' && term.term_type !== 'venue_minimum_spend') continue | if (term.term_type !== 'vendor_consumption_share' && term.term_type !== 'venue_minimum_spend') continue | count via rg before rename |
| lib/finance/eventActuals.ts:628 | const category = term.term_type === 'vendor_rev_share' ? 'vendor' : 'venue' | const category = term.term_type === 'vendor_consumption_share' ? 'vendor' : 'venue' | count via rg before rename |
| lib/finance/eventActuals.ts:635 | if (term.term_type === 'vendor_rev_share' && matchingManualAmount &gt; 0) { | if (term.term_type === 'vendor_consumption_share' && matchingManualAmount &gt; 0) { | count via rg before rename |
| lib/finance/eventActuals.ts:642 | party_name: impact.party_name ?? (term.term_type === 'vendor_rev_share' ? 'Vendor rev share' : 'Venue minimum spend'), | party_name: impact.party_name ?? (term.term_type === 'vendor_consumption_share' ? 'Vendor rev share' : 'Venue minimum spend'), | count via rg before rename |
| lib/finance/eventActuals.ts:650 | rev_share_adjustments: adjustments, | consumption_share_adjustments: adjustments, | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:16 | 'per_head_kickback', | 'per_head_chi_cents', | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:17 | 'bar_revenue_share', | 'bar_consumption_share', | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:18 | 'ticket_revenue_share', | 'ticket_consumption_share', | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:36 | venue_kickback_rate: z.number().nonnegative().default(0), | venue_chi_rate: z.number().nonnegative().default(0), | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:44 | kickback_projection_cents: z.number().int(), | chi_projection_cents: z.number().int(), | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:125 | const kickbackProjectionCents = calculateVenueKickbackProjectionCents({ | const chiProjectionCents = calculateVenueKickbackProjectionCents({ | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:127 | kickbackRate: input.venue_kickback_rate, | chiRate: input.venue_chi_rate, | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:132 | const totalRevenueCents = ticketRevenueCents + input.sponsorship_revenue_cents + kickbackProjectionCents | const totalRevenueCents = ticketRevenueCents + input.sponsorship_revenue_cents + chiProjectionCents | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:139 | kickback_projection_cents: kickbackProjectionCents, | chi_projection_cents: chiProjectionCents, | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:147 | export function calculateVenueKickbackProjectionCents({ | export function calculateVenueKickbackProjectionCents({ | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:149 | kickbackRate, | chiRate, | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:155 | kickbackRate?: number | chiRate?: number | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:160 | const rate = Number.isFinite(kickbackRate ?? 0) ? Math.max(kickbackRate ?? 0, 0) : 0 | const rate = Number.isFinite(chiRate ?? 0) ? Math.max(chiRate ?? 0, 0) : 0 | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:161 | if (model === 'per_head_kickback') { | if (model === 'per_head_chi_cents') { | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:165 | if (model === 'bar_revenue_share') { | if (model === 'bar_consumption_share') { | count via rg before rename |
| lib/finance/eventPlanningEconomics.ts:170 | if (model === 'ticket_revenue_share') { | if (model === 'ticket_consumption_share') { | count via rg before rename |

## Track D: UI Strings

Total occurrences: 61. Files affected: 12. Estimated PR size: medium.

| path:line | current copy/context | proposed copy |
| --- | --- | --- |
| app/(planner)/planner/venues/page.tsx:369 | if (venue.bar_revenue_share_enabled) return 'Bar share' | if (venue.bar_consumption_share_enabled) return 'Bar share' |
| app/(planner)/planner/venues/page.tsx:370 | if (venue.per_head_kickback_amount && venue.per_head_kickback_amount &gt; 0) return 'Per-head' | if (venue.per_head_chi_cents && venue.per_head_chi_cents &gt; 0) return 'Per-head' |
| app/(planner)/planner/analytics/page.tsx:486 | &lt;ImpactRow label="Community Host Incentive projection" value={formatMoney(scorecard.venueKickbackProjectionDollars)} source="financial summary" /&gt; | &lt;ImpactRow label="Community Host Incentive projection" value={formatMoney(scorecard.venueKickbackProjectionDollars)} source="financial su... |
| app/(dashboard)/vendor/pricing/page.tsx:113 | const headcountKickback = watch('headcount_kickback') | const headcountKickback = watch('headcount_chi') |
| app/(dashboard)/vendor/pricing/page.tsx:350 | id="headcount_kickback" | id="headcount_chi" |
| app/(dashboard)/vendor/pricing/page.tsx:351 | {...register('headcount_kickback')} | {...register('headcount_chi')} |
| app/(dashboard)/vendor/pricing/page.tsx:354 | &lt;label htmlFor="headcount_kickback" className="text-sm font-medium text-ink"&gt; | &lt;label htmlFor="headcount_chi" className="text-sm font-medium text-ink"&gt; |
| app/(dashboard)/venue/payouts/page.tsx:839 | {isLoadingKickbacks ? 'Loading records...' : `${kickbackPayments.length} settlement${kickbackPayments.length === 1 ? '' : 's'}`} | {isLoadingKickbacks ? 'Loading records...' : `${chiPayments.length} settlement${chiPayments.length === 1 ? '' : 's'}`} |
| app/(dashboard)/venue/pricing/page.tsx:102 | const perHeadKickback = watch('per_head_kickback') \|\| 0 | const perHeadKickback = watch('per_head_chi_cents') \|\| 0 |
| app/(dashboard)/venue/pricing/page.tsx:489 | {...register('per_head_kickback', { valueAsNumber: true })} | {...register('per_head_chi_cents', { valueAsNumber: true })} |
| components/planner/RevenueTermsTab.tsx:12 | \| 'venue_kickback' | \| 'venue_chi' |
| components/planner/RevenueTermsTab.tsx:14 | \| 'vendor_rev_share' | \| 'vendor_consumption_share' |
| components/planner/RevenueTermsTab.tsx:64 | venue_kickback_cents: number | venue_chi_cents: number |
| components/planner/RevenueTermsTab.tsx:66 | vendor_rev_share_cents: number | vendor_consumption_share_cents: number |
| components/planner/RevenueTermsTab.tsx:105 | venue_kickback: 'Community Host Incentive', | venue_chi: 'Community Host Incentive', |
| components/planner/RevenueTermsTab.tsx:107 | vendor_rev_share: 'Vendor partner share', | vendor_consumption_share: 'Vendor partner share', |
| components/planner/RevenueTermsTab.tsx:172 | (summary?.vendor_rev_share_cents ?? 0) + | (summary?.vendor_consumption_share_cents ?? 0) + |
| components/planner/RevenueTermsTab.tsx:175 | (summary?.venue_kickback_cents ?? 0) + | (summary?.venue_chi_cents ?? 0) + |
| components/auth/SignupExperience.tsx:1008 | barKickback: '10', | barKickback: '10', |
| components/auth/SignupExperience.tsx:1126 | bar_kickback_pct: form.isBar ? parseFloat(form.barKickback) : null, | bar_chi_pct: form.isBar ? parseFloat(form.barKickback) : null, |
| components/auth/SignupExperience.tsx:1284 | &lt;Input type="number" value={form.barKickback} onChange={(e) =&gt; setForm({ ...form, barKickback: e.target.value })} placeholder="10" /&gt; | &lt;Input type="number" value={form.barKickback} onChange={(e) =&gt; setForm({ ...form, barKickback: e.target.value })} placeholder="10" /&gt; |
| components/planner/PlannerLivePlanPanel.tsx:104 | revenue_share: string \| null | consumption_share: string \| null |
| components/planner/PlannerLivePlanPanel.tsx:178 | venueKickbackCents: number | venueKickbackCents: number |
| components/planner/PlannerLivePlanPanel.tsx:179 | revenueShareCents: number | consumptionShareCents: number |
| components/planner/PlannerLivePlanPanel.tsx:426 | revenue_share: null, | consumption_share: null, |
| components/planner/PlannerLivePlanPanel.tsx:454 | revenue_share: readString(summary.revenue_share) ?? fallback.revenue_share, | consumption_share: readString(summary.consumption_share) ?? fallback.consumption_share, |
| components/planner/PlannerLivePlanPanel.tsx:495 | if (label.includes('revenue')) nextSummary.revenue_share = value | if (label.includes('revenue')) nextSummary.consumption_share = value |
| components/planner/PlannerLivePlanPanel.tsx:629 | const venueKickbackCents = guestCount &gt; 100 ? (guestCount - 100) * 800 : 0 | const venueKickbackCents = guestCount &gt; 100 ? (guestCount - 100) * 800 : 0 |
| components/planner/PlannerLivePlanPanel.tsx:630 | const revenueShareCents = Math.round(Math.max(0, ticketRevenueCents - feesCents) * 0.12) | const consumptionShareCents = Math.round(Math.max(0, ticketRevenueCents - feesCents) * 0.12) |
| components/planner/PlannerLivePlanPanel.tsx:631 | const expectedCents = ticketRevenueCents + barRevenueCents - venueCostCents - vendorCostCents - customCostsTotalCents - feesCents - venueKickbackCents | const expectedCents = ticketRevenueCents + barRevenueCents - venueCostCents - vendorCostCents - customCostsTotalCents - feesCents - venue... |
| components/planner/PlannerLivePlanPanel.tsx:636 | const totalCostCents = venueCostCents + vendorCostCents + customCostsTotalCents + feesCents + venueKickbackCents | const totalCostCents = venueCostCents + vendorCostCents + customCostsTotalCents + feesCents + venueKickbackCents |
| components/planner/PlannerLivePlanPanel.tsx:648 | { label: 'Community Host Incentive (per-head model)', amountCents: venueKickbackCents, negative: true }, | { label: 'Community Host Incentive (per-head model)', amountCents: venueKickbackCents, negative: true }, |
| components/planner/PlannerLivePlanPanel.tsx:664 | venueKickbackCents, | venueKickbackCents, |
| components/planner/PlannerLivePlanPanel.tsx:665 | revenueShareCents, | consumptionShareCents, |
| components/planner/PlannerLivePlanPanel.tsx:782 | const isComparingCommercialModels = isRecommendBestModel(eventSummary.revenue_share) | const isComparingCommercialModels = isRecommendBestModel(eventSummary.consumption_share) |
| components/planner/PlannerLivePlanPanel.tsx:1205 | &lt;KickbackCard | &lt;KickbackCard |
| components/planner/PlannerLivePlanPanel.tsx:1210 | estimate={`≈ ${formatCents(profitModel.venueKickbackCents)} to venue at ${profitModel.paidAverage \|\| 'TBD'}`} | estimate={`≈ ${formatCents(profitModel.venueKickbackCents)} to venue at ${profitModel.paidAverage \|\| 'TBD'}`} |
| components/planner/PlannerLivePlanPanel.tsx:1211 | recommended={profitModel.venueKickbackCents &lt;= profitModel.revenueShareCents} | recommended={profitModel.venueKickbackCents &lt;= profitModel.consumptionShareCents} |
| components/planner/PlannerLivePlanPanel.tsx:1213 | &lt;KickbackCard | &lt;KickbackCard |
| components/planner/PlannerLivePlanPanel.tsx:1218 | estimate={`≈ ${formatCents(profitModel.revenueShareCents)} to venue at ${profitModel.paidAverage \|\| 'TBD'}`} | estimate={`≈ ${formatCents(profitModel.consumptionShareCents)} to venue at ${profitModel.paidAverage \|\| 'TBD'}`} |
| components/planner/PlannerLivePlanPanel.tsx:1219 | recommended={profitModel.revenueShareCents &lt; profitModel.venueKickbackCents} | recommended={profitModel.consumptionShareCents &lt; profitModel.venueKickbackCents} |
| components/planner/PlannerLivePlanPanel.tsx:1526 | function KickbackCard({ | function KickbackCard({ |
| components/planner/PlannerLivePlanPanel.tsx:1740 | if (isRecommendBestModel(summary.revenue_share)) return 'Flexible while agent compares' | if (isRecommendBestModel(summary.consumption_share)) return 'Flexible while agent compares' |
| components/planner/PlannerLivePlanPanel.tsx:1745 | if (isRecommendBestModel(summary.revenue_share)) return 'Agent recommends best model' | if (isRecommendBestModel(summary.consumption_share)) return 'Agent recommends best model' |
| components/planner/PlannerLivePlanPanel.tsx:1746 | return summary.revenue_share ?? 'Need revenue model' | return summary.consumption_share ?? 'Need revenue model' |
| components/planner/PlannerLivePlanPanel.tsx:2272 | summary.revenue_share, | summary.consumption_share, |
| components/planner/planner-page/draftMode.ts:417 | question('bar_rev_share', 'Bar economics', 'Do you want a Community Host Incentive, bar split, minimum spend, or no bar terms?', /\b(revenue share\|rev share\|bar split\|kickback\|minimum spend\|no rev)\b/i), | question('bar_consumption_share', 'Bar economics', 'Do you want a Community Host Incentive, bar split, minimum spend, or no bar terms?', ... |
| components/planner/planner-page/draftMode.ts:452 | question('door_split', 'Door economics', 'Do you want a door split, bar incentive, flat rental, or minimum spend?', /\b(door split\|bar revenue\|rev share\|flat rental\|minimum spend\|kickback)\b/i), | question('door_split', 'Door economics', 'Do you want a door split, bar incentive, flat rental, or minimum spend?', /\b(door split\|bar re... |
| components/planner/planner-page/draftMode.ts:622 | if (/\b(house party\|kickback\|pregame)\b/.test(lower)) return 'house party' | if (/\b(house party\|chi\|pregame)\b/.test(lower)) return 'house party' |
| components/planner/LiveEventDashboard.tsx:79 | rev_share_adjustments: Array&lt;{ | consumption_share_adjustments: Array&lt;{ |
| components/planner/LiveEventDashboard.tsx:151 | venue_kickback_cents: number | venue_chi_cents: number |
| components/planner/LiveEventDashboard.tsx:153 | vendor_rev_share_cents: number | vendor_consumption_share_cents: number |
| components/planner/LiveEventDashboard.tsx:493 | &lt;MiniMetric label="Community Host Incentive" value={formatCents(snapshot.revenue_terms.summary.venue_kickback_cents)} /&gt; | &lt;MiniMetric label="Community Host Incentive" value={formatCents(snapshot.revenue_terms.summary.venue_chi_cents)} /&gt; |
| components/venue/BookingDetailModal.tsx:66 | const perHeadKickbackCents = readCents( | const perHeadKickbackCents = readCents( |
| components/venue/BookingDetailModal.tsx:67 | venue?.per_head_kickback_cents, | venue?.per_head_chi_cents, |
| components/venue/BookingDetailModal.tsx:68 | venue?.per_head_kickback_amount ?? venue?.per_head_kickback | venue?.per_head_chi_cents ?? venue?.per_head_chi_cents |
| components/venue/BookingDetailModal.tsx:375 | {venue?.bar_revenue_share_enabled && ( | {venue?.bar_consumption_share_enabled && ( |
| components/venue/BookingDetailModal.tsx:378 | &lt;span className="font-medium"&gt;{venue.bar_revenue_share_percent \|\| 0}%&lt;/span&gt; | &lt;span className="font-medium"&gt;{venue.bar_consumption_share_percent \|\| 0}%&lt;/span&gt; |
| components/venue/BookingDetailModal.tsx:381 | {(perHeadKickbackCents ?? 0) &gt; 0 && ( | {(perHeadKickbackCents ?? 0) &gt; 0 && ( |
| components/venue/BookingDetailModal.tsx:384 | &lt;span className="font-medium"&gt;{formatCents(perHeadKickbackCents ?? 0)}/guest&lt;/span&gt; | &lt;span className="font-medium"&gt;{formatCents(perHeadKickbackCents ?? 0)}/guest&lt;/span&gt; |
| components/admin/AdminCatalogConsole.tsx:264 | per_head_kickback_amount: null, | per_head_chi_cents: null, |

## Track E: Internal-Only References

Total occurrences: 14. Files affected: 3. Estimated PR size: small.

| path:line | reference | reason still needed |
| --- | --- | --- |
| lib/server/community-host-incentive/checkout.ts:791 | is_legacy_revenue_share: false, | delete with adapter or retain only behind compatibility boundary |
| lib/server/community-host-incentive/checkout.ts:891 | is_legacy_revenue_share: false, | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1377 | is_legacy_revenue_share: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1405 | is_legacy_revenue_share?: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1433 | is_legacy_revenue_share?: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1512 | is_legacy_revenue_share: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1534 | is_legacy_revenue_share?: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:1556 | is_legacy_revenue_share?: boolean | delete with adapter or retain only behind compatibility boundary |
| lib/types/database-generated.ts:9240 | is_legacy_revenue_share: boolean \| null | delete with adapter or retain only behind compatibility boundary |
| lib/finance/legacySettlementAdapter.ts:244 | .from('kickback_payments') | delete with adapter or retain only behind compatibility boundary |
| lib/finance/legacySettlementAdapter.ts:291 | is_legacy_revenue_share: false, | delete with adapter or retain only behind compatibility boundary |
| lib/finance/legacySettlementAdapter.ts:293 | source_table: 'event_kickback_agreements', | delete with adapter or retain only behind compatibility boundary |
| lib/finance/legacySettlementAdapter.ts:391 | is_legacy_revenue_share: false, | delete with adapter or retain only behind compatibility boundary |
| lib/finance/legacySettlementAdapter.ts:393 | source_table: 'event_kickback_agreements', | delete with adapter or retain only behind compatibility boundary |

## Decisions Needed

1. Choose schema naming style: full `community_host_incentive_*` names are clearer and already exist for CHI; concise `chi_*` names reduce length but make SQL less self-describing. Recommendation: full names for persisted schema, `Chi*` for TypeScript identifiers.
2. Decide whether public API compatibility should be maintained with deprecated aliases for one release. Recommendation: yes for request/response keys that may have external callers, with explicit TODO removal dates.
3. Decide preferred replacement for `bar_revenue_share_enabled`: `bar_consumption_chi_enabled` is descriptive; `bar_chi_enabled` is shorter. Recommendation: `bar_consumption_chi_enabled` in schema/API, `barChiEnabled` in TypeScript.
4. Decide how to treat historical migrations before 2026-06-01. The strict script excludes them by design; newer migrations remain subject to cleanup.
5. Confirm whether the legacy adapter should be deleted in Phase delta.5 or kept as a temporary compatibility shell after production call sites are migrated.

## Decisions Made Under Ambiguity

- The strict scanner is implemented as a separate script so the existing loose compliance command remains backward-compatible until the cleanup phases are complete.
- The audit classifies `app/api/**` matches as API contract risk even when the line is a DB key, because route-level request/response compatibility is the review concern.
- Generated database types are classified as TypeScript rename work, not schema work; the source schema migration remains the owner for DB renames.
- Pre-2026-06-01 migrations are excluded from the strict script but are still discussed here only when a newer view or generated type keeps the old language alive.
