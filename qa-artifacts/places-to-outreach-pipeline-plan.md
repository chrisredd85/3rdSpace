# Google Places to Outreach Pipeline Audit

Branch: `codex/places-outreach-pipeline-audit`  
Base: `origin/main` at `4ca59b7 chore(planner): remove experiences prototype route (#80)`  
Scope: read-only audit document. No production code, schema, or route changes are included in this PR.

## 1. Current Places State

There is no application code on `origin/main` that calls Google Places today.

Evidence:

- `.env.example:63` defines `GOOGLE_PLACES_API_KEY=your_google_places_api_key`, but no route/helper consumes it.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:29-31` defines `source`, `source_external_id`, and Google rating columns.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:42-43` allows `source='google_places'`.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:73-74` documents `source_external_id` as a provider id such as a Google Places id.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:80-81` provides a unique index on `(source, source_external_id)` for idempotent provider imports.
- Repo search for `places.googleapis`, `maps.googleapis`, and `GOOGLE_PLACES_API_KEY` found no runtime caller.

Existing discovery/contact pieces:

- `lib/server/discovery-enrichment.ts:29-53` resolves contact emails from either a direct `contact_email` or cached website `extracted_emails`.
- `lib/server/discovery-enrichment.ts:55-61` decides whether a discovery row should be queued for website extraction.
- `app/api/internal/jobs/venue-website-extraction/route.ts:46-59` exposes the extraction job behind worker/admin auth and `OUTREACH_AUTONOMOUS_ENABLED`.
- `app/api/internal/jobs/venue-website-extraction/route.ts:60-66` loads `discovery_venues` rows with website/extraction state.
- `app/api/internal/jobs/venue-website-extraction/route.ts:112-125` calls `extractVenueContacts()` and writes extraction results back to `discovery_venues`.

Conclusion: the schema and website extraction layer are ready for Places-sourced rows, but the app still needs a server-side Places search route and persistence layer.

## 2. Minimum Places API Surface

Recommendation: use **Places API (New) Text Search** as the MVP entrypoint.

Why Text Search:

- Planner prompts naturally produce query text such as `bars in the Mission San Francisco`.
- Text Search can return enough top-of-funnel business data for discovery: display name, address, type, website, phone, rating, location, and business status.
- Nearby Search requires lat/lng radius plumbing that the planner does not always have.
- Place Details is useful after a selected candidate exists, but it is not needed for the first discovery pass if Text Search requests the exact fields used by the UI.

Important product fact: Google Places does **not** return business email addresses. Email resolution must remain a second step:

1. Text Search returns `websiteUri`.
2. Existing website extraction visits the venue website/contact pages and extracts candidate emails.
3. Organizer-provided manual email paste covers venues whose websites do not expose email.

## 3. Field Mask Spec

Use this field mask for Text Search:

```text
places.id,
places.displayName,
places.formattedAddress,
places.primaryType,
places.types,
places.location,
places.websiteUri,
places.nationalPhoneNumber,
places.rating,
places.userRatingCount,
places.priceLevel,
places.businessStatus
```

Do not request reviews or photos for MVP. Do not request `places.emailAddress`; it is not a valid Places field and Google Places does not provide business emails.

Implementation note: validate `GOOGLE_PLACES_API_KEY` at the search route entrypoint, not at global app boot.

## 4. `gmail_approved_outreach` Payload Shape

Current Gmail approval path is usable once targets are known.

Creation path:

- `app/api/planner/outreach/gmail-approval/route.ts:21-30` validates `targets`, `subject`, and `bodyText`.
- `app/api/planner/outreach/gmail-approval/route.ts:44-69` creates an approval through `createOrReuseGmailOutreachApproval()`.
- `lib/outreach/gmailApprovalFlow.ts:118-139` loads the connected Gmail account and builds the action payload.
- `lib/outreach/gmailApprovalFlow.ts:180-197` inserts an `agent_actions` row with `action_type='email'`, `provider='Gmail'`, `target_type='venue'`, and `payload_json`.
- `lib/outreach/gmailApprovalFlow.ts:211-219` inserts the pending `approvals` row.
- `lib/outreach/gmailApprovalFlow.ts:227-235` inserts a planner `approval_request` message.

Execution path:

- `lib/outreach/gmailApprovalFlow.ts:250-262` rejects actions whose payload kind is not `gmail_approved_outreach`.
- `lib/outreach/gmailApprovalFlow.ts:267-284` sends through Gmail only after approval execution.
- `lib/outreach/gmailApprovalFlow.ts:286-316` records `outreach_threads` and outbound `outreach_messages`.
- `lib/outreach/gmailApprovalFlow.ts:325-338` inserts a status update with `outbound_message_sent: true`.
- `lib/outreach/gmailApprovalFlow.ts:348-372` syncs Gmail replies back into 3rdPlace.
- `lib/outreach/gmail.ts:65-69` requests Gmail send, readonly, and modify scopes.
- `lib/outreach/gmail.ts:187-219` sends Gmail messages.
- `lib/outreach/gmail.ts:221-241` reads Gmail thread messages.
- `lib/outreach/gmail.ts:243-268` modifies Gmail thread labels.

Payload fields required for the existing send path:

```ts
{
  kind: 'gmail_approved_outreach',
  targets: Array<{ name: string; email: string }>,
  subject: string,
  body_text: string
}
```

Tests confirm template substitution:

- `__tests__/outreach/gmailApprovalFlow.test.ts:202-210` builds a payload containing `{{venue_name}}` and `{{sender_email}}`.
- `__tests__/outreach/gmailApprovalFlow.test.ts:255-269` asserts Gmail send bodies include concrete venue names and no unresolved template tokens.
- `__tests__/outreach/gmailApprovalFlow.test.ts:276-285` directly tests `renderBodyForTarget()`.

## 5. `discovery_venues` Plan Association

`discovery_venues` is global supply today, not plan-scoped.

Existing links:

- `supabase/migrations/20260601000001_add_discovery_venues.sql:6-41` defines the global `discovery_venues` table.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:108-121` adds `target_source` and `discovery_venue_id` to `outreach_threads`, which links sent outreach back to a discovery venue after sending.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:126-153` defines `discovery_venue_signals`, which can track outcomes for discovery rows.
- `supabase/migrations/20260601000001_add_discovery_venues.sql:154-167` defines `discovery_venue_events`, which is an audit trail but not a plan-selection relationship.
- `supabase/migrations/20260601000002_add_multichannel_outreach.sql:96-119` defines `venue_contact_profiles` with optional `discovery_venue_id`, useful for contact methods but not plan membership.

Recommendation: add a dedicated join table in Phase 2:

```sql
CREATE TABLE public.plan_discovery_venue_candidates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  discovery_venue_id uuid not null references public.discovery_venues(id) on delete cascade,
  searched_by_user_id uuid not null references public.users(id) on delete cascade,
  search_query text not null,
  archetype_id text,
  neighborhood text,
  fit_score integer,
  status text not null default 'candidate',
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, discovery_venue_id)
);
```

Why not a `plan_id` column on `discovery_venues`:

- The same venue can be discovered by multiple organizers/plans.
- `discovery_venues` should remain the global cold-supply catalog.
- A join table gives a natural place for per-plan dismissal, search query, fit score, and RLS.

## 6. Existing Ranker Integration

Prompt mismatch: the original prompt referenced `lib/planner/venueDiscoveryRanker.ts`, which does not exist on `origin/main`. This audit uses the approved substitutes:

- `lib/planner/catalogRanker.ts`
- `lib/venues/venueRanker.ts`

Do not create a new ranker seam in the audit PR.

### `catalogRanker.ts`

API shape:

- `lib/planner/catalogRanker.ts:12-37` defines `CatalogPlanRankingInput`.
- `lib/planner/catalogRanker.ts:39-45` defines venue/vendor ranking input rows as `Record<string, unknown> & { id: string }`.
- `lib/planner/catalogRanker.ts:47-59` defines `RankedCatalogRecommendation`.
- `lib/planner/catalogRanker.ts:61-65` defines `CatalogRankingResult`.
- `lib/planner/catalogRanker.ts:161-193` exports `rankCatalogPartners()`.

Venue scoring inputs:

- `lib/planner/catalogRanker.ts:199-239` ranks a venue using plan, venue row, archetype, and builder attendance.
- `lib/planner/catalogRanker.ts:502-515` reads capacity and returns `null` when none exists.
- `lib/planner/catalogRanker.ts:517-543` estimates venue cost and returns `0` when no price signal exists.
- `lib/planner/catalogRanker.ts:570-579` gives neutral budget score when budget or estimate is unknown.
- `lib/planner/catalogRanker.ts:671-686` gives baseline partner signal when rating/bookings are unknown.
- `lib/planner/catalogRanker.ts:1100-1109` serializes unknown values into search text safely.
- `lib/planner/catalogRanker.ts:1116-1124` returns an empty tag list when tag fields are missing.
- `lib/planner/catalogRanker.ts:1149-1161` safely reads strings/numbers from unknown values.

Current recommend route uses catalog ranking only for onboarded catalog rows:

- `app/api/planner/plans/[planId]/recommend/route.ts:26-32` imports `rankCatalogPartners`.
- `app/api/planner/plans/[planId]/recommend/route.ts:674-687` loads catalog venues/vendors and ranks them.
- `app/api/planner/plans/[planId]/recommend/route.ts:1991-2004` loads published rows from `venues`.
- `app/api/planner/plans/[planId]/recommend/route.ts:2660-2703` persists recommendations to `recommendations`.

### `venueRanker.ts`

API shape:

- `lib/venues/venueRanker.ts:10-24` defines `VenueRankerPlanInput`.
- `lib/venues/venueRanker.ts:26-28` defines venue input rows as `Record<string, unknown> & { id: string }`.
- `lib/venues/venueRanker.ts:30-57` defines `VenueArchetypeScore`.
- `lib/venues/venueRanker.ts:71-95` exports `rankVenuesForArchetype()`.
- `lib/venues/venueRanker.ts:97-186` exports `scoreVenueAgainstArchetype()`.

Sparse-signal behavior:

- `lib/venues/venueRanker.ts:527-538` returns `null` capacity when no capacity fields exist.
- `lib/venues/venueRanker.ts:540-548` lets venues with unknown capacity pass the projected-capacity gate.
- `lib/venues/venueRanker.ts:608-615` returns `0` cost when price is missing.
- `lib/venues/venueRanker.ts:618-623` serializes null/undefined/object values safely.
- `lib/venues/venueRanker.ts:637-650` safely reads string/number values.

Executable sparse-row check:

```json
{
  "catalogRecommendations": 1,
  "catalogRejected": 0,
  "catalogScore": 62,
  "venueRanked": 1,
  "venueScore": 35
}
```

This was run against a sparse Places-shaped row with only `id`, `name`, `address`, `source`, and `source_external_id`. Both ranker entrypoints returned scores instead of throwing. No ranker P1 null-handling blocker was found.

### Proposed `discovery_venues` to ranker mapping

```ts
function mapDiscoveryVenueToCatalogVenue(row: DiscoveryVenueRow): CatalogVenueRankingInput {
  return {
    id: row.id,
    name: row.name,
    venue_name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    neighborhood: row.neighborhood,
    venue_type: row.metadata?.primary_type ?? row.metadata?.google_primary_type ?? null,
    description: row.metadata?.places_summary ?? null,
    unique_features_tags: [
      ...(row.vibe_tags ?? []),
      ...(Array.isArray(row.metadata?.google_types) ? row.metadata.google_types : []),
    ],
    capacity: row.capacity_cocktail ?? row.capacity_standing ?? row.capacity_seated ?? null,
    standing_capacity: row.capacity_standing,
    seated_capacity: row.capacity_seated,
    estimate_cents: row.price_hint_cents_high ?? row.price_hint_cents_low ?? null,
    rating: row.google_rating,
    review_count: row.google_user_ratings_total,
    source: row.source,
    source_external_id: row.source_external_id,
    is_claimed: row.is_claimed,
    website: row.website,
    contact_phone: row.contact_phone,
  }
}
```

Use `rankCatalogPartners()` for planner list ordering. Use `scoreVenueAgainstArchetype()` only if the listing route wants a more detailed score breakdown.

## 7. Email Resolution Rate Audit

Live sample was run on 2026-06-16 using production `GOOGLE_PLACES_API_KEY`, Text Search with the field mask in Section 3, and `maxResultCount: 3` per query. The sample used a standalone script mirroring the existing extractor's path list and email confidence heuristics. It was not a production code change and no secrets were written to the repo.

Queries:

1. bars in the Mission San Francisco
2. private dining restaurants in Hayes Valley San Francisco
3. lounges in SOMA San Francisco
4. cafes in Castro San Francisco
5. wine bars in Marina San Francisco
6. restaurants in Fillmore San Francisco
7. rooftop bars in North Beach San Francisco
8. coffee shops in Outer Sunset San Francisco
9. pubs in downtown Berkeley
10. bars in Uptown Oakland

Raw sample result:

- Places results sampled: 30
- Results with website: 30
- Raw email extracted: 22 / 30 = 73.3%
- Raw email extracted from websites: 22 / 30 = 73.3%
- Query split:
  - Mission bars: 3 / 3
  - Hayes Valley private dining: 3 / 3
  - SOMA lounges: 1 / 3
  - Castro cafes: 2 / 3
  - Marina wine bars: 3 / 3
  - Fillmore restaurants: 3 / 3
  - North Beach rooftop bars: 1 / 3
  - Outer Sunset coffee: 2 / 3
  - Downtown Berkeley pubs: 2 / 3
  - Uptown Oakland bars: 2 / 3

Quality adjustment:

The raw sample included false positives such as `user@domain.com` and `*.sentry-next.wixpress.com`. The shipped extractor currently skips some junk local parts/domains in `lib/server/venue-website-extractor.ts:467-475`, but it does not skip these two classes. Excluding obvious placeholders/telemetry addresses gives a directional quality-adjusted result of approximately 13 / 30 = 43.3%.

Recommendation for Phase 2 UI: design around a conservative 40-50% automatic ready-to-reach-out rate, not the raw 73.3%. Section B ("Contact pending") must be prominent because roughly half of Places candidates will still need organizer-provided email or another contact path.

P1 implementation follow-up before marking extracted contacts as "ready":

- Extend `shouldSkipEmail()` to filter `user@domain.com`, `domain.com` placeholder local/domain patterns, and `*.sentry-next.wixpress.com`.
- Add tests to `lib/server/__tests__/venue-website-extractor.test.ts` for those false positives.
- Consider requiring either `is_likely_booking_contact=true` or `confidence >= 0.7` before an extracted email qualifies as `ready_to_reach_out`.

## 8. New Routes Needed

| Route | Purpose | Auth / RLS posture |
| --- | --- | --- |
| `POST /api/planner/plans/[planId]/discover-venues` | Run explicit Places Text Search, upsert global `discovery_venues`, create/update plan candidate rows, enqueue or mark extraction-needed rows. | Authenticated `community_builder`; plan owner only; service-role writes to global discovery table and plan join table. |
| `GET /api/planner/plans/[planId]/discover-venues` | Return ranked plan candidates with contact resolution state. | Authenticated `community_builder`; plan owner only; reads only candidates for owned plan. |
| `POST /api/planner/discovery-venues/[venueId]/contact-email` | Append organizer-provided email and return updated contact state. | Authenticated `community_builder`; must own a plan candidate row for this discovery venue; service-role update to `discovery_venues` or plan-scoped contact table. |
| `POST /api/planner/plans/[planId]/outreach/approve-batch` | Create one pending Gmail approval per selected ready venue. | Authenticated `community_builder`; plan owner only; rejects candidates without contact email and duplicate existing outreach. |

Do not add routes under `app/(dashboard)`.

## 9. UI Surface Plan

Modify `app/(planner)/planner/outreach/page.tsx`.

Current state:

- `app/(planner)/planner/outreach/page.tsx:67-76` uses two hard-coded target names and an editable message.
- `app/(planner)/planner/outreach/page.tsx:82-99` loads Gmail approval state.
- `app/(planner)/planner/outreach/page.tsx:101-109` enables approval creation only when Gmail is connected and at least one manually entered target has a valid email.
- `app/(planner)/planner/outreach/page.tsx:111-127` posts manual targets to `/api/planner/outreach/gmail-approval`.
- `app/(planner)/planner/outreach/page.tsx:201-220` sends users to Gmail settings if not connected.
- `app/(planner)/planner/outreach/page.tsx:299-366` renders sent threads and reply sync/mark-handled actions.

Phase 2 target state:

1. Top search form: "Find venues for this event"
   - Prefill archetype/neighborhood from active plan where available.
   - Submit calls `POST /api/planner/plans/[planId]/discover-venues`.
   - Search only runs on explicit click.

2. Summary banner:
   - "`N` venues found. `M` ready to reach out. `K` need a contact email - add one to enable outreach, or skip."
   - Use conservative copy when automatic hit rate is low.

3. Section A: "Ready to reach out (`M`)"
   - Checkbox per row.
   - Name, address, fit score, email source/confidence.
   - Website external link.
   - CTA creates approvals for selected rows.

4. Section B: "Contact pending (`K`)"
   - Name, address, website link, phone if available.
   - Inline "Add contact email" form.
   - Save moves the row into Section A immediately.
   - "Skip this venue" sets `dismissed_at` on the plan candidate row.

5. After batch approval:
   - Redirect to the planner approval queue with a banner.
   - Approval cards remain individual send gates.

Use warm editorial components consistent with `AGENTS.md`; no dark/glass/gradient UI.

## 10. Schema Additions

Additive discovery contact field:

```sql
ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS organizer_provided_emails JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discovery_venues.organizer_provided_emails IS
  'Emails the organizer pasted in manually after finding them on the venue website or contact form. Format: array of { email, provided_by_user_id, provided_at, source: "organizer_manual" }. Used when website extractor failed or returned nothing. Takes priority over extracted_emails when both are present (organizer has ground truth).';

CREATE INDEX IF NOT EXISTS idx_discovery_venues_has_organizer_email
  ON public.discovery_venues (id)
  WHERE jsonb_array_length(organizer_provided_emails) > 0;
```

Recommended additional join table: `plan_discovery_venue_candidates` from Section 5. This is needed for plan-scoped search results, dismissals, duplicate prevention, and RLS.

Rollback:

```sql
DROP TABLE IF EXISTS public.plan_discovery_venue_candidates;
ALTER TABLE public.discovery_venues
  DROP COLUMN IF EXISTS organizer_provided_emails;
```

## 11. Contact Resolution Priority

Resolution order:

1. If `organizer_provided_emails` is non-empty, use the most recent entry.
   - `contact_email_source='organizer_provided'`
   - `contact_email_confidence='high'`
2. Else if `extracted_emails` contains an email above the Phase 2 threshold, use the highest-confidence likely booking contact.
   - Recommended threshold: `is_likely_booking_contact=true` OR `confidence >= 0.7`.
   - `contact_email_source='extracted'`
3. Else return `contact_email=null`.

Organizer-provided emails should always outrank extracted emails because they are human-confirmed ground truth.

## 12. `contact_status` Enum Derivation

```ts
type ContactStatus =
  | 'ready_to_reach_out'
  | 'contact_pending'
  | 'no_contact_available'
```

Derivation:

- `ready_to_reach_out`: resolved `contact_email` is non-null.
- `contact_pending`: resolved `contact_email` is null and `website_url` is non-null.
- `no_contact_available`: resolved `contact_email` is null and `website_url` is null.

Phase 2 route responses should include `extraction_status` separately so the UI can explain whether extraction is pending, failed, blocked, or found nothing.

## 13. Tests to Add

Unit tests:

- `lib/server/__tests__/google-places-client.test.ts`
  - Happy path with multiple results.
  - Empty results.
  - 429 rate limit.
  - 5xx retry then success.
  - 5xx after retries.
  - Missing API key.
  - `CLOSED_PERMANENTLY` filtered.
  - Malformed result skipped.
  - Field mask does not include `places.emailAddress`.

- `lib/server/__tests__/venue-website-extractor.test.ts`
  - Add false-positive skips for `user@domain.com` and `*.sentry-next.wixpress.com`.

Integration tests:

- `__tests__/integration/discover-venues-route.test.ts`
  - Plan owner can search.
  - Non-owner rejected.
  - Places rows upsert idempotently on `(source, source_external_id)`.
  - Plan candidate join rows dedupe.
  - Rows with websites are marked for extraction or queued.
  - Missing API key returns clear server error.

- `__tests__/integration/discover-venues-list-route.test.ts`
  - Returns ranked candidates for owned plan only.
  - Groups contact states correctly.
  - Uses organizer-provided email before extracted email.

- `__tests__/integration/organizer-provided-email-route.test.ts`
  - Valid email append.
  - Invalid email rejected.
  - Non-owner rejected.
  - Venue not attached to owned plan rejected.
  - Response returns updated contact resolution.

- `__tests__/integration/outreach-approve-batch.test.ts`
  - Creates one pending approval per selected venue.
  - Rejects candidates that are not `ready_to_reach_out`.
  - Dedupes existing outreach for same plan/discovery venue.
  - Preserves per-message approval gate.

UI tests:

- Planner outreach page renders search form, summary banner, Section A, Section B.
- Email paste in Section B moves venue to Section A.
- Batch CTA only enables with selected ready venues.
- After approval creation, user is routed to planner approval queue.

Snapshot/template tests:

- Extracted-email source renders concrete `{{venue_name}}` and `{{sender_email}}`.
- Organizer-provided source renders concrete `{{venue_name}}` and `{{sender_email}}`.

Security/compliance:

- RLS test for plan candidate rows and organizer-provided email route.
- `npm run security:tied-house` remains clean.

## 14. Out of Scope

- Autonomous sending.
- A single bulk approval that authorizes multiple sends.
- SMS/Twilio outreach for phone-only venues. Defer until A2P approval.
- Instagram-native sourcing or DMs for venues with neither email nor website.
- Periodic re-search cron.
- New ranker file or duplicated ranker logic.
- Ranker enhancement. Current rankers are sparse-safe; only add adapter mapping in Phase 2.
- Vendor invite/claim changes.
- Experiences mockup or planner operating-record work.

## Final Recommendation

Safe to proceed to Phase 2 after review, with one product-quality caveat:

- The pipeline architecture is clear and can reuse existing Gmail approval execution.
- Existing rankers can handle sparse Places rows through an adapter.
- The UI must assume about half of candidates need manual contact completion.
- Before Phase 2 marks extracted contacts as ready, tighten extractor false-positive filtering and require a confidence threshold.

Approval-gate invariant remains unchanged: the search pipeline may create approval records, but every outbound Gmail message still requires explicit host approval before send.
