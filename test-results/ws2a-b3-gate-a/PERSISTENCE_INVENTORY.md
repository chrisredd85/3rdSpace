# DATA — Complete Gate A persistence-path inventory

Baseline `b0f038150cee1fbbe34e2714ebd39faba9fd5c28`. This index and its two evidence appendices form the inventory. Every named existing path below remains unchanged in Gate A. B/C1/C2/D are B3 implementation gates, not the similarly lettered workstream items in the master brief.

**Scope:** current repository source-to-sink paths, including TS/TSX, SQL RPCs/migrations, jobs, browser storage and photo cache policy. The appendices quote current code, list field-level content and distinguish proven receiving paths from conditional/legacy paths and absent evidence. This is not a production-row, deployment, browser, CDN or backup census; that requires a separately authorized dry run. No external data was inspected.

## Inventory and activation/cleanup owners

| Persistence family | Google content / derivatives that can land there today | Later fence / historical cleanup | Quoted evidence |
|---|---|---|---|
| `discovery_venues` — helper plus separate discover route | Name/address/derived city/lat/lng/phone/site/rating/count/status; JSON type/price/status duplicates, derived cluster/subspace | C1; B for photos; D existing fields/copies | [Direct §2](persistence-discovery.md#2-direct-venue-row-writer--complete-field-map) |
| `discovery_vendors` | Name/address/derived city/phone/site/rating/count/price/status/types; `website_extraction_metadata.google_primary_type` | C2; B photos; D | [Direct §3](persistence-discovery.md#3-direct-vendor-row-writer--complete-field-map) |
| Both candidate tables / catalog-shaped projections | Derived venue fit score; request JSON is mostly own intent, not a response. In-memory projection carries names/tags/estimates/contact into downstream writers | C1/C2; D provenance-aware cleanup | Direct §4 |
| Stored photo arrays / legacy `google_photo_names` / `opening_hours_json` | Photo names/dimensions/author names/URIs; legacy columns lack a current producer but may contain historical content | B prevent/cache control; D legacy cleanup | Direct §6 |
| Photo proxy / HTTP browser-CDN policy / framework boundary | Uses stored names, returns photo bytes with one-day public cache header. No proven app blob store for these media bytes | B; D controlled existing copies | Direct §6; downstream §7 |
| Refresh/change history/admin replay | Updated listing fields, `old_value`/`new_value`, reapplication of old Google values; refreshed timestamps are not field-level TTL | C1/C2 before D | Direct §5 |
| Contact extraction / enrichment metadata | Google site/name/type bootstrap; actual page emails/forms may be independent; context/error/source-label ambiguity remains | C1/C2 eligibility and evidence; D selective classification | Direct §7 |
| Capacity/rate estimates and admin review | Google-dependent estimates, confidence/source quote/model/time; same rate columns also receive independent vendor base rate | C1/C2; D preserve independent values | Direct §7–8 |
| `app_jobs` payload/result | Current capacity input is ID-only; result persists inferred capacities/confidence. Optional snippet-bearing payloads are conditional | C1/C2; D results/legacy payloads | Direct §7 |
| `recommendations`, `plan_messages` JSON and prose | Candidate response objects, provider-fed reasoning, names, contacts, derived estimates and summaries | C1 complete venue path before enablement; C2 shared/vendor path; D | [Downstream §1](persistence-downstream.md#1-recommendations-messages-operational-prose-and-plans) |
| `plans.metadata` / `plan_versions` | Shopping list names/reasons, agent cache/timeline/workspace summary; entire plan snapshots propagate prior content | C1/C2; D each copied surface | Downstream §1 |
| `plan_revisions`, `audit_logs`, `admin_audit_log` | Trigger `new_value`, whole before/after plan/task state, copied action content; TS and SQL writers | C1/C2 including RPCs; D | Downstream §2 |
| `agent_actions`, `approvals`, approval messages | Recipient/target names, drafts/previews/package descriptions, snapshot JSON and derivatives/hashes | C1/C2 independent identity before staging; D explicit consent/redaction policy | Downstream §3 |
| Canonical venue/vendor bookings / reapproval copies | Joined discovery name enters SQL-staged action/approval/message, then `approved_terms_snapshot` on bookings | C1/C2 SQL + TS; D audited migration preserving money/consent | Downstream §3 |
| `admin_tasks` and completion/cancellation copies | Provider/target names and concierge description; task snapshots in admin audit/messages | C1/C2; D | Downstream §3 |
| `outreach_threads`, `outreach_messages`, Gmail copies | Target name, rendered subject/body/html/quoted correspondence; actual partner terms remain independent evidence | C1/C2 draft/send serialization; D app copies; external copies require separate assessment | Downstream §4 |
| Opportunity briefs/invites/drafts and generic actions | Conditional mixed-source catalog/free-text content. No current standalone `outreach_drafts` writer established | C1/C2; D where lineage warrants | Downstream §4, §8 |
| Templates and applied snapshots | Entire recommendation metadata, shopping list/run-of-show, copied `template_snapshot`, automatic refreshed recommendations | C1/C2 create/apply/refresh; D originals and applied copies | Downstream §5 |
| `agent_runs`, console/errors/Sentry/host logs | Recommendation input/output/messages/raw output; conditional provider error bodies and context | C1/C2 allowlists; D configured historical copies | Downstream §6 |
| `planner-live-plan` browser storage | Snapshot + complete messages; partial merges can resurrect removed fields | C1/C2 all writers and restore/version boundary; D legacy storage | Downstream §7 |
| `planner-active-conversation` browser storage | Full plan + messages, independently of live-plan key | C1/C2 + D, both keys | Downstream §7 |
| Analytics, downloads/ICS/invoice files/media uploads | Core financial math has no direct Places dependency; text/catalog/artifact lineage is conditional. Invoice PDF storage is a real sink, not proven direct Places promotion | C1/C2 safe inputs; D only affected independently classified artifacts | Downstream §8 |
| Supply scout, schema-only fields, mirrors/aliases | Schema can hold mixed text; no current automatic Places-to-scout/catalog promotion found. Reverse partner-to-discovery mirror is independent | C1/C2 preserve independent flow; D historical provenance inventory | Direct §4, §8 |
| Other browser stores / caches / dedicated export tables | No Places-specific sessionStorage/IndexedDB/service-worker/persisted-query writer or dedicated plan-export writer established in searched code | Recheck during activation; D separately authorized deployed-state census | Downstream §7–9 |
| Backups, replicas, WAL/PITR, logs, old clients/workers, external AI/email/download recipients | Copies depend on deployments/configuration/history not inspected here; database cleanup alone does not establish deletion | B/C1/C2 prevent resurrection; D authorized census/remediation | Both appendices' limits |

**Identity exemption is not row exemption:** stable internal IDs and Place IDs must survive. Host intent, independent contact/quote/price/financial facts may coexist with restricted content in the same row. Do not purge by entity source, equal values or broad prefixes. Coordinate request bounds may be app constants; they are not all returned Google coordinates.

## Critical dependencies preserved for later gates

1. Fence both venue initial writers and the vendor writer, then refresh/admin replay, shared messages/templates/agent logs, browser stores, SQL revisions/audits/staging/booking copies and job results. A serializer existing in a module is not enforcement.
2. Complete each activated flow's reader and persistence coverage before enabling retrieval; unfinished shared sinks block activation for that flow.
3. Request-only Google coordinates do not erase earlier retained coordinates. Photo-name/history/log/client copies need deliberate cleanup. No cleanup is executed now.
4. Preserve independent business records and UUID/FK identity. Never silently rehash approvals or erase genuine quote/payment evidence. Pending executable changes require explicit consent handling.
5. The current generic contact/outreach retention cron does not implement a Places purge. Inspect controlled backups/caches/older workers separately; do not claim physical deletion from static code.

## Evidence appendices

- [Direct discovery / row / history / inference / photo paths](persistence-discovery.md): full per-field map, quoted writes, callers, independent-source distinctions, existing tests and later owner.
- [Downstream / SQL / correspondence / template / log / browser / artifact paths](persistence-downstream.md): quoted assignments and RPC inserts, copied consent records, conditional/absent paths, tests and limits.

Gate A changes none of these paths. No paid/live Places request, business-site crawl, outreach, production query/write or cleanup was performed.
