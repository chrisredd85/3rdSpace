# Week 4 Final Integration Runbook

Use this runbook for Day 18-20 final integration before production release. It combines automated checks with the manual scenarios that require real auth sessions, Stripe/Supabase state, storage buckets, and responsive browser review.

## Baseline Verification

Run these first and stop on failures:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

For browser coverage:

```bash
npm run dev
npm run test:e2e
```

Required seeded or manually created accounts:

- Builder on pay-per-event billing.
- Builder on active Pro monthly billing.
- Vendor with connected Stripe account and payouts enabled.
- Vendor without connected Stripe account for failure-path testing.
- A booking with invoice generation enabled.
- A message thread tied to a vendor booking.

## End-to-End Payment Flow Testing

| Scenario | Steps | Acceptance Criteria |
| --- | --- | --- |
| Pay-per-event booking | Builder creates a vendor booking as a non-Pro builder. Confirm the booking and generate/pay invoice. | Builder invoice includes the `3rdSpace Booking Fee` line for `$30.00`; vendor payment calculation pays vendor service amount at 100%. |
| Pro subscriber booking | Builder creates the same type of booking with active Pro monthly subscription. | Invoice includes `3rdSpace Booking Fee (Pro - Free)` with `$0.00`; no pay-per-event charge is collected. |
| Vendor payment | Pay deposit and final payment for a booking with connected vendor Stripe account. | `vendor_transactions.vendor_payout` equals payment amount; `platform_fee` is `0`; transfer is created for the connected account after charge succeeds. |
| Refund scenarios | Request full and partial refunds from payment history/refund endpoints. | Refund rows are recorded, booking/payment state updates correctly, and user-facing errors appear for invalid refund amounts. |
| Invoice generation | Generate, view, download, and email invoice. | Invoice totals match line items, tax, deposit, and final balance; HTML/PDF escapes user-entered text. |

## Messaging System Testing

| Scenario | Steps | Acceptance Criteria |
| --- | --- | --- |
| Builder/vendor messaging | Open a booking thread as builder, send a message, then view as vendor. | Message appears in chronological order for both users. |
| File attachments | Attach PDF, image, and document files under 10MB. | Files upload to Supabase Storage and signed URLs open from the thread. |
| Read receipts | Send from builder, open as vendor. | Sender sees `read_at` once recipient fetches the thread. |
| Polling | Keep a thread open and send from the other user. | New messages appear within the polling interval without refresh. |
| Unread badge | Send messages while recipient is away from thread. | Header and message inbox badges increment, then clear after reading. |

## File Sharing Testing

| Scenario | Steps | Acceptance Criteria |
| --- | --- | --- |
| File types | Upload PDF, image, Word, spreadsheet/CSV, and fallback file types. | Icons, metadata, and file type labels render correctly. |
| Versioning | Upload a duplicate file name in the same event scope. | Version increments and version history shows previous uploads. |
| Download/preview | Preview PDF/image and download each file. | Preview modal opens for supported files; downloads preserve file name. |
| Delete permissions | Try deleting as uploader and as another user. | Uploader can delete; non-uploader is denied by API/RLS. |
| Size limit | Attempt a file over 10MB. | Upload is rejected with a clear error before/at API boundary. |

## Analytics Dashboard Testing

| Scenario | Steps | Acceptance Criteria |
| --- | --- | --- |
| Revenue calculations | Compare analytics totals to `vendor_bookings`, transactions, and invoices. | Total, pending, and average booking values match source rows. |
| Chart rendering | Open `/vendor/analytics` with populated and empty datasets. | Revenue and bookings charts render without console errors; empty states render for no data. |
| Period filters | Switch month/year/all and custom date range when available. | API receives period/range and chart data updates. |
| Performance metrics | Verify response time, acceptance rate, rating, and reviews. | Metrics match materialized view or source query calculations. |
| Materialized view refresh | Run the analytics refresh SQL or scheduled job. | `vendor_analytics` reflects latest booking/review/payment rows. |

## Notification System Testing

| Scenario | Steps | Acceptance Criteria |
| --- | --- | --- |
| In-app notifications | Trigger new booking, payment, message, review, and cancellation. | Notification center receives the item with correct icon, title, message, and link. |
| Unread badge | Trigger notifications while dropdown is closed. | Header badge count increments via polling or realtime. |
| Mark as read | Click a notification. | Notification read state updates and badge decrements. |
| Mark all as read | Use the dropdown or notifications page action. | All unread rows for that user get `read_at` and `is_read=true`. |
| Preferences | Disable email or in-app for a type, then trigger it. | Disabled channel does not send/create notification for that type. |

## Mobile Responsiveness

Test these viewports in Playwright UI/browser dev tools and real devices when possible:

- iPhone Safari: 390x844 and 430x932.
- Android Chrome: 360x800 and 412x915.
- Tablet: 768x1024 and 1024x768.

Critical pages:

- Builder dashboard, event wizard, bookings, messages, invoices, notifications.
- Vendor bookings, services, calendar, analytics, payouts, messages, notifications.
- Venue listing, requests, pricing, settings.

Pass criteria:

- No horizontal overflow.
- Primary actions remain visible and tappable.
- Tables/cards collapse cleanly.
- Modals fit viewport and can be dismissed.
- Header/sidebar navigation remains reachable.

## Security Audit

| Area | Checks |
| --- | --- |
| RLS | Confirm builder cannot read another builder's events/bookings/files/messages; vendor cannot access other vendor bookings, invoices, analytics, payouts, messages. |
| Unauthorized APIs | Hit protected API routes without session and with wrong-role session; expect `401` or `403`. |
| CSRF | Mutating API routes should require authenticated Supabase session and JSON/form payloads; Stripe/Luma/Posh webhooks must verify provider signatures/secrets. |
| Rate limits | Public webhook endpoints use in-memory rate limits; add platform/edge rate limits for production. Consider adding API route rate limiting for auth/payment/message upload endpoints. |
| Input safety | Confirm zod validation on payment, invoice, booking, service, review, and availability endpoints; confirm HTML email/invoice rendering escapes user input. |
| Storage | Buckets containing private files must deny public reads and use signed URLs. |

## Performance Optimization

| Area | Checks |
| --- | --- |
| Database indexes | Confirm indexes exist for notification unread queries, message thread lookups, analytics materialized view, bookings by vendor/status/date, and file lookup by event/uploader. |
| Slow queries | Inspect Supabase query plans for analytics, vendor search, venue search, and inbox APIs. |
| Caching | Keep analytics on materialized view; use client polling intervals conservatively; consider Redis/edge cache only for read-heavy public search. |
| Assets | Use optimized images for marketplace cards and profile galleries; compress large uploads where product requirements allow it. |
| Build assets | `npm run build` should complete without bundle-size regressions that materially affect dashboard load. |

## Bug Fix Pass

During manual testing, log each issue with:

- User role.
- Page/API route.
- Steps to reproduce.
- Expected result.
- Actual result.
- Screenshot or console/network output.
- Severity: blocker, high, medium, low.

Before release, verify:

- No uncaught console errors on critical pages.
- Empty, loading, unauthorized, and failure states are readable.
- Payment/provider failures show helpful messages.
- Polling intervals clean up on navigation.

## Documentation Pass

Before release, update:

- `README.md` for app setup and final integration commands.
- `.env.example` for Stripe, Supabase, email, billing, messaging, and notification variables.
- `VERCEL_DEPLOYMENT.md` for required production variables.
- API docs for payment, messaging, analytics, notifications, invoices, and files.
- Supabase migration notes for storage buckets, materialized views, cron jobs, and RLS.
