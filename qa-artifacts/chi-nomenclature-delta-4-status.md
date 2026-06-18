# CHI Nomenclature Delta 4 Status

## Summary

Phase delta 4 updates user-facing copy, frontend type names, planner economics labels, venue/vendor commercial-model UI, and affected tests from legacy settlement terms to CHI / consumption-share language.

Claude guidance request attempted through `claude -p`, but the local CLI returned `401 Invalid authentication credentials`; no Claude direction was available.

## Validation

- 2026-06-18T09:40:00Z: focused CHI/venue rename tests passed (`6` suites, `41` tests).
- 2026-06-18T09:42:00Z: repaired remaining stale fixtures; focused follow-up passed (`5` suites, `30` tests).
- 2026-06-18T09:43:00Z: full Jest passed (`162` suites passed, `1` skipped; `816` tests passed, `9` skipped).
- 2026-06-18T09:44:00Z: `npm run type-check -- --pretty false` passed.
- 2026-06-18T09:44:00Z: `npm run lint` passed with existing React hook dependency warnings.
- 2026-06-18T09:44:00Z: `npm run security:tied-house` passed.
- 2026-06-18T09:47:00Z: `npm run build` passed after copying ignored local env files into this worktree for Supabase build-time configuration.
- 2026-06-18T09:48:00Z: `npm run security:tied-house:strict` failed as expected. Remaining findings are compatibility/schema/webhook/legacy-adapter paths scheduled for delta 5 after the required legacy-key telemetry quiet window.
- 2026-06-18T09:52:00Z: cleanup pass removed redundant compatibility fallback expressions in venue/vendor adapters and commercial-model rankers.
- 2026-06-18T09:53:00Z: targeted venue/ranker tests passed (`2` suites, `10` tests), `npm run type-check -- --pretty false` passed, `npm run lint` passed with existing React hook dependency warnings, and `npm run security:tied-house` passed.
- 2026-06-18T09:54:00Z: full Jest passed (`162` suites passed, `1` skipped; `816` tests passed, `9` skipped).
- 2026-06-18T09:55:00Z: `npm run build` passed. Sentry source-map upload ran during local build using the current base release SHA before this commit existed.
- 2026-06-18T09:55:00Z: `npm run security:tied-house:strict` failed as expected and refreshed `qa-artifacts/tied-house-violations.txt` with remaining delta 5 work.

## Notes

- The build uses local ignored env files; no env files are staged or committed.
- Strict tied-house is not made green in this PR because delta 3 intentionally keeps backward-compatible request/response keys and delta 5 owns the destructive compatibility/schema removal.
- `qa-artifacts/tied-house-violations.txt` was refreshed by the strict scan and now represents the post-delta-4 remaining violation set.
