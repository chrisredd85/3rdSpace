# Brief Consolidation Audit - 2026-06-27

## Scope

This audit covers the tab-level consolidation request: remove the desktop planner `Event Plan` tab, move the full brief to Experiences as the per-event operating record, and add a compact planner brief strip above the tab row. It does not recommend changing brief copy, section names, approval semantics, or brief field meanings.

## Current Planner Tab State

- `components/planner/planner-page/types.ts:4-11` defines six planner tabs: `chat`, `event_plan`, `recommendations`, `approvals`, `data`, and `timeline`.
- `components/planner/planner-page/PlannerWorkspace.tsx:65` initializes the active tab to `chat`, so no default-tab migration is needed.
- `components/planner/planner-page/PlannerWorkspace.tsx:187-201` reads `?tab=...` client-side and treats any `planTabs` entry as a valid destination. Once `event_plan` is removed, old URLs must be handled before the client workspace sees them.
- `components/planner/planner-page/PlannerWorkspace.tsx:1642-1673` renders the tab list directly from `planTabs`.
- `components/planner/planner-page/PlannerWorkspace.tsx:1675-1683` changes the tab header icon when `activeTab === 'event_plan'`.
- `components/planner/planner-page/PlannerWorkspace.tsx:1781-1787` renders `<PlannerLivePlanPanel inline />` only when `activeTab === 'event_plan'`.
- `components/planner/PlannerTimelineCountdown.tsx:29` includes `event_plan` in the local navigation tab type even though the countdown currently routes to approvals/timeline surfaces.

## Current Experiences Route State

- `app/(planner)/planner/experiences/page.tsx:283-291` is a single server route that accepts `searchParams.record`; it does not expose a dynamic `/planner/experiences/[planId]` detail route.
- `app/(planner)/planner/experiences/page.tsx:288-291` loads all Experiences data and chooses a selected record via `getSelectedRecord(data.records, searchParams?.record)`.
- `app/(planner)/planner/experiences/page.tsx:182-206` defines `ExperienceRecord` with its own operating-record shape and `href`, but this is not the same component as the full planner brief.
- `app/(planner)/planner/experiences/page.tsx:1346` builds record URLs as `/planner/experiences?record=<kind:id>`, confirming the current detail model is query-driven.
- `app/(planner)/planner/experiences/page.tsx:454` starts the data-backed loader for the Experiences index. The loader is useful for the index but is not the right seam for rendering the full `PlannerLivePlanPanel` for one current plan.

## Current Full Brief Data Flow

- `components/planner/PlannerLivePlanPanel.tsx:168-181` accepts `messages`, `planId`, and callback props but also reads the current live plan payload when explicit props are absent.
- `components/planner/PlannerLivePlanPanel.tsx:1392-1404` keeps the full brief as a client component.
- `components/planner/PlannerLivePlanPanel.tsx:1441-1455` reads `planner-live-plan` from localStorage and listens for `planner-live-plan:update`, so rendering this component on a new route requires explicitly publishing the fetched plan payload or passing props.
- `components/planner/PlannerLivePlanPanel.tsx:1462-1465` uses explicit `messages` / `planId` props when provided, falling back to the live payload otherwise.
- `components/planner/planner-page/plannerState.ts:224-264` publishes the same live plan payload used by the panel. A new Experiences detail client can reuse this helper after fetching `/api/planner/plans/[planId]`.
- `components/planner/planner-page/plannerState.ts:412-452` already has the client fetch path for `/api/planner/plans/[planId]`.
- `app/api/planner/plans/[planId]/route.ts:72-102` returns `{ plan, messages, recommendations, approvals, workspace_summary, timeline }` for an authenticated community builder. This is the correct existing backend seam for the new Experiences detail route.

## Brief Sections to Preserve

The full brief already contains the requested section content in `PlannerLivePlanPanel`:

- Event facts, ticketing, budget, venue terms, complexity, run-of-show field: `components/planner/PlannerLivePlanPanel.tsx:2045-2073`.
- Date-change approval workflow: `components/planner/PlannerLivePlanPanel.tsx:2079-2207`.
- Top venue, readiness, status, invite/report controls: `components/planner/PlannerLivePlanPanel.tsx:2209-2301`.
- Open questions: `components/planner/PlannerLivePlanPanel.tsx:2303-2320`.
- Profit window and custom costs live inside the `Profit Window` section starting at `components/planner/PlannerLivePlanPanel.tsx:2347`.
- Venue deal model comparison starts at `components/planner/PlannerLivePlanPanel.tsx:2474`.
- Shopping list starts at `components/planner/PlannerLivePlanPanel.tsx:2510`.
- Payment and agent authorization starts at `components/planner/PlannerLivePlanPanel.tsx:2557`.
- Connected data and spending rules start at `components/planner/PlannerLivePlanPanel.tsx:2634`.

## Section Collapsibility State

- `components/planner/PlannerLivePlanPanel.tsx:2721-2779` already wraps each `ArtifactSection` in a collapsible button and persists state to localStorage.
- Current storage key shape is `brief_section_<section_name>` at `components/planner/PlannerLivePlanPanel.tsx:2732`, but current values are `collapsed` / `expanded` at `components/planner/PlannerLivePlanPanel.tsx:2737-2749`.
- The prompt asks for values `'true' | 'false'`. Implementation should normalize this without breaking already-saved `collapsed` / `expanded` values.
- There is no existing `components/ui/collapsible` or `components/ui/accordion` file in this worktree, so the safest path is to keep the existing local `ArtifactSection` pattern and make it match the requested persistence/default behavior.

## Mobile State

- `components/planner/mobile/MobilePlanner.tsx:54-57` includes a `brief` mobile view.
- `components/planner/mobile/MobilePlanner.tsx:919` routes the mobile shell to `BriefView` when `view === 'brief'`.
- `components/planner/mobile/MobilePlanner.tsx:1444-1566` renders the existing mobile brief view with confirmed facts, operating loop, notes, and approval-gated external-use copy.
- `components/planner/mobile/MobilePlanner.tsx:1494-1496` already uses `Event brief` / `Shared operating brief` language.
- `lib/planner/mobileReadModels.ts:29-36` returns the current `plan`, pending approvals, progress, and updates for mobile home.
- `lib/planner/mobileReadModels.ts:135-155` builds the mobile home read model from the same plan plus approvals/recommendations/activity.

## URL Redirect Surface

- `app/(planner)/planner/page.tsx:1-15` is currently a client component that only wraps `PlannerWorkspace`. To return a real 308 for `?tab=event_plan`, this route should become a server component that checks `searchParams` and calls `permanentRedirect` before rendering the client workspace.
- Existing `/planner?tab=event_plan&plan=<planId>` should redirect to `/planner/experiences/<planId>`.
- Existing `/planner?tab=event_plan` without a plan id cannot resolve a specific brief on the server. It should redirect to `/planner` so the client loads the active plan and exposes the brief strip.
- No `app/(planner)/planner/event-plan/[planId]` route exists today. Creating a small permanent redirect route is safe and keeps future old links from 404ing.

## Implementation Plan

1. Create `/planner/experiences/[planId]` as a server route with a client detail component. The client fetches `/api/planner/plans/[planId]`, publishes the live plan payload, and renders `PlannerLivePlanPanel inline` with `messages` and `planId`.
2. Add `PlannerBriefStrip` as a compact summary component mounted in `PlannerWorkspace` between the plan header and tab row. It should use the active `Plan`, current messages when useful, and link to `/planner/experiences/<planId>`.
3. Convert `app/(planner)/planner/page.tsx` to a server component that permanently redirects `?tab=event_plan` links before rendering `PlannerWorkspace`.
4. Remove `event_plan` from `planTabs`, remove the `PlannerLivePlanPanel` branch in `PlannerWorkspace`, and remove planner-tab type references that only exist to support the old tab.
5. Normalize `ArtifactSection` collapsibility defaults and storage values while preserving legacy saved values.
6. Keep mobile brief language aligned and link mobile planner users to the same full brief route where appropriate.

## Risk Notes

- The full brief includes date-change approval creation. If the new Experiences detail route renders without `onDateChangeRequest`, that action becomes disabled. To preserve parity, the new detail client should provide a callback that posts to `/api/planner/plans/[planId]/date-change`, republishes the returned plan/messages, and routes the organizer to planner approvals.
- The old planner tab URL includes client-only hash fragments that are not visible to server components. Query params can be preserved; hash preservation is not possible server-side.
- No approval-gated execution path is changed by this consolidation.
