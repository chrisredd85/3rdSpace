# CHI epsilon.2 status

Updated: 2026-06-18T03:05:55Z

## Summary

Implemented CHI settlement run creation and attendance review without money movement. This PR adds the settlement run schema, attendance evidence storage, cron/job orchestration, ticketing webhook attendance capture, organizer attendance/review APIs, and a planner Settlements page.

## Dependency check

- origin/main includes delta.2 schema nomenclature cutover via PR #90.
- CHI rate resolver exists and was reused for per-attendee cents.
- Existing ticketing webhook jobs exist and were extended in a best-effort way so settlement attendance recording cannot break current ticket ingestion.
- No new routes were added under `app/(dashboard)`.

## Decisions made under ambiguity

- CHI eligibility wraps the existing compliance helper rather than expanding the eligible venue list. The current engine treats restaurants as manual review, so epsilon.2 preserves that stricter gate.
- `events` has no direct `plan_id`, so settlement context derives organizer from `events.builder_id -> builder_profiles.user_id` and finds likely plan context by organizer/date/title. Event and venue rows remain the canonical fallback.
- No existing webhook-state table fit the attendance replay need, so the migration adds `settlement_attendance_webhook_cache` for ticketing webhooks that arrive before a settlement run exists.
- Browser smoke initially hit hosted Supabase through `.env.local`, where the new migration is not yet applied, and correctly failed with a missing-table error. The smoke was rerun against local Supabase after `supabase db reset`; the protected route redirected to login without a 500.
- Settlement approval only prepares the record for later venue acknowledgment/payment phases. It does not call Stripe and does not write payment ledger rows.

## Validation

| Check | Result |
| --- | --- |
| Baseline `npm test` on fresh worktree before edits | Passed: 151/152 suites, 794 tests, 9 skipped |
| `supabase db reset` | Passed, including `20260618024000_add_settlement_runs.sql` |
| `npm run type-check -- --pretty false` | Passed |
| Focused settlement tests | Passed: 5 suites, 15 tests |
| `npm run lint` | Passed with existing hook dependency warnings |
| `npm run security:tied-house` | Passed |
| `npm run security:tied-house:strict` | Expected mainline backlog remains; branch diff adds zero new strict matches |
| `npm run build` | Passed after using ignored local env vars |
| `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` | Passed: 9 tests |
| `npm run security:rls` | Passed |
| `npm test` | Passed: 156/157 suites, 809 tests, 9 skipped |
| Browser smoke `/planner/settlements` | Passed against local Supabase: protected route redirected to `/login/builder`; no server error |

## Operator notes

- Apply the new Supabase migration before deploying the route to hosted environments; otherwise the planner Settlements page will fail because `settlement_runs` is absent.
- `CRON_SECRET` must be set for `/api/cron/settlement-runs/create`.
- Vercel cron now schedules `/api/cron/settlement-runs/create` daily at 14:30 UTC.

## Out of scope

- Stripe transfer/refund/payment execution for settlement records.
- Venue acknowledgment workflow.
- Evidence-file browser beyond event-detail linking from the settlement card.
