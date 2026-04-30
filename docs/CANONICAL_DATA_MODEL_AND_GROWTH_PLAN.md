# Canonical Data Model and Growth Plan

> Date: 2026-04-30  
> Status: working plan  
> Purpose: reconcile the app, TypeScript types, migrations, and seed data around one marketplace data model before real growth traffic exposes schema drift.

## Current Finding

The operational source of truth is the actual Supabase schema after migrations, not the hand-maintained `lib/types/database.ts` file. During seed generation, the local database exposed these important differences:

| Area | Current database reality | App/type assumptions seen in code |
|---|---|---|
| Profiles | `public.users`, `builder_profiles`, `owner_profiles`, `vendor_profiles` | Some routes query `public.profiles` |
| Venues | `venues.venue_name`, `standing_capacity`, `seated_capacity`, `is_published` | Many reads expect `name`, `capacity`, `is_active`, `is_verified`, `photo_url` |
| Events | `events.event_name`, `expected_attendance`, statuses `draft`, `venue_pending`, `confirmed`, `cancelled`, `completed` | Types expect `title`, `expected_attendees`, statuses like `planning` |
| Venue bookings | `venue_bookings` is the modern booking table | Legacy `bookings` still exists and generic messages depend on it |
| Vendor bookings | `vendor_bookings` is the modern booking table | Vendor messaging has both generic and newer-table variants |
| Messaging | `messages.booking_id` references legacy `bookings`; `vendor_booking_id` exists without the same FK shape | APIs reference `profiles` for sender display data |
| Enums | DB check constraints are the effective enum set | `lib/types/enums.ts` has incompatible values |

This is not just naming drift. It affects core growth paths: marketplace search, booking requests, chat, notifications, and analytics.

## Canonical Model

Use these tables as the canonical domain model until a deliberate migration changes them.

| Domain | Canonical table(s) | Notes |
|---|---|---|
| Auth identity | `auth.users` | Supabase-owned. App seed scripts should not write here. |
| App user | `public.users` | One row per auth user. Contains `role`, `user_type`, account status, billing flags. |
| Builder profile | `public.builder_profiles` | Builder-specific profile and billing/event usage metadata. FK: `user_id -> users.id`. |
| Venue owner profile | `public.owner_profiles` | Owner/operator account metadata. FK: `user_id -> users.id`. |
| Vendor profile | `public.vendor_profiles` | Vendor account/listing metadata. FK: `user_id -> users.id`. Existing `lib/vendors/profile-adapter.ts` is the pattern to follow. |
| Venue listing | `public.venues` | Canonical venue listing. `spaces` is legacy and should not power new product surfaces. |
| Venue listing details | `venue_amenities`, `venue_amenity_types`, `venue_rules`, `venue_photos`, `venue_requirements` | Keep as child tables. |
| Event | `public.events` | Canonical builder event. App-facing DTO may use `title`, but DB field is currently `event_name`. |
| Venue booking | `public.venue_bookings` | Canonical builder-to-venue request/booking table. |
| Vendor booking | `public.vendor_bookings` | Canonical builder-to-vendor request/booking table. |
| Vendor services | `vendor_offerings`, `vendor_packages`, `vendor_availability` | Canonical vendor service/catalog/calendar tables. |
| Messaging | One thread/message system tied to events and booking ids | Target shape should avoid legacy `bookings` as a required dependency. |
| Notifications | `public.notifications` | Use DB enum values: `new_booking_request`, `booking_confirmed`, `booking_declined`, `new_message`, `payment_received`, `review_posted`, `reminder`. |

## App-Facing DTOs

Keep user-facing code ergonomic, but adapt from DB rows in one place.

### Venue DTO

`Venue` should be an app-facing DTO produced by a venue adapter:

| App field | Current DB source |
|---|---|
| `id` | `venues.id` |
| `owner_id` | `venues.owner_id` |
| `name` | `venues.venue_name` |
| `capacity` | `venues.standing_capacity` |
| `min_capacity` | nullable derived value or future column |
| `max_capacity` | `venues.standing_capacity` |
| `is_active` | `venues.is_published` |
| `is_verified` | `venues.is_published` until a real verification column exists |
| `photo_url` | primary row from `venue_photos`, or `null` |
| `daily_rate` | derive from hourly rate and minimum hours, or keep `null` until added |

### Event DTO

| App field | Current DB source |
|---|---|
| `title` | `events.event_name` |
| `expected_attendees` | `events.expected_attendance` |
| `budget` | `events.budget` or `events.total_budget` |
| `status: planning` | map to DB `draft` if the UI needs the word planning |
| `status: in_progress` | do not use until DB constraint supports it |

### Vendor DTO

Keep `lib/vendors/profile-adapter.ts` as the canonical pattern. Expand it only when schema adds real address, website, or verification fields.

## Work Plan

### Phase 0: Freeze The Map

Goal: stop accidental drift before deeper changes.

- Add a generated Supabase type output, separate from app DTOs, for example `lib/types/database-generated.ts`.
- Add `npm run db:types` using `supabase gen types typescript --local`.
- Rename the current hand-written types mentally and in docs: they are DTO contracts, not DB truth.
- Add a short schema-audit check that fails when high-risk assumed columns are missing, such as `profiles`, `venues.name`, or `events.title`.

Acceptance criteria:

- Engineers know whether they are importing raw DB types or app DTO types.
- `npm run type-check` can no longer hide table/column mismatch by using stale hand-written interfaces.

### Phase 1: Adapter Layer For Read Paths

Goal: keep UI stable while reading the real schema.

- Add `lib/venues/profile-adapter.ts` or `lib/venues/venue-adapter.ts`, matching the vendor adapter pattern.
- Update venue read paths to select real DB columns and normalize to `Venue` DTO:
  - `lib/hooks/useVenues.ts`
  - `lib/hooks/useInfiniteVenues.ts`
  - `app/api/venues/route.ts`
  - `app/api/venues/search/route.ts`
  - `app/sitemap.ts`
  - builder venue marketplace pages
- Add `lib/events/event-adapter.ts` for `event_name -> title`, attendee naming, and status mapping.
- Remove direct use of impossible venue fields from queries: `name`, `capacity`, `is_active`, `is_verified`, `daily_rate`, `photo_url`.

Acceptance criteria:

- Venue marketplace loads from a reset local database plus `supabase/seed.sql`.
- Event pages show names, dates, budgets, and statuses using one adapter.

### Phase 2: Messaging Consolidation

Goal: make chat reliable under real booking traffic.

- Decide target message schema:
  - Preferred: `message_threads` owns `booking_type` and `booking_id`; `messages` only references `thread_id`.
  - Alternative: add explicit nullable `venue_booking_id` and `vendor_booking_id` FKs to both `message_threads` and `messages`.
- Stop generic message APIs from querying `public.profiles`; resolve participants through `users` plus role-specific profile tables.
- Backfill current seed/generic venue conversations away from legacy `bookings`.
- Update:
  - `app/api/messages/threads/create/route.ts`
  - `app/api/messages/threads/[threadId]/route.ts`
  - `app/api/messages/send/route.ts`
  - venue and vendor booking modals
- Add RLS policies and tests for builder-venue and builder-vendor conversations.

Acceptance criteria:

- Builder, venue owner, and vendor can each open a seeded thread.
- Messages are tied to `venue_bookings` or `vendor_bookings`, not legacy `bookings`.
- There is one supported sender display path.

### Phase 3: Booking Table Cleanup

Goal: make booking analytics and operations clear.

- Declare `venue_bookings` and `vendor_bookings` canonical in code comments and docs.
- Move any remaining production reads from legacy `bookings`/`spaces` to `venue_bookings`/`venues`.
- Keep `bookings` and `spaces` only for migration/backfill compatibility until no code path depends on them.
- Create a deprecation migration or compatibility view if old data must remain queryable.

Acceptance criteria:

- New booking creation never writes `bookings` or `spaces`.
- Venue request dashboards, vendor request dashboards, analytics, notifications, and messages all use modern booking tables.

### Phase 4: Enum Alignment

Goal: eliminate contradictory business states.

- Generate or centralize enum constants from DB constraints.
- Align event statuses:
  - DB: `draft`, `venue_pending`, `confirmed`, `cancelled`, `completed`
  - App labels: planning, venue pending, confirmed, cancelled, completed
- Align event types:
  - DB: `networking`, `conference`, `workshop`, `social_mixer`, `product_launch`, `all_hands`, `other`
  - App labels can still say party/meeting, but stored values must be valid.
- Align pricing models and notification types.

Acceptance criteria:

- No API route accepts an enum value that the DB rejects.
- No UI filter sends an enum value that returns impossible results.

### Phase 5: Growth Traffic Hardening

Goal: keep the marketplace usable as rows grow.

- Add pagination and indexes for marketplace lists:
  - venues by `is_published`, `city`, `venue_type`, `standing_capacity`, `hourly_rate`
  - vendors by `is_published`, `service_type`, `regions_served`, rating
  - bookings by organizer/vendor/venue/date/status
  - messages by thread and `created_at`
- Add realistic seed scenarios to E2E fixtures so dashboards load with non-empty states.
- Add RLS regression tests for all three roles.
- Add server-side rate limits or abuse protections for message send and booking request creation.
- Add structured logging for payment, booking, and messaging events before launch traffic.

Acceptance criteria:

- List pages remain fast with thousands of venues/vendors/bookings.
- Each role can only see its own private bookings/messages under RLS.

### Phase 6: Cleanup And Documentation

Goal: make future development boring in the best way.

- Update `TECHNICAL_HANDOFF.md` once the model is reconciled.
- Replace "database.ts is ground truth" language with "generated DB types are ground truth; adapters define app DTOs."
- Remove orphaned or impossible APIs after compatibility windows close.
- Keep `supabase/seed.sql` aligned with this model and rerun it during local resets.

Acceptance criteria:

- A new engineer can follow docs, reset Supabase, seed data, run the app, and see all three role flows work without schema guessing.

## Recommended First PRs

1. **DB type generation and documentation cleanup**
   - Add `db:types` script.
   - Generate `lib/types/database-generated.ts`.
   - Update docs to distinguish DB rows from app DTOs.

2. **Venue adapter and venue read-path fix**
   - Add venue adapter.
   - Fix all venue marketplace/API reads to select real columns.
   - Verify seeded venue marketplace.

3. **Event adapter and enum fix**
   - Add event adapter.
   - Update event statuses/types in `lib/types/enums.ts`.
   - Ensure event wizard/API writes valid DB values.

4. **Messaging participant/profile fix**
   - Remove `public.profiles` reads.
   - Resolve participant display data from `users` and role profiles.

5. **Messaging booking migration**
   - Migrate message booking references to modern `venue_bookings` and `vendor_bookings`.
   - Backfill seeded/local data and add RLS tests.

6. **Legacy booking deprecation**
   - Stop new writes to `bookings`/`spaces`.
   - Add compatibility views only if historical data needs read access.

## Execution Update

Completed in the first implementation pass:

- Added `npm run db:types` and generated `lib/types/database-generated.ts`.
- Added `scripts/schema-audit.sql` plus `npm run db:audit`; local audit passes against Supabase.
- Added `saved_venues` migration so saved venue flows no longer depend on a missing table.
- Added venue, venue booking, and availability block adapters.
- Updated venue marketplace/read paths to use `venue_name`, `standing_capacity`, and `is_published`.
- Updated venue-owner request, bulk approval, booking update, stats, calendar, and block routes to use canonical booking/block columns.
- Updated vendor block routes to use canonical polymorphic availability blocks.
- Repaired the generic message thread/create/send/read paths away from `public.profiles` and `messages.is_read`.
- Updated event writes and form options so stored event types satisfy the DB constraint.
- Verified `npm run type-check`, `npm run db:audit`, and `git diff --check`.

Completed in the second implementation pass:

- Added `lib/bookings/vendor-booking-adapter.ts` and moved vendor booking list/detail/approve/reject responses through it.
- Removed stale vendor booking joins to `profiles`, `events.expected_attendees`, `venues.name`, and non-existent package fields.
- Added `messages.venue_booking_id` and moved venue generic messages off legacy `messages.booking_id`.
- Regenerated `lib/types/database-generated.ts` after the message-reference migration.
- Added low-risk growth indexes for venue/vendor marketplace filters, booking dashboards, and message timelines.
- Reran `supabase/seed.sql` successfully after the new migrations.
- Added `docs/CLAUDE_REVIEW_PROMPT.md` for read-only second-pass review.

## Open Decisions

- Whether to rename DB columns to app-friendly names or keep DB names and rely on adapters. Recommendation: keep DB names for now and use adapters; column renames are high-churn and should wait until booking/messaging are stable.
- Whether to preserve `public.profiles` as a compatibility view. Recommendation: create a read-only view only if message UI needs a simple participant lookup during transition.
- Whether `message_threads.booking_id` should remain polymorphic. Recommendation: acceptable short term with `booking_type`; explicit FK columns are safer long term.
