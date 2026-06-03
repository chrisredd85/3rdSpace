## Summary

- Re-applies the useful Playwright stabilization work from `chore/qa-stabilization` onto current `main`.
- Makes the local Husky pre-commit Jest run deterministic with `--runInBand`.
- Documents the split in `qa-artifacts/qa-stabilization-handoff.md`.

## Classification

Case B. The source branch contains useful Playwright stability work but does not directly address the recurring `venue-payouts-rental-ui` Husky flake. This PR keeps the Playwright stabilization and adds the explicit flake fix in the same branch.

## Flake Fix

The recurring local failure is the Husky pre-commit hook running the full Jest suite in parallel. The flaky `__tests__/integration/venue-payouts-rental-ui.test.tsx` passes in isolation with `--runInBand` but times out under the parallel hook. This PR changes `.husky/pre-commit` from:

```sh
npm run test -- --passWithNoTests
```

to:

```sh
npm run test -- --passWithNoTests --runInBand
```

This is intentionally local-hook scoped. GitHub CI remains the authoritative parallel/hosted gate.

## Validation

- Pre-commit hook scenario passed 5 consecutive times locally after the Husky `--runInBand` change.
- Each pre-commit run completed lint, type-check, and full Jest in-band: 93 passed, 1 skipped.
- `npx playwright test e2e/login.spec.ts e2e/planner-chat.spec.ts --project=chromium` passed after raising the production-build webServer timeout: 8 passed, 1 skipped.
- Manual `PLAYWRIGHT_TEST=1 npm run build` succeeded in about 93 seconds.

## Scope Notes

- No application code changes.
- No route, API, database, payment, or signup behavior changes.
- `--no-verify` is not authorized for this PR.
