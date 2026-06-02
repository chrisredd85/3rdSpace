## Summary

Ships the Phase-5 hygiene slice only:

- Adds unauthenticated `GET /api/health` with a minimal `{ "status": "ok" }` payload.
- Adds Sentry App Router runtime initialization and global error capture.
- Wraps the Next.js config with Sentry source-map upload support.
- Adds `@sentry/nextjs`.
- Documents Phase-5 environment variables in `.env.example`.

No outreach, discovery, or supply-scout functionality is exposed by this PR. No booking, payment, or outbound-message path changes. The approval-gate invariant is unchanged.

## Audit Result

Nine target files intentionally brought over or edited (5 original hygiene files + 4 Sentry init files):

- `app/api/health/route.ts`
- `app/global-error.tsx`
- `instrumentation.ts`
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.js`
- `package.json`
- `.env.example`

Generated support file:

- `package-lock.json`

Rejected source-branch hunks:

- `package.json`: rejected `seed:discovery` and `eval:outreach`.
- `package.json`: preserved already-merged `security:rls` and `check` scripts.
- `.env.example`: preserved `EVENTBRITE_WEBHOOK_SECRET` from current `main`.
- Everything else from `origin/codex/outreach-phase-5`.

## Sentry Setup

The four Sentry init files are standard SDK boilerplate:

- `instrumentation.ts` registers server/edge Sentry config and exports `Sentry.captureRequestError`.
- `sentry.client.config.ts` reads `NEXT_PUBLIC_SENTRY_DSN` and initializes only when present.
- `sentry.server.config.ts` and `sentry.edge.config.ts` read `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` and initialize only when present.
- No Sentry file imports outreach/discovery code, sets outreach-specific tags, or references not-yet-landed modules.

This matches the Sentry Next.js manual setup pattern for App Router instrumentation, server/edge config, global error capture, and source maps:

https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

Build-time source-map upload is gated by:

```js
sourcemaps: {
  disable: !process.env.SENTRY_AUTH_TOKEN,
}
```

Local validation ran with `SENTRY_AUTH_TOKEN` unset. No local build-with-token test was run to avoid uploading local source maps or polluting Sentry release history.

Known warning: `@sentry/nextjs` recommends `instrumentation-client.ts` instead of `sentry.client.config.ts` for Turbopack. This repo's current production build is Next 14 webpack, and the no-token build passed. Follow-up can rename the client init file if/when the app moves to Turbopack.

## Health Route

The source branch health route exposed commit/package version and env-derived checks. This PR narrows it for recon hygiene:

```json
{ "status": "ok" }
```

No auth, DB call, commit SHA, package version, Stripe status, Resend status, or env state is exposed.

## Env Docs

`.env.example` changes are documentation only:

- Adds placeholder-only Gmail, discovery, multichannel outreach, and Sentry docs.
- Contains no real secrets.
- Preserves current Eventbrite webhook docs from PR #19.
- Does not expose outreach/discovery runtime code paths in this PR.

`SENTRY_AUTH_TOKEN` is set in Vercel Production and Preview for the 3rdPlace Vercel project. The internal Vercel project slug is `3rd-space`, inherited from earlier repo/product naming. Source maps should upload on the first Vercel build after merge; verify in the Vercel build log. Pre-merge token-scope verification completed in the Vercel UI: `SENTRY_AUTH_TOKEN` appears under the `Project` tab for this project, not `Shared`, so the Vercel environment variable is project-level. The token value was not exposed locally.

## Validation

- `npm install`: passed; existing npm audit vulnerabilities remain.
- `npm run type-check`: passed.
- `npm run lint`: passed with existing React hook dependency warnings.
- `npm run build` with `SENTRY_AUTH_TOKEN` unset and local Supabase env: passed.
- `npm test`: first full run hit the existing intermittent `venue-payouts-rental-ui.test.tsx` timeout; isolated rerun passed; full rerun passed with 93 suites passed, 1 skipped; 564 tests passed, 9 skipped.
- Dev smoke:
  - `GET http://127.0.0.1:3000/api/health`: `200`, `{"status":"ok"}`
  - `GET http://127.0.0.1:3000/planner`: `200`

## Rollback

Trivial revert:

- Revert this PR.
- Remove `@sentry/nextjs` from `package.json` and regenerate the lockfile.
- Remove `/api/health`, `app/global-error.tsx`, `instrumentation.ts`, and the Sentry config files.
- Restore `next.config.js` to `withBundleAnalyzer(nextConfig)`.

## Audience Impact

Zero user-facing workflow impact. The new health endpoint is unauthenticated, read-only, and returns only static status. Sentry is no-op unless DSN env vars are configured.
