## Summary

Promotes the wired mobile planner shell from PR #33 into the canonical `/planner/*` route family. The homepage splash still routes to `/planner?draft=...`; `/planner` now renders the mobile shell below `lg` and the existing desktop planner workspace at `lg+`.

## Route Map

| Old path | New canonical path | Notes |
| --- | --- | --- |
| `/mobile-mockup` | `/planner` | 308 |
| `/mobile-mockup/planner` | `/planner` | 308 |
| `/mobile-mockup/approvals` | `/planner/payments` | Mobile review queue maps to existing payments/approvals area |
| `/mobile-mockup/messages` | `/planner/messages` | 308 |
| `/mobile-mockup/vendors` | `/planner/vendors` | 308 |
| `/mobile-mockup/outreach` | `/planner/outreach` | New canonical planner route; desktop falls back to existing workspace |
| `/mobile-mockup/settings` | `/planner/settings` | 308 |
| `/mobile-mockup/new-plan` | `/planner/new-plan` | New canonical public planner-intake route |
| `/mobile-mockup/ticketing` | `/planner/tickets` | Existing canonical ticketing route is `/planner/tickets` |
| `/mobile-mockup/analytics` | `/planner/analytics` | 308 |
| `/mobile-mockup/billing` | `/planner/billing` | 308 |

## Files Renamed / Moved / Deleted

- Moved `components/planner/mobile-mockup/MobilePlannerMockup.tsx` to `components/planner/mobile/MobilePlanner.tsx`
- Moved `components/planner/mobile-mockup/mobileMockupSpacing.ts` to `components/planner/mobile/mobileSpacing.ts`
- Added `components/planner/mobile/PlannerResponsiveLayout.tsx`
- Added `app/(planner)/planner/layout.tsx`
- Added `app/(planner)/planner/new-plan/page.tsx`
- Added `app/(planner)/planner/outreach/page.tsx`
- Deleted `app/(mobile-mockup)/`
- Deleted stale PR #33 body artifact that documented the old mockup-only state

## Responsive Behavior

- Promoted routes render the mobile tree below `lg` and existing desktop tree at `lg+`.
- `PlannerShell` hides its desktop navigation chrome below `lg` only for promoted mobile routes.
- Hidden desktop `PlannerWorkspace` skips draft/server-loading side effects below `lg`, so mobile owns `/planner?draft=...`.
- Homepage `/planner?draft=...` handoff auto-starts the mobile planner draft; users do not have to press a second "Start private plan" button.
- Unauthenticated/public intake falls back to a local draft instead of surfacing the private-plan API error.
- `/planner/new-plan` is allowed through middleware like `/planner`, so public planner intake does not redirect unauthenticated users to login.
- Protected subroutes still require a signed-in community builder session before route content renders.

## Redirect Verification

```text
/mobile-mockup -> 308 /planner
/mobile-mockup/planner -> 308 /planner
/mobile-mockup/approvals -> 308 /planner/payments
/mobile-mockup/messages -> 308 /planner/messages
/mobile-mockup/vendors -> 308 /planner/vendors
/mobile-mockup/outreach -> 308 /planner/outreach
/mobile-mockup/settings -> 308 /planner/settings
/mobile-mockup/new-plan -> 308 /planner/new-plan
/mobile-mockup/ticketing -> 308 /planner/tickets
/mobile-mockup/analytics -> 308 /planner/analytics
/mobile-mockup/billing -> 308 /planner/billing
```

## Screenshots

Saved under `qa-artifacts/mobile-promote-screenshots/`:

- `planner-mobile-390.png`
- `planner-desktop-1440.png`
- `new-plan-mobile-390.png`
- `new-plan-desktop-1440.png`
- `boundary-1023.png`
- `boundary-1024.png`
- `splash-mobile-draft-flow.png`

The public splash flow was verified at 390x844: homepage textarea submit lands on `/planner?draft=Founder%20dinner%20for%2024...`, auto-starts the mobile planner draft, renders the loaded planner view, and does not show the second "Start private plan" step.

Breakpoint check:

- `1023px`: mobile new-plan tree
- `1024px`: desktop planner tree

Note: protected planner subroutes require an authenticated builder session. Local unauthenticated browser attempts correctly redirect or emit 401s, so the committed screenshots focus on public planner intake and the desktop/mobile boundary. Build output confirms the promoted canonical routes compile.

## Validation

- `npm run type-check` passed
- `npm run lint` passed with existing unrelated warnings
- `npm test -- __tests__/planner/mobileReadModels.test.ts __tests__/integration/mobile-planner-routes.test.ts --runInBand` passed
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed
- `npm run security:rls` passed
- `npm test -- --runInBand` passed, 96 suites passed / 1 skipped, 575 tests passed / 9 skipped
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npm run build` passed
- Browser smoke: homepage submit at mobile viewport landed on `/planner?draft=Founder%20dinner%20for%2024...`, removed desktop rail, auto-loaded the planner, and did not show "Start private plan" or "Unable to start plan"

## Rollback

Revert this PR. The old `/mobile-mockup/*` pages are deleted here, but all old URLs are covered by 308 redirects to canonical `/planner/*` paths.
