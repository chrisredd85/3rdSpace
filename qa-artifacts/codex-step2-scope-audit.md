# Codex Step 2 Scope Audit

Source branch: `feat/event-economics-core@3b76094`
Compared against: `origin/main`

## Counts

| Class | Count |
| --- | ---: |
| in-scope | 65 |
| infrastructure | 5 |
| already-landed | 9 |
| scope-creep | 7 |

## File Classification

| Path | Class | One-line reason |
| --- | --- | --- |
| `.env.example` | infrastructure | Adds `EVENTBRITE_WEBHOOK_SECRET`, an environment variable needed by Eventbrite webhook handling. |
| `.github/workflows/rls-checks.yml` | already-landed | Branch predates PR #16 and would delete the merged RLS workflow. |
| `__tests__/integration/eventbrite-oauth-webhook.test.ts` | in-scope | Covers Eventbrite OAuth/webhook behavior for ticketing import. |
| `__tests__/integration/live-event-dashboard-route.test.ts` | in-scope | Covers live P&L dashboard API behavior. |
| `__tests__/integration/posh-webhook-route.test.ts` | in-scope | Covers Posh webhook processing and ticketing import behavior. |
| `__tests__/security/rls.test.ts` | already-landed | Branch predates PR #16 and would delete the merged RLS regression suite. |
| `app/(planner)/planner/events/[eventId]/costs/page.tsx` | in-scope | Adds planner event cost commitments UI route. |
| `app/(planner)/planner/events/[eventId]/live/page.tsx` | in-scope | Adds live event P&L dashboard route. |
| `app/(planner)/planner/events/[eventId]/report/page.tsx` | in-scope | Adds post-event report route from imported sales and attendance data. |
| `app/(planner)/planner/events/[eventId]/revenue-terms/page.tsx` | in-scope | Adds event revenue terms UI route. |
| `app/(planner)/planner/events/import/page.tsx` | in-scope | Adds planner event import wizard route. |
| `app/(planner)/planner/integrations/eventbrite/page.tsx` | in-scope | Adds Eventbrite ticketing integration setup/backfill route. |
| `app/(planner)/planner/integrations/posh/page.tsx` | in-scope | Adds Posh ticketing integration setup route. |
| `app/api/integrations/eventbrite/backfill/route.ts` | in-scope | Adds authenticated Eventbrite event list/import backfill API. |
| `app/api/integrations/eventbrite/callback/route.ts` | in-scope | Refactors Eventbrite OAuth callback for builder-scoped connection, webhook URL, and revenue-term seeding. |
| `app/api/integrations/eventbrite/connect/route.ts` | in-scope | Refactors Eventbrite OAuth initiation for account-level ticketing connection. |
| `app/api/internal/jobs/live-event-recompute/route.ts` | in-scope | Adds worker/admin route for live recommendation recomputation. |
| `app/api/internal/jobs/run/route.ts` | in-scope | Adds live recompute and Eventbrite webhook jobs to the worker dispatcher. |
| `app/api/planner/events/[eventId]/commitments/[commitmentId]/route.ts` | in-scope | Adds event cost commitment update/delete API. |
| `app/api/planner/events/[eventId]/commitments/route.ts` | in-scope | Adds event cost commitment list/create API. |
| `app/api/planner/events/[eventId]/live/route.ts` | in-scope | Adds live P&L dashboard API. |
| `app/api/planner/events/[eventId]/receipts/route.ts` | in-scope | Adds receipt upload/extraction API for event costs. |
| `app/api/planner/events/[eventId]/revenue-terms/route.ts` | in-scope | Adds revenue term list/create/update/delete API. |
| `app/api/planner/events/import/[importId]/csv/route.ts` | in-scope | Adds CSV import mapping API. |
| `app/api/planner/events/import/[importId]/finalize/route.ts` | in-scope | Adds finalization API for staged event imports. |
| `app/api/planner/events/import/[importId]/screenshot/route.ts` | in-scope | Adds screenshot import extraction API. |
| `app/api/planner/events/import/route.ts` | in-scope | Adds event import session create/list API. |
| `app/api/planner/integrations/posh/route.ts` | in-scope | Adds authenticated Posh secret, disconnect, and event-link API. |
| `app/api/vendors/route.ts` | scope-creep | Type-only catalog route shim caused by global Supabase typing; not event economics. |
| `app/api/venues/route.ts` | scope-creep | Type-only catalog route shim caused by global Supabase typing; not event economics. |
| `app/api/webhooks/eventbrite/route.ts` | in-scope | Adds Eventbrite webhook receiver for ticketing import. |
| `app/api/webhooks/posh/route.ts` | in-scope | Updates Posh webhook processing, secret verification, heartbeat, and direct ticket import handling. |
| `app/api/webhooks/stripe/route.ts` | scope-creep | Reorders Stripe rate limiting after signature verification; useful hardening but not event-economics scope. |
| `components/planner/CostsTab.tsx` | in-scope | Adds planner cost commitments UI. |
| `components/planner/CsvColumnMapper.tsx` | in-scope | Adds CSV import column mapping UI. |
| `components/planner/EventImportWizard.tsx` | in-scope | Adds event import wizard UI. |
| `components/planner/EventbriteBackfillWizard.tsx` | in-scope | Adds Eventbrite backfill selection and verification UI. |
| `components/planner/LiveAgentFeed.tsx` | in-scope | Adds live economics agent recommendation feed UI. |
| `components/planner/LiveEventDashboard.tsx` | in-scope | Adds live event P&L dashboard UI. |
| `components/planner/PlannerTicketingConnectPanel.tsx` | in-scope | Routes planner ticketing panel into Eventbrite/Posh/import flows. |
| `components/planner/PoshConnectWizard.tsx` | in-scope | Adds Posh webhook setup and event-link UI. |
| `components/planner/ReceiptUploadModal.tsx` | in-scope | Adds receipt upload UI for cost evidence extraction. |
| `components/planner/RevenueTermsTab.tsx` | in-scope | Adds event revenue terms UI. |
| `components/planner/__tests__/EventbriteBackfillWizard.test.tsx` | in-scope | Covers Eventbrite backfill UI behavior. |
| `lib/ai/agents/economicsAgent.ts` | in-scope | Extends economics agent with live and post-event modes. |
| `lib/ai/agents/eventScreenshotAgent.ts` | in-scope | Adds screenshot extraction agent for event import metrics. |
| `lib/ai/agents/receiptExtractionAgent.ts` | in-scope | Adds receipt extraction agent for event cost evidence. |
| `lib/finance/__tests__/costCommitments.test.ts` | in-scope | Covers cost commitment finance logic. |
| `lib/finance/__tests__/eventActuals.test.ts` | in-scope | Covers actual P&L aggregation logic. |
| `lib/finance/__tests__/liveTriggers.test.ts` | in-scope | Covers deterministic live trigger logic. |
| `lib/finance/__tests__/revenueTerms.test.ts` | in-scope | Covers revenue term calculations. |
| `lib/finance/costCommitments.ts` | in-scope | Adds event cost commitment schemas and helpers. |
| `lib/finance/eventActuals.ts` | in-scope | Adds event actuals aggregation and P&L calculations. |
| `lib/finance/liveRecommendations.ts` | in-scope | Adds live recommendation generation and persistence. |
| `lib/finance/liveTriggers.ts` | in-scope | Adds deterministic live P&L trigger evaluation. |
| `lib/finance/revenueTerms.ts` | in-scope | Adds event revenue term schemas, calculations, and platform defaults. |
| `lib/integrations/csv/__tests__/parse.test.ts` | in-scope | Covers CSV parser used by event import wizard. |
| `lib/integrations/csv/parse.ts` | in-scope | Adds CSV parsing for event import. |
| `lib/integrations/eventbrite/client.ts` | in-scope | Adds Eventbrite API/OAuth/webhook signature client helpers. |
| `lib/integrations/eventbrite/sync.ts` | in-scope | Adds Eventbrite event/order/attendee import and webhook sync logic. |
| `lib/integrations/poshLink.ts` | in-scope | Adds Posh org connection, event-link, heartbeat, and quarantine helpers. |
| `lib/integrations/scrape/eventPage.ts` | in-scope | Adds event-page scraping helper for import wizard. |
| `lib/outreach/__tests__/commitment-hook.test.ts` | scope-creep | Outreach reply hook test belongs to phase-5 outreach, even though it writes commitments. |
| `lib/outreach/commitmentHook.ts` | scope-creep | Outreach reply hook belongs to phase-5 outreach, not this economics core PR. |
| `lib/server/job-queue.ts` | in-scope | Adds live recompute and Eventbrite webhook job types. |
| `lib/server/ticket-webhooks.ts` | in-scope | Extends ticket webhook processing for Posh event linking, sales fields, and platform-fee commitments. |
| `lib/supabase/client.ts` | infrastructure | Switches Supabase client typing to generated database types; required only if narrowed branch keeps this typing strategy. |
| `lib/supabase/server.ts` | infrastructure | Switches Supabase server client typing to generated database types; required only if narrowed branch keeps this typing strategy. |
| `lib/supabase/types.ts` | infrastructure | Adds shared Supabase DB type aliases used by new helpers. |
| `lib/types/database-generated.ts` | infrastructure | Generated DB types must be regenerated from the narrowed migration set, not copied blindly. |
| `package.json` | already-landed | Branch predates PR #16 and would delete merged `security:rls`/`check` scripts. |
| `qa-artifacts/feature-core-split-report.md` | scope-creep | Stale split report from prior branch state, not a required product or validation artifact. |
| `qa-artifacts/pr-body-restrict-unpublished-vendor-profiles.md` | already-landed | Branch predates PR #18 and would delete the merged Branch B PR artifact. |
| `qa-artifacts/pr-body-rls-baseline-and-recursion-fix.md` | already-landed | Branch predates PR #16 and would delete the merged Branch A PR artifact. |
| `qa-artifacts/verification-report.md` | scope-creep | Stale verification report from prior branch state; should be replaced by fresh narrowed-branch validation. |
| `scripts/security/check-rls.ts` | already-landed | Branch predates PR #16 and would delete the merged RLS checker. |
| `supabase/migrations/20260602000000_enable_rls_security_baseline.sql` | already-landed | Branch predates PR #16 and would delete the merged RLS baseline migration. |
| `supabase/migrations/20260602000001_fix_events_collaborators_rls_recursion.sql` | already-landed | Branch predates PR #16 and would delete the merged recursion-fix migration. |
| `supabase/migrations/20260602000002_add_event_cost_commitments.sql` | in-scope | Adds event cost commitments table, helper, triggers, and RLS. |
| `supabase/migrations/20260602000003_add_event_evidence_bucket.sql` | in-scope | Adds private event evidence storage bucket/policy for receipts. |
| `supabase/migrations/20260602000004_add_posh_org_ticketing_mapping.sql` | in-scope | Adds Posh mapping, webhook heartbeat fields, sales fields, and quarantine table. |
| `supabase/migrations/20260602000005_add_eventbrite_oauth_backfill.sql` | in-scope | Adds Eventbrite event mapping, confidence metadata, and API import source support. |
| `supabase/migrations/20260602000006_add_event_import_wizard.sql` | in-scope | Adds import sessions and field confidence metadata for staged event imports. |
| `supabase/migrations/20260602000007_add_event_revenue_terms.sql` | in-scope | Adds event revenue terms table, triggers, helper, and RLS. |
| `supabase/migrations/20260602000008_add_live_recommendations.sql` | in-scope | Adds live recommendations table, triggers, helper, RLS, and realtime publication. |
| `supabase/migrations/20260602000009_restrict_unpublished_vendor_profiles.sql` | already-landed | Branch predates PR #18 and would delete the merged vendor profile visibility migration. |

## Migration Overlap Notes

- `20260602000002_add_event_cost_commitments.sql` references `events` only through foreign keys and trigger validation. It creates policies only on the new `event_cost_commitments` table.
- `20260602000003_add_event_evidence_bucket.sql` creates a storage bucket and storage policy only for `event-evidence`.
- `20260602000004_add_posh_org_ticketing_mapping.sql` adds `events.posh_event_id`, ticketing/sales columns, `event_cost_commitments.source_ref`, and the new `unlinked_ticket_events` table/policies. It does not redefine #16/#18 policies.
- `20260602000005_add_eventbrite_oauth_backfill.sql` adds `events.eventbrite_event_id`, `events.field_confidence`, ticketing connection columns, and expands the `event_cost_commitments.source` check. It does not redefine #16/#18 policies.
- `20260602000006_add_event_import_wizard.sql` adds field confidence columns and the new `event_import_sessions` table/policies. It does not redefine #16/#18 policies.
- `20260602000007_add_event_revenue_terms.sql` creates policies only on the new `event_revenue_terms` table.
- `20260602000008_add_live_recommendations.sql` creates policies only on the new `live_recommendations` table.
- `20260602000009_restrict_unpublished_vendor_profiles.sql` is not present in the source branch file list; it appears only as a deletion versus `origin/main` because PR #18 has already merged.

## Split Recommendations

- Exclude all `already-landed` files from the narrowed branch.
- Split out `lib/outreach/commitmentHook.ts` and its test into the phase-5 outreach series. The schema can keep `outreach_reply` as a source value, but the reply-processing hook should not ship in the economics core PR.
- Exclude `app/api/webhooks/stripe/route.ts` unless the user explicitly wants a separate webhook-hardening change in this PR.
- Exclude stale QA artifacts and replace them with fresh narrowed-branch PR body/validation artifacts.
- Treat `app/api/vendors/route.ts` and `app/api/venues/route.ts` as type-refactor fallout. Prefer excluding them unless the narrowed branch type-check shows they are required by the generated Supabase typing change.
- Keep `.env.example`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/types.ts`, and regenerated `lib/types/database-generated.ts` only if the narrowed branch needs them after applying the event-economics files.
