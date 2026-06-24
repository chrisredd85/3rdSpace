# Baseline Projections + Posh Backfill QA

## Scope

This change adds privacy-floored projection baselines and wires the planner live brief profit window to prefer:

1. organizer-specific history when there are at least 3 matching historical events,
2. anonymized archetype/neighborhood history when there are at least 5 matching historical events,
3. conservative defaults when neither floor is met.

The baseline refresh runs through `/api/cron/baselines/refresh` with the existing `CRON_SECRET` bearer-token pattern.

## Implementation Notes

- Baselines are materialized views, not per-request scans.
- Direct view reads are granted only to `service_role`; the planner API verifies plan ownership first and then performs the aggregate lookup with the service-role client.
- Eventbrite historical imports feed the same source tables already used by the baselines (`event_sales_data`, `imported_attendees`, `event_financial_summary`) rather than synthesizing `settlement_runs` rows.
- Synthetic settlement rows were intentionally not added because the current `settlement_runs` schema models CHI settlement execution and requires venue/settlement state that ticket backfill does not actually know.
- Posh currently has a webhook-secret/manual event-link integration, not a historical sales API/OAuth token. `/api/integrations/posh/backfill` therefore returns an explicit 501 with connection status and explains that Posh baselines populate from verified webhook events going forward.

## Validation

- `npm ci`
- focused Jest: baseline helper, baseline cron route, Posh backfill route, live plan panel baseline UI, migration assertions
- `npm run type-check -- --pretty false`
- `npm run lint` (passes with existing unrelated React hook warnings)
- `npx supabase db reset`
- local RPC smoke: `select * from public.refresh_projection_baselines();`
- `npm run build` (passes with existing unrelated React hook warnings)
