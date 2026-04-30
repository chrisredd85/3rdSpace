# 3rdSpace — Technical Handoff Document

> **Audience:** Engineers taking over or contributing to this project.  
> **Date written:** 2026-04-29  
> **Current state:** MVP-stage web app, functional UI, Supabase back-end live, Stripe wired but not yet enabled for live payments.

---

## 1. What Is 3rdSpace?

3rdSpace is a **B2B event-infrastructure marketplace** connecting three types of users:

| Role | Internal key | What they do |
|------|-------------|--------------|
| **Event Creator** (Community Builder) | `community_builder` | Plans events, books venues and vendors, manages budgets |
| **Venue Owner** | `venue_owner` | Lists their space, accepts/declines bookings, sets pricing |
| **Vendor** | `vendor` | Lists services (DJ, catering, AV, etc.), responds to booking requests |

Each role gets its own authenticated dashboard, its own set of API routes, and its own sidebar navigation.

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Next.js 14 (App Router) | Server Components + streaming, edge middleware for auth, great DX |
| **Language** | TypeScript 5 | End-to-end type safety; `strict` mode enabled |
| **Database / Auth** | Supabase (Postgres + Auth) | Managed Postgres with row-level security, real-time capabilities, and built-in auth |
| **Styling** | Tailwind CSS v3 + CSS custom properties | Utility-first with a design-token layer — all colors/shadows/gradients come from CSS vars defined in `globals.css` |
| **Component library** | shadcn/ui (Radix primitives) | Accessible, unstyled primitives wrapped with CVA — lives in `components/ui/` |
| **Server state** | TanStack React Query v5 | Handles caching, background refetch, and optimistic updates for all Supabase calls |
| **Client state** | Zustand | Lightweight auth store only — not overused |
| **Forms** | React Hook Form + Zod | Schema-driven validation with type-safe error messages |
| **Charts** | Recharts | Analytics dashboards |
| **PDF generation** | Puppeteer (server-side) | Invoice PDF rendering |
| **Payments** | Stripe (placeholder) | SDK integrated, UI gated — see §9 |
| **Email** | Configurable (env-driven) | See `lib/email.ts` |
| **Testing** | Jest (unit/integration) + Playwright (E2E) | |

---

## 3. Repository Layout

```
3rdSpace.webapp/
├── app/                        Next.js App Router pages & API routes
│   ├── (auth)/                 Login, signup, onboarding (no sidebar)
│   ├── (dashboard)/            All authenticated dashboard pages
│   │   ├── [userType]/         Generic pages shared across roles (messages, notifications)
│   │   ├── builder/            Event Creator dashboard
│   │   ├── venue/              Venue Owner dashboard
│   │   └── vendor/             Vendor dashboard
│   └── api/                    100 Next.js Route Handlers grouped by domain
├── components/
│   ├── ui/                     Base design-system primitives (Button, Card, Input…)
│   ├── shared/                 Cross-role reusable components (Sidebar, Header, StatCard…)
│   ├── builder/                Event Creator–specific components
│   ├── venue/                  Venue Owner–specific components
│   ├── vendor/                 Vendor-specific components
│   ├── forms/                  Reusable form fields
│   ├── analytics/              Chart components
│   ├── messages/               Messaging thread UI
│   ├── notifications/          Notification center
│   ├── payments/               Payment form / status UI (Stripe placeholder)
│   └── invoices/               Invoice preview and PDF
├── lib/
│   ├── hooks/                  React Query hooks (one file per domain)
│   ├── types/                  TypeScript types (database.ts, enums.ts, helpers.ts)
│   ├── supabase/               Supabase client factories (client / server / middleware)
│   ├── stripe/                 Stripe Connect helpers (server-only)
│   ├── server/                 Server-only utilities (Eventbrite, webhooks, job queue)
│   ├── store/                  Zustand auth store
│   ├── utils/                  cn(), formatting, filters, error handling, performance
│   ├── finance/                Event financial calculations
│   └── payments/ invoices/ messages/ vendors/ venues/  — domain logic
├── supabase/
│   └── migrations/             SQL migration files (apply in order)
├── __tests__/                  Jest integration tests
├── e2e/                        Playwright E2E tests
└── public/                     Static assets
```

---

## 4. Architecture Decisions

### 4.1 App Router + Server Components

Pages in `app/(dashboard)/` are **Server Components by default** — they fetch initial data and pass it as props to client components. This gives fast first paints with no loading spinner for the data that was available at request time.

The pattern is:
```
page.tsx (Server Component)
  └─ fetchData() from Supabase server client
  └─ passes initialData as prop to ─→  SomethingClient.tsx ('use client')
                                           └─ useQuery({ initialData }) via React Query
```

React Query is initialised with the server data so it shows immediately, then silently refreshes in the background. This avoids the "SSR data goes stale" problem.

### 4.2 Auth Architecture

Authentication uses **three layers**:

1. **Supabase Auth** — the source of truth. Session stored in `HttpOnly` cookies via `@supabase/ssr`.
2. **Edge Middleware** (`middleware.ts`) — runs on every request. Refreshes the session, redirects unauthenticated users to `/login`, and enforces role-based route access (a `venue_owner` hitting `/builder` gets redirected to `/venue`).
3. **`DashboardClientWrapper`** (`components/shared/DashboardClientWrapper.tsx`) — client-side belt-and-suspenders. Re-validates auth state after hydration and redirects if the session has expired. Also manages mobile menu state and passes `userType` down to `Sidebar` and `Header`.

**User role is stored in two places:** `auth.user.user_metadata.user_type` (set at signup) and the `users` table row. The layout reads both and falls back gracefully. This redundancy was a deliberate choice to avoid an extra DB round-trip in the middleware.

### 4.3 Data Fetching (React Query Hooks)

All data fetching lives in `lib/hooks/`. Each hook file owns one domain:

- `useVenues.ts` — venue CRUD + availability
- `useVendors.ts` — vendor profiles + saved vendors
- `useBookings.ts` — venue and vendor booking mutations
- `useEvents.ts` — event CRUD
- `useMessages.ts` — thread creation, message send, unread count
- `useNotifications.ts` — notification fetch + mark-read
- etc.

Hooks that **mutate** data (`useCreateEvent`, `useUpdateBookingStatus`, etc.) call Next.js API routes (not Supabase directly from the client) so that:
1. Server-side validation runs before DB writes.
2. Side effects (notification creation, email sends) happen atomically on the server.
3. Row-level security is not relied on as the sole guard.

Read-only hooks (data display) **do** call Supabase client directly for lower latency.

### 4.4 State Management

**Zustand** is used for exactly one thing: the `auth-store` (`lib/store/auth-store.ts`) that holds `user | null` so any component can access the current user without prop-drilling. Nothing else is in Zustand. Complex UI state (modals open/closed, form state) lives in local `useState`.

### 4.5 Design System

The design system lives entirely in **CSS custom properties** defined in `app/globals.css`. Tailwind's config references those variables via `hsl(var(--token))` patterns. This means:

- The entire palette can be changed by editing one file.
- All colours are dark-mode only (there is no light mode toggle — dark is the only theme).
- The brand gradient (`--gradient-brand`) is purple → pink → coral. It's used for the logo, active nav items, primary buttons (`variant="hero"`), and avatar initials.
- Font stack: **Space Grotesk** (headings, display text) + **Inter** (body, UI).

**Button variants** defined in `components/ui/button.tsx`:
| Variant | Use case |
|---------|----------|
| `default` | Standard primary action |
| `hero` | Main CTA, gradient + glow |
| `outline` | Secondary/tertiary actions |
| `ghost` | Icon buttons, nav items |
| `glass` | Overlaid on gradient backgrounds |
| `accent` | Lime-green accent actions |
| `destructive` | Deletes, cancellations |
| `secondary` | Coral-toned secondary |

### 4.6 API Route Design

All 100 API routes follow the same pattern:

```ts
export async function POST(req: NextRequest) {
  // 1. Authenticate
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Validate input (Zod)
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // 3. Business logic + DB writes

  // 4. Return { data } or { error }
}
```

Error responses always use `{ error: string }` as the JSON key (not `message`). HTTP status codes follow REST conventions.

---

## 5. Database Schema Overview

Schema lives in `supabase/migrations/`. Apply all migrations in timestamp order when setting up a new Supabase project.

> **Important data-model note:** `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md` is now the working source for the schema reconciliation effort. The live database schema and generated Supabase types should be treated as DB truth; `lib/types/database.ts` currently contains app-facing DTO assumptions that have drifted from the actual tables.

**Core tables:**

| Table | Purpose |
|-------|---------|
| `users` | Extends Supabase auth with `user_type`, `company_name` |
| `owner_profiles` | Venue owner/operator account metadata |
| `venues` | Venue listing data, pricing, deposit settings, rules |
| `vendor_profiles` | Vendor profile, service type, Stripe account ID |
| `events` | Event records owned by builders |
| `venue_bookings` | Booking requests from builders to venues |
| `vendor_bookings` | Booking requests from builders to vendors |
| `vendor_offerings` / `vendor_packages` | Service listings |
| `message_threads` / `messages` | In-app messaging |
| `notifications` | Per-user notification records |
| `vendor_stripe_accounts` | Stripe Connect account status per vendor |
| `vendor_invoices` / `vendor_invoice_line_items` | Invoice records |
| `availability_blocks` | Blocked-off dates for venues and vendors |
| `event_financial_summaries` | Aggregated revenue/cost per event |

Row-level security (RLS) is enabled on all tables. Policies enforce that users can only read/write their own data.

---

## 6. Three-Role User Flows

### Event Creator (Builder)
1. Signs up → onboarding collects company name + preferred ticketing platform
2. Creates events via a multi-step wizard (planning → timeline → venue → vendors → team → checklist → finalize)
3. Browses venue marketplace → sends booking request → venue owner accepts/declines
4. Browses vendor marketplace → sends booking request → vendor accepts/counter-offers
5. Manages budget via the analytics dashboard (connected to Eventbrite/Luma/Posh ticket sales via webhooks)
6. Billing: Stripe subscription for platform access (placeholder, not live yet)

### Venue Owner
1. Signs up → onboarding collects venue name and address
2. Creates venue listing with photos, amenities, pricing, rules, deposit terms
3. Receives booking requests → views details → accepts/declines/counter-offers
4. Calendar view shows confirmed bookings and blocked dates
5. Bulk approval mode: auto-approve bookings meeting configurable criteria
6. Payouts: Stripe Connect (placeholder)

### Vendor
1. Signs up → onboarding collects service type and business name
2. Creates service listings and packages
3. Sets availability calendar with blocked dates
4. Receives booking requests → reviews details → approves/rejects (with optional note)
5. Sends invoices to clients (PDF generation via Puppeteer)
6. Payouts: Stripe Connect (placeholder)

---

## 7. Stripe Integration Status

**The Stripe SDK is fully wired — payment _collection_ is intentionally disabled in the UI.**

What is implemented:
- Stripe Connect flow for vendors (`app/api/vendor/stripe/`)
- Venue deposit configuration saved in DB
- Vendor invoice generation (amounts, line items)
- Payment intent creation endpoint (`app/api/payments/create-intent/`)
- Refund calculation logic (`lib/payments/refund-calculator.ts`)
- Platform fee calculation (`app/api/payments/platform-fee/`)
- `StripeIntegrationNotice` component renders a "coming soon" banner wherever payment UI appears

What is **not** yet active:
- Live Stripe keys — set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local`
- The `@stripe/react-stripe-js` `<Elements>` wrapper around the `PaymentForm` component needs to be uncommented once keys are ready
- Stripe webhook handler (`app/api/webhooks/stripe/route.ts`) exists but needs `STRIPE_WEBHOOK_SECRET`

**To go live with payments:** add the three env vars, remove `StripeIntegrationNotice` components from payment-flow pages, and test with Stripe test cards.

---

## 8. Third-Party Integrations

| Integration | Status | Notes |
|-------------|--------|-------|
| **Eventbrite** | ✅ OAuth + webhooks | Builders connect their Eventbrite account to import events and sync ticket sales data. OAuth flow: `/api/integrations/eventbrite/connect` → `/callback`. Webhooks: `/api/integrations/webhooks/` |
| **Luma** | ✅ Webhooks | Ticket sale webhooks only (no OAuth). Secret verified via HMAC. |
| **Posh** | ✅ Webhooks | Same as Luma |
| **Stripe** | 🔶 Placeholder | See §7 |
| **Email** | 🔶 Optional | `lib/email.ts` — configure `EMAIL_PROVIDER` env var. No-ops gracefully if unconfigured. |

---

## 9. Environment Variables

Copy `.env.local.example` (or create `.env.local`) with:

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App URL (required for OAuth redirects)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Stripe (set to enable payments)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Eventbrite (set to enable integration)
EVENTBRITE_CLIENT_ID=
EVENTBRITE_CLIENT_SECRET=
EVENTBRITE_ENCRYPTION_KEY=

# Webhook secrets
LUMA_WEBHOOK_SECRET=
POSH_WEBHOOK_SECRET=

# Internal job security
INTERNAL_JOB_SECRET=

# Email (optional)
EMAIL_PROVIDER=
```

---

## 10. Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local   # then fill in Supabase keys

# 3. Apply database migrations
npx supabase db push          # or run migrations manually in Supabase Studio

# 4. Start dev server
npm run dev                   # http://localhost:3000

# 5. Run tests
npm test                      # Jest unit + integration
npm run test:e2e              # Playwright (requires running dev server)
npm run type-check            # TypeScript
npm run lint                  # ESLint
```

---

## 11. Testing Architecture

| Layer | Tool | Location | What it covers |
|-------|------|----------|----------------|
| Unit | Jest + Testing Library | `**/__tests__/` | Utility functions, form validation, individual components |
| Integration | Jest | `__tests__/integration/` | Booking flow, API route logic with mocked Supabase |
| E2E | Playwright | `e2e/` | Full user journeys: auth, venue flow, vendor flow, design system, business math |

The Supabase client is mocked in unit/integration tests via `lib/test-utils/mock-supabase.ts`. Playwright tests run against a live dev server.

---

## 12. Known Limitations & Technical Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| **Organizer contact info in booking modals is placeholder** | Medium | Both `venue/BookingDetailModal` and `vendor/BookingDetailModal` display `—` for organizer email/phone. The `builder_id` is available; a profile join query needs to be added. Marked with `TODO` comments. |
| **Search bar in Header is non-functional** | Low | The search `<input>` in `components/shared/Header.tsx` is decorative — it has no `onChange` handler or state. Full-text search via Supabase `ilike` or `pg_trgm` would need to be added. |
| **`useSupabase` hook is orphaned** | Low | `lib/hooks/useSupabase.ts` has no callers. Prefer `useUser` for auth state. The file is kept for potential future use but can be deleted if not needed. |
| **`supabase` legacy singleton in `client.ts`** | Low | The named `supabase` export is a module-level singleton kept for backward compatibility. New code should call `createClient()` per component. Gradual migration in progress. |
| **Direct Supabase calls in some components** | Low | ~20 components import and call `supabase` directly for reads (calendar pages, marketplace pages). These should ideally be extracted into React Query hooks for cache consistency. Not breaking, just architecturally inconsistent. |
| **`events?: any` and `venues?: any` types** | Low | `venue/BookingDetailModal` uses `any` for the joined event/venue shape. The correct types from `lib/types/database.ts` should be used once the join schema is stable. |
| **Schema/type drift across core marketplace tables** | High | `lib/types/database.ts` and several read paths assume columns/tables not present in the current database, including `profiles`, `venues.name`, `venues.capacity`, `events.title`, and app-only status names. See `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md` for the canonical model and cleanup plan. |
| **Legacy and modern booking/messaging paths overlap** | High | `spaces`/`bookings` coexist with `venues`/`venue_bookings`, and generic messages still depend on legacy booking IDs. This should be consolidated before production traffic grows. |
| **No light mode** | Design decision | The design system is dark-only. All CSS custom properties have a single value set — there is no `@media (prefers-color-scheme: light)` block. Adding light mode would require duplicating all CSS vars under a `[data-theme="light"]` selector. |
| **`console.log` in API routes and server utilities** | Low | Eventbrite OAuth, financial calculations, check-in uploads, and signup routes use `console.log` for operational tracing. These are prefixed `[module.name]` and are intentional for server-side observability. Replace with a structured logger (e.g., Pino) before production if log volume is a concern. |
| **Vim swap file in repo** | Resolved | `lib/supabase/.middleware.ts.swp` is now covered by `.gitignore`. The existing file will disappear from tracking on the next commit that touches `.gitignore`. |

---

## 13. Deployment

The project is configured for **Vercel** deployment. See `VERCEL_DEPLOYMENT.md` for the full guide.

Key notes:
- All env vars from §9 must be set in the Vercel dashboard.
- The `next.config.js` enables `critters` for critical CSS inlining and configures allowed image domains.
- All dashboard routes use `export const dynamic = 'force-dynamic'` to opt out of static caching (required because every page reads auth state).
- The Supabase project must have RLS policies applied and all migrations run before the first deploy.

---

## 14. How to Take Over — Checklist

For an engineer joining this project cold:

- [ ] Read this document top to bottom
- [ ] Set up `.env.local` with Supabase keys and run `npm run dev`
- [ ] Sign up as each of the three roles and walk through each dashboard
- [ ] Run `npm test` and `npm run type-check` — both should pass clean
- [ ] Review `supabase/migrations/` in timestamp order to understand the schema evolution
- [ ] Read `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md` before touching core marketplace data
- [ ] Read generated DB types once added; treat hand-written `lib/types/database.ts` as app-facing DTOs until the reconciliation work is complete
- [ ] Read `middleware.ts` — understand the auth and role-guard logic before touching any auth code
- [ ] Understand the Server Component → React Query handoff pattern (§4.1) before adding new pages
- [ ] Before enabling Stripe: add the three env vars, wire the `<Elements>` provider in `components/payments/PaymentForm.tsx`, remove `StripeIntegrationNotice` from payment pages, and test with test cards

---

## 15. File Quick-Reference

| I want to... | Look here |
|---|---|
| Add a new nav item | `components/shared/Sidebar.tsx` → `getNavigation()` |
| Add a new role-specific page | `app/(dashboard)/[role]/new-page/page.tsx` |
| Add a new API endpoint | `app/api/[domain]/route.ts` — follow the auth → validate → mutate → return pattern |
| Change a colour | `app/globals.css` → `@layer base :root { ... }` |
| Change button styles | `components/ui/button.tsx` → `buttonVariants` CVA config |
| Add a new DB table | `supabase/migrations/TIMESTAMP_description.sql` + update `lib/types/database.ts` |
| Add a new React Query hook | `lib/hooks/useX.ts` — follow the pattern in `useVenues.ts` |
| Understand the canonical marketplace model | `docs/CANONICAL_DATA_MODEL_AND_GROWTH_PLAN.md` |
| Understand a current app-facing DTO shape | `lib/types/database.ts` |
| Understand enum values | `lib/types/enums.ts` |
| Find Stripe logic | `lib/stripe/connect.ts` + `app/api/vendor/stripe/` |
| Find webhook handlers | `app/api/integrations/webhooks/` + `app/api/webhooks/stripe/route.ts` |

---

*Document generated during QA pass — 2026-04-29.*
