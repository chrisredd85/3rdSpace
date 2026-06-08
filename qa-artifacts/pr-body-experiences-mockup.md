# feat(planner): visual mockup of rebuilt experiences page (Phase 1, no real data)

## Scope

This PR adds a static visual mockup for the proposed Experiences replacement at `/planner/experiences/mockup`.

- Mockup-only: hardcoded sample data, local React state, no Supabase reads/writes.
- Existing `/planner/experiences` remains untouched.
- No migrations, API routes, auth redirects, env changes, or production data wiring.
- No real approvals, payments, bookings, or outbound messages are executed.
- Added `/planner/experiences/mockup` to the mobile-promoted planner shell path list so the mockup is usable on narrow screens.

## Product Intent

The page is a multi-event booking operating record for recurring community hosts who run professional events but are often doing this alongside another job. It keeps the interface focused on:

- What needs the host now.
- Which recurring event is being handled.
- The current Plan, Bookings, Money, and Guests state.
- Approval-gated venue/vendor actions.
- Profitability and break-even visibility without turning the product into generic planning software.

## Screenshots

Default urgent desktop:

![Default urgent desktop](qa-artifacts/experiences-mockup/desktop-urgent.png)

Calm state desktop:

![Calm desktop](qa-artifacts/experiences-mockup/desktop-calm.png)

Mobile 375px:

![Mobile 375](qa-artifacts/experiences-mockup/mobile-urgent-tall.png)

Tablet 768px:

![Tablet 768](qa-artifacts/experiences-mockup/tablet-urgent.png)

Venue expanded:

![Venue expanded](qa-artifacts/experiences-mockup/desktop-venue-expanded.png)

Photo expanded:

![Photo expanded](qa-artifacts/experiences-mockup/desktop-photo-expanded.png)

Money expanded:

![Money expanded](qa-artifacts/experiences-mockup/desktop-money-expanded.png)

Approval modal:

![Approval modal](qa-artifacts/experiences-mockup/desktop-approval-modal.png)

## Validation

- `npm run type-check` passed.
- `npm run lint` passed with existing hook dependency warnings outside this change.
- `npm run build` passed with existing Sentry/upload and hook dependency warnings.
- Auth-protected route check: unauthenticated `/planner/experiences/mockup` redirects to login; authenticated route returns 200.
- Browser visual QA captured desktop, tablet, and mobile states from the local Next dev server.
- Browser console showed external Sentry ingest 400s during local capture; no mockup route error overlay or local asset failure was present after a clean dev server restart.
- Interactive QA confirmed event-card switching, Money drilldown expansion, and updated `$30` 3rdPlace per-event fee copy.

No `--no-verify` was used.

## Phase 2 Notes

If approved, wire this pattern to real planner data and then replace `/planner/experiences`:

- Event list from saved plans/events.
- Bookings from `venue_bookings`, `vendor_bookings`, approvals, and partner terms.
- Money from `event_financial_summary`, `event_sales_data`, platform fee/pricing rules, deposits, and committed/estimated costs.
- Guest state from ticketing syncs and RSVP/check-in data.
- Approval actions through existing approval records only; no booking, payment, or outbound message should execute without approval.
