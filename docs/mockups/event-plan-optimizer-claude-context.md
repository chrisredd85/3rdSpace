# Context Window: 3rdSpace Event Idea Planner Optimization

You are helping design and/or implement an MVP feature for 3rdSpace, a marketplace where event creators can plan events, find venues, find vendors, message providers, and manage event workflows.

## Product Problem

An event creator may start with a vague intent:

> I want to host a game night for around 40 people with casual food, drinks, and a welcoming venue.

The product should convert that idea into a useful event plan without making the app feel like a complicated production-management system.

The earlier mockup became too dense because it exposed every logistics detail immediately: venue requirements, vendor call sheets, full run of show, checklist, budget, risk flags, and open questions all at once. That is useful for a professional organizer, but too heavy as the first MVP surface.

## Recommended Product Direction

Use a progressive workflow:

1. Start from an idea.
2. Show a lightweight event plan summary.
3. Ask only the questions that block venue/vendor matching.
4. Let the user optionally inspect deeper logistics.
5. Convert the accepted draft into existing wizard objects.

The feature should feel like:

> "3rdSpace understood what I am trying to host and helped me take the next step."

Not:

> "I just opened a complex event operations dashboard."

## Existing App Context

The app is a Next.js 14 app using App Router, TypeScript, Tailwind, and lucide-react icons.

Relevant product areas:

- Builder dashboard: `/builder`
- Event wizard: `/builder/event/[eventId]`
- Existing wizard steps:
  - Planning
  - Team
  - Venue
  - Vendors
  - Timeline
  - Checklist
  - Documents
  - Finalize

Existing visual language:

- Dark dashboard shell
- Sidebar navigation
- Gradient brand buttons
- Rounded cards
- `bg-gradient-card`, `bg-gradient-brand`, `shadow-card`, `shadow-glow`
- Font display style via `font-display`
- Icons from `lucide-react`

Useful existing files:

- `components/shared/Sidebar.tsx`
- `components/shared/Header.tsx`
- `components/builder/event-wizard/EventPlanningStep.tsx`
- `components/builder/event-wizard/EventVenueStep.tsx`
- `components/builder/event-wizard/EventVendorStep.tsx`
- `components/builder/event-wizard/EventTimelineStep.tsx`
- `components/builder/event-wizard/EventChecklistStep.tsx`
- `app/globals.css`
- `components/ui/button.tsx`

## Current Mockups

Three mockup routes exist:

- Concept draft: `/mockups/event-idea-planner`
- Logistics-heavy version: `/mockups/event-logistics-planner`
- Optimized progressive version: `/mockups/event-plan-optimizer`

The optimized version is the preferred direction.

Key file:

- `app/mockups/event-plan-optimizer/page.tsx`

Preview image:

- `public/mockups/event-plan-optimizer-preview.png`

## What the Optimized Mockup Does

The optimized mockup includes:

- Plain-language event idea input.
- Draft result summary:
  - Event type: Game Night
  - Guest range: 32-48
  - Blockers: 3
  - Create: 6 objects
- Three tabs:
  - Plan Summary
  - Logistics Detail
  - Create Objects
- Blocker cards that can be clicked to mark answered:
  - Date window
  - Alcohol path
  - Food rules
- Readiness score that improves as blockers are answered.
- Collapsible logistics sections:
  - Venue requirements
  - Vendor needs
  - Run of show
  - Checklist tasks
- Create Objects tab with toggles for what should be written into the event wizard:
  - Event brief
  - Venue filters
  - Vendor needs
  - Run of show
  - Checklist tasks
  - Budget lines
- Create Event Plan button that moves the UI into a created state.

## UX Rules For The Next Attempt

Keep the first view simple.

Do not show the full operations board immediately. Details should be available, but not dominant.

Venue/vendor recommendations should be database-driven, not invented by AI.

AI, if used later, should parse intent into structured data. It should not directly book vendors, send messages, or claim availability.

Use the existing wizard as the destination for created objects. The draft is not the source of truth; the event and wizard steps are.

Avoid making the product feel like a chatbot. This should be an "idea-to-plan" accelerator inside the event creation workflow.

## Engineering Shape

For MVP, implement a template-driven planner before AI.

Suggested structure:

```txt
components/builder/event-wizard/EventIdeaPlanner.tsx
components/builder/event-wizard/EventPlanSummary.tsx
components/builder/event-wizard/EventPlanLogisticsPreview.tsx
components/builder/event-wizard/EventPlanCreateReview.tsx
lib/event-plans/templates.ts
lib/event-plans/match-template.ts
app/api/event-plans/draft/route.ts
app/api/event-plans/apply/route.ts
```

Data model idea:

```txt
event_plan_templates
- id
- slug
- name
- prompt_examples
- event_type
- venue_traits jsonb
- vendor_categories jsonb
- timeline jsonb
- checklist jsonb
- budget_ranges jsonb

event_plan_drafts
- id
- event_id
- user_id
- raw_prompt
- matched_template_slug
- generated_plan jsonb
- accepted_at
- created_at
```

## Acceptance Criteria

The next design/code attempt should:

- Fit inside the current 3rdSpace dashboard shell.
- Make the MVP feature feel lighter than the logistics-heavy mockup.
- Let the user see immediate value within one screen.
- Ask only 2-4 blocker questions before matching venues/vendors.
- Preserve a path to deeper logistics without forcing it upfront.
- Have a clear final CTA: `Create Event Plan`.
- Make clear that no vendor messages, bookings, or external actions happen automatically.
- Work responsively on desktop and mobile.

## Suggested Copy Direction

Primary header:

> Start with the event, not the system

Supporting copy:

> The first screen stays light: understand the idea, show a useful draft, ask only the blockers, then create working event objects.

Primary CTA:

> Create Event Plan

Guardrail copy:

> This creates event planning objects only. It does not book anything or message vendors.

