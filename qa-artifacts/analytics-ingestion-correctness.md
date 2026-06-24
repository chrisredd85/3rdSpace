# Analytics Ingestion Correctness Audit

Date: 2026-06-24
Branch: `codex/analytics-ingestion-correctness`
Base: `origin/main` at `6da7307`

## Scope

Prompt 1 asked for verification and correctness hardening across ticketing ingestion and event analytics:

- Eventbrite historical import and webhook ingestion
- Posh and Luma webhook ingestion
- `event_sales_data` / `imported_attendees` normalization
- Ticket-tier classification and rollups
- Post-event report aggregation
- Planner analytics rendering inputs

Prompt 2 is intentionally not included here.

## Findings And Fixes

### 1. Ticket Tier Normalization

Source inspected:

- `lib/server/ticket-normalization.ts:36-44`
- `__tests__/integration/mvp-launch-contracts.test.ts:810-833`

Finding:

- The shared classifier already normalized common tiers like `Early Bird`, `GA`, and `VIP Table`, but did not classify plain `Bird` as `early_bird` or `Founder` tiers as `vip`.

Fix:

- Added `bird` to the `early_bird` pattern and `founder` to the `vip` pattern.
- Extended the MVP launch contract test to cover `Bird` and `Founder Circle`.

### 2. Refund Math In Rollups

Source inspected:

- `lib/server/ticket-normalization.ts:99-134`
- `app/api/planner/ticketing/analytics/route.ts:156-184`
- `supabase/migrations/20260624000000_fix_ticket_sales_rollup_refund_math.sql:6-78`

Finding:

- Refund rows were included in `gross_revenue_cents` by signed total amount. That made gross revenue shrink when refunds arrived and blurred the difference between sold revenue, refunded principal, and net revenue.

Fix:

- Gross revenue now counts non-refund rows only.
- Refund amount is tracked as `refund_amount_cents`.
- Net revenue is `gross - fees - refunds`.
- Average ticket price is `gross / tickets_sold`, not refund-adjusted net divided by remaining tickets.
- Added a replacement SQL view migration so `event_ticket_sales_rollups` matches the shared TypeScript rollup math.

### 3. Eventbrite Historical Event Listing

Source inspected:

- `lib/integrations/eventbrite/client.ts:191-224`
- `lib/integrations/eventbrite/client.ts:276-335`
- `lib/integrations/eventbrite/sync.ts:159-189`
- `__tests__/integration/eventbrite-oauth-webhook.test.ts:131-194`

Finding:

- Eventbrite event listing was capped to a first page of 10 events. This meant the import picker could omit older/past events before the user had a chance to select them.

Fix:

- Eventbrite organization event listing now follows pagination continuations.
- The backfill event list no longer slices the response to 10 events.
- Import execution remains selected and capped at 10 IDs per request. This is intentional: the host still chooses which events to import, and large imports can be run in batches rather than silently importing every event.

### 4. Provider Row Shape Consistency

Source inspected:

- `lib/integrations/eventbrite/sync.ts:949-997`
- `lib/server/eventbrite-import.ts:35-62`
- `lib/server/eventbrite-import.ts:122-166`
- `lib/server/ticket-webhooks.ts:766-876`
- `__tests__/integration/luma-webhook-normalization.test.ts:11-66`
- `lib/server/__tests__/eventbriteImport.test.ts:16-45`

Finding:

- Current Eventbrite OAuth/backfill and Posh webhook rows already carried provenance fields such as `source`, `received_at`, `gross_cents`, and `tier_name`.
- Luma webhook rows and the older Eventbrite import job did not consistently write those fields.
- The older Eventbrite import job upserted sales rows on `platform,order_id`, while the newer table constraint is `event_id,platform,order_id`.

Fix:

- Luma sales rows now write `source: 'luma_webhook'`, `received_at`, `gross_cents`, and `tier_name`.
- The older Eventbrite import job now writes `source: 'eventbrite_import'`, `received_at`, `gross_cents`, and `tier_name`.
- The older Eventbrite import job now upserts with `event_id,platform,order_id`.

### 5. Post-Event Report Aggregation

Source inspected:

- `app/api/planner/post-event/report/route.ts:137-205`
- `__tests__/planner/postEventReport.test.ts:101-126`

Finding:

- Post-event report gross/refund/net math was mostly correct, but average ticket price used refund-adjusted net revenue over net tickets. That made the average ticket price unstable after refunds.
- `venue_foot_traffic_proxy` existed but its fallback order was not documented.

Fix:

- Average ticket price now uses gross non-refund revenue divided by tickets sold.
- Added an inline comment documenting the foot-traffic proxy fallback: real check-ins, then imported attendee rows, then net sold tickets.

## Current Provider Coverage

| Provider | Historical Import | Webhook | Signature / Secret | Idempotency | Notes |
| --- | --- | --- | --- | --- | --- |
| Eventbrite | Yes, selected event import; event listing now paginates | Yes, queued through `webhook.eventbrite` | HMAC checked before enqueue | Delivery receipt + `event_id,platform,order_id` sales upsert | Import selection still capped at 10 event IDs per request. |
| Posh | No historical OAuth import in this pass | Yes, synchronous route / job helper | Configured secret checked before processing | `event_id,platform,order_id` sales upsert | Posh check-ins are not available; attendee rows default `checked_in=false`. |
| Luma | Poll helper exists, but webhook is the analytics writer | Yes, queued through `webhook.luma` | HMAC checked in job before processing | `event_id,platform,order_id` sales upsert | This pass aligned Luma sale provenance fields. |

## Analytics UI Inputs

Source inspected:

- `app/(planner)/planner/analytics/page.tsx:574-581`
- `app/(planner)/planner/analytics/page.tsx:594-649`

The planner analytics page composes three deterministic API sources:

- `/api/events/[eventId]/financials`
- `/api/planner/post-event/report`
- `/api/planner/ticketing/analytics`

No AI path generates the metrics directly. Ticket tier performance comes from `event_sales_data` via `/api/planner/ticketing/analytics`; attendance and check-in metrics come from `imported_attendees` via `/api/planner/post-event/report`.

## Tests Added Or Extended

- `__tests__/integration/mvp-launch-contracts.test.ts`
  - Added ticket tier classification for `Bird` and `Founder`.
  - Added refund rollup regression for gross/refund/net separation.
- `__tests__/integration/eventbrite-oauth-webhook.test.ts`
  - Added Eventbrite pagination regression for 52 events over two pages.
- `__tests__/integration/luma-webhook-normalization.test.ts`
  - Added Luma webhook normalization and idempotent upsert coverage.
- `lib/server/__tests__/eventbriteImport.test.ts`
  - Added provenance field assertions for older Eventbrite import rows.
- `__tests__/planner/postEventReport.test.ts`
  - Added average ticket price assertion after refunds.

## Validation

Executed locally in `/Users/chrisredd/3rdSpace.analytics-ingestion-audit`:

```bash
npm ci
npm test -- __tests__/planner/postEventReport.test.ts __tests__/integration/eventbrite-oauth-webhook.test.ts __tests__/integration/luma-webhook-normalization.test.ts lib/server/__tests__/eventbriteImport.test.ts __tests__/integration/mvp-launch-contracts.test.ts --runInBand
npm run type-check -- --pretty false
npm run lint
npm run build
npx supabase db reset
npm test -- --runInBand
```

Results:

- Focused provider/report/MVP tests: 5 suites / 21 tests passed.
- Type-check passed.
- Lint passed with existing unrelated React hook dependency warnings.
- Build passed after copying local `.env.local` into the clean worktree for validation-only Supabase/Sentry environment access.
- Local Supabase `db reset` passed after replaying all migrations through `20260624000000_fix_ticket_sales_rollup_refund_math.sql`.
- Full Jest passed: 184 suites passed, 1 suite skipped, 957 tests passed, 9 tests skipped.

## Remaining Non-Blocking Notes

- Eventbrite event import remains explicitly selected and capped at 10 selected IDs per request. This is a product/ops guard, not a correctness bug.
- Luma has a polling helper, but analytics writes currently come from the webhook/job path.
- Posh has no reliable check-in signal, so check-in analytics require Eventbrite/Luma/other attendee imports or manual source data.
