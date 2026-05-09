# 3rdSpace — Agent Brief

This document is the source of truth for any AI coding agent working in this repo.
Read it before making any changes. Deviating from these constraints will be rejected in review.

---

## What this product is

**3rdSpace** is an agent-like event operating platform for Bay Area community organizers, startup hosts, and corporate/private event leads.

The core experience is a **chat-first planner**: a user describes an event idea in natural language, the system asks only for missing parameters (date, headcount, budget, neighborhood, ticketed/invite, food/drinks, profit goal), then produces a structured plan with venue/vendor recommendations, a profit window, and approval cards for each actionable step.

**The agent proposes. The user approves. The system executes.**

---

## Roles

| Role | Description |
|---|---|
| `community_builder` | Paying organizer/host. Creates plans, approves actions, manages events. Primary customer. |
| `venue` | Supply-side listing. No account required at MVP — admin-seeded. Claims listing via email. |
| `vendor` | Supply-side listing. Same as venue — no account required at MVP. |
| `admin` | Internal operator. Seeds catalog, manages claim queue, routes concierge tasks. |

---

## Route structure

```
app/
  (auth)/           — signup, login, callback
  (planner)/        — NEW primary experience (agent planner, plans, analytics, etc.)
    planner/        — chat planner UI
    experiences/    — saved event plans / history
    venues/         — venue catalog browse
    vendors/        — vendor catalog browse
    analytics/      — event performance
    payments/       — approvals + payment history
    settings/       — account settings
    tickets/        — ticketing connections
  (dashboard)/      — LEGACY builder/venue/vendor dashboards (do not expand)
```

**Stop expanding `(dashboard)/`.** All new feature work goes under `(planner)/`.

---

## Primary build priorities (in order)

1. **Agent Planner UI** — `app/(planner)/planner/` chat interface, `PlannerLivePlanPanel`, approval cards
2. **Plan data model** — `plans`, `plan_messages`, `plan_versions`, `recommendations`, `approvals` tables (schema already in `supabase/migrations/20260504000002_agent_planner_schema.sql`)
3. **Approval + execution workflow** — three execution modes (see below)
4. **Venue/vendor catalog** — seeded listings, claim flow, `app/(planner)/venues/` and `vendors/`
5. **Templates/Rebook** — save completed plan as template, rebook with new date/headcount

---

## Execution model — NEVER bypass this

Execution has exactly three modes. Do not invent a fourth.

| Mode | When | How |
|---|---|---|
| **Controlled Payment** | Vendor onboarded to Stripe | Stripe payment intent, held until approval |
| **External Checkout** | SeatGeek, OpenTable, Eventbrite, etc. | Deep link only — no browser automation |
| **Concierge/Admin Queue** | High-value, custom, or unsupported | Insert into `admin_tasks` table; human executes |

**Re-approval is required** if price, date, seats, vendor, or terms change after initial approval.
**The agent never auto-executes a purchase.** Approval card must be confirmed by the user first.

---

## Data model

### New planner tables (from migration `20260504000002`)
- `plans` — plan lifecycle (`drafting → ready → approved → executing → complete → archived`)
- `plan_messages` — chat thread (roles: `user`, `agent`, `system`)
- `plan_versions` — snapshot on each approval
- `recommendations` — venue/vendor recs attached to a plan
- `approvals` — per-action approval records
- `agent_actions` — audit log of agent-proposed actions
- `admin_tasks` — concierge queue items

### Reuse from existing tables
- `venues`, `vendor_profiles`, `vendor_offerings` — catalog
- `venue_bookings`, `vendor_bookings` — bookings
- `event_financial_summary`, `event_sales_data` — financial tracking
- `builder_ticketing_connections` — ticket platform integrations
- Stripe patterns in `vendor_stripe_accounts`, `venue_stripe_accounts`

### Catalog / supply-side (from migration `20260504000000/01`)
- Venue and vendor listings have `claim_status` and `claimed_by` fields
- Listings exist without a user account — admin seeds them
- Claim flow triggered by: first host interaction, booking request, or lead notification

---

## Signup flows — do not change step structure without explicit instruction

### Creator / Community Builder (4 steps)
1. Name, email, password
2. Org name, type, social handle, website, bio
3. Event types, avg attendance, preferred amenities
4. **Ticketing platforms** (chips), bulk booking toggle, invite collaborators

### Venue (5 steps)
1. Contact name, role, booking email, phone, password
2. Venue name, type, address, loading dock, capacity, prep time
3. Amenities, photo upload, house rules
4. Bar toggle + revenue settings, base price, deposit, cancellation terms
5. Available days, open hours, calendar sync note

### Vendor (4 steps)
1. Name, business name, email, phone, password
2. Services, service area, portfolio URL, bio
3. Base price, starter package, deposit %, lead time, cancellation terms
4. Available days, emergency vendor toggle + uplift %

All flows route through `components/auth/SignupExperience.tsx` and call `/api/auth/signup`.

---

## Design system

**Theme**: Dark vibrant. Background `hsl(250 30% 7%)`, primary purple `hsl(280 90% 62%)`, coral secondary `hsl(12 95% 60%)`, lime accent `hsl(80 90% 60%)`.

**Fonts**: Space Grotesk (`font-display`) for headings, Inter for body.

**Required patterns for all new UI**:
- Cards: `bg-gradient-card rounded-3xl shadow-card border-border`
- Primary CTA buttons: `variant="hero"` (gradient + glow)
- Secondary actions: `variant="glass"` (frosted glass)
- Gradient text: `text-gradient-brand`
- Smooth transitions: `transition-smooth`

Do not use plain white backgrounds, default rounded corners (`rounded-md`), or Tailwind default shadows. Match the dark vibrant aesthetic.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Auth + DB | Supabase (Postgres, RLS, edge functions) |
| Payments | Stripe (payment intents, Connect) |
| Styling | Tailwind CSS + custom utilities in `globals.css` |
| Testing | Playwright (e2e in `e2e/`), Jest (unit/integration in `__tests__/`) |

### Test email convention

Use `example.com` for deterministic local and E2E signup accounts:
`test-<role>-<timestamp>-<random>@example.com`.

The hosted Supabase project must allow this test domain in Auth email provider settings, or local QA signup checks will fail before app validation runs.

---

## Hard rules

1. **No new routes under `(dashboard)/`** — that section is legacy.
2. **No auto-execution of bookings or payments** — always require user approval.
3. **Venue/vendor listings do not require accounts** — admin seeds supply, claim flow handles onboarding later.
4. **All monetary values stored as integer cents** — never floats.
5. **All new tables need RLS policies** — do not create tables without enabling row-level security.
6. **Do not break existing signup flows** — `SignupExperience.tsx` step count and field names are stable.
7. **Do not remove or rename existing Stripe patterns** — `vendor_stripe_accounts`, `venue_stripe_accounts`, payment intent flows are load-bearing.
8. **Match the design system** — every new component must use the dark vibrant theme utilities.

---

## Removed / out of scope for MVP

- Live transit/weather data
- SMS notifications
- Browser automation for external checkout
- Generic lifestyle planning (not event-specific)
- Full vendor/venue dashboard (ships after MVP)

---

## When in doubt

Ask before building. The product is opinionated about the approval model, data model, and UX flow. A wrong assumption here creates rework. If a task is ambiguous, surface the ambiguity rather than guessing.
