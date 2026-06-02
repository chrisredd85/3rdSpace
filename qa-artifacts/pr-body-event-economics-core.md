## Summary

Ships the event economics core as a narrowed PR from current `origin/main`:

- Cost commitments schema and planner APIs/UI
- Revenue terms schema, calculation helpers, and planner APIs/UI
- Live event P&L snapshot, deterministic triggers, live recommendations, and economics-agent live/post-event modes
- Event import wizard for CSV, screenshot extraction, and finalization
- Eventbrite OAuth/backfill/webhook ingestion
- Posh org webhook setup, event linking, quarantine inbox, and ticketing webhook ingestion
- Receipt upload/extraction support for cost evidence

No outreach sender, Gmail/Twilio autonomy, marketing copy, signup-flow, or unrelated webhook-hardening work is included.

## Scope Audit Outcome

Audit artifact: `qa-artifacts/codex-step2-scope-audit.md`

Per-class counts from the pre-PR audit:

| Class | Count |
| --- | ---: |
| in-scope | 65 |
| infrastructure | 5 |
| already-landed | 9 |
| scope-creep | 7 |

Final narrowed diff intentionally includes the in-scope set plus required infrastructure. Two type-only catalog route hunks were initially treated as scope-creep, but `npm run type-check` proved they are required by the generated Supabase typing change, so they are included as dependency fallout:

- `app/api/vendors/route.ts`: type-only return/cast shim; no behavior change
- `app/api/venues/route.ts`: type-only return/cast shim; no behavior change

Additional validation fix included:

- `__tests__/security/rls.test.ts`: updates the vendor profile expectation to match the already-merged PR #18 visibility policy.

Scope-creep excluded:

- `app/api/webhooks/stripe/route.ts`: webhook hardening only; no event-economics hookup
- `lib/outreach/commitmentHook.ts`
- `lib/outreach/__tests__/commitment-hook.test.ts`
- stale source-branch QA reports: `qa-artifacts/feature-core-split-report.md`, `qa-artifacts/verification-report.md`

Already-landed exclusions:

- PR #16 RLS baseline, recursion fix, RLS checker, RLS workflow
- PR #18 vendor profile visibility migration `20260602000009`
- `package.json` source-branch diff, because it would remove the already-merged `security:rls` and `check` scripts

## Migrations

- `20260602000002_add_event_cost_commitments.sql`: adds `event_cost_commitments`, lifecycle state, evidence fields, scope validation, RLS policies.
- `20260602000003_add_event_evidence_bucket.sql`: adds private `event-evidence` storage bucket with service-role storage policy.
- `20260602000004_add_posh_org_ticketing_mapping.sql`: adds Posh event mapping, ticketing connection heartbeat fields, event sales fields, `unlinked_ticket_events`, and Posh fee commitment idempotency.
- `20260602000005_add_eventbrite_oauth_backfill.sql`: adds Eventbrite event mapping, field-confidence metadata, webhook tracking, and `api_import` commitment source.
- `20260602000006_add_event_import_wizard.sql`: adds `event_import_sessions` and field-confidence columns for staged imports.
- `20260602000007_add_event_revenue_terms.sql`: adds `event_revenue_terms`, scope validation, and RLS policies.
- `20260602000008_add_live_recommendations.sql`: adds `live_recommendations`, scope validation, RLS policies, and realtime publication.

## RLS Posture

Every new public table introduced by migrations `00002`-`00008` has RLS enabled and policies:

- `event_cost_commitments`: owner/org-scoped select/insert/update; service role through helper.
- `unlinked_ticket_events`: builder-scoped select/update plus service-role manage policy.
- `event_import_sessions`: builder-scoped select/insert/update plus service-role manage policy.
- `event_revenue_terms`: owner/org-scoped select/insert/update/delete.
- `live_recommendations`: owner/org-scoped select/insert/update/delete.

`event-evidence` is a private storage bucket with service-role-only object management.

No migration redefines the PR #16/#18 policies on `events`, `vendor_bookings`, `vendor_profiles`, or `webhook_rate_limits`.

## API Routes

- `GET/POST /api/planner/events/[eventId]/commitments`: authenticated builder access; writes scoped by event ownership and table RLS.
- `PATCH/DELETE /api/planner/events/[eventId]/commitments/[commitmentId]`: authenticated builder access; scoped by event ownership and table RLS.
- `GET/PATCH /api/planner/events/[eventId]/live`: authenticated builder access; reads/writes live recommendation state.
- `POST /api/planner/events/[eventId]/receipts`: authenticated builder access; uploads private evidence and creates cost commitments.
- `GET/POST/PATCH/DELETE /api/planner/events/[eventId]/revenue-terms`: authenticated builder access; scoped by event ownership and table RLS.
- `POST /api/planner/events/import`: authenticated builder import session creation.
- `POST /api/planner/events/import/[importId]/csv`: authenticated builder CSV staging.
- `POST /api/planner/events/import/[importId]/screenshot`: authenticated builder screenshot extraction staging.
- `POST /api/planner/events/import/[importId]/finalize`: authenticated builder import finalization.
- `GET/POST/DELETE /api/planner/integrations/posh`: authenticated builder Posh setup/link/disconnect.
- `GET/POST /api/integrations/eventbrite/backfill`: authenticated builder Eventbrite event list/import.
- `POST /api/integrations/eventbrite/connect` and `GET /api/integrations/eventbrite/callback`: authenticated builder OAuth setup.
- `POST /api/webhooks/eventbrite`: signature-verified, rate-limited webhook receiver that queues processing.
- `POST /api/webhooks/posh`: secret-verified, rate-limited webhook receiver that records heartbeat and imports ticketing data.
- `POST /api/internal/jobs/live-event-recompute`: worker/admin authorized recompute route.
- `POST /api/internal/jobs/run`: worker/admin dispatcher extended for Eventbrite webhook and live recompute jobs.

## Env Vars

New/changed production provisioning asks:

- `EVENTBRITE_WEBHOOK_SECRET`: optional fallback signing secret for Eventbrite webhooks. Per-connection secrets are encrypted/stored; this is still useful as the platform fallback.

Optional tuning env vars read by finance defaults:

- `POSH_DEFAULT_SERVICE_FEE_RATE`
- `EVENTBRITE_DEFAULT_SERVICE_FEE_RATE`

Existing env dependencies remain:

- `EVENTBRITE_CLIENT_ID`
- `EVENTBRITE_CLIENT_SECRET`
- `EVENTBRITE_OAUTH_REDIRECT_URI`
- `POSH_WEBHOOK_SECRET`
- Supabase keys
- `OPENAI_API_KEY` for screenshot/receipt/economics model calls

## Approval-Gate Invariant

This PR does not add a booking, payment, or outbound-message execution path. It ingests ticketing data, imports attendance/sales rows, stores cost/revenue facts, uploads evidence, and creates/updates recommendation records.

The economics agent remains advisory. The prompt explicitly forbids database reads, outreach sends, bookings, payment authorization, and action execution. Live triggers can suggest upgrades or spend controls, but do not execute spend. Any new spend remains subject to the existing approval/payment flow outside this PR.

## Rollback

Mostly additive rollback:

- Drop new tables: `live_recommendations`, `event_revenue_terms`, `event_import_sessions`, `unlinked_ticket_events`, `event_cost_commitments`.
- Remove added columns/indexes from `events`, `event_sales_data`, `imported_attendees`, and `builder_ticketing_connections`.
- Remove `event-evidence` storage bucket after deleting any stored objects.
- Remove realtime publication entries for `live_recommendations` and `event_sales_data`.

Data caveats:

- Imported ticketing rows, evidence objects, and cost/revenue records would be lost if rolled back by dropping tables/bucket.
- Reverting the expanded `event_cost_commitments.source` constraint requires deleting or remapping `api_import` rows first.

## Audience Impact

No real external users are currently onboarded. This adds planner finance/ticketing surfaces and backend ingestion without changing public marketplace visibility or publish readiness gating.

## Validation

- `npm install`: passed. npm reported existing audit vulnerabilities.
- `npm run type-check`: passed after keeping the two required type-only catalog route shims.
- `supabase db reset`: passed with migrations through `20260602000009`.
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand`: passed, 9 tests.
- `npm run security:rls`: passed.
- Targeted tests passed:
  - `__tests__/integration/eventbrite-oauth-webhook.test.ts`
  - `__tests__/integration/live-event-dashboard-route.test.ts`
  - `__tests__/integration/posh-webhook-route.test.ts`
  - `lib/finance/__tests__/`
  - Combined result: 8 suites, 36 tests.
- `npm test`: first run hit one unrelated timeout in `venue-payouts-rental-ui.test.tsx`; isolated rerun passed. Full rerun passed: 93 suites passed, 1 skipped; 564 tests passed, 9 skipped.
- `npm run lint`: passed with existing hook-dependency warnings.
- `npm run build`: initial run failed because local shell lacked Supabase env vars; rerun with local Supabase envs passed.

Dev smoke:

- `/planner`: 200.
- `/planner/events/00000000-0000-0000-0000-000000001075/live`: 307 to login when unauthenticated, expected for planner routes.
- `/api/health`: 404 because this checkout does not currently define `app/api/health/route.ts`; no health route was added in this economics PR.
