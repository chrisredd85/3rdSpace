# WS2a-B3 Gate A — downstream persistence inventory

Baseline: `b0f038150cee1fbbe34e2714ebd39faba9fd5c28`, worktree `/Users/chrisredd/.codex/worktrees/ws2a-b3-gate-a/3rdSpace.webapp`. Read `AGENTS.md` and `docs/MVP_EXECUTION_BRIEF.md`. This is an inventory, not an implementation or production data audit. No network/provider/production calls, migrations, source/test changes, or runtime tests were performed. Paths and line numbers below refer to current code at this baseline. Earlier design appendices supplied leads; the cited code was re-read here.

**Conclusion:** the durable boundary extends beyond discovery rows into recommendations, prose, plans, versions, revisions, multiple audit tables, approval/action/booking snapshots, correspondence, templates, and two browser caches. Application serializers alone do not cover SQL RPC writers. The exact provider fields in a historical record still require lineage classification: independent host/partner/site facts can coexist in the same row and can equal the Google value.

## Evidence labels and later-gate obligations

- **P — proven receiving path:** a source-to-sink assignment/call chain exists for a Google-origin field or its generated derivative. This proves possible execution of that code, not that any production row contains it.
- **C — conditional path:** a durable sink or export exists, but its input comes from catalog/client/free text or another mixed source; no automatic Google-to-that-source promotion was proved here. Do not classify all its rows as Google-origin.
- **N — no receiving evidence:** the bounded current-code search did not find a Places receiving path, or the inspected sink has only IDs/status/first-party numbers. This is not proof about historic deployments or production services.

For each item, **C1/C2 fence** means later venue/vendor cutover must stop new restricted copies at *all* relevant serializers/RPCs before enabling live enrichment. Mixed shared sinks belong to the shared completion gate; C1 must remain gated if they are incomplete. **D cleanup** means separately approved, source-aware cleanup of historical columns/JSON/prose and controlled copies; never a wholesale row delete. **B photos** owns photo names/media/cache prevention and cleanup wherever copied. These are inventory dependencies, not authorization to implement them.

The allowed durable layer cannot be inferred from `source: agent`, confidence, approval, or string equality. A generated summary, inferred number, hash, or revised object may still depend on Google content. Conversely, do not remove genuine agreed prices, reply evidence, event identity, payment lineage, or attendance as if they were provider decorations.

## Entry objects used by the downstream trace

P: `lib/server/places-outreach.ts:178–213` constructs `name: place.displayName.text`, address/city, coordinates, phone/site, rating/count/status, `photos: sanitizePlacesPhotos(place.photos)`, and Google types/price/status plus derived cluster/subspace metadata. The vendor constructor at `lib/server/places-vendor-search.ts:267–293` similarly sets name/address/city/site/phone/rating/count/price/status/types/photos and metadata. These are the provenance-bearing sources, not a claim that every discovery value retains that provenance forever.

Later independently extracted contacts, partner quote responses and self-service fields mix with those objects. Keep per-field origins; entity-level `source='google_places'` is insufficient. Primary discovery/history/inference inventory is owned by the companion Gate A audit; this report traces their downstream copies.

## 1. Recommendations, messages, operational prose and plans

| Status / durable sink | Current call chain and exact evidence | Content reaching it | C1/C2 fence and D cleanup |
|---|---|---|---|
| P — `plan_messages.metadata` recommendation response | `lib/planner/autoRecommendations.ts:33` calls `requestRecommendationRun`; `:47–64` inserts `plan_messages` with `recommendations: venueDisplayItems`, `recommendation_response: recommendationData`, `ranked_venues: rankedVenues`. Vendor insert `:81–101` additionally saves `vendor_recommendations`, groups, workspace summary and timeline. | Recommendation route explicitly adds discovery phone/site at `app/api/planner/plans/[planId]/recommend/route.ts:1124–1144` (`contact_phone: discoveryVenue.contact_phone`, `website: discoveryVenue.website`). Vendor projection `:2495–2520` includes name, derived location context, phone, website, estimated rate and `source: 'google_places'`. Ranked/derived text and capacity may also be Google-fed. **No claim that this specific projection always includes photo names or ratings.** | Fence the full response and both message constructors, not just displayed cards. D inspect nested response, display arrays, groups and prose. Preserve economics/timeline portions that are independently based. B handles any photo-bearing legacy blob actually found. |
| P — `plan_messages.content` | Same helper `:45–51`, `:79–85` stores `buildVenueOnlyContent(recommendationData)` / `buildVendorFollowUpContent(...)`. | Human-readable generated recommendation text can carry provider names and derived rationale. It is not safe merely because it is prose rather than JSON. | Build durable copy only from permitted inputs; D classify text as well as JSON. Do not delete an entire conversation indiscriminately. |
| P — `recommendations` notes/metadata | `recommend/route.ts:3338–3366`: `notes: recommendation.reasoning.join('. ')`; metadata copies reasoning, capacity, tags and ranker metadata. `:3392–3461`: agent venue notes, pros/cons, questions, intro, reason summary/calibration; vendor notes/pros/cons/notice. | Provider-fed matching/estimation output is a derived-data path. **Nuance:** current constructors set `external_name: null` at `:3345,3396,3425`; do not claim every recommendation row directly stores the Google business name there. | Fence raw/derived provider content in both catalog and agent/fallback persistence. D field-aware metadata/prose cleanup with independent estimate evidence retained. |
| P — `plans.metadata.shopping_list` | `recommend/route.ts:3503–3541`: `external_name: input.topVenue.venue_name` and `external_name: vendor.name`; writes `{...currentMetadata, shopping_list: shoppingList}`. | Venue/vendor names, reasons, estimated rates and fit scores (some derived from provider-fed inputs), alongside stable references and first-party economics. | Save stable references and independent display/economic facts; D cleanse selected venue/vendor names/reasons by lineage. Keep reference IDs; absent fields must not be repopulated by merging an old shopping list. |
| P — operational `plans.metadata.agent_cache` / timelines / workspace prose | `recommend/route.ts:1937–1956` writes `agent_cache`, then snapshots a version. `:1965–1987` stores `artifacts.timeline`, `artifacts.workspace_summary` or error text. Deterministic fallback `:2083–2088` says ``Top venue recommendation is ${venue.venue_name ...}``. | The saved recommendation name is definitely embedded in fallback prose. Model-generated artifacts may embed candidate/provider details; source tags `planner_recommendation_ready` are generator provenance only. | Fence both deterministic and AI artifact inputs/outputs, including failures. D inspect saved artifact text/errors rather than dropping safe numerical/operational sections. |
| P — `plan_versions.snapshot` | `recommend/route.ts:2013–2025`: `snapshot: { ...plan, metadata, run_of_show: artifacts.timeline, workspace_summary: artifacts.workspace_summary, operational_artifact_errors: artifacts.errors }`. | A full plan/metadata copy can retain shopping list, applied template, prior provider names/prose and error strings. Current-row cleanup does not touch snapshots. | No overlay may enter future snapshots. D separately inventory snapshots; preserve version identity and approved independent facts. Schema `20260504000002_agent_planner_schema.sql:112–113` calls these immutable history, so historical redaction must be explicit/auditable. |
| C — separate summary cache path | `lib/planner/planAgentSummaries.ts:55–86` loads event tasks/bookings/venue requirements; `:120–141` builds cache and `:484–485` updates `plans.metadata`. `:265–278` also supports full agent logging. | This loader uses catalog/event data, not direct discovery fetch. It can propagate legacy/mixed booking labels or task text if those contain provider data. Do not assert all operational summaries are Google-derived. | Shared serializer must cover this independent path too; D classify labels/prose, preserving actual tasks/booking/financial facts. |

Automatic recommendation helper callers include `app/api/planner/plans/[planId]/trigger-recommendations/route.ts:65`, plan update `app/api/planner/plans/[planId]/route.ts:384`, and template apply `app/api/planner/templates/[id]/apply/route.ts:185`. These refresh actions can recreate removed copies if only old rows are cleaned.

## 2. Revisions and audit records — independent durable sinks

**P — discovery cascade → plan revisions → plan metadata → audit log.** `lib/discovery/cascadeInvalidation.ts:71–92` calls `applyPlanRevision` with `trigger.value.new_value: input.newValue`. `lib/planner/planRevisions.ts:72–79` sends `p_trigger` to `apply_plan_revision_atomic`. It also copies the value into `plans.metadata.latest_plan_revision.value` and appends to `plan_revision_triggers` at `:613–640`.

The latest matching RPC definition found by the migration search is `supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql:723–735`: `INSERT INTO public.plan_revisions (... trigger_payload ...) ... p_trigger`. At `:838–857`, `INSERT INTO public.audit_logs` stores `before_state = to_jsonb(v_plan)` and `after_state` containing `'trigger', p_trigger` and `'plan_updates', p_plan_updates`. Earlier definitions in `20260626002000...` and `20260709110000...` have the same copy pattern; the later definition is the anchor for current migration state.

**P — ordinary message exchange → `audit_logs`.** `app/api/planner/plans/[planId]/messages/route.ts:396–410` supplies `before_state: toJson({ plan: existingPlan })` and `after_state: toJson({ plan: finalPlan, intent, ... })`; `:1668` inserts that payload. Any already-contaminated plan can be copied even when the new user message is unrelated to Places.

**P/C — recommendation audit.** `recommend/route.ts:660–678` records IDs plus notices, calibration and elasticity; `:4303` inserts `audit_logs`. IDs themselves are not restricted business presentation content. Notices/calibration are conditional provider-derived content and need lineage inspection, not blanket deletion of the audit event.

**P — operator task → `admin_audit_log`.** `supabase/migrations/20260709160000_complete_concierge_execution.sql:819` captures `v_before_task := to_jsonb(v_task)`; `:932–940` inserts before/after task snapshots into `admin_audit_log`. Cancellation has the same pattern at `:1061,1139–1146`. When a task contains a copied provider name (section 3), its audit snapshots also do.

**N for inspected Gmail audit constructor — `agent_action_audit_log`.** `lib/outreach/gmailApprovalFlow.ts:1529–1539` inserts action/plan/actor IDs, statuses, reason and `{approval_flow: ...}` only. This specific writer does not copy the email/body/name. Other audit metadata remains an allowlist review surface; do not confuse it with the proven full `audit_logs`/`admin_audit_log` copies.

**Required later handling:** C1/C2 fence RPC-trigger payloads, whole-plan before/after snapshots and operator snapshots in addition to TS serializers. D include `plan_revisions.trigger_payload`, the two metadata revision arrays/objects, `audit_logs.before_state/after_state`, and `admin_audit_log.before_state/after_state`. Running ordinary change cascades for each redacted field can generate *more* historical copies and needless commercial revisions; design a specific audited migration path. Do not retain prohibited field hashes as a substitute.

## 3. Approvals, execution, canonical bookings and operator work

### P — direct discovery Gmail approval chain

`lib/planner/discoveryOutreachDrafts.ts:93–109` resolves contact and calls `createOrReuseGmailOutreachApproval` with `name: row.venue.name`, `email: contact.email`, discovery ID, subject and body. This is a proven name input from discovery; the email is independently extracted/organizer-supplied when that resolver has such evidence.

`lib/outreach/gmailApprovalFlow.ts` then creates these separate sinks:

- `:649–667`: `actionPayload` holds `targets: input.targets`, `subject`, `body_text`, sender and comparison instructions; `:279–298` writes it into `agent_actions.payload_json`.
- `:681–691`: `approvals.package_details` interpolates each `${target.name} <${target.email}>`; `:325–335` writes `snapshot_hash` and `snapshot_json: buildApprovalSnapshotV2(...)`.
- `:343–350` writes a `plan_messages` approval request. Its metadata at `:719–739` repeats names/emails in `partner_targets`, `invites[].venue_response_json`, and a rendered preview in `opportunity.summary`.

The recommendation route has an additional approval constructor: `recommend/route.ts:1225–1246` builds `partner_targets` plus summary/requirements into `actionPayload`, and `:1333–1342` stores V2 snapshots. Both constructors must obey the boundary; neither can be missed by fixing only the direct discovery helper.

**C1/C2:** establish independent durable recipient identity/contact before constructing these payloads, descriptions/previews and snapshot hashes. **D:** inventory actions, approval fields/snapshots, approval-message metadata and previews together. Treat pending action consent explicitly; do not silently replace content and recompute a hash.

### P — canonical quote name joins → approvals → booking snapshots

`lib/planner/execution/canonicalQuoteBooking.ts:875–906` joins `venue_outreach_responses` to `discovery_venues!inner(id, name, claimed_venue_id)` and returns `partnerName: readString(venue?.name)`. Vendor equivalent `:910–943` joins discovery vendors and uses their name. Partner terms/amounts/excerpts are independently received evidence; that does **not** establish independent provenance for the joined business name.

At `:114–152`, the payload stores `target_name: quote.partnerName`; the approval stores ``Approve booking request with ${quote.partnerName}`` and `provider: quote.partnerName`. At `:160–173`, these go to `stage_plan_quote_booking` as `p_action_payload`, `p_snapshot_json` and hash.

The SQL writer matters: `supabase/migrations/20260709162000_add_canonical_quote_booking_execution.sql:537–581` inserts `agent_actions` and `approvals`, using joined `v_partner_name`; `:601–612` inserts a message containing the name and approval object. It is not sufficient to change one TS display function.

After execution, the same migration `:1084–1094` writes `venue_bookings.approved_terms_snapshot = v_approval.snapshot_json`; `:1183–1194` does the same for `vendor_bookings`. The name/payload can therefore remain in booking rows after the originating approval is cleaned.

Reapproval also copies: `20260709170000_require_canonical_quote_booking_reapproval.sql:335–341` merges `(to_jsonb(v_approval) - 'payment_method_id')` into `plan_messages.metadata.approval`.

**C1/C2:** independently sourced identities before staging; preserve full approval consistency checks. `lib/planner/execution/reapproval.ts:111,118–133` hashes package details/display name/full action payload; `:138–150` detects changes. **D:** include booking snapshots and copied approval-message objects in the same supervised migration policy. Never silently rehash an executable approval, drop FKs or weaken SQL snapshot/provenance checks to permit redaction. Executed records require a separate auditable redaction design preserving financial and consent lineage; pending changes may require reapproval.

### P — canonical action → `admin_tasks` → operator audit/message

`lib/server/concierge-execution.ts:260–278` takes provider from action/provider/target_name and builds description ``Complete the approved concierge handoff with ${provider}.``, `metadata.provider`, and a host message with that provider. `:342–352` calls `enqueue_approved_admin_task` with description/metadata/message. SQL `20260709160000...:294–319` persists description and `p_metadata` in `admin_tasks`. Task before/after copies into `admin_audit_log` are described above.

**C1/C2:** fence descriptive fields and names in both wrapper and RPC; preserve independent booking terms/IDs. **D:** classify task descriptions/metadata/outcomes/messages and both audit snapshots; do not delete operator/financial history wholesale. Paused or already executed actions need explicit status handling, not an invisible rename.

## 4. Correspondence, drafts, reply extraction and opportunity branches

| Status / sink | Quote and chain | Later handling |
|---|---|---|
| P — `outreach_threads` | Gmail helper `:1167–1183` inserts `target_name: input.target.name`, target email, discovery IDs and channel strategy. | C1/C2 use independent identity; D clear/classify the copied name while preserving thread/quote identity. |
| P — outbound `outreach_messages` and Gmail | Gmail helper `:1579–1591` substitutes target names into body templates. `:1046–1065` stores subject, `body_text: input.bodyText`, `body_html: textToHtml(input.bodyText)`, headers and dispatch/approval IDs before dispatch. The name is a prose copy, even if only a salutation. | C1/C2 fence final rendered body as well as template and target. D app copies need scoped redaction. Actual external Gmail messages, recipient copies and exports cannot be assumed erased by database cleanup; no live sending/recalling/mailbox editing is authorized by this inventory. |
| P/C — inbound mail and quote extraction | Gmail helper `:1246–1251` stores imported subject/body text/html. `:1291` reuses saved `thread.target_name`; `:1303–1317` builds full thread text and extraction context. `:1368–1373` passes `entityName: targetName`. Quote tables store extracted terms/excerpts; the entire conversation can quote the earlier Google-derived salutation. | Received terms are independently evidenced, but quoted prior content and generated excerpts require lineage inspection. C1/C2 do not contaminate extraction/logs with provider decorations. D preserve real price/date/terms/reply evidence; classify incidental quoted content separately. |
| P — `plans.metadata.outreach_response_summary` / agent status prose | Gmail helper `:1351,1406` puts `name: targetName` into the response summary. `:1448–1471` merges and saves that summary; `:1473–1479` writes agent status content including the response name. | C1/C2 safe independent label plus stable ID; D summary arrays and matching message prose. |
| C — catalog opportunity drafts and brief rows | `lib/planner/opportunityOutreach.ts:353–375` reads `venues`, and `:383–403` reads `vendor_profiles` (not direct discovery); `:159–177` feeds name/contact/phone/site/details into AI; `:188–200` creates `drafts` and `requirements.outreach_drafts`. `venueOpportunityBriefs.ts:90–104` persists requirements/outreach_message; `vendorOpportunityBriefs.ts:113–126` likewise. | No current automatic Google-content-to-catalog promotion was proved. If catalog/summary lineage is Google-origin, this is a copy path. C1/C2 safe DTO/agent/draft serialization and D inspect actual provenance; do not wipe genuine partner catalog data. |
| C — opportunity invites/actions/public contexts | `lib/planner/opportunityBuilder.ts:399–409` stores invite `target_name`/fit reason; `:418–449` duplicates name in action targets. Current inputs are catalog/matching data, so Google origin is conditional. | Gate shared invite/action serializers. D inspect `venue_opportunity_invites.venue_response_json`, brief/draft fields and saved target arrays when origin warrants it. Token/public rendering is a consumer, not an extra DB sink by itself. |

**Named-table caveat:** searching `outreach_drafts`, `OUTREACH_DRAFTS`, draft-body names and scheduled-send names across `lib`, `app`, `supabase/functions` and migrations found `outreach_drafts` as a nested field and execution label, but no current standalone `outreach_drafts` table creator/writer. The project brief names the table; the current implementation evidence here points to `agent_actions`, `outreach_messages` and brief JSON instead. Do not invent a purge target without checking deployed schema. Scheduled/autonomy columns/indexes exist on `outreach_messages` (`20260601000003_add_outreach_autonomy_policy.sql:44`); future/old workers remain an external-deployment inventory obligation.

## 5. Templates and rebook copies

P: `app/api/planner/templates/route.ts:169–174` loads recommendations; `:197–209` calls `buildTemplateInsert` and inserts `templates`. `lib/planner/templateIdentity.ts:106–115` copies `external_name`, `price_cents` and the **entire recommendation metadata**. `:153–160` also saves run-of-show, shopping list and export copy. The metadata/prose paths described in section 1 therefore extend into templates even though current recommendation `external_name` is often null.

P: `app/api/planner/templates/[id]/apply/route.ts:482–503` copies the template into new/current plan `metadata.template_snapshot`, including `run_of_show`, `shopping_list`, economics and historical performance. Purging a template does not purge already-applied snapshots; automatic fresh recommendations can add more copies.

C: `templateIdentity.ts:169–176` copies canonical `outcome_summary`; free text may contain a copied partner label, but no blanket Google origin is established for an event outcome. Actual attendance/financial history is independent. `export_copy` at `:186–193` uses event type, guest count and plan neighborhood only; it is not currently a full provider-detail export.

Rebook identity itself does not require presentation retention: apply route `:515–542` uses `reference_id ?? id` to populate preferred IDs. Keep actual identifier semantics: template `id` is a recommendation row ID at `templateIdentity.ts:107`, while `reference_id` is the partner reference at `:109`; neither should be guessed into a Place ID.

**C1/C2:** safe template creation, application and automatic refresh; persistence rejection must include nested recommendation metadata and prose. **D:** templates plus every applied plan/version/audit/browser snapshot; preserve event identity, actual partner/financial evidence and rebook IDs. Existing selection-by-recommendation is not proof of a hired partner; WS-5 E2 remains separate, not an excuse to label Google values venue-confirmed.

## 6. Agent runs, errors, traces and generic inputs

**P — `agent_runs` full payloads:** `recommend/route.ts:474–476` sends `candidate_venues: compliantCandidateVenues`; `:1702–1714` passes `inputPayload: payload`, output, model messages and raw model output to logger. `lib/server/agent-runs.ts:39–53` directly inserts `input_payload`, `output_payload`, `messages_payload`, `raw_model_output` and `error` into `agent_runs` without a Places allowlist.

**C — additional logger callers:** `lib/planner/opportunityOutreach.ts:329–342` and `lib/planner/planAgentSummaries.ts:265–278` use the same logger. `app/api/ai/agents/run/route.ts:55–85` accepts validated client payload, runs the agent and logs it in full; failed runs do so at `:96–109`. These endpoints need the same boundary even if the recommendation route is fixed. No current provider-fed payload is proved for every generic caller.

**C — console/error/Sentry surfaces:** `lib/server/google-places-client.ts:321–322` uses `response.text()` as the Google API error message; `:448` embeds that in `Error`. The failure body content is provider-dependent, so do not assert it always contains listing fields. Downstream console/Sentry persistence is a possible copy path and cannot be ruled out by successful-response masking. `lib/server/logger.ts:25` only names password/token/secret/auth keys as sensitive; `:52–67,75–96` writes serialized errors/context to console and Sentry. This is not a Places content filter.

`sentry.server.config.ts:9–16`, `sentry.edge.config.ts:9–16` enable error/tracing when DSN is present; `sentry.client.config.ts:9–33` has error/replay sampling configuration and strips query strings in `beforeSend`. Configuration is **not** proof that replay integrations are active or that actual provider responses were captured. No production Sentry/hosting log/trace contents or retention were inspected.

**C1/C2:** allowlist operational ID/method/status/timing/count/error-class data at every logger/caller; no candidate/raw prompt/output/body copies or provider-derived field hashes as a workaround. **D:** inventory historical `agent_runs`, controlled application/hosting/Sentry logs, debug exports and model-provider retention as separate surfaces. Provider-controlled retention and contractual settings cannot be verified statically and no external deletion is authorized.

## 7. Browser storage, HTTP photo caching and absent persistence evidence

**P — two distinct localStorage copies:**

1. `components/planner/planner-page/plannerState.ts:224–264` stores `planner-live-plan`. Snapshot includes run-of-show/workspace/selected vendors and `messages` is copied whole at `:257–263`.
2. Same file `:358–373` stores the **full** `{ plan, messages, savedAt }` under `activeConversationStorageKey`. `components/planner/planner-page/types.ts:20` aliases that key to `lib/planner/migrateDraft.ts:3`, **`planner-active-conversation`**. Its read path at `plannerState.ts:327–348` restores the whole objects. Completion/new-event clearing is not a provider-retention boundary.

**P — partial merge/resurrection:** `components/planner/plannerLivePlanStorage.ts:5–14` loads old JSON and saves `{...current, plan: {...current.plan, ...plan}}`. `InviteVenueForm.tsx:69` / `InviteVendorForm.tsx:70` call it with response plans. `PlannerLivePlanPanel.tsx:1785–1788` and `:1825–1836` separately rewrite the same cache after quote/timeline updates. Omitting a removed field from a response does not remove old nested content; unchanged `messages` survive.

**P — photo HTTP/CDN/browser cache path (B):** `app/api/planner/discovery-venues/[venueId]/photo/[index]/route.ts:45–61` reads saved `photos`, selects stored `photo.name` and fetches media. `:87–94` returns image bytes with `'Cache-Control': 'public, max-age=86400, s-maxage=86400'`. This permits durable intermediary/browser copies even without a blob upload. Actual CDN copies/lifetime were not queried.

**N within searched code — other client stores:** `rg` across `lib components app public` for `localStorage|sessionStorage|indexedDB|caches\.|serviceWorker|persistQueryClient|createSyncStoragePersister|persist\(` found planner stores above plus UI widths, banner-dismissal flags, signup IDs and independent venue-feature drafts. SessionStorage hits were billing/vendor dismissal flags; no Places session-storage, IndexedDB, service-worker Cache API or persisted query-client writer was found. This does not inspect browser extensions, obsolete clients, framework internals or installed production bundles. In-memory query state is not automatically durable storage.

**C1/C2:** all client writers use the permitted representation; version and invalidate **both** planner keys before restore and reject reintroduction by stale clients. **D:** deliberate legacy cache cleanup/version transition, not merely clearing one current tab. **B:** fresh photo metadata/image+credit and no-store behavior; disable old proxy and invalidate controlled photo caches. Do not promise erasure of every browser or external cache from server-side deletion.

## 8. Analytics, downloads, invoices and other conditional artifacts

**N direct Places dependency — core cross-event analytics:** `lib/planner/mobileReadModels.ts:217–236` reads `events` and `event_financial_summary`; `:260–274` computes profit/margin/repeat/format history. No discovery lookup or Google rating/photo dependency exists in this inspected calculation. Preserve actual event totals.

**C — planner analytics CSV:** `app/(planner)/planner/analytics/page.tsx:252–285` creates a downloadable Blob with event title/date, confidence, financial/check-in numbers and ticket tier fields. It does not export Google phone/address/rating/photos directly. Event titles/tier labels are free text, so manual or prior copying remains conditional lineage, not a proven automated Places export. Once downloaded, local files are outside application DB purge control.

**C — opportunity calendar export:** `components/opportunities/OpportunityResponseForm.tsx:547–573` emits ICS `SUMMARY:${...event.title}` and `DESCRIPTION:${...event.description}`. Catalog/opportunity provenance determines whether these text fields include provider-origin content; the function itself does not fetch Places. Future safe rendering/export inputs must share the boundary.

**C — invoice PDF/storage/email:** `lib/invoices/vendor-invoices.ts:297–303` loads catalog venue name/address/city/state; `:380,458` embeds venue name/location in output; `:656–669` uploads generated PDF to `invoices` storage; `:694–700` produces/stores the URL. This is a real durable artifact writer but **no automatic discovery-to-catalog content promotion was proved**, so Google lineage here is conditional. Catalog business identity must be independent; D must inspect actual artifacts only where lineage warrants it and retain legally required financial evidence. Do not delete invoice files or send replacements as part of inventory.

**N current dedicated planner export writer:** `plan_exports` / `.from('exports')` / `TABLES.EXPORT` searches across app/lib/functions/migrations found no matching current writer. `lib/types/planner.ts:570–580` declares export-shaped types and agent-actions accepts an `export` kind, but types/action labels do not prove a file generator. Generic `agent_actions.payload_json` remains a conditional sink for client-submitted content (`app/api/planner/plans/[planId]/agent-actions/route.ts:413–428`). No dedicated Places PDF/report export was established.

**C — user-uploaded documents/screenshots:** upload/render features exist, but no programmatic Places→receipt/document upload chain was established in the searched code. Users can manually capture content; static source audit cannot inventory those artifacts. This is not authorization for blanket media deletion.

**C1/C2:** prevent restricted display/prose from entering durable exports/artifacts. **D:** keep analytics/financial numbers, inspect text by provenance, include controlled file objects only when an actual affected artifact is identified; outside-recipient/downloaded copies require separately assessed obligations.

## 9. Retention, resurrection and static-audit limits

The generic retention route is not a downstream Places purge. `app/api/cron/retention-cleanup/route.ts:37–51` clears unused venue contact fields after one year; `:53–65` deletes old response rows; `:67–80` redacts outreach bodies/headers/metadata after two years. It does not traverse recommendation messages, templates, versions, approvals, booking snapshots, revisions/audit logs or browser stores. It also mixes independently extracted/organizer emails with phone. Do not reuse this as a blanket compliance cleanup.

`lib/privacy/executeDataDeletion.ts:98–103` explicitly preserves financial/tax records and executes a user privacy-deletion process, not source/field-specific provider retention. Such helpers are not evidence that the Places copies above expire.

Separate companion inventories cover the primary discovery row writers, daily refresh/change log, inference, claims/catalog mirrors and admin reapply. Cross-boundary hazards for this inventory: stale refresh/change events create revision/audit copies; old admin queues can reapply values; old workers/deployments/client blobs can recreate rows after cleanup; template reuse and ordinary message exchanges can copy already-contaminated objects. Only stable ID references do not carry the provider content by themselves.

No production schema was queried, and migrations are evidence of intended deployed state rather than proof every migration has run. No actual row counts/field lineage, old deployment binaries, background job payloads outside the repo, backups/replicas/PITR/WAL, database logs, hosting log drains, Sentry events, model-provider retention, CDN objects, browser caches, Gmail mailboxes, recipient copies or downloaded exports were inspected. A static search cannot prove completeness of actual historical data. The inventory identifies code contracts and concrete surfaces for a separately approved dry run; it makes no physical-deletion/TTL guarantee.

## Search coverage and existing-test pointers

Searches were run against current `lib`, `app`, `components`, `public`, `supabase/functions`, and migrations for table `.from(...)` call sites; `outreach_drafts`/scheduling names; `snapshot`, `to_jsonb`, `before_state`, `after_state`, `trigger_payload`; `logAgentRun`, console/Sentry/loggers; browser persistence APIs; and download/CSV/PDF/Blob/storage/export paths. All major discovered sink families are classified above. Broad search result listings include unrelated ticket/payment/profile sinks; those were not called Places sinks without a content chain. The inventory is not a claim that every arbitrary future/client-authored payload is traced.

Existing regression footholds (not run here):

- `__tests__/integration/planner-recommend-agent-route.test.ts` — recommendation persistence/Places default/Oakland and agent-run payload assertions; existing persistence expectations need deliberate change later, not blind preservation.
- `components/planner/__tests__/PlannerLivePlanPanel.test.tsx` and `components/planner/planner-page/__tests__/plannerState.test.ts` — existing localStorage fixtures; add both-key legacy restore/partial-merge no-resurrection coverage.
- `__tests__/outreach/gmailApprovalFlow.test.ts` — full V2 snapshots, deterministic substitution, dispatch retry/concurrency; preserve approval/idempotency while changing provenance inputs.
- `lib/planner/execution/__tests__/reapproval.test.ts` — full V2 snapshot/hash fields; never weaken it to allow silent cleanup rehash.
- `lib/planner/execution/__tests__/canonicalQuoteBooking.test.ts` — canonical staging/execution/reapproval; add SQL/booking snapshot safe-content fixtures.
- `__tests__/integration/planner-template-creation-eligibility.test.ts`, `__tests__/integration/template-rebook-preferences.test.ts`, `app/api/planner/templates/__tests__/eventIdentity.test.ts` — completed canonical-event eligibility/reference preservation; not provider-retention proof.
- `__tests__/planner/mobileReadModels.test.ts`, planner analytics page tests — numerical/owned-event invariants should remain unchanged.
- `lib/discovery/__tests__/cascadeInvalidation.test.ts`, `lib/planner/__tests__/planRevisions.test.ts`, `lib/server/__tests__/concierge-execution.test.ts`, `__tests__/schema/concierge-execution-migration.test.ts`, and canonical quote schema/realized tests are required integration companions: prove no copy into revision/audit/admin/booking RPC paths, not only app response snapshots.

Required later mixed-fixture acceptance: Google-derived names/prose/metadata rejected from every durable boundary above; equal independently evidenced values survive; IDs/FKs/rebook/financial totals preserved; pending altered consent cannot execute; approved historical redaction is audited without silent rehash; repeat cleanup/template apply/admin jobs/old browser updates cannot resurrect data; photo metadata/bytes follow B; no production test is implied by these fixture requirements.

**Gate A inventory stop:** only this evidence file was written. No implementation, cleanup, outbound communication or execution was authorized or performed.
