# Dependency Audit Remediation - 2026-06-25

## Goal

Remove all high-severity production dependency audit findings and add a CI gate so high production vulnerabilities cannot silently re-enter.

## Starting Findings

`npm audit --audit-level=high --omit=dev` reported high-severity production findings in:

- `@babel/core` through transitive dependencies
- `lodash` through transitive dependencies
- `ws` through transitive dependencies
- `next`
- `xlsx`

## Remediation

### Transitive Lockfile Updates

`npm audit fix` updated production transitive dependencies and cleared the high findings for:

- `@babel/core`
- `lodash`
- `ws`

No source changes were required for those packages.

### Next.js

`next` moved from `14.2.35` to `15.5.18`.

Reason: the audit advisory requires a patched version outside the Next 14 line. `14.2.35` is the latest Next 14 release available from npm, so there is no Next 14 patch target that satisfies the high-severity audit gate. `15.5.18` is the smallest patched line that keeps the app on React 18 and Node 20.

Migration notes:

- Ran the official async request API codemod.
- Removed obsolete `swcMinify` from `next.config.js`.
- Manually resolved all codemod markers.
- Updated request-param/search-param call sites to await Next 15 dynamic APIs.
- Preserved existing route behavior; no intentional product behavior change.

### Spreadsheet Parsing

Removed vulnerable `xlsx@0.18.5` and replaced spreadsheet parsing with `exceljs@4.4.0`.

Implementation notes:

- `lib/ai/agents/documentExtractionAgent.ts` now uses ExcelJS for `.xlsx` input.
- ExcelJS is lazy-loaded from `exceljs/lib/exceljs.nodejs` so jsdom tests that import agent registries do not pull browser-incompatible UUID ESM paths.
- CSV-like sheet flattening remains deterministic through `Papa.unparse`.
- Spreadsheet extraction stays server-side.

### CI Gate

Added:

```bash
npm run security:deps
```

which runs:

```bash
npm audit --audit-level=high --omit=dev
```

The GitHub test workflow now runs this after `npm ci`.

## Remaining Non-High Findings

`npm run security:deps` passes. `npm audit` still reports lower-severity production findings:

- `cookie` low via `@supabase/ssr`
- `postcss` moderate via `next`
- `uuid` moderate via `exceljs`

These are below the high-severity production gate and were left out of scope for this PR.

## Validation

Commands run from `/Users/chrisredd/3rdSpace.npm-audit-highs`:

```bash
npm install
npm run security:deps
npm test -- lib/ai/agents/__tests__/documentExtractionAgent.test.ts --runInBand
npm test -- lib/ai/__tests__/agents.test.ts __tests__/integration/community-host-incentive-redirect-routes.test.ts --runInBand
npm run type-check -- --pretty false
npm run lint
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key npm run build
npm test -- --runInBand
```

Results:

- `npm run security:deps`: passed; no high or critical production findings.
- Focused spreadsheet extraction tests: passed.
- Focused agent registry and redirect-route tests: passed.
- Type-check: passed.
- Lint: passed with existing warnings.
- Build: passed with Supabase placeholder env, matching CI build expectations.
- Full Jest: 218 suites passed, 1 skipped; 1106 tests passed, 9 skipped.

## Operational Notes

The first build attempt without Supabase env failed during page data collection with the existing "Missing Supabase environment variables" guard. Re-running with CI-style placeholder Supabase env succeeded.

