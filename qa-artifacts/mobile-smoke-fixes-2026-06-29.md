# Mobile Smoke Fixes - 2026-06-29

Branch: `codex/mobile-smoke-fixes`  
Base: `origin/main @ e31c2dd`

## Issue 1: Experiences record selector stale

**Root cause:** The Experiences page defaulted to the first combined record after date-based sorting. A newly created plan could be hidden behind an older future-dated record, and the rail only displayed the first four records without forcing the selected record into view.

**Fix:** `app/(planner)/planner/experiences/page.tsx` now uses the shared `selectExperienceRecord` helper. `lib/planner/experienceRecordSelection.ts` selects the newest created planner draft by default when no explicit `?record=` is present, and `orderExperienceRecordRail` keeps the selected record first in the rail.

**Test added:** `lib/planner/__tests__/experienceRecordSelection.test.ts`

**Mobile + desktop both affected?** Yes. The Experiences route is shared; mobile and desktop use the same selected record and rail data.

**Status:** Fixed.

## Issue 2: Intake redundant clarification

**Root cause:** The intake prompt could still let the model ask an event-type confirmation question after an exact archetype match. There was no post-parse guard to enforce exact-match archetype locks.

**Fix:** `lib/ai/agents/intakeAgent.ts` now explicitly instructs the model not to reconfirm exact archetype matches and post-processes exact-match output. If a redundant event-type confirmation appears, it is replaced with the next unanswered archetype intake question when available.

**Test added:** `lib/ai/agents/__tests__/intakeAgent.test.ts`

**Eval test result:** Focused Jest passed after the fix. No separate eval corpus was run.

**Status:** Fixed.

## What Was Not Changed

- No route or schema changes.
- No broader Experiences page refactor beyond selected-record source of truth.
- No changes to fuzzy or inferred archetype clarification behavior.
- No mobile-only visual redesign.

## Verification Checklist

- [x] Mobile data flow: new plan becomes default selected through the shared Experiences selection helper.
- [x] Desktop data flow: same shared route/helper used by desktop Experiences view.
- [x] Intake: exact archetype match does not trigger redundant event-type clarification.
- [x] Existing intake behavior: fuzzy archetype clarification still passes.
- [x] No new console or Sentry instrumentation added.
- [ ] Manual authenticated mobile browser smoke not run in this branch; covered by focused tests and full Jest hook.

## Commands

- `npm ci --ignore-scripts`
- `jest lib/planner/__tests__/experienceRecordSelection.test.ts --runInBand` - passed.
- `jest lib/ai/agents/__tests__/intakeAgent.test.ts --runInBand` - passed.
- Commit hook for `fix(planner): default experiences to newest plan`: lint passed with existing warnings; type-check passed; full Jest passed (`1165 passed`, `9 skipped`).
- Commit hook for `fix(ai): suppress exact archetype reconfirmation`: lint passed with existing warnings; type-check passed; full Jest passed (`1167 passed`, `9 skipped`).
