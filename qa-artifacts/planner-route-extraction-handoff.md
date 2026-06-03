# Planner Route Extraction Handoff

Branch: `refactor/planner-route-extraction`

## Kept
- `app/(planner)/planner/page.tsx` as a slim client wrapper around `PlannerWorkspace`.
- Extracted planner-page components under `components/planner/planner-page/`.

## Dropped
- Outreach pages, discovery pages, recommendations refactor, monitoring, Sentry, package changes, and E2E changes.
- No feature migrations or API behavior changes are included.
- `OutreachSenderSettingsPanel` import/render hunk from the old refactor commit was removed because that component belongs to outreach-phase work and does not exist on current `main`.

## Notes
- This is a mechanical extraction branch intended to reduce the planner route size without changing behavior.
- Rebased onto current `origin/main` after PR #28.
- Validation run in the rebased worktree; see PR body for details.
