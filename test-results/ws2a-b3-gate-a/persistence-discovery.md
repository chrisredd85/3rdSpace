# Gate A — direct Places persistence and discovery inventory

Baseline: `b0f038150cee1fbbe34e2714ebd39faba9fd5c28`, isolated worktree `/Users/chrisredd/.codex/worktrees/ws2a-b3-gate-a/3rdSpace.webapp`. Read `AGENTS.md` and `docs/MVP_EXECUTION_BRIEF.md`. Static source/schema/test inspection only; no network, provider calls, tests, source edits, or database reads/writes. This report is the only file authored by this audit. Foundation changes by other agents are not evidence that these baseline flows have been fenced.

Paths below are repository-relative; quoted line numbers refer to this baseline. **PROVEN** means an executable source-to-write path exists, not that production contains a particular value. **CONDITIONAL** means a supported path or schema can carry the content, without a proven current producer. **ABSENT** means no implementation was found in the bounded searches described here, not a claim about historical databases, deployments, backups, or observability settings.

Gate labels refer to the approved B3 design sequence, not similarly named workstream items in the execution brief: **B** photo flow/retention; **C1** venue retrieval, saved reads, contact compatibility; **C2** vendor retrieval and shared consumers; **D** reviewed historical purge/record and approval migration. Gate A inventories these paths; it does not authorize activating retrieval or executing cleanup.

## 1. Provider entry points and request/response boundary

`lib/server/google-places-client.ts:5–19` requests `id`, `displayName`, `formattedAddress`, `primaryType`, `types`, `location`, `websiteUri`, `nationalPhoneNumber`, `rating`, `userRatingCount`, `priceLevel`, `businessStatus`, and `photos`. The POST at `:305–313` serializes the request and sends the fixed mask. The parser `:478–506` requires ID and display name and returns those fields. `:509–536` retains photo `name`, dimensions and author `{displayName, uri}`; it does not retain photo-source `googleMapsUri` or author `photoUri`. `displayName.languageCode` is parsed at `:539–546` but the direct writers below retain only `.text`.

The provider client itself does not write the database. Current callers found by searches for `searchGooglePlacesText`, `GOOGLE_PLACES_`, `places.googleapis.com`, and `maps.googleapis.com` across `app`, `lib`, and Supabase source are:

| Caller | Actual behavior | Later gate |
|---|---|---|
| `lib/server/places-outreach.ts:506,518` | Venue search, then discovery and candidate upserts | C1; B photos; D historical values |
| `app/api/planner/plans/[planId]/discover-venues/route.ts:165,177` | Separate venue route invokes search and the same insert builder, then its own upsert | C1; B; D |
| `lib/server/places-vendor-search.ts:179–188` | Vendor search, then discovery and candidate upserts | C2; B; D |
| `lib/discovery/refreshDiscoveryFromPlaces.ts:160–178` | Searches by saved name/address/city; updates rows and change history | C1/C2; D |
| `app/api/planner/discovery-venues/[venueId]/photo/[index]/route.ts:102–111` | Reads saved photo name and fetches media | B; D caches |

No separate current Place Details implementation was found in those callers. Request metadata is not automatically provider response content: geographic bounds/aliases in `google-places-client.ts:164–281` are application constants, and the request payload may contain host query/category/location intent. Preserve this distinction when inspecting JSON.

**CONDITIONAL diagnostic sink:** non-OK response text is read at `google-places-client.ts:320–322`; `:446–449` constructs `Google Places API error ${status}: ${message}`. Caller error responses/logging can therefore contain provider error-body content. This is not proof that successful full responses are logged. C1/C2 must sanitize this boundary; D should inventory configured logs without asserting retention from source alone.

## 2. Direct venue row writer — complete field map

`lib/server/places-outreach.ts:164–215` builds the persisted row. Exact examples: `name: place.displayName.text` at `:178`, `lat: place.location?.latitude ?? null` at `:183`, `photos: sanitizePlacesPhotos(place.photos)` at `:192`, and `google_primary_type: place.primaryType ?? null` at `:197`.

| Stored destination | Origin and nuance |
|---|---|
| `name`, `address`, `contact_phone`, `website` (`:178–186`) | Direct display name, formatted address, phone, website |
| `lat`, `lng` (`:183–184`) | Direct response coordinates; no coordinate-specific acquisition/expiry clock in this writer |
| `source_external_id` (`:188`) | Place ID; stable identity must survive content cleanup |
| `google_rating`, `google_user_ratings_total`, `business_status` (`:189–191`) | Direct returned rating, count, status |
| `photos` (`:192`) | Stored resource names, dimensions, author names/URIs; sanitizer `:787–813` limits this venue array to ten |
| `city` (`:181`) | Derived from formatted address, with an application `'San Francisco'` fallback; not evidence of independently entered city |
| `metadata.google_primary_type`, `.google_types`, `.google_price_level`, `.google_business_status` (`:197–200`) | Direct Google content, including duplicated status |
| `metadata.places_primary_type_match`, `.places_all_types` (`:203–204`) | Duplicated Google type values despite request-like naming |
| `metadata.venue_cluster_id`, `.subspace_hint` (`:211–212`) | Derived from Google name/address/type; see below |
| `website_extraction_status` (`:214`) | Workflow status initialized from presence of Google website, not a copied website fact |
| `neighborhood`, `state`, `source`, freshness/change timestamps/status (`:180,182,187,193–195`) | Request/config/provenance/operational values, not all Google content |
| `metadata.places_search_query`, `.places_request`, intent/requested/matched type and supply-intent fields (`:201–202,205–210`) | Request/context metadata; `places_intent_matched_type` is the included request type, not the returned primary type. Inspect mixed query content rather than deleting by prefix alone |

**PROVEN writers:** helper `places-outreach.ts:549–553` executes `.from('discovery_venues').upsert(insert, { onConflict: 'source,source_external_id' })`; the independent route `app/api/planner/plans/[planId]/discover-venues/route.ts:207–220` builds and upserts the same row at `:217–218`. Both must be fenced in C1, with photo writes removed in B. Fencing only one leaves a current bypass. D must clean the columns and nested duplicate/derived fields, not just the top-level name/address.

Cluster derivation `places-outreach.ts:220–228`: non-hotel rows use Place ID; hotel rows strip subspace words from the Google name, infer city from the Google address, and return a `hotel_${slug}`. A name-based cluster is not automatically an ID-only safe alias. `:231–238` derives rooftop/ballroom/private-dining/lounge/main-floor hints from returned name/type. Multi-room behavior needs compatible replacement before purging these dependencies.

## 3. Direct vendor row writer — complete field map

`lib/server/places-vendor-search.ts:195–205` builds then upserts `discovery_vendors` on `source,source_external_id`. Builder `:267–293` persists:

| Stored destination | Origin and nuance |
|---|---|
| `source_external_id`, `google_place_id` (`:268,276`) | Same Place ID in two identity columns |
| `name`, `formatted_address`, `website`, `phone` (`:269,271,274–275`) | Direct Google text/contact fields |
| `city` (`:272`) | Derived from Google formatted address via `inferCity` (`:381–387`) |
| `google_rating`, `google_user_rating_count`, `google_price_level`, `business_status`, `place_types` (`:277–281`) | Direct response fields |
| `photos` (`:282`) | Google photo names/dimensions/author names/URIs; sanitizer `:390–403` |
| `website_extraction_metadata.google_primary_type` (`:292`) | Hidden Google content in an enrichment-metadata column, separate from `place_types` |
| `service_type`, `state`, `source` (`:267,270,273`) | Requested service category/application state/provenance; retain independent category |
| `website_extraction_status`, `last_refreshed_at`, `last_places_refresh_at`, `last_meaningful_change_at`, `data_freshness_status`, `updated_at` (`:283–288`) | Operational bookkeeping |
| `website_extraction_metadata.places_search_query`, `.places_request` (`:290–291`) | Request context, not a stored full response |

No vendor lat/lng write exists in this builder. C2 must fence the entire vendor write including the nested primary type; B handles photo writes; D handles existing values while preserving IDs and independent category/partner facts.

## 4. Candidate rows, aliases and catalog projections

**PROVEN:** venue helper `places-outreach.ts:568–590` persists `plan_discovery_venue_candidates` with stable IDs/user/query/archetype/neighborhood, `fit_score`, status/dismissal and `places_request_json`. The latter contains query, result counts, request arrays and supply intent, not a full response. The duplicate route writes the equivalent candidate at `discover-venues/route.ts:234–249`; its request bundle is built at `:195–203`. The venue score is derived through `places-outreach.ts:354–369`, including the catalog projection below. C1 must decide which source-aware score/reasons may remain durable; D cannot treat all candidate JSON as either wholly Google or wholly independent.

Vendor candidate upsert `places-vendor-search.ts:219–239` stores IDs, user/query/service category, null `fit_score`, status/dismissal, query/request arrays and counts. Current null vendor score is not a Google-derived numeric copy. C2 fence/D inventory applies to later enrichment or embedded query content.

**PROVEN in-memory aliases, not a catalog insert:** `mapDiscoveryVenueToCatalogVenue` in `places-outreach.ts:375–423` exposes `name` and `venue_name` (`:384–386`), address/city/state/neighborhood/type (`:387–391`), description from `metadata.places_summary` (`:392`), tags including Google types (`:393–399`), generated alcohol policy (`:400`), capacities/cost, rating/review count (`:401–413`), raw `metadata`, source IDs, cluster/subspace and website/phone (`:414–422`). Bar-derived tags and alcohol policy follow returned types (`:379–382`). `metadata.places_summary` is a possible legacy input; the current insert builder does not populate it. These aliases can feed rankers and downstream serializers, but this function itself does not insert into `venues`.

**ABSENT in bounded search:** no `discovery_venue_alias`, `discovery_vendor_alias`, `venue_aliases`, or `vendor_aliases` table/caller found. Geographic aliases in the client/ranker are coded query matching. No automatic direct Google-to-`venues` or Google-to-`vendor_profiles` promotion was established from the current Places call graph. Do not confuse the adapter alias `venue_name` or reverse self-service mirror with such a writer. C1/C2 must still fence downstream serialization of this projection; broader plan/message/template/browser sinks belong to the companion inventory.

## 5. Refresh, durable history, admin reapply and cascade copies

**PROVEN refresh writer:** `lib/discovery/refreshDiscoveryFromPlaces.ts:73–89` loads existing rows and retains old content when no match is found, only marking stale. It searches saved name/address/city (`:160–178`, query construction `:329–335`), prefers matching Place ID but falls back to the first result (`:174–178`). This path is not restricted to rows whose `source` is Google.

Change detection `:181–202` compares name, address/formatted address, phone, website, business status, venue rating/count, and vendor rating/count/price level/types. Name has `autoApply: false`; it is still persisted to history for review. The other listed changes may be auto-applied at `:235–237` with `[change.field]: change.newValue`. Coordinates, photos, venue type metadata and city are not refreshed by this list: generic `last_places_refresh_at` must not be mistaken for their individual content age.

**PROVEN history:** `:251–276` inserts `discovery_change_log`; exact fields include `old_value: toJson(input.change.oldValue)` (`:268`) and `new_value: toJson(input.change.newValue)` (`:269`), field/source/confidence/evidence/actor/applied time/cascade. Thus both superseded and current Google values survive even if the entity row is cleaned.

**Actual schedule/wiring:** `app/api/cron/discovery/refresh-stale/route.ts:32–64` invokes this helper for venues and vendors. Loader `:88–104` selects null/older-than-seven-day refresh clocks, limit 25 per type, without a source filter. It also invokes website extraction (`:68`). `vercel.json:28–29` schedules the refresh daily. Searches found this cron as the current non-test refresher caller. C1/C2 must replace/fence it and its eligibility rules before D; otherwise independently supplied records can be overwritten or cleaned content repopulated.

**PROVEN replay writer:** `app/admin/discovery/review-changes/page.tsx:107–153` reads history `new_value` (`:115`), dynamically updates the original entity field (`:125–133`), cascades (`:135–142`), then marks review (`:145–153`). Approving a Google-origin history record does not make the saved content independently sourced. C1/C2 must fence this replay; D must clean history/queue content before it can resurrect fields.

**PROVEN secondary cascade persistence:** `lib/discovery/cascadeInvalidation.ts:80–91` passes `trigger.value.new_value: input.newValue` (`:88`) to `applyPlanRevision`; `lib/planner/planRevisions.ts:71–80` forwards it to `apply_plan_revision_atomic`. The latest function definition found is `supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql`: `:723–735` inserts `p_trigger` into `plan_revisions.trigger_payload`, and `:838–857` inserts `audit_logs.after_state` containing `'trigger', p_trigger` (`:854`). `before_state` also stores `to_jsonb(v_plan)` (`:852`), a conditional additional copy if the prior plan has provider content. Notifications in `cascadeInvalidation.ts:105–114` carry IDs/changed-field names, not the value in this shown payload. C2 shared consumers and D history/log inventory must include these sinks; preserve audit/approval identity and require reapproval when executable fields change, never silently rehash.

## 6. Coordinates, photo metadata/media and caches

**Coordinates:** the direct venue writer stores returned lat/lng (`places-outreach.ts:183–184`), with baseline schema columns at `20260601000001_add_discovery_venues.sql:13–14`. No coordinate-specific fetched-at/expiry enforcement is present in this baseline path. Generic freshness does not provide that guarantee. Request JSON also includes application-defined geographic coordinates; distinguish these from returned place location. C1 must enforce the separately selected coordinate policy; D inventories old returned coordinates without inventing their acquisition time.

**PROVEN photo resource persistence:** both initial writers store `photos`; author names and URIs are copied with resource names. `20260618042000_add_organizer_provided_emails_and_photos.sql:6–10` adds the JSON arrays; its comment `:21–22` describes stored references. The older venue `google_photo_names` and `opening_hours_json` columns exist at `20260601000001_add_discovery_venues.sql:33–34`. Current search mask has no opening-hours field; neither current builder writes these two legacy columns. **CONDITIONAL legacy storage**, still selected by `places-outreach.ts:75–77`, the discover route `:71–73`, and outreach approve-batch `:212`. Do not omit them from D merely because current writers use `photos`.

**PROVEN media/cache policy:** photo route `app/api/planner/discovery-venues/[venueId]/photo/[index]/route.ts` authenticates before loading the row (`:30–42`), then reads saved `photos` and selects a saved resource name (`:45–56`). `:102–111` fetches Google media by that name; `:73–81` may fetch returned `photoUri`; `:87–92` returns image bytes with **`public, max-age=86400, s-maxage=86400`**. This explicitly permits one-day browser/CDN caching. Source inspection is not evidence of a populated live cache. No image-byte storage into Supabase Storage or disk occurs in this shown route. No equivalent vendor photo proxy was found among provider API callers.

**Framework-cache nuance:** route has `dynamic = 'force-dynamic'` (`:1`), while provider/photo fetches have no explicit `cache: 'no-store'`. Absence of that flag alone does not prove Next Data Cache persistence, especially for POST search and dynamic/authenticated routes. The provider module's singleton timing state is pacing (`google-places-client.ts:453–460`), not a result cache. B must explicitly control fetch/response/CDN behavior and fresh metadata/attribution; D includes old stored names and caches. A bounded search for `caches.open`, `serviceWorker`, `runtimeCaching`, `workbox`, `unstable_cache`, and `force-cache` in application/library/public/config source found no custom result-cache implementation; browser/framework/deployment behavior remains separately testable.

## 7. Contact discovery and inference — Google bootstrap vs independent evidence

**PROVEN contact-job dependency:** `app/api/internal/jobs/venue-website-extraction/route.ts:100–141` selects both discovery tables and requires stored non-null `website` (`:104,126`). Venue processing calls `extractVenueContacts` with cached website/name/type (`:214–226`); vendor processing does likewise (`:311–326`). Results update the discovery row and can resume pending venue drafts (`:241–247`). The cron refresh calls this batch; the general job runner also invokes it at `app/api/internal/jobs/run/route.ts:359–367`. This batch reads rows on execution, not a stored website payload. C1/C2 must replace eligibility/loading before removing websites; otherwise contact discovery silently starves.

**Independent page extraction, with source gaps:** `lib/server/venue-website-extractor.ts:36–64` defines extracted email/form values with confidence, source path, extraction time and booking-contact flag, plus attempted/successful paths, errors, robot flag and timing. `lib/server/discovery-enrichment.ts:66–79` writes `extracted_emails`, `extracted_contact_forms`, extraction status/metadata/timestamps/attempts. Those email/form facts come from fetched business pages, not a Google email API field; search has no such email field. They require independent page provenance, not automatic deletion because the bootstrap URL came from Places. Paths/times alone do not establish every field's origin or corroboration. Email ranking receives cached name/type at extractor `:220–236`; conditional error telemetry includes `venue_name` in Sentry context (`:241–244`). C1/C2 must keep Google context out of durable prompt/diagnostic copies; D reviews the actual source of mixed metadata and telemetry.

**Misleading alias:** `discovery-enrichment.ts:31–39` calls `row.contact_email` a `placesEmail` and returns source `'places'`; this is not proof the value came from Places. Website-extracted email is separately tagged at `:49–53`. Row provenance and misleading labels cannot replace field-level evidence.

**PROVEN capacity inference:** `lib/discovery/venueCapacityJobs.ts:42–56,90–100` loads/sends saved name, address/city/state, website, rating/count and type metadata to `inferCapacity` (`lib/discovery/inferCapacity.ts:35–72`). Types are built from Google metadata (`venueCapacityJobs.ts:148–158`). It writes `inferred_capacity_standing`, `inferred_capacity_seated`, confidence, source quote, model, pending admin status and extraction time (`:127–140`). These are Google-dependent estimates unless independent evidence establishes a different source; a model-generated `source_quote` is not sufficient evidence by itself.

**PROVEN queue distinction:** enqueue `venueCapacityJobs.ts:58–69` contains only `payload: { discoveryVenueId: venueId }` (`:65`) and an ID-based unique key. The runner accepts optional `websiteSnippet`/`website_snippet` (`jobs/run/route.ts:312–318`), but this current enqueue does not supply it: a snippet-bearing queue payload is **CONDITIONAL**, not a proven current producer. However the normal result contains standing/seated/confidence (`venueCapacityJobs.ts:118–124`), and `jobs/run/route.ts:345–346` calls `completeJob`; `lib/server/job-queue.ts:138–155` writes that `result` into `app_jobs`. Thus derived inference survives in completed job rows even with ID-only inputs. C1/C2 fence both inference and result serialization; D includes `app_jobs.result` and conditional old payloads.

**PROVEN vendor rate inference:** website job `:391–403` sends name, requested service type, cached Google `place_types`, website and `websiteSnippet` to `inferVendorRate` (`lib/discovery/inferVendorRate.ts:25–65`). The actual snippet at website job `:319–321` is assembled from `${email.email} found on ${email.source_path}`, not fetched pricing text. The update `:417–441` writes inferred hourly/package/minimum values, confidence/source quote/model/admin status/extraction time alongside contacts. Do not label this independently published pricing merely because the worker ran a website extractor. C2 must preserve estimates as estimates and attach actual independent evidence; D classifies source field by field.

Admin capacity review `app/admin/discovery/capacity-review/page.tsx:126–162` and vendor rate review `app/admin/discovery/vendor-rate-review/page.tsx:129–163` approve status or allow edited numbers with generic admin source quotes/confidence 1. Approval alone is not independent sourcing; independently entered overrides can be retained with real provenance. These admin paths need C1/C2 compatibility and D review rather than blanket removal of business capacity/rate facts.

## 8. Independent mirrors, supply scout and schema-only storage

**PROVEN reverse catalog mirror:** `lib/discovery/freshness.ts:118–149` creates discovery vendor rows from `vendor_profiles` with `source: 'vendor_self_service'`, profile-based external ID, partner name/service/contact and operational metadata. `:169–219` can update an existing linked discovery row and writes history with `source: 'vendor_self_update'`. The builder `:347–367` explicitly copies partner name/service/email and, critically, `update.inferred_package_rate_cents = dollarsToCents(baseRate)` (`:361`), with quote `'Vendor self-updated base rate.'` (`:363`). Therefore the same columns used by Google-dependent model inference can contain independently supplied partner data; an existing row's broad source label may remain Google. Preserve these facts and links during C2/D. The profile freshness API is an actual caller, not merely an unused helper.

**Other independent write boundaries:** organizer contact-email route `app/api/planner/discovery-venues/[venueId]/contact-email/route.ts:66–83` records email, user/time and `source: 'organizer_manual'`; `:93–97` resumes outreach. `freshness.ts:66–115` records organizer reports; Stripe-related history `:239–305` records operational payment-readiness events. These are not proven direct Places copies. A human can paste provider text into free text, so D must preserve independently evidenced facts without treating every manual label as conclusive provenance.

**Supply scout — CONDITIONAL, not a proven current Places pipeline:** `supabase/migrations/20260601000004_add_supply_scout_leads.sql:7–40` defines name/address and normalized variants, neighborhood/city/state, source platform/URL, event title/type, evidence summary, booking signals/disqualifiers, website, capacity/price hints, confidence/status, discovery/duplicate links, actors, metadata and timestamps. Its full-text index derives searchable tokens from these values (`:79–85`). Allowed source platform includes `google_search` (`:40`), not `google_places`; these are not interchangeable sources. Comments describe promotion intent, but searches for `supply_scout`/`supply-scout` in `app`, `lib`, scripts and Supabase functions found no current runtime writer or automatic Places-to-scout mirror. D must inventory actual legacy/manual rows if present; no new architecture or promotion implementation is implied by this finding.

Schema inventory for D: base venue schema `20260601000001_add_discovery_venues.sql:6–42`; contact/photo additions `20260618042000_add_organizer_provided_emails_and_photos.sql:6–10`; vendor schema `20260624011000_add_vendor_discovery_response_commitments.sql:6–42`; capacity fields `20260624012000_add_discovery_venue_capacity_inference.sql:6–13`; freshness/history `20260626001000_add_vendor_city_and_discovery_freshness.sql:24–34,53–83`; contact-form arrays `20260626003000_add_discovery_contact_forms.sql:7,17`. These files are under `supabase/migrations/`. Stable identity/FKs and NOT NULL name/city assumptions require the Gate A compatibility design before destructive cleanup. History is polymorphic by entity type/ID and contains old/new JSON plus source evidence/cascade JSON; it is not just an entity-column cleanup.

## 9. Existing retention does not cover this inventory

`app/api/cron/retention-cleanup/route.ts:37–51` clears old venue contact email/phone and organizer/extracted email arrays, replacing extraction metadata, only when `updated_at` is older than one year. It does not clear Google name/address/website/rating/types/photos/coordinates, and it does not implement equivalent vendor content cleanup. Refresh can change `updated_at`; this is not a content-specific clock. Other steps delete old responses (`:53–65`) and redact outreach bodies/headers/provider metadata/attachments (`:67–80`), not a complete Places purge. `vercel.json:24–25` schedules this weekly. B/C1/C2 must prevent new persistence before D inventories existing database, browser/media, logs and restore surfaces. No production cleanup or backup inspection occurred here.

## 10. Existing tests inspected, and limits

No tests were run by this audit. Existing source tests confirm behavior expectations, not live provider compliance:

| Test file / lines | Existing coverage relevant to inventory |
|---|---|
| `lib/server/__tests__/google-places-client.test.ts:17,36,70,84,144` | Request without invented email, type field mask, geography bias, retries/filter/photo parsing, rate-limit behavior |
| `lib/server/__tests__/places-outreach.test.ts:74,115,158,207` | Photo metadata in inserts; intent/cluster/subspace persistence; proxy URLs/contact in response; inferred capacity mapping |
| `lib/server/__tests__/places-outreach.test.ts:25,47` | Organizer email precedence and form fallback |
| `lib/server/__tests__/places-vendor-search.test.ts:17,27,62,81` | Service normalization, geography bias, high-confidence inferred rates, TBD rates |
| `lib/discovery/__tests__/refreshDiscoveryFromPlaces.test.ts:54,68,86` | Source allowlist, accepted `places_refresh` history write, Sentry reporting on constraint failure |
| `__tests__/integration/discovery-freshness/helpers.test.ts:165,200,266` | Organizer reports; self-service mirror/cents/cascade; Stripe event deduplication |

The direct persistence tests intentionally expect today's writes; later gates must rewrite those expectations to the chosen transient/read and provenance contract rather than simply leave them green. No dedicated current Google photo-proxy cache/attribution test was found in the bounded file-name/content search; similarly, these tests do not establish source-aware historical purge, no rehydration from admin history, complete queue-result sanitation, cache invalidation, or absence of Google content in external logs.

## Gate handoff

1. **B:** stop both photo-array writes; replace stored-resource proxy with fresh metadata/credit flow; explicit no-store on every media hop/response; inventory legacy photo fields and media caches.
2. **C1:** fence both venue initial writers, venue refresh/history/admin replay, candidate-derived values, capacity inputs/results and saved contact eligibility; keep Place ID and independently evidenced facts usable.
3. **C2:** vendor writer including nested extraction metadata, vendor refresh/rate/admin paths; source-aware self-service mirror; shared cascade/history/log and downstream serializers. Do not persist full provider DTOs or Google-dependent model text as independent evidence.
4. **D:** dry-run all named columns/JSON paths/history/job results/caches and conditional legacy stores after writers/readers are safe. Preserve IDs/FKs, financial/business records and independent equal-valued facts; unresolved lineage becomes unavailable. Follow explicit approval/reapproval rules for changed executable fields. No inferred deletion by row source and no silent approval rehash.

This is an inventory and future-gate dependency report, not a claim that Gate A alone fixes retention or makes current Places usage compliant.
