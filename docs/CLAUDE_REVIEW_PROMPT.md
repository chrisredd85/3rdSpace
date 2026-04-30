# Claude Review Prompt

Use this as a read-only review prompt in a separate Claude window.

```text
You are reviewing a Next.js 14 + Supabase app at /Users/chrisredd/3rdSpace.webapp.

Do not edit files. Do not run destructive commands. Act as a senior code/schema reviewer.

Context:
- The app is a marketplace for event builders, venue owners, and vendors.
- The canonical DB model is documented in docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md.
- The generated DB truth is lib/types/database-generated.ts.
- App-facing DTOs/adapters now live in:
  - lib/venues/venue-adapter.ts
  - lib/bookings/venue-booking-adapter.ts
  - lib/bookings/vendor-booking-adapter.ts
  - lib/bookings/availability-adapter.ts
- The comprehensive seed is supabase/seed.sql.

Recent implementation focus:
- Venue and vendor booking routes were moved off stale columns like profiles, events.title, venues.name, venue_bookings.requested_date, messages.is_read.
- Generic messages now support messages.venue_booking_id.
- Growth indexes were added for marketplace, booking, and message access paths.

Review goals:
1. Find remaining schema drift risks where code still queries columns/tables that do not exist in lib/types/database-generated.ts.
2. Focus especially on vendor bookings, messages, notifications, availability, invoices, payments, reviews, and analytics.
3. Check whether new adapters are used consistently or whether direct DB rows leak into UI-facing code.
4. Look for RLS/authorization mistakes where builder_profile.id, vendor_profile.id, or auth user id may be confused.
5. Look for migrations that are not idempotent or that could fail when optional tables are absent.
6. Return findings first, ordered by severity, with file paths and line numbers.
7. Include a short prioritized next-work list after the findings.

Do not propose broad rewrites unless needed. Prefer focused, actionable issues.
```
