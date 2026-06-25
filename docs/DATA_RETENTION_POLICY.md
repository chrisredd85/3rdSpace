# 3rdPlace Data Retention Policy

Last updated: 2026-06-25

This document describes the current technical retention behavior for 3rdPlace. It is implementation guidance for the product and engineering team and should be reviewed by counsel before being treated as final legal copy.

## Principles

- Delete personal data when it is no longer needed.
- Anonymize records that must remain for legal, tax, security, or financial audit reasons.
- Retain aggregate analytics when they no longer identify a person.
- Keep money movement records long enough to support chargebacks, taxes, audits, and settlement disputes.
- Require admin review before executing account deletion until the process is mature.

## User-Initiated Account Deletion

Users can request deletion from `/planner/settings/delete-account`.

The request creates a `data_deletion_requests` row with:

- `status = requested`
- `requested_at = now()`
- `cooling_off_ends_at = requested_at + 7 days`

Users may cancel while the request is still in the `requested` state. Admins review requests at `/admin/data-deletion` after the cooling-off period.

## Deletion Request Statuses

| Status | Meaning |
| --- | --- |
| `requested` | User requested deletion and cooling-off is active. |
| `canceled` | User canceled before execution. |
| `in_review` | Admin is reviewing exceptions, disputes, or active financial records. |
| `approved` | Admin approved execution. |
| `executed` | Deletion/anonymization ran and wrote an execution log. |
| `rejected` | Admin rejected, usually because of legal hold, active dispute, or incomplete identity verification. |

## Data Categories

| Category | Retention | Action on user deletion |
| --- | --- | --- |
| Auth user | Until deletion request execution | Soft-delete via Supabase Auth so restrictive financial FKs remain valid. |
| Public user profile | Until deletion request execution | Replace email with deleted alias, clear company/subscription personal fields, deactivate. |
| Builder profile | Until deletion request execution | Strip name, org, phone, photo, website, social, invite metadata, Stripe ids. |
| Gmail OAuth tokens | Until disconnected or deletion request execution | Hard delete `creator_email_accounts`. |
| Ticketing OAuth/webhook secrets | Until disconnected or deletion request execution | Hard delete `builder_ticketing_connections`. |
| Pending OAuth connections | Until expiration or deletion request execution | Hard delete `oauth_pending_connections`. |
| Outreach message bodies | 2 years | Redact subject/body/html/transcript/headers/provider metadata. |
| Outreach response extraction rows | 2 years | Delete venue/vendor outreach response rows. |
| Discovery venue contact fields | 1 year unused | Clear contact email/phone/extracted emails/organizer-provided emails. |
| Settlement runs and settlement charges | 7 years | Retain for legal, tax, payment, dispute, and audit reasons. |
| Platform fee transactions | 7 years | Retain for accounting and Stripe reconciliation. |
| Stripe records | Stripe-controlled | Delete/anonymize Stripe Customer when possible; Stripe retains accounting records. |
| Operational audit logs | 7 years or security policy | Retain; do not expose to ordinary users. |
| Anonymous aggregate analytics | Indefinite | Retain when not reasonably identifiable. |

## Retention Cleanup Cron

`GET /api/cron/retention-cleanup` runs behind `CRON_SECRET`.

Current cleanup behavior:

- Redacts `outreach_messages` older than 2 years.
- Deletes `venue_outreach_responses` older than 2 years.
- Deletes `vendor_outreach_responses` older than 2 years.
- Clears `discovery_venues` contact fields for rows not updated in 1 year.

Recommended schedule: weekly.

## What Is Not Automated Yet

- Data portability export.
- Legal hold workflow.
- Automatic inactive account deletion after 18 months.
- Granular file/object-storage deletion.
- Automated user notification 30 days before inactive account cleanup.

## Operational Notes

- Account deletion is not instant. The 7-day cooling-off period prevents accidental deletion.
- Admin execution writes `execution_log` on `data_deletion_requests` and `admin_audit_log`.
- Any failed deletion step leaves the request in `in_review` with the partial execution log for follow-up.
- Financial records are intentionally retained or anonymized rather than blindly deleted.
