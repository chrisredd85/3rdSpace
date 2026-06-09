# CHI Production Row Count Audit

Audit PR: https://github.com/chrisredd85/3rdSpace/pull/61

Audit status: merged

Artifact PR: https://github.com/chrisredd85/3rdSpace/pull/63

Queried at: 2026-06-09 UTC

Supabase project: `rxoyebxazqwknlqvpchc` (`3rdspace.app`)

Main commit used as branch base: `3fc45332f9eaa4f9ac015ea7b3f34481144c73c4`

## Scope

This is a read-only production inventory for legacy venue-to-organizer settlement data before future Community Host Incentive (CHI) migration work. No production rows were inserted, updated, deleted, renamed, or migrated.

The purpose is to inform the Phase gamma migration policy:

- zero in-flight rows: Phase gamma can proceed mechanically with table renames
- 1-5 in-flight rows: surface each for product review and re-approval under CHI terms
- more than 5 in-flight rows: structured migration plan required before Phase gamma

## Bucket Count Query

```sql
WITH event_status AS (
  SELECT
    id,
    event_date,
    CASE
      WHEN event_date IS NULL THEN 'no_date'
      WHEN event_date > now() THEN 'future'
      WHEN event_date BETWEEN now() - interval '30 days' AND now() THEN 'recent_past'
      WHEN event_date BETWEEN now() - interval '180 days' AND now() - interval '30 days' THEN 'mid_past'
      ELSE 'older'
    END AS event_status_bucket
  FROM events
)
SELECT
  'event_kickback_agreements' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE es.event_status_bucket = 'future') AS in_flight_future_events,
  COUNT(*) FILTER (WHERE es.event_status_bucket = 'recent_past') AS recent_past_events,
  COUNT(*) FILTER (WHERE es.event_status_bucket = 'mid_past') AS mid_past_events,
  COUNT(*) FILTER (WHERE es.event_status_bucket = 'older') AS older_events,
  COUNT(*) FILTER (WHERE es.event_status_bucket = 'no_date' OR es.event_status_bucket IS NULL) AS no_date_or_orphan
FROM event_kickback_agreements eka
LEFT JOIN event_status es ON es.id = eka.event_id
UNION ALL
SELECT
  'kickback_payments',
  COUNT(*),
  COUNT(*) FILTER (WHERE status IN ('pending', 'invoice_sent', 'in_progress')),
  COUNT(*) FILTER (WHERE created_at BETWEEN now() - interval '30 days' AND now()),
  COUNT(*) FILTER (WHERE created_at BETWEEN now() - interval '180 days' AND now() - interval '30 days'),
  COUNT(*) FILTER (WHERE created_at <= now() - interval '180 days'),
  COUNT(*) FILTER (WHERE status NOT IN ('pending', 'invoice_sent', 'in_progress', 'settled', 'refunded', 'cancelled'))
FROM kickback_payments;
```

## Bucket Count Results

| Table | Total rows | In-flight future events / active payments | Recent past events / recent payments | Mid-past events / mid-past payments | Older events / older payments | No-date, orphan, or non-terminal status |
|---|---:|---:|---:|---:|---:|---:|
| `event_kickback_agreements` | 3 | 0 | 0 | 0 | 0 | 3 |
| `kickback_payments` | 3 | 0 | 3 | 0 | 0 | 3 |

Notes:

- The `event_kickback_agreements` `no_date_or_orphan` bucket means the rows do not join to an event row with a usable event-date bucket.
- The `kickback_payments` final bucket follows the Prompt A status list exactly. Existing production statuses `invoice_failed`, `refund_requested`, and `refunded_partial` are outside that terminal-status list, so they count as non-terminal for this audit even though none are active `pending`, `invoice_sent`, or `in_progress` payments.

## In-Flight Payment Sample Query

The prompt sample query referenced `organizer_id` and `total_amount_cents`, but production `kickback_payments` uses `recipient_id` and `amount_cents`. This read-only query preserves the requested output shape by aliasing existing columns.

```sql
SELECT id, event_id, payer_id AS venue_id, recipient_id AS organizer_id, status, created_at, amount_cents AS total_amount_cents
FROM kickback_payments
WHERE status IN ('pending', 'invoice_sent', 'in_progress')
ORDER BY created_at DESC
LIMIT 50;
```

Result: no rows.

No PII redaction was needed because no sample rows were returned.

## Future Agreement Sample Query

The prompt sample query referenced `organizer_id` and `kickback_percentage`, but production `event_kickback_agreements` uses `builder_id` and does not expose `kickback_percentage` under that column name. This read-only query preserves the requested purpose by returning future event-linked agreement rows with actual production columns.

```sql
SELECT eka.id, eka.event_id, eka.venue_id, eka.builder_id AS organizer_id, eka.status, eka.created_at, eka.event_date
FROM event_kickback_agreements eka
JOIN events e ON e.id = eka.event_id
WHERE e.event_date > now()
ORDER BY e.event_date ASC
LIMIT 50;
```

Result: no rows.

No PII redaction was needed because no sample rows were returned.

## Status Aggregate

Because the bucket query found nonzero legacy rows, I ran one additional read-only aggregate query to classify the legacy statuses without surfacing row-level data.

```sql
SELECT 'event_kickback_agreements' AS table_name, status, COUNT(*) AS count
FROM event_kickback_agreements
GROUP BY status
UNION ALL
SELECT 'kickback_payments' AS table_name, status, COUNT(*) AS count
FROM kickback_payments
GROUP BY status
ORDER BY table_name, status;
```

| Table | Status | Count |
|---|---|---:|
| `event_kickback_agreements` | `payment_completed` | 2 |
| `event_kickback_agreements` | `payment_pending` | 1 |
| `kickback_payments` | `invoice_failed` | 1 |
| `kickback_payments` | `refund_requested` | 1 |
| `kickback_payments` | `refunded_partial` | 1 |

## Recommendation

The two sample in-flight queries returned zero rows:

- no `kickback_payments` rows with status `pending`, `invoice_sent`, or `in_progress`
- no future event-linked `event_kickback_agreements` rows

That means there are no event-linked in-flight legacy agreements that need per-row re-approval before Phase gamma.

However, Phase gamma should still include a small cleanup decision before table renames because production has:

- 3 legacy agreement rows in the no-date/orphan bucket
- 1 legacy agreement row still marked `payment_pending`
- 3 recent legacy payment rows with statuses outside the Prompt A terminal-status list

Recommended migration policy:

1. Classify the three no-date/orphan agreement rows as test, seed, historical, or real.
2. Resolve or explicitly archive the one `payment_pending` agreement before renaming legacy tables.
3. Preserve all historical rows under `_legacy_archived` table names.
4. Add `is_legacy_revenue_share = true` to archived rows.
5. Do not silently convert any legacy revenue-share row into a CHI agreement.

If product confirms these null-event rows are not real in-flight agreements, Phase gamma can proceed mechanically for event-linked migration while treating these rows as controlled legacy archival cleanup.
