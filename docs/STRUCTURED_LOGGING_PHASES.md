# Structured Logging Rollout

This document tracks the staged migration from ad hoc `console.*` calls to the
canonical server logger in `lib/server/logger.ts`.

## Phase 1 — request correlation and highest-risk paths

Phase 1 introduces:

- `lib/server/request-id.ts` for `x-request-id` propagation through middleware.
- `lib/server/logger.ts` for structured console output, Sentry breadcrumbs, Sentry
  exception capture, child loggers, and recursive redaction.
- Top-level request logging in platform Stripe webhooks, Connect webhooks, stale
  Stripe webhook reservation cron, Gmail outreach reply sync, and the planner
  approval route entry points.

Phase 1 intentionally does not replace every `console.*` in the repo. Several
planner helper modules still contain local logs, and those should be migrated in
smaller follow-up PRs so behavior changes remain reviewable.

## Phase 2 — planner execution modules

Recommended next targets:

- `lib/planner/opportunityOutreach.ts`
- `lib/planner/opportunityBuilder.ts`
- `lib/planner/discoveryOutreachDrafts.ts`
- `lib/planner/dateChangeOutreach.ts`
- `lib/planner/productAccess.ts`
- Remaining helper functions in `app/api/planner/plans/[planId]/approvals/route.ts`

These paths should use child loggers with `plan_id`, `approval_id`,
`agent_action_id`, and partner identifiers where available.

## Phase 3 — admin, background jobs, and read models

Recommended final pass:

- Admin routes under `admin/`
- Internal job runners under `app/api/internal/jobs/`
- Mobile and planner read model helpers
- Ticketing integrations

Phase 3 should also add a lint rule or CI grep once the remaining intended
`console.*` usage is small enough to whitelist.
