# Marketing compliance hotfix status

## Scope

Remove forbidden tied-house terminology from public marketing surfaces only. No hero rewrite, nav change, new section, or broader marketing refresh included.

## Baseline sweep

Command:

```bash
rg -n -i "kickback|kick_back|kick-back|rev_share|revShare|RevShare|revenue_share|revenueShare|revenue[[:space:]-]+share|bar_split|barSplit|bar_kickback|headcount_kickback|per_head_kickback" 'app/(marketing)' components/marketing
```

Baseline result on origin/main:

| Path:line | Surrounding sentence |
| --- | --- |
| app/(marketing)/privacy/page.tsx:32 | To process subscriptions, venue rental payments, vendor payments, and revenue-share settlement records through Stripe. |

## Replacements made

| Path:line | Original | Replacement |
| --- | --- | --- |
| app/(marketing)/privacy/page.tsx:32 | To process subscriptions, venue rental payments, vendor payments, and revenue-share settlement records through Stripe. | To process subscriptions, venue rental payments, vendor payments, and community host incentive settlement records through Stripe. |

## Strict checker update

The strict tied-house script already scanned `app` by default, which includes `app/(marketing)`, but its pattern did not catch hyphenated `revenue-share`. This hotfix extends the strict pattern to catch `revenue[[:space:]-]+share` and adds coverage for that case.

## Post-change marketing sweep

Marketing path violations after this PR: 0.

Targeted strict command:

```bash
TIED_HOUSE_STRICT_OUTPUT=qa-artifacts/marketing-hotfix-marketing-strict.log npm run security:tied-house:strict -- 'app/(marketing)' components/marketing
```

Result: passed.

## Validation

- `npm install`: passed after removing a failed partial install from this worktree; npm reports existing dependency audit warnings.
- `npm run type-check`: passed.
- `npm run lint`: passed with existing React hook warnings outside this diff.
- `npm run build`: compiled successfully, then failed writing `.next/cache/.tsbuildinfo` due local disk exhaustion (`ENOSPC`). This is an environment-space failure, not a code compile failure.
- `npm run security:tied-house`: passed.
- `npm run security:tied-house:strict -- 'app/(marketing)' components/marketing`: passed.
- `npm run security:tied-house:strict`: failed as expected on existing non-marketing legacy nomenclature paths; this PR is marketing-only.
- `npm test -- __tests__/security/marketing-tied-house.test.ts __tests__/security/tied-house-strict.test.ts --runInBand`: passed, 2 suites / 5 tests.
- `npm test -- --runInBand`: test suite passed, 173 suites passed, 1 skipped, 890 tests passed, 9 skipped, 4 snapshots passed. The command exited nonzero because `tee` could not finish writing the QA log due `ENOSPC`.

## Self-review checklist

- [x] Every forbidden-term occurrence in `app/(marketing)/` replaced.
- [x] Replacement preserves sentence meaning with minimal restructure.
- [x] Marketing strict grep returns zero violations.
- [x] New regression test enforces zero forbidden terms in marketing files.
- [x] No new sections, hero changes, nav changes, or non-replacement edits.
- [x] No `--no-verify`.
- [x] In-flight PR branch files not touched.
