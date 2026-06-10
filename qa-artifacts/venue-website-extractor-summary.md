# Venue Website Email Extractor

## Scope

Adds a dormant venue website contact extraction layer for discovery venues:

- Additive `discovery_venues` columns for extracted public contact emails, extraction status, metadata, attempt count, and last attempt time.
- `lib/server/venue-website-extractor.ts` functional core for polite public website fetching, robots.txt handling, email extraction, confidence scoring, and booking-contact marking.
- `lib/ai/agents/contactDisambiguationAgent.ts` for GPT-4o-mini booking-contact ranking when multiple emails are found.
- `lib/server/discovery-enrichment.ts` helper seam so callers can prefer a Places-provided email and otherwise use cached extracted emails.
- `app/api/internal/jobs/venue-website-extraction/route.ts` internal worker/admin route to process queued discovery venues in batches.
- Focused Jest coverage for extraction, robots parsing, rate limiting, timeout behavior, discovery helpers, and contact disambiguation.

This PR does not send outreach, book, pay, import, or perform any external action on behalf of a host. It only caches public contact candidates for later approval-gated outreach workflows.

## Migration

Migration: `supabase/migrations/20260615000000_add_venue_website_extraction.sql`

The prompt referenced `website_url`, but current `discovery_venues` schema uses `website`. The migration index and code intentionally use `website`.

Rollback SQL:

```sql
DROP INDEX IF EXISTS public.idx_discovery_venues_extraction_pending;

ALTER TABLE public.discovery_venues
  DROP COLUMN IF EXISTS extracted_emails,
  DROP COLUMN IF EXISTS website_extraction_attempted_at,
  DROP COLUMN IF EXISTS website_extraction_status,
  DROP COLUMN IF EXISTS website_extraction_metadata,
  DROP COLUMN IF EXISTS website_extraction_attempts;
```

No new table is introduced, so no new RLS policy is required. Existing `discovery_venues` RLS remains in force.

## Coordination

This branch was created from current `origin/main` at `7c50172b99e32d983966a1f7da704a82384c53fd`.

After implementation, `git fetch origin` confirmed `origin/main` still points to `7c50172b99e32d983966a1f7da704a82384c53fd`; no CHI Phase gamma/delta merge landed during this work. File scope remains separate from the in-flight CHI settlement branch.

## Compliance

- Identified User-Agent: `3rdPlace-Venue-Inquiry-Bot/1.0 (+https://www.3rdplace.io/bot-info)`.
- Respects `robots.txt`; missing or failed robots fetch proceeds, explicit disallow blocks paths.
- Per-domain in-memory rate limit: max one request per second.
- Per-request timeout: 8 seconds.
- Per-venue total budget: 30 seconds.
- Retries transient network/5xx failures; does not retry 404 or 429.
- Filters obvious junk addresses such as example/test/no-reply/webmaster and fixture domains.
- Unexpected extraction, disambiguation, query, and update failures are captured in Sentry with scoped tags and non-sensitive identifiers.
- No `vercel.json` cron entry added; route is dormant until scheduled in a later activation PR.
- `OUTREACH_AUTONOMOUS_ENABLED` must be exactly `true`, otherwise the route returns a skip response without extraction.

Expected impact: roughly doubles the reachable-venue rate for outreach by filling website-derived public contacts when Places does not provide an email.

## Validation

- `npm ci` passed.
- `npm run type-check` passed.
- `npm run lint` passed with existing unrelated hook dependency warnings.
- `npm run build` passed with `.env.local` loaded via dotenv.
- `supabase db reset` passed and applied `20260615000000_add_venue_website_extraction.sql`.
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed.
- `npm run security:rls` passed.
- `npm run security:tied-house` passed.
- `npm test -- lib/server/__tests__/venue-website-extractor.test.ts lib/server/__tests__/discovery-enrichment.test.ts --runInBand` passed.
- `npm test -- lib/ai/agents/__tests__/contactDisambiguationAgent.test.ts --runInBand` passed.
- `npm test` passed: 134 suites passed, 1 skipped; 720 tests passed, 9 skipped.
- `npm run eval:outreach` passed on fixture provider.

Dev smoke:

- `POST /api/internal/jobs/venue-website-extraction` without auth returned `401 {"error":"Unauthorized"}`.
- `POST /api/internal/jobs/venue-website-extraction` with worker auth and `OUTREACH_AUTONOMOUS_ENABLED=false` returned `200 {"skipped":true,"reason":"outreach_autonomy_disabled"}`.

## Activation Note

Recommend activating in the later outreach activation PR by adding the cron schedule there, so scraper activation and outreach activation remain one reviewed operational decision.
