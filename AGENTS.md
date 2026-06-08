# 3rdPlace — Agent Brief

This document is the source of truth for any AI coding agent working in this repo.
Read it before making any changes. Deviating from these constraints will be rejected in review.

> **Repo note:** the directory is `3rdSpace.webapp` for legacy reasons. The product is **3rdPlace** (capital P). Use "3rdPlace" in all user-facing copy.

---

## Canonical product contract

**3rdPlace is an agent-first event operating system for Bay Area hosts.**
The agent proposes. The host approves. The system executes. It is not a marketplace.

**Primary user:** community builders (recurring hosts running events). Every product decision is made for them first. Venues and vendors are *partners*, not the primary audience.

**Core loop:**
1. Host describes the event in chat
2. Agent drafts a plan (venues, vendors, economics, timeline)
3. Host approves each actionable step
4. System books / pays / sends on approval
5. Host reviews outcome → templates / rebooks

**Supply acquisition:** primarily **autonomous outreach** (Gmail loop, multichannel, discovery enrichment). Self-serve vendor/venue signup exists and is maintained, but is a secondary surface — not co-equal on the homepage.

---

## Roles

| Role | Description |
|---|---|
| `community_builder` | Paying host. Creates plans, approves actions, manages events. **Primary customer.** |
| `venue` | Partner. May self-serve signup; most are reached via autonomous outreach and seeded as `discovery_venues` until claimed. |
| `vendor` | Partner. Same model as venue. |
| `admin` | Internal operator. Runs supply-scout console, claim queue, outreach review, concierge tasks. |

---

## Route structure

```
app/
  (auth)/           — signup, login, callback
  (marketing)/      — homepage, pricing, faq, privacy, terms
  (planner)/        — PRIMARY experience
    planner/        — chat planner UI
      outreach/     — outreach threads + drafts
      experiences/  — saved event plans / history
      venues/       — venue catalog + discovery
      vendors/      — vendor catalog
      analytics/    — event performance
      payments/     — approvals + payment history
      templates/    — saved playbooks
      messages/     — host inbox
      billing/      — subscription
      settings/     — account settings
      tickets/      — ticketing connections
  admin/            — internal ops: supply-scout, outreach review, claims, concierge, ops, health
  v/[discoveryVenueId]/ — public partner landing for outreach links
  (dashboard)/      — LEGACY partner dashboards. Maintained, not extended.
```

**Hard rule:** no new routes under `app/(dashboard)/`. All new feature work goes under `(planner)/` or `admin/`.

---

## Primary build priorities (in order)

1. **Agent Planner UI** — `app/(planner)/planner/` chat, live plan panel, approval cards
2. **Approval + execution workflow** — three execution modes (see below)
3. **Autonomous outreach loop** — Gmail send/poll, reply classifier, draft composer, autonomy policies, eval corpus
4. **Discovery + supply-scout** — `discovery_venues`, enrichment jobs, admin supply-scout console
5. **Templates / rebook** — save completed plan as template, rebook with new date/headcount
6. **Analytics** — event performance feedback into planner recommendations

---

## Execution model — NEVER bypass this

Execution has exactly three modes. Do not invent a fourth.

| Mode | When | How |
|---|---|---|
| **Controlled Payment** | Vendor/venue onboarded to Stripe | Stripe payment intent, held until approval |
| **External Checkout** | SeatGeek, OpenTable, Eventbrite, etc. | Deep link only — no browser automation |
| **Concierge/Admin Queue** | High-value, custom, or unsupported | Insert into `admin_tasks` table; human executes |

**Re-approval is required** if price, date, seats, vendor, or terms change after initial approval.
**The agent never auto-executes a purchase, booking, payment, or outbound message.** Every send/book/pay requires an approval record.

For outreach specifically: autonomy policies (`creator_outreach_policies`) gate what the agent may send without per-message approval, but the host always sets the policy explicitly. Default is approval-required.

---

## Data model

### Planner tables (migration `20260504000002`)
- `plans` — lifecycle (`drafting → ready → approved → executing → complete → archived`)
- `plan_messages` — chat thread (`user`, `agent`, `system`)
- `plan_versions` — snapshot on each approval
- `recommendations` — venue/vendor recs attached to a plan
- `approvals` — per-action approval records
- `agent_actions` — audit log of agent-proposed actions
- `admin_tasks` — concierge queue

### Outreach tables (migrations `20260601000000–04`)
- `outreach_threads`, `outreach_messages`, `outreach_drafts` — Gmail loop
- `creator_outreach_policies` — per-host autonomy gates
- `discovery_venues` — agent-discovered supply, pre-claim
- `supply_scout_venue_leads` — admin scout queue
- Multichannel + scheduled send + trust-recompute jobs under `app/api/internal/jobs/`

### Reuse from existing tables
- `venues`, `vendor_profiles`, `vendor_offerings` — catalog (treat as partner inventory, not marketplace)
- `venue_bookings`, `vendor_bookings` — bookings
- `event_financial_summary`, `event_sales_data` — financials
- `builder_ticketing_connections` — ticket platform integrations
- Stripe patterns in `vendor_stripe_accounts`, `venue_stripe_accounts`

**Generated types in `lib/types/database-generated.ts` are stale for newer tables.** Regenerate before adding more `any` escapes around discovery/outreach/policy queries.

---

## Signup flows — do not change step structure without explicit instruction

The `/signup` chooser ("Which one are you?") presents three role cards: Creator, Venue, Vendor.

### Creator / Community Builder (4 steps)
1. Name, email, password
2. Org name, type, social handle, website, bio
3. Event types, avg attendance, preferred amenities
4. Ticketing platforms, bulk booking toggle, invite collaborators

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

Supply-side signup is **not** promoted on the marketing homepage as a co-equal CTA. Entry points are `/signup` and outbound outreach landing pages under `app/v/[discoveryVenueId]/`.

---

## Design system — warm editorial

**Theme:** warm cream editorial. Background `hsl(38 35% 96%)`, ink `hsl(20 15% 12%)`, clay primary `hsl(15 65% 55%)`, forest accent `hsl(155 25% 28%)`. Source of truth: `app/globals.css`.

**Fonts:**
- `font-display` → Fraunces (headings, editorial moments)
- `font-sans` → Inter (body, UI)
- `font-mono` → JetBrains Mono (numerics, codes)

**Patterns:**
- Restrained color, generous whitespace, editorial spacing
- Cards: cream-deep surfaces with subtle borders, not glassmorphism
- Primary CTA: solid clay; secondary: outline ink
- Avoid gradients-as-decoration, neon glows, dark-vibrant remnants

**Deprecated:** dark vibrant theme, Space Grotesk display font, `bg-gradient-card`, `variant="hero"` glow buttons, `variant="glass"` frosted surfaces, `text-gradient-brand`. Do not add new components in that style. Existing usages are tech debt to migrate.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Auth + DB | Supabase (Postgres, RLS, edge functions) |
| Payments | Stripe (payment intents, Connect) |
| AI | OpenAI — GPT-4o for quality, GPT-4o-mini for extraction/classification. Structured JSON outputs required. |
| Outreach | Gmail API (per-creator OAuth), Twilio (planned multichannel) |
| Styling | Tailwind CSS + custom utilities in `globals.css` |
| Testing | Playwright (`e2e/`), Jest (`__tests__/`), eval corpus (`evals/`) |

### Test email convention
Use `example.com` for deterministic local and E2E signup accounts:
`test-<role>-<timestamp>-<random>@example.com`.

---

## Hard rules

1. **No new routes under `(dashboard)/`** — legacy.
2. **No auto-execution of bookings, payments, or outbound messages** — always require an approval record. Outreach autonomy policies are host-configured, not agent-configured.
3. **All monetary values are integer cents.** Never floats.
4. **All new tables need RLS policies.** No exceptions.
5. **Do not break existing signup step structure** — `SignupExperience.tsx` step count and field names are stable.
6. **Do not remove or rename existing Stripe patterns** — `vendor_stripe_accounts`, `venue_stripe_accounts`, payment intent flows are load-bearing.
7. **Match the warm editorial design system** — no new dark-vibrant components.
8. **Use 3rdPlace in all user-facing copy.** The repo dir name is legacy.
9. **Outreach autonomy ships behind eval gates.** Do not raise autonomy defaults without the reply-classifier + scenario eval corpora passing thresholds defined in `evals/outreach/README.md`.

---

## Out of scope for MVP

- Live transit/weather data
- SMS notifications (Twilio is scaffolded, not launched)
- Browser automation for external checkout
- Generic lifestyle planning (not event-specific)
- Self-serve marketplace browsing as the primary host entry point
- Public partner dashboards beyond what `(dashboard)/` already ships

---

## When in doubt

Ask before building. The product is opinionated about the agent-first model, approval gates, outreach autonomy, and editorial aesthetic. A wrong assumption here creates rework. Surface ambiguity rather than guessing.
