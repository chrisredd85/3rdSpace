# Lovable Port Mapping

Production repo: `/Users/chrisredd/3rdSpace.webapp`
Lovable reference repo: `/Users/chrisredd/3rdplace-design`

This document maps the Lovable Vite mockup onto the current Next.js 14 production codebase. `NOT FOUND IN PRODUCTION` means I could not find an existing production route, component, or integration point matching the mockup surface.

## Section 1 - Splash / Marketing Page Mapping

Primary Lovable source files:

- `/Users/chrisredd/3rdplace-design/src/routes/index.tsx`
- `/Users/chrisredd/3rdplace-design/src/components/ThemeToggle.tsx`
- `/Users/chrisredd/3rdplace-design/src/styles.css`
- `/Users/chrisredd/3rdplace-design/src/assets/hero-venue.jpg`

Primary production source files:

- `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx`
- `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/terms/page.tsx`
- `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/privacy/page.tsx`

| Mockup element | Production file path | Production component or route | Notes / mismatches |
|---|---|---|---|
| Top logo, `3rdplace` wordmark | `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx` | `Header` | Production product-facing name renders as `3rdPlace`; Lovable uses lowercase `3rdplace`. |
| Header `Pricing` link | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Lovable points to `#pricing`. Production has `/planner/billing`, but no standalone marketing `/pricing` page and no matching pricing anchor found in the marketing page. |
| Header `FAQ` link | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Lovable points to `#faq`. Production marketing page currently exposes `#who` and `#features`; no standalone `/faq` route found. |
| Header `Sign in` link | `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx` | `/login` | Production maps sign-in to `/login`. Lovable maps sign-in to `/app/run`, which is not a production auth route. |
| Header theme toggle | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Lovable has `ThemeToggle`; production marketing header does not expose a light/dark toggle. |
| Header primary CTA | `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx` | `/planner` | Lovable CTA text is `Start running events`; production CTA text is `Start planning` and routes to `/planner`. Current requested design should keep one CTA, not duplicate it in mobile header and hero. |
| Hero eyebrow, `Bay Area 2026` | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Marketing hero copy | Production uses `The repeat event OS - Bay Area`; Lovable uses more editorial `Bay Area - 2026`. |
| Hero headline | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Marketing hero copy | Lovable: `Run events without running yourself ragged.` Production: `Stop planning the same event from scratch.` This is copy mismatch, not a code gap. |
| Hero support copy | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Marketing hero copy | Lovable emphasizes approvals and execution; production emphasizes repeat-event memory and profit window. |
| Hero image card | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `HomePlannerStart` | Production does not use Lovable's static venue image; the right hero card is an interactive planner composer. |
| Static prompt overlay on hero image | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `HomePlannerStart` | Production equivalent is an actual textarea, not static prompt copy. |
| Agent card overlay on hero image | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `HomePlannerStart` | Production shows the actual public planner intake module with prompt chips and approval note. |
| Hero CTA under headline | `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx` and `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | `/planner` | Production should route the CTA to `/planner`; Lovable routes to `/app/run`, which is not a production route. |
| `See how it works` anchor link | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | `#features` / `#who` sections | Lovable uses `#how`; production does not have a `#how` anchor. |
| `First 2 events free. No card required.` note | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Marketing hero/support copy | Production has billing/free-trial behavior elsewhere, but the exact Lovable note is not the primary source of truth. Billing source is `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/billing/page.tsx`. |
| P0 missing surface: public hero composer | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `HomePlannerStart` | Production has a textarea where an anonymous user enters an event and submits to `/planner?draft=<encoded-prompt>`. Lovable does not include this composer. This is a P0 missing surface. Put it in the redesigned splash where Lovable currently shows the static right-side image/prompt card, preserving the editorial layout but making the prompt card interactive. |
| Sample prompt chips | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `samplePrompts` | Production chips are `Monthly founder dinner for 24 in Hayes Valley`, `Supper club for 18 in the Mission, cocktails and a photographer`, and `Rebook my June rooftop mixer - same venue, new date`. Lovable has static chips but not production's exact composer behavior. |
| `Who it's for` section | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | `#who` | Production has a matching marketing section. |
| Lovable `The work nobody sees` section | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Production marketing content | Production does not match this section one-for-one; map as marketing copy only. |
| Lovable `How it runs` three-step section | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Production marketing content | Production does not have the same three-step module. Not a route gap, but a content mismatch. |
| Lovable feature cards | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | `#features` | Production has feature cards, but copy and grouping differ. |
| Lovable quote/editorial proof section | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | No one-to-one testimonial/quote section found in the production marketing page. |
| Lovable `Pricing` section | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | No public pricing route or section found. Authenticated billing exists at `/planner/billing`. |
| Lovable `FAQ` section | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | No public FAQ route or section found. |
| Footer `Terms` link | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/terms/page.tsx` | `/terms` | Production route exists. |
| Footer `Privacy` link | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/privacy/page.tsx` | `/privacy` | Production route exists. |
| Footer `Refund policy` link | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | No `/refund` marketing route found. Refund handling exists in payment APIs, not a public legal page. |

Marketing sub-route coverage:

| Route / anchor | Production status | File path | Notes |
|---|---|---|---|
| `/` | Exists | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx` | Splash page. |
| `/pricing` | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Do not map Lovable `#pricing` to a real route. |
| `/faq` | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Do not map Lovable `#faq` to a real route. |
| `/terms` | Exists | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/terms/page.tsx` | Public legal page. |
| `/privacy` | Exists | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/privacy/page.tsx` | Public legal page. |

## Section 2 - Signup Flow Mapping

Production source files:

- `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/page.tsx`
- `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/[portal]/page.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx`
- `/Users/chrisredd/3rdSpace.webapp/app/api/auth/signup/route.ts`
- `/Users/chrisredd/3rdSpace.webapp/lib/server/account-setup.ts`

Important production route mismatch:

- Production supports `/signup/builder`, `/signup/venue`, and `/signup/vendor`.
- `/signup/creator` is `NOT FOUND IN PRODUCTION`.
- Venue lands at `/venue`, not `/dashboard/venue`.
- Vendor lands at `/vendor`, not `/dashboard/vendor`.

### Creator / Community Builder

| Mockup step | Production file | Production fields collected | Conditional reveals | Production destination after submit | Notes |
|---|---|---|---|---|---|
| Role selection: `Run events` | `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `initialUserType="community_builder"` through `/signup/builder` | None | `/signup/builder` | Mockup/spec says `/signup/creator`; production uses `/signup/builder`. |
| Step 1 - account basics | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `fullName`, `email`, `password` | Password visibility toggle | If final submit succeeds: `/planner`; if email confirmation required: `/login/builder?redirect=/planner` | Production does not collect confirm password. |
| Step 2 - organization | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `orgName`, `orgType`, `socialHandle`, `website`, `bio` | None | Same final flow | Matches the broad brief. |
| Step 3 - event profile | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `eventTypes`, `avgAttendance`, `amenities` | Multi-select chip state | Same final flow | Matches the broad brief. |
| Step 4 - ticketing and collaborators | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `platforms`, `bulkBooking`, `collaboratorEmails` | Bulk booking toggle changes submitted field; no nested explainer block found | Same final flow | Production requires at least one supported ticketing platform. The user/spec says ticketing can be optional. |
| Production step count | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `const total = 5` in builder flow | N/A | N/A | CONTRADICTION: AGENTS.md and the requested mockup say Creator has 4 steps. Current production renders 5. This must be resolved before porting signup UI. |

### Venue

| Mockup step | Production file | Production fields collected | Conditional reveals | Production destination after submit | Notes |
|---|---|---|---|---|---|
| Role selection: `List my venue` | `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/[portal]/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `initialUserType="venue_owner"` through `/signup/venue` | None | `/signup/venue` | Matches production route. |
| Step 1 - contact and account | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `contactName`, `contactRole`, `email`, `phone`, `password` | Password visibility toggle | `/venue`; if email confirmation required: `/login/venue?redirect=/venue` | Mockup destination `/dashboard/venue` is wrong for production. |
| Step 2 - venue details | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `venueName`, `venueType`, `address`, `city`, `neighborhood`, `state`, `zipCode`, `loadingAddress`, `capacity`, `prepTime` | None | Same final flow | Production has more address fields than the prompt summary. |
| Step 3 - amenities, photos, rules | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `amenities`, `houseRules` | Amenity chip state | Same final flow | Production signup code does not show the required photo upload field described in the mockup/spec. |
| Step 4 - business terms | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `isBar`, `barKickback`, `perHeadDrinkPct`, `minBarSpend`, `pricePerNight`, `deposit`, `cancellationTerms` | `isBar` reveals bar kickback, drink share, and minimum spend | Same final flow | Production has no rate-model radio, no hourly min-hours reveal, no deposit-required toggle, and no fixed-vs-percentage deposit type reveal. |
| Step 5 - availability | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `openDays`, `openFrom`, `openTo` | Day chips toggle selected days | Same final flow | Production has one global open/close time range, not per-day nested time pickers. |

### Vendor

| Mockup step | Production file | Production fields collected | Conditional reveals | Production destination after submit | Notes |
|---|---|---|---|---|---|
| Role selection: `List my services` | `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/[portal]/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `initialUserType="vendor"` through `/signup/vendor` | None | `/signup/vendor` | Matches production route. |
| Step 1 - account | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `fullName`, `businessName`, `email`, `phone`, `password` | Password visibility toggle | `/vendor`; if email confirmation required: `/login/vendor?redirect=/vendor` | Mockup destination `/dashboard/vendor` is wrong for production. |
| Step 2 - services | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `services`, `serviceArea`, `portfolioUrl`, `bio` | Services chip state | Same final flow | Matches the broad brief. |
| Step 3 - pricing | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `basePrice`, `packageName`, `packageDetails`, `depositPct`, `leadTimeDays`, `cancellationTerms` | None found for deposit toggle or pricing model select | Same final flow | Mockup/spec says deposit toggle and pricing model reveal package textarea. Production always shows package and deposit fields. |
| Step 4 - availability | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | `availableDays`, `emergencyAvailable`, `emergencyRate` | `emergencyAvailable` reveals `emergencyRate` | Same final flow | Matches the emergency vendor reveal pattern. |

## Section 3 - Chat-First Signup Gate Mapping

| Mockup / required behavior | Production file path | Production component or logic | Notes / mismatches |
|---|---|---|---|
| Anonymous `/planner` draft mode | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | `initialDraft = searchParams.get('draft')` | Production consumes the draft query param seeded by `HomePlannerStart`. |
| Splash composer submits draft | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | `router.push('/planner?draft=' + encodeURIComponent(trimmed))` | Production has this. Lovable splash mockup does not. |
| Draft migration status | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | `draftMigrationStatus = searchParams.get('draftMigration')` | Production shows a toast on `draftMigration=failed` and then replaces the URL. |
| Draft to account migration after signup | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Signup flow can return to `/planner?plan=<id>` or `/planner?draftMigration=failed` | Production has migration references, but the UI path is route-based rather than inline 3-field signup. |
| Inline 3-field signup overlay in chat | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Existing production equivalent is `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSignupGate.tsx`, a modal that sends users to creator signup. It is not the requested inline email/password/first-name card. |
| Signup gate card in conversation thread | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | `DraftMatchSignupCard` | Production has a draft match gate card, but it does not create an account inline. |

## Section 4 - Planner: Full Sidebar + Every Drill-Down Route

Primary planner shell files:

- `/Users/chrisredd/3rdSpace.webapp/app/(planner)/layout.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerShell.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSidebar.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTopBar.tsx`

Lovable app shell source:

- `/Users/chrisredd/3rdplace-design/src/routes/app.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.run.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.approvals.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.payments.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.run-sheet.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.partners.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.portal.tsx`
- `/Users/chrisredd/3rdplace-design/src/routes/app.components.tsx`

### 4a - Sidebar / Left-Nav Inventory

| Sidebar label | Route | File path | Default sub-view | Mockup coverage status |
|---|---|---|---|---|
| Agent Planner | `/planner` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Chat tab | Partially covered by Lovable `/app/run`, but production has six internal tabs and draft migration that Lovable does not cover. |
| Experiences | `/planner/experiences` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/experiences/page.tsx` | Experience OS / empty event pipeline | `NOT FOUND IN LOVABLE MOCKUP` as a first-class sidebar route. |
| Templates | `/planner/templates` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/templates/page.tsx` | Saved event templates and starter templates | `NOT FOUND IN LOVABLE MOCKUP`. |
| Venues | `/planner/venues` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/page.tsx` | Venue catalog search and cards | Partially covered inside Lovable `/app/partners`, but production has a separate route and nested marketplace/detail routes. |
| Tickets | `/planner/tickets` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/tickets/page.tsx` | Ticketing connection setup | `NOT FOUND IN LOVABLE MOCKUP` as a sidebar route. |
| Vendors | `/planner/vendors` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/page.tsx` | Vendor catalog, known vendor invite, filters | Partially covered inside Lovable `/app/partners`, but production has a separate route and nested marketplace/detail routes. |
| Messages | `/planner/messages` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/messages/page.tsx` | Conversation list and selected thread empty state | `NOT FOUND IN LOVABLE MOCKUP`. |
| Payments | `/planner/payments` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/payments/page.tsx` | Payment Control Center | Partially covered by Lovable `/app/payments`, but production has approval queue, payout readiness, venue rental payments, builder payout ledger, and refund request surfaces. |
| Billing | `/planner/billing` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/billing/page.tsx` | Free trial, event credits, Pro plan | `NOT FOUND IN LOVABLE MOCKUP` as a sidebar route. |
| Analytics | `/planner/analytics` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/analytics/page.tsx` | Financial scorecards and post-event metrics | `NOT FOUND IN LOVABLE MOCKUP` as a sidebar route. |
| Settings | `/planner/settings` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/settings/page.tsx` | Builder account settings | `NOT FOUND IN LOVABLE MOCKUP` as a sidebar route. |

Additional planner nested routes:

| Route | File path | Sub-views / triggers in file | Mockup coverage |
|---|---|---|---|
| `/planner/venues/marketplace` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/marketplace/page.tsx` | Wraps `VenueMarketplace`; back link to `/planner/venues` | `NOT FOUND IN LOVABLE MOCKUP` as a nested route. |
| `/planner/venues/[venueId]` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/[venueId]/page.tsx` | Builder-facing venue detail and booking request | `NOT FOUND IN LOVABLE MOCKUP` as a nested route. |
| `/planner/vendors/marketplace` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/marketplace/page.tsx` | Wraps `VendorSearchPage`; back link to `/planner/vendors` | `NOT FOUND IN LOVABLE MOCKUP` as a nested route. |
| `/planner/vendors/[vendorId]` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/[vendorId]/page.tsx` | Builder-facing vendor profile | `NOT FOUND IN LOVABLE MOCKUP` as a nested route. |
| `/planner/run-sheet` | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Lovable has `/app/run-sheet`. Production day-of countdown/run sheet is part of `/planner` timeline tab, not a standalone route. |

### 4b - Main Planner Page Tab-Level Mapping

The production planner page is `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx`. Its tab views are switched inside the page; Lovable treats major app surfaces as separate flat routes.

| Tab | Tab key | Components rendered / source | Mockup coverage |
|---|---|---|---|
| Chat | `chat` | Main chat view in `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx`; uses `PlannerLivePlanPanel`, `DraftMatchSignupCard`, reply analysis UI, signup gate hooks | Partially covered by Lovable `/app/run`. Lovable does not cover draft migration, billing gate, or inline approval card behavior. |
| Event Plan | `event_plan` | Event-plan structured artifact inside `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Partially covered by Lovable run/portal concepts, but not as the production tab. |
| Recommendations | `recommendations` | Recommendation cards, venue/vendor matching, economics gate, `PlannerRecommendationActionButton` in `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Partially covered by Lovable partner/cards, but production phase logic and action buttons are missing. |
| Approvals | `approvals` | Inline `PlannerApprovalCard` in `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx`; posts to `/api/planner/plans/[planId]/approvals` | Partially covered by Lovable `/app/approvals`, but production approval card and billing gate behavior are not covered. |
| Data | `data` | `PlannerDataConnectionPanel` from `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerDataConnectionPanel.tsx` | `NOT FOUND IN LOVABLE MOCKUP` as a planner tab. |
| Timeline | `timeline` | `PlannerTimelineCountdown` from `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTimelineCountdown.tsx`; logic in `/Users/chrisredd/3rdSpace.webapp/lib/planner/timelineDerivation.ts` | Partially covered by Lovable `/app/run-sheet`, but production tab is not a separate route. |
| Payments / money ledger | No standalone tab key in production main tabs | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/payments/page.tsx` | Lovable `/app/payments` maps to production `/planner/payments`, not to a main planner tab. |
| Run sheet / day-of countdown | `timeline` | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTimelineCountdown.tsx` | Lovable `/app/run-sheet` is a route mismatch. |

### 4c - Modals, Drawers, and Overlay Surfaces

| Trigger surface | Modal / drawer name | File path | Mockup coverage |
|---|---|---|---|
| Planner signup gate event or draft match gate | `PlannerSignupGate` | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSignupGate.tsx` | Partially covered conceptually. Lovable/mockup requested inline 3-field signup, which is `NOT FOUND IN PRODUCTION`. |
| Free tier exhaustion / product access required | `BillingGateModal` via `usePlannerBillingGate` | `/Users/chrisredd/3rdSpace.webapp/components/planner/BillingGateModal.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/usePlannerBillingGate.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Template button inside `/planner` | `PlannerTemplatesModal` | Inline in `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Venue rental payment action | Venue payment method overlay and picker | `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentButton.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentMethodPicker.tsx` | `NOT FOUND IN LOVABLE MOCKUP` as an exact payment-method overlay. |
| Booked partner refund request | Venue rental refund dialog | `/Users/chrisredd/3rdSpace.webapp/components/planner/BookedPartnersWorkspace.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Planner payments rental refund | Refund request dialog | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/payments/page.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Draft migration failure | Toast/banner via `useToast` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/ui/toast.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Approval confirmation/edit/cancel states | Inline `PlannerApprovalCard` modes | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Lovable has approval cards, but production state machine is more specific. |
| Venue detail drawer | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Venue detail is a route at `/planner/venues/[venueId]`, not a drawer. |
| Vendor detail drawer | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Vendor detail is a route at `/planner/vendors/[vendorId]`, not a drawer. |
| BYO vendor add modal | `NOT FOUND IN PRODUCTION` | `NOT FOUND IN PRODUCTION` | Production known-vendor invite is an inline panel in `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/page.tsx`, not a modal. |

### 4d - Drill-Down Nested-Route Hierarchy

Production planner hierarchy:

```text
/planner
├── tab=chat
├── tab=event_plan
├── tab=recommendations
├── tab=approvals
├── tab=data
├── tab=timeline
├── /planner/experiences
├── /planner/templates
├── /planner/venues
│   ├── /planner/venues/marketplace
│   └── /planner/venues/[venueId]
├── /planner/tickets
├── /planner/vendors
│   ├── /planner/vendors/marketplace
│   └── /planner/vendors/[vendorId]
├── /planner/messages
├── /planner/payments
├── /planner/billing
├── /planner/analytics
└── /planner/settings
```

Drill-down mismatch:

- Lovable `/app` uses a flat nav: Run, Approvals, Payments, Run sheet, Partners, Portal, System.
- Production has a persistent planner sidebar plus real child routes under Venues and Vendors.
- The mockup collapses venues and vendors into Partners and does not demonstrate production route drill-down for `/planner/venues/marketplace`, `/planner/venues/[venueId]`, `/planner/vendors/marketplace`, or `/planner/vendors/[vendorId]`.

## Section 5 - Venue Dashboard Mapping

Important production path mismatch:

- Lovable/mockup shows `/dashboard/venue`.
- Production URL is `/venue` because the file is under a route group: `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/page.tsx`.
- Production `(dashboard)` routes are legacy per AGENTS.md. Do not add new files under `(dashboard)` during a visual port.

| Mockup venue section | Production file path | Production component or route | Notes / mismatches |
|---|---|---|---|
| Venue dashboard home / inbox summary | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/page.tsx` | `/venue` | Shows booking requests, payout overview, stats, quick actions, Stripe setup banner. |
| Inbox / booking inquiries | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/requests/page.tsx` | `/venue/requests` | Real production route exists. Lovable `/dashboard/venue/inbox` path is wrong. |
| Bookings calendar | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/calendar/page.tsx` | `/venue/calendar` | Uses venue calendar components and date blocking modals. |
| Confirmed bookings | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/confirmed/page.tsx` | `/venue/confirmed` | Separate production route not represented in Lovable dashboard spec. |
| Payouts | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/payouts/page.tsx` | `/venue/payouts` | Includes venue payout and Connect surfaces. |
| Pricing / business terms | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/pricing/page.tsx` | `/venue/pricing` | Production route exists. |
| Listing | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/listing/page.tsx` | `/venue/listing` | Production route exists. |
| Settings | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/page.tsx` | `/venue/settings` | Production route exists. |
| Settings - amenities | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/amenities/page.tsx` | `/venue/settings/amenities` | Nested route not represented in Lovable dashboard mockup. |
| Settings - bulk approval | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/bulk-approval/page.tsx` | `/venue/settings/bulk-approval` | Nested route not represented in Lovable dashboard mockup. |
| Settings - deposits | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/deposits/page.tsx` | `/venue/settings/deposits` | Nested route not represented in Lovable dashboard mockup. |
| Settings - rules | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/rules/page.tsx` | `/venue/settings/rules` | Nested route not represented in Lovable dashboard mockup. |
| Settings - unique features | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/settings/unique-features/page.tsx` | `/venue/settings/unique-features` | Nested route not represented in Lovable dashboard mockup. |
| Claim pending | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/claim-pending/page.tsx` | `/venue/claim-pending` | Missing from Lovable dashboard mockup. |
| Requirements | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/requirements/page.tsx` | `/venue/requirements` | Missing from Lovable dashboard mockup. |
| Venue dashboard sidebar shell | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/layout.tsx` | Layout returns `children` only | Production has no dedicated venue sidebar component in this layout. A Lovable dashboard sidebar is `NOT FOUND IN PRODUCTION`. |

Venue dashboard modals:

| Trigger surface | Modal / component | File path | Mockup coverage |
|---|---|---|---|
| Booking request detail | `BookingDetailModal` | `/Users/chrisredd/3rdSpace.webapp/components/venue/BookingDetailModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Calendar block dates | `BlockDatesModal` | `/Users/chrisredd/3rdSpace.webapp/components/venue/BlockDatesModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Calendar edit block | `EditBlockModal` | `/Users/chrisredd/3rdSpace.webapp/components/venue/EditBlockModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Bulk approval settings | `BulkApprovalSettings` / `BulkApprovalDashboard` | `/Users/chrisredd/3rdSpace.webapp/components/venue/BulkApprovalSettings.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/venue/BulkApprovalDashboard.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |

Venue dashboard hierarchy:

```text
/venue
├── /venue/requests
├── /venue/calendar
├── /venue/confirmed
├── /venue/payouts
├── /venue/pricing
├── /venue/listing
├── /venue/settings
│   ├── /venue/settings/amenities
│   ├── /venue/settings/bulk-approval
│   ├── /venue/settings/deposits
│   ├── /venue/settings/rules
│   └── /venue/settings/unique-features
├── /venue/claim-pending
└── /venue/requirements
```

## Section 6 - Vendor Dashboard Mapping

Important production path mismatch:

- Lovable/mockup shows `/dashboard/vendor`.
- Production URL is `/vendor` because the file is under a route group: `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/page.tsx`.

| Mockup vendor section | Production file path | Production component or route | Notes / mismatches |
|---|---|---|---|
| Vendor dashboard home / inbox summary | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/page.tsx` | `/vendor` | Shows booking requests, payout overview, public booking link, stats, Stripe setup banner. |
| Inbox / requests | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/requests/page.tsx` | `/vendor/requests` | Real production route exists. Lovable `/dashboard/vendor/inbox` path is wrong. |
| Bookings calendar | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/calendar/page.tsx` | `/vendor/calendar` | Real production route exists. |
| Bookings list/dashboard | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/bookings/page.tsx` | `/vendor/bookings` | Real production route exists and is not represented in the Lovable spec table. |
| Services | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/services/page.tsx` | `/vendor/services` | Real production route exists. |
| Pricing | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/pricing/page.tsx` | `/vendor/pricing` | Real production route exists; Lovable vendor dashboard spec did not separate pricing from services in all screenshots. |
| Payouts | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/payouts/page.tsx` | `/vendor/payouts` | Real production route exists. |
| Analytics | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/analytics/page.tsx` | `/vendor/analytics` | Missing from Lovable dashboard spec. |
| Claim pending | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/claim-pending/page.tsx` | `/vendor/claim-pending` | Missing from Lovable dashboard mockup. |
| Messages | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/[userType]/messages/page.tsx` | `/vendor/messages` through dynamic dashboard userType route | Real generic dashboard route exists. Missing from Lovable vendor dashboard spec. |
| Notifications | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/[userType]/notifications/page.tsx` | `/vendor/notifications` through dynamic dashboard userType route | Real generic dashboard route exists. Missing from Lovable vendor dashboard spec. |
| Settings | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/[userType]/settings/page.tsx` | `/vendor/settings` through dynamic dashboard userType route | Real generic dashboard route exists. |
| Vendor dashboard sidebar shell | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/layout.tsx` | Layout returns `children` only | Production has no dedicated vendor sidebar component in this layout. A Lovable dashboard sidebar is `NOT FOUND IN PRODUCTION`. |

Vendor dashboard modals:

| Trigger surface | Modal / component | File path | Mockup coverage |
|---|---|---|---|
| Booking request detail | `BookingDetailModal` | `/Users/chrisredd/3rdSpace.webapp/components/vendor/BookingDetailModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Booking list detail | `BookingDetailsModal` | `/Users/chrisredd/3rdSpace.webapp/components/vendor/BookingDetailsModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |
| Stripe onboarding | `StripeOnboardingModal` | `/Users/chrisredd/3rdSpace.webapp/components/vendor/StripeOnboardingModal.tsx` | Partially covered conceptually by Lovable signup/dashboard Connect banners, but production component differs. |
| Service package editing | `PackageModal` | `/Users/chrisredd/3rdSpace.webapp/components/vendor/PackageModal.tsx` | `NOT FOUND IN LOVABLE MOCKUP`. |

Vendor dashboard hierarchy:

```text
/vendor
├── /vendor/requests
├── /vendor/calendar
├── /vendor/bookings
├── /vendor/services
├── /vendor/pricing
├── /vendor/payouts
├── /vendor/analytics
├── /vendor/claim-pending
├── /vendor/messages
├── /vendor/notifications
└── /vendor/settings
```

## Section 7 - Stripe Connect Integration Touchpoints

Production webhook status:

- Platform webhook exists: `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts`
- Connect webhook does not exist: `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/connect/route.ts` is `NOT FOUND IN PRODUCTION`
- Missing Connect webhook is a launch blocker for production-grade connected-account event handling.

| Mockup money / Stripe surface | Relevant production API call | Webhook handler | Payment namespace | Match to actual money flow |
|---|---|---|---|---|
| Creator/builder subscription billing | `/Users/chrisredd/3rdSpace.webapp/app/api/builder/billing/checkout/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/subscription/create/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/subscription/cancel/route.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | Builder billing/subscription namespace is handled by billing routes; exact user-requested namespace not applicable | Production has a real `/planner/billing` surface. Lovable does not cover it as a planner sidebar page. |
| Builder Connect onboarding / payouts | `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/connect/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/callback/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/status/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/dashboard/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/refresh/route.ts` | Platform webhook exists; Connect webhook `NOT FOUND IN PRODUCTION` | Builder payout / Connect account | Production has builder Stripe APIs; mockup does not consistently show builder Connect redirect handling. |
| Venue Connect onboarding banner | `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/connect/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/callback/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/status/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/dashboard/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/refresh/route.ts` | Platform webhook exists; Connect webhook `NOT FOUND IN PRODUCTION` | Venue Connect account | Production uses `/venue`, not `/dashboard/venue`. |
| Vendor Connect onboarding banner | `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/connect/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/callback/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/status/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/dashboard/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/refresh/route.ts` | Platform webhook exists; Connect webhook `NOT FOUND IN PRODUCTION` | Vendor Connect account | Production uses `/vendor`, not `/dashboard/vendor`. |
| Venue rental payment card / deposit collection | `/Users/chrisredd/3rdSpace.webapp/app/api/planner/plans/[planId]/venue-payment/checkout/route.ts`; `/Users/chrisredd/3rdSpace.webapp/lib/payments/venue-rental.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | `venue_rental` | Production stores cents-based amounts and uses zero platform fee on rental checkout. Mockup must not imply a platform fee on venue rentals. |
| Venue rental payment summary | `/Users/chrisredd/3rdSpace.webapp/app/api/planner/payments/venue-rentals/summary/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/rentals/summary/route.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | `venue_rental` | Production has both planner and venue summary endpoints. |
| Venue-builder kickback settlement | `/Users/chrisredd/3rdSpace.webapp/app/api/venue/kickbacks/[id]/checkout/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/kickbacks/summary/route.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | `venue_builder_kickback` | Production has explicit namespace and webhook handling. Mockup must represent this as post-event settlement, not upfront organizer payment. |
| Vendor payment cards | `/Users/chrisredd/3rdSpace.webapp/app/api/payments/vendor/route.ts`; `/Users/chrisredd/3rdSpace.webapp/lib/payments/vendor-payments.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts`; Connect webhook `NOT FOUND IN PRODUCTION` | Exact string `vendor_payment` is `NOT FOUND IN PRODUCTION`; vendor payment routes and transfers exist | Production uses Stripe payment intents/transfers and approval-first flows. Mockup should not show auto-pay without approval. |
| Planner deposit authorization | `/Users/chrisredd/3rdSpace.webapp/app/api/planner/plans/[planId]/payments/authorize/route.ts`; `/Users/chrisredd/3rdSpace.webapp/lib/planner/depositPayments.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | `planner_deposit` | Production creates/captures payment intents. Mockup should preserve approval-first authorization. |
| Refund request / decision | `/Users/chrisredd/3rdSpace.webapp/app/api/planner/plans/[planId]/venue-payment/[transactionId]/refund-request/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/planner/plans/[planId]/refund-decision/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/rentals/[transactionId]/refund-decision/route.ts` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/route.ts` | `venue_rental` / `venue_builder_kickback` depending on payment | Production has refund-specific routes. Lovable mockup does not cover refund workflows. |

## Section 8 - Missing Surfaces in the Mockup

| Missing production surface | Production file path | Notes |
|---|---|---|
| Splash hero composer | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | P0 missing from Lovable. Must remain interactive and route to `/planner?draft=<encoded-prompt>`. |
| Planner approval cards inside `/planner` | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Inline `PlannerApprovalCard` around the approval section, including authorize/edit/cancel modes and billing gate. |
| Planner sidebar entry: Experiences | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/experiences/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Templates | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/templates/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Venues nested marketplace/detail | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/marketplace/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/[venueId]/page.tsx` | Missing drill-down coverage. |
| Planner sidebar entry: Tickets | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/tickets/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Vendors nested marketplace/detail | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/marketplace/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/[vendorId]/page.tsx` | Missing drill-down coverage. |
| Planner sidebar entry: Messages | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/messages/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Billing | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/billing/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Analytics | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/analytics/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner sidebar entry: Settings | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/settings/page.tsx` | Missing as first-class Lovable sidebar page. |
| Planner signup gate production behavior | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSignupGate.tsx` | Lovable/requested mockup shows inline 3-field signup; production has redirect modal. |
| Billing gate / free tier exhaustion screen | `/Users/chrisredd/3rdSpace.webapp/components/planner/BillingGateModal.tsx` | Missing from Lovable. |
| Planner templates modal | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx` | Missing from Lovable. |
| Venue rental payment method overlay | `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentButton.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentMethodPicker.tsx` | Missing from Lovable. |
| Refund request dialogs | `/Users/chrisredd/3rdSpace.webapp/components/planner/BookedPartnersWorkspace.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/payments/page.tsx` | Missing from Lovable. |
| Stripe Connect onboarding redirect handling | `/Users/chrisredd/3rdSpace.webapp/app/api/builder/stripe/callback/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/venue/stripe/callback/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/api/vendor/stripe/callback/route.ts` | Missing from Lovable dashboard mockup. |
| Email verification banner / confirmation handoff | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | Signup flow supports confirmation redirect and messaging; Lovable mockup does not cover it. |
| Terms page | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/terms/page.tsx` | Lovable footer references legal links but does not mock the actual page. |
| Privacy page | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/privacy/page.tsx` | Lovable footer references legal links but does not mock the actual page. |
| Health check / status page | `/Users/chrisredd/3rdSpace.webapp/app/api/health/route.ts`; `/Users/chrisredd/3rdSpace.webapp/app/admin/health/page.tsx` | Missing from Lovable. |
| Admin home | `/Users/chrisredd/3rdSpace.webapp/app/admin/page.tsx` | Missing from Lovable. |
| Admin claims | `/Users/chrisredd/3rdSpace.webapp/app/admin/claims/page.tsx` | Missing from Lovable. |
| Admin concierge | `/Users/chrisredd/3rdSpace.webapp/app/admin/concierge/page.tsx` | Missing from Lovable. |
| Admin failures | `/Users/chrisredd/3rdSpace.webapp/app/admin/failures/page.tsx` | Missing from Lovable. |
| Admin ops | `/Users/chrisredd/3rdSpace.webapp/app/admin/ops/page.tsx` | Missing from Lovable. |
| Admin overrides | `/Users/chrisredd/3rdSpace.webapp/app/admin/overrides/page.tsx` | Missing from Lovable. |
| Admin catalog vendors | `/Users/chrisredd/3rdSpace.webapp/app/admin/catalog/vendors/page.tsx` | Missing from Lovable. |
| Admin catalog venues | `/Users/chrisredd/3rdSpace.webapp/app/admin/catalog/venues/page.tsx` | Missing from Lovable. |
| Connect webhook route | `NOT FOUND IN PRODUCTION` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/connect/route.ts` does not exist. This is a launch blocker for connected-account event handling. |

## Section 9 - Component-Library Port Plan

Production UI component files:

- `/Users/chrisredd/3rdSpace.webapp/components/ui/button.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/card.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/input.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/label.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/switch.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/textarea.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/toast.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/inline-form-error.tsx`

Component files `NOT FOUND IN PRODUCTION`:

- `/Users/chrisredd/3rdSpace.webapp/components/ui/dialog.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/drawer.tsx`
- `/Users/chrisredd/3rdSpace.webapp/components/ui/sheet.tsx`

Token sources:

- Production Tailwind config: `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts`
- Production global tokens/utilities: `/Users/chrisredd/3rdSpace.webapp/app/globals.css`
- Lovable reference tokens: `/Users/chrisredd/3rdplace-design/src/styles.css`

| Lovable token / pattern | Production target | Current production status | Notes |
|---|---|---|---|
| Warm cream background | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` CSS variables and `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` color entries | Production currently uses dark vibrant variables from AGENTS.md | This contradicts the repo design-system brief in AGENTS.md. Porting warm cream requires an explicit design-system decision. |
| Terracotta / clay accent | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` `--primary` or `--secondary` | Production already has coral/orange primary-style variables | Can map without changing component APIs if variable values change only in CSS. |
| Forest success | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` success variables | Production has `--success` | Token mapping exists. |
| Ochre warning | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` warning variables | Production has `--warning` | Token mapping exists. |
| Brick error | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` destructive variables | Production has `--destructive` | Token mapping exists. |
| Fraunces display font | `/Users/chrisredd/3rdSpace.webapp/app/globals.css`; `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` | `NOT FOUND IN PRODUCTION` | Production wires Space Grotesk as `font-display`, not Fraunces. |
| Inter body font | `/Users/chrisredd/3rdSpace.webapp/app/globals.css`; `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` | Already wired | Production uses Inter. |
| JetBrains Mono data font | `/Users/chrisredd/3rdSpace.webapp/app/globals.css`; `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` | `NOT FOUND IN PRODUCTION` | Production uses default monospace family entries, not explicit JetBrains Mono. |
| Gradient card utility | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` | Exists as `.bg-gradient-card` | Production utility exists but currently dark vibrant. |
| Gradient brand utility | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` | Exists as `.bg-gradient-brand` and `.text-gradient-brand` | Production utility exists. Lovable design should be applied by token changes, not by changing button/card APIs. |
| Hero button API | `/Users/chrisredd/3rdSpace.webapp/components/ui/button.tsx` | `variant="hero"` exists | Preserve API and adjust CSS/classes only if porting. |
| Glass button API | `/Users/chrisredd/3rdSpace.webapp/components/ui/button.tsx` | `variant="glass"` exists | Preserve API. |
| Card API | `/Users/chrisredd/3rdSpace.webapp/components/ui/card.tsx` | Uses rounded card, border, gradient card | Preserve API. |

File-by-file port impact list:

| Area | File path | Port action scope |
|---|---|---|
| Global tokens | `/Users/chrisredd/3rdSpace.webapp/app/globals.css` | Apply Lovable color/font variables here first if approved. |
| Tailwind theme | `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` | Add or remap `font-display` only if Fraunces replaces Space Grotesk. |
| Button variants | `/Users/chrisredd/3rdSpace.webapp/components/ui/button.tsx` | Keep variants stable; tune classes only. |
| Card surfaces | `/Users/chrisredd/3rdSpace.webapp/components/ui/card.tsx` | Keep component API stable; tune token-backed surfaces only. |
| Marketing header | `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx` | Apply visual treatment, preserve routes. |
| Splash composer | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | Preserve textarea, prompt chips, and `/planner?draft=` routing. |
| Signup flows | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | Style existing step flows without changing field names or backend payload shape. |
| Planner shell | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerShell.tsx` | Shell styling only. |
| Planner sidebar | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSidebar.tsx` | Sidebar visual port; do not remove routes. |
| Planner top bar | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTopBar.tsx` | Search/account/status styling only. |
| Signup gate modal | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSignupGate.tsx` | Style or replace only after deciding whether inline 3-field signup is in scope. |
| Billing gate modal | `/Users/chrisredd/3rdSpace.webapp/components/planner/BillingGateModal.tsx` | Style modal shell; preserve gating logic. |
| Venue rental payment | `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentButton.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentMethodPicker.tsx` | Style overlay; do not change payment namespace or zero-fee rental behavior. |
| Payout overview | `/Users/chrisredd/3rdSpace.webapp/components/payments/PayoutOverviewPanel.tsx` | Style money cards; preserve cents-based values. |
| Venue dashboard | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/page.tsx` and nested `/venue/*` files | Last-pass visual port only; do not add new dashboard routes. |
| Vendor dashboard | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/page.tsx` and nested `/vendor/*` files | Last-pass visual port only; do not add new dashboard routes. |

## Section 10 - Recommended Port Order

Target date context: four-week launch timeline ending Monday, June 30.

| Phase | Scope | Production files | Constraints |
|---|---|---|---|
| 1 | Splash and marketing shell first | `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/marketing/Header.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/terms/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(marketing)/privacy/page.tsx` | Highest marketing leverage and lowest blast radius. Preserve the `HomePlannerStart` composer and `/planner?draft=` routing. |
| 2 | Signup/auth visual pass | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(auth)/signup/[portal]/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/api/auth/signup/route.ts`; `/Users/chrisredd/3rdSpace.webapp/lib/server/account-setup.ts` | Do not break payload field names. Resolve the production Creator `total=5` vs AGENTS `4 steps` contradiction before changing visual structure. |
| 3 | Planner shell and sidebar styling | `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerShell.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerSidebar.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTopBar.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/layout.tsx` | Port shell/sidebar before internals. Do not remove any sidebar entry or nested route. |
| 4 | Planner internals after Phase 3 vendor payment work lands | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerLivePlanPanel.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerTimelineCountdown.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/PlannerDataConnectionPanel.tsx`; `/Users/chrisredd/3rdSpace.webapp/components/planner/VenueRentalPaymentButton.tsx` | Highest blast radius. Preserve approval-first execution, cents-based money values, and billing gates. |
| 5 | Planner side pages | `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/experiences/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/templates/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/venues/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/vendors/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/tickets/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/messages/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/payments/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/billing/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/analytics/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(planner)/planner/settings/page.tsx` | Keep nested drill-down routes intact. Do not summarize or collapse sidebar pages into Lovable's flat `Partners` concept. |
| 6 | Venue and vendor dashboards last | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/*`; `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/*`; `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/[userType]/*`; `/Users/chrisredd/3rdSpace.webapp/components/venue/*`; `/Users/chrisredd/3rdSpace.webapp/components/vendor/*` | Lowest urgency and widest surface area. Do not add new routes under `(dashboard)`. Production URLs remain `/venue` and `/vendor`, not `/dashboard/venue` or `/dashboard/vendor`. |

Launch blockers and contradictions to resolve before porting money/signup visuals:

| Issue | File path | Required decision |
|---|---|---|
| Creator signup step count conflict | `/Users/chrisredd/3rdSpace.webapp/components/auth/SignupExperience.tsx` | Production currently uses `total = 5`; AGENTS.md and mockup spec require 4. |
| Warm cream Lovable theme conflicts with AGENTS dark vibrant design system | `/Users/chrisredd/3rdSpace.webapp/app/globals.css`; `/Users/chrisredd/3rdSpace.webapp/tailwind.config.ts` | Choose whether the design-system source of truth is changing before rewriting tokens. |
| Lovable lacks production splash composer | `/Users/chrisredd/3rdSpace.webapp/components/planner/HomePlannerStart.tsx` | Keep composer as P0 in redesigned splash. |
| Connect webhook missing | `NOT FOUND IN PRODUCTION` | `/Users/chrisredd/3rdSpace.webapp/app/api/webhooks/stripe/connect/route.ts` must exist before connected-account webhook handling is launch-ready. |
| Mockup uses `/dashboard/venue` and `/dashboard/vendor` | `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/venue/page.tsx`; `/Users/chrisredd/3rdSpace.webapp/app/(dashboard)/vendor/page.tsx` | Production routes are `/venue` and `/vendor`; do not port wrong route labels. |
