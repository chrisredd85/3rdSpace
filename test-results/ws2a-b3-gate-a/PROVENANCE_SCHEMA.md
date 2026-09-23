# DATA — Gate A dormant provenance and boundary contract

Baseline: `b0f038150cee1fbbe34e2714ebd39faba9fd5c28`. This is an application-side model and isolated serializer, not a database migration or active write policy.

## Existing columns, no physical schema changes

`lib/discovery/foundation/fields.ts` declares allowable independent-value fields by existing column name. TypeScript checks the names against the existing generated `discovery_venues.Row` and `discovery_vendors.Row` types. There is no new table, database column, constraint, trigger, ORM writer or generated-type modification. Values are nullable/missing at the adapter boundary. Current NOT NULL columns (including venue name/city/state and vendor name/service_type) remain unchanged. Their physical compatibility migration belongs to activation, before any active reader/writer cutover.

The new reader takes a row and a **separate** per-field provenance map. No map is read from or written to production today. `field_provenance` in the new DTO/output is a proposed application contract, **not an existing database column**. A future gate must explicitly select/implement its durable placement and trusted acquisition writers; this gate does not silently overload venue metadata or vendor website-extraction metadata. No normalized fact table is introduced.

The field allowlist covers:

- Venue: name/address/neighborhood/city/state; independently acquired lat/lng; email/phone/site/Instagram; seated/standing/cocktail and inferred capacity; vibe tags, alcohol policy, AV, parking; price-hint cents and note.
- Vendor: name/service type/address/city/state; site/phone/contact and organizer-provided email; hourly/package/minimum rate estimates in integer cents.
- Provider ratings/counts/status/types/photos and arbitrary JSON are not independent-value fields. They may exist only in the transient overlay in this contract. This does not change their existing production columns or writers.

## Provenance shape

```ts
type FieldProvenance = {
  resolution: 'resolved'
  source: 'google_places' | 'venue_site' | 'host_input' | 'outreach_reply' | 'derived'
  evidence_reference: string
  collected_at: string // explicit timezone-bearing timestamp
  confidence: number | null // 0..1; separate from confirmation
  confirmation_status: 'unconfirmed' | 'site_published' | 'venue_confirmed'
  lineage: Array<{ field: string; provenance: FieldProvenance }>
} | {
  resolution: 'unresolved'
  reason: 'missing' | 'invalid' | 'unknown_lineage'
}
```

Evidence references identify evidence; they are not copied page text, Google response bodies or raw model input. Derived facts require nonempty lineage. Missing/malformed provenance, unsupported sources, missing evidence/timestamp, invalid confidence or unknown ancestry remain unresolved. Parsing is bounded to avoid recursive/cyclic legacy inputs exhausting the stack.

Acquisition and confirmation are distinct. `retentionOrigin` follows ancestry: any Google ancestor makes a value `google_derived`; otherwise unknown ancestry makes it unresolved; only fully independently evidenced ancestry is eligible. Row-level source, a claim/approval flag, string equality or model confidence never establishes independence. A Google-dependent estimate keeps `source: derived` and Google ancestry and is classified `google_derived`; its parsed display confirmation is forced to `unconfirmed`, as explicitly requested by this gate. The input evidence is not mutated. This normalization is not an approval-history rewrite; no history writer is connected. A later independently obtained partner answer is a separately evidenced fact, not a relabeling of the old estimate.

Example: two `capacity_seated=60` values can carry site-published evidence with confidence 0.8 or an independently captured outreach reply with venue-confirmed status and confidence 1. Identical numbers do not merge those origins. Numeric confidence is not proof of retention rights.

## Transient boundary and isolated durable projection

`createTransientDiscovery` owns a frozen snapshot of identity, values, field provenance and `googleLive`. Mutating the original input after construction cannot pair a new Google value with stale independent evidence. Direct `JSON.stringify` throws and asks for the explicit serializer.

`serializeDiscovery` defaults to rejection. Any live Google overlay, disallowed field, Google-derived value or populated field with unresolved/invalid evidence causes a field-only error. `strip` mode emits only eligible allowlisted independent values and their parsed provenance, plus stable internal identity/Place ID and contract version. It never spreads arbitrary source rows, JSON metadata, photo names or model payloads. Raw values and unknown input key names are not echoed into errors. Known zero/false remain known values, not missing data. No Google coordinates pass the proposed durable projection; independently acquired coordinates may.

This is deliberately **not a universal text scrubber**. Provenance supplied by a caller can be false; future acquisition paths must establish evidence server-side. Arbitrary object spread, console inspection or copying values outside the DTO cannot be prevented by a TypeScript type or JSON guard. Later gates must wire and test every TS, SQL, job and browser sink in the inventory. Gate A proves only the isolated contract and explicitly does not establish current storage compliance.

## Compatible readers and dormant UI

`readDiscoveryFields(kind, row, provenance?)` tolerates legacy/sparse rows without the new map. It returns `available` only for validated, independently evidenced values, or `unavailable` with a missing/invalid/unresolved/Google-content reason. It never guesses evidence from row source or approval. `DiscoveryFieldValue` displays “Unavailable,” renders known zero as `0`, false as `No`, and an explicit empty list as `None`. It is not imported by any existing display.

`parseGooglePhotoAttribution` accepts one fresh photo object, retains supplied authors' names/profile URIs and its individual `googleMapsUri`, and removes malformed/unsafe links. `GooglePlacesAttribution` renders those links and Google Maps text; no photo fetching, transport, image display, caching or live attribution cutover occurs. Fresh image/credit pairing, full presentation policy, proxy no-store and cache cleanup remain Gate B.

## Explicit activation exclusions

No coordinate writer stops. No live writer rejects/strips fields. No current display uses unavailable or attribution components. No field mask, ranking, retrieval, photo endpoint, cache header, cron, queue, logger, SQL RPC, localStorage key, approval hash or schema constraint changes. No feature flag is installed: unreferenced modules are dormant without a flag capable of accidental activation.

Activation must preserve UUIDs/FKs, actual quote/financial evidence, immutable consent semantics and rebooking identity. Coordinate/photo/history cleanup remains required separately even though future coordinates are request-only. Rollback must not reactivate prohibited persistence. These are later-gate obligations, not work performed here.
