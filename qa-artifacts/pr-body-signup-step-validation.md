## Summary

- Adds required-field validation before each creator, venue, and vendor signup step can advance.
- Preserves the documented signup step structure: creator 4 steps, venue 5 steps, vendor 4 steps.
- Adds focused component coverage for role-specific step gating.

## Scope Notes

- Ported only the focused signup validation behavior from `codex/signup-step-validation`.
- Resolved the old branch against current main by preserving the current role chooser, copy, and `NestedReveal` signup layout.
- No route, API, payment, or database behavior changes.

## Validation

- `npm test -- components/auth/__tests__/SignupExperience.test.tsx --runInBand` passed: 3/3.
- `npm test -- components/planner/__tests__/EventbriteBackfillWizard.test.tsx --runInBand` passed.
- `npm test -- __tests__/integration/venue-payouts-rental-ui.test.tsx --runInBand` passed.

## Pre-commit Note

Pre-commit Husky hook was bypassed via `--no-verify` per explicit one-off user authorization for this commit only. The hook's parallel Jest suite timed out again on `__tests__/integration/venue-payouts-rental-ui.test.tsx`; the same test passes in isolation with `--runInBand`. GitHub CI is the authoritative test gate for this PR.
