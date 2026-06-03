# QA Stabilization Handoff

Branch: `chore/qa-stabilization`

## Kept
- `playwright.config.ts`.
- Stabilized E2E specs:
  - `e2e/login.spec.ts`
  - `e2e/planner-chat.spec.ts`
- Local Husky pre-commit Jest run now uses `--runInBand` to avoid the recurring `venue-payouts-rental-ui` parallel timeout.

## Dropped
- Sentry `next.config.js` wrapper, package changes, feature work, outreach, discovery, RLS, and product-positioning tests.

## Notes
- The source branch's `next.config.js` includes a `PLAYWRIGHT_TEST` webpack cache guard, but this split keeps only the files named in Prompt 3.
- Follow-up validation on the rebased branch ran the pre-commit scenario 5 consecutive times and targeted Chromium E2E for the touched specs.
