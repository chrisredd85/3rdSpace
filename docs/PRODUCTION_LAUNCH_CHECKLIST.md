# Production Launch Checklist

Use this checklist for the production cutover. Keep production secrets out of Git, and apply each variable in the hosting provider dashboard rather than committing real values.

## 1. Set Up Production Supabase

- Create or choose the production Supabase project.
- Copy these values from Supabase project settings:
  - `DATABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Configure Auth URLs:
  - Site URL: `https://your-production-domain.com`
  - Redirect URL: `https://your-production-domain.com/auth/callback`
  - Optional previews: `https://*.vercel.app/auth/callback`
- Verify required private storage buckets exist and are not public:
  - event/vendor document buckets
  - message attachment bucket
  - invoice/document buckets used by the app

## 2. Run SQL Migrations

From a clean local checkout with the Supabase CLI linked to production:

```bash
supabase link --project-ref your-production-project-ref
supabase db push
```

Alternative with a direct connection:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260420000000_remote_baseline.sql
```

If using `psql`, apply every file in `supabase/migrations` in timestamp order. After migrations:

- Confirm RLS is enabled on production tables.
- Confirm storage bucket policies are present.
- Refresh materialized views used for analytics.
- Run a smoke query against `vendor_analytics`, notifications, vendor bookings, invoices, and message threads.

## 3. Configure Stripe Production

Create production Stripe resources:

- Platform secret key: `STRIPE_SECRET_KEY`
- Publishable key: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Connect client id: `STRIPE_CONNECT_CLIENT_ID`
- Pay-per-event price: `STRIPE_PRICE_PAY_PER_EVENT`
- Pro monthly price: `STRIPE_PRICE_PRO_MONTHLY`
- Pro annual price: `STRIPE_PRICE_PRO_ANNUAL`
- Webhook signing secret: `STRIPE_WEBHOOK_SECRET`
- Connect webhook signing secret if separate: `STRIPE_CONNECT_WEBHOOK_SECRET`

Production webhook endpoint:

```text
https://your-production-domain.com/api/webhooks/stripe
```

Subscribe to the Stripe events used by the app, including payment intent, charge/refund, invoice/subscription, and account updates for Connect.

## 4. Set Environment Variables

Required:

```env
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
STRIPE_PRICE_PAY_PER_EVENT=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
PLATFORM_FEE_PER_EVENT=30.00
PLATFORM_FEE_PRO_MONTHLY=79.00
PLATFORM_FEE_PRO_ANNUAL=690.00
NEXT_PUBLIC_SITE_URL=https://your-production-domain.com
NEXT_PUBLIC_APP_URL=https://your-production-domain.com
```

Recommended email:

```env
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
BILLING_FROM_EMAIL=
INVOICE_FROM_EMAIL=
MESSAGE_FROM_EMAIL=
NOTIFICATIONS_FROM_EMAIL=
INVOICE_TAX_RATE_PERCENTAGE=
```

Recommended monitoring:

```env
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

## 5. Deploy to Vercel

1. Import the Git repository in Vercel.
2. Set framework preset to Next.js.
3. Add all production environment variables before the first production deploy.
4. Deploy `main` or the chosen production branch.
5. Set the custom production domain.
6. Redeploy after setting `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` to the final domain.

Pre-deploy gate:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

## 6. Test Production Webhooks

Stripe:

- Use the Stripe Dashboard webhook test sender against `/api/webhooks/stripe`.
- Confirm signature verification succeeds.
- Confirm payment/refund/subscription/account events update database rows.
- Confirm failed signatures return `400` or `401`.

Ticketing webhooks:

- Posh endpoint: `/api/webhooks/posh`
- Luma endpoint: `/api/webhooks/luma`
- Configure per-integration webhook secrets.
- Confirm valid events are recorded and invalid signatures/secrets are rejected.

## 7. Enable Monitoring

Recommended baseline:

- Sentry or similar frontend/server error monitoring.
- Vercel deployment and runtime logs.
- Supabase database logs.
- Stripe webhook delivery alerts.
- Uptime monitor for `/`, `/login`, and one authenticated smoke path if available.

Sentry setup checklist:

- Create Sentry project for production.
- Add `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`.
- Configure release/source maps if Sentry is installed.
- Verify a test error appears in Sentry before launch.

## 8. Set Up Backups

Supabase:

- Enable scheduled backups on the production project.
- Enable Point-in-Time Recovery if the plan supports it.
- Document restore owner and restore procedure.
- Export a pre-launch backup after migrations and seed/config data are complete.

Operational:

- Keep a copy of migration state and production env var names.
- Confirm Stripe has production event history retention.
- Confirm invoice/file storage buckets have provider-level durability and access controls.

## Launch Smoke Test

After deploy and migrations:

- Sign up and sign in as each role.
- Create a builder event.
- Request a venue/vendor booking.
- Approve/reject booking as venue/vendor.
- Generate and view an invoice.
- Complete Stripe test-mode equivalent in production with small real transaction only when ready.
- Send a builder/vendor message with attachment.
- Verify notification center and email notifications.
- Open vendor analytics and refresh materialized view.
- Confirm mobile layouts for builder, venue, and vendor dashboards.
