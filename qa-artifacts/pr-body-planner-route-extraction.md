## Summary

Extracts the large `/planner` route workspace out of `app/(planner)/planner/page.tsx` into focused modules under `components/planner/planner-page/`.

The route file now stays as a small Suspense wrapper around `PlannerWorkspace`; planner state, draft-mode helpers, conversation rendering, template modal UI, and local types move into separate files.

## Scope

Ported from local branch `refactor/planner-route-extraction` onto current `origin/main` after PR #28.

Included:
- `components/planner/planner-page/PlannerWorkspace.tsx`
- `components/planner/planner-page/PlannerConversation.tsx`
- `components/planner/planner-page/PlannerTemplatesModal.tsx`
- `components/planner/planner-page/draftMode.ts`
- `components/planner/planner-page/plannerState.ts`
- `components/planner/planner-page/types.ts`
- Slimmed `app/(planner)/planner/page.tsx`

Excluded:
- Removed the old branch's `OutreachSenderSettingsPanel` import/render hunk. That component exists only on outreach-phase branches and is not part of current `main`; keeping it would couple this mechanical route extraction to phase-5 outreach work.

## Behavior

Intended behavior is unchanged. The Event Plan tab remains equivalent to current `main`: it renders `PlannerLivePlanPanel` only.

No migrations, route handlers, payment flows, booking flows, or outreach execution paths are changed.

## Validation

- `npm install` passed; existing npm audit warnings remain
- `npm run type-check` passed
- `npm run lint` passed with existing React hook warnings, now partly reported from `PlannerWorkspace.tsx`
- `npm test` parallel run failed once on known local `venue-payouts-rental-ui.test.tsx` timeout
- `npm test -- --runInBand` passed, 94 suites / 567 tests
- `npm test -- __tests__/integration/venue-payouts-rental-ui.test.tsx --runInBand` passed
- `npm run build` passed with local Supabase env from `supabase status -o env`
- Dev smoke on `127.0.0.1:3105`: `/api/health` 200, `/planner` 200

## Rollback

Revert this PR to return the planner route to the monolithic file.
