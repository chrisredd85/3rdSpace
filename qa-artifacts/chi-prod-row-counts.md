# CHI Production Row Counts

Audit PR: https://github.com/chrisredd85/3rdSpace/pull/61

Audit status: merged

Queried at: 2026-06-09 18:11:54 UTC

Supabase project: `rxoyebxazqwknlqvpchc` (`3rdspace.app`)

Main commit queried from: `3fc45332f9eaa4f9ac015ea7b3f34481144c73c4`

## Scope

This is a read-only production count check for legacy venue-to-organizer settlement tables before future Community Host Incentive (CHI) implementation work. No production rows were inserted, updated, deleted, renamed, or migrated.

## Query

```sql
SELECT 
  'event_kickback_agreements' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE event_id IN (
    SELECT id FROM events WHERE event_date > now()
  )) AS in_flight_future_events,
  COUNT(*) FILTER (WHERE event_id IN (
    SELECT id FROM events WHERE event_date BETWEEN now() - interval '30 days' AND now()
  )) AS recent_past_events,
  COUNT(*) FILTER (WHERE event_id IN (
    SELECT id FROM events WHERE event_date < now() - interval '30 days'
  )) AS older_settled
FROM event_kickback_agreements
UNION ALL
SELECT 
  'kickback_payments',
  COUNT(*),
  COUNT(*) FILTER (WHERE status = 'pending'),
  COUNT(*) FILTER (WHERE created_at > now() - interval '30 days'),
  COUNT(*) FILTER (WHERE created_at <= now() - interval '30 days')
FROM kickback_payments;
```

## Results

| Table | Total rows | In-flight future events / pending payments | Recent past events / recent payments | Older settled / older payments |
|---|---:|---:|---:|---:|
| `event_kickback_agreements` | 3 | 0 | 0 | 0 |
| `kickback_payments` | 3 | 0 | 3 | 0 |

## Follow-up Aggregates

Because the primary query found nonzero legacy rows, I ran one additional read-only aggregate check to classify statuses and event linkage without exposing row-level data.

```sql
SELECT 'event_kickback_agreements_status' AS section, status::text AS bucket, COUNT(*) AS count
FROM event_kickback_agreements
GROUP BY status
UNION ALL
SELECT 'kickback_payments_status' AS section, status::text AS bucket, COUNT(*) AS count
FROM kickback_payments
GROUP BY status
UNION ALL
SELECT 'event_kickback_agreements_event_link' AS section,
  CASE
    WHEN event_id IS NULL THEN 'event_id_null'
    WHEN event_id NOT IN (SELECT id FROM events) THEN 'event_id_missing'
    ELSE 'event_id_matches_events'
  END AS bucket,
  COUNT(*) AS count
FROM event_kickback_agreements
GROUP BY bucket
ORDER BY section, bucket;
```

| Section | Bucket | Count |
|---|---|---:|
| `event_kickback_agreements_event_link` | `event_id_null` | 3 |
| `event_kickback_agreements_status` | `payment_completed` | 2 |
| `event_kickback_agreements_status` | `payment_pending` | 1 |
| `kickback_payments_status` | `invoice_failed` | 1 |
| `kickback_payments_status` | `refund_requested` | 1 |
| `kickback_payments_status` | `refunded_partial` | 1 |

## Interpretation

There are no legacy agreement rows linked to future events, and there are no `kickback_payments` rows with `status = 'pending'`.

There are three legacy agreement rows with `event_id` null. One of those agreement rows is still marked `payment_pending`, even though no payment row is currently pending.

This means Phase gamma should not be treated as purely mechanical until the null-event legacy rows are explicitly classified. The safest policy is:

1. Confirm these three rows are test, seed, or historical records.
2. Resolve or explicitly archive the one `payment_pending` agreement before table renames.
3. Preserve historical rows with `_legacy_archived` table names and `is_legacy_revenue_share = true`.
4. Do not silently convert any legacy revenue-share row into a CHI agreement.

If product confirms the null-event rows are not real in-flight agreements, the CHI table rename/archive step can proceed as a controlled legacy archival migration.
