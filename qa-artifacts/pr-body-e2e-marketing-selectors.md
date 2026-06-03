## Summary

Marketing e2e specs were asserting against stale copy and had been silently failing on recent PR check runs (most recently PR #20). Updates selectors and expected text to match current production copy at https://www.3rdplace.io/. No product copy changed.

## What changed

The marketing nav was reworked at some point from a "List with us" dropdown (revealing "List your venue" / "List as vendor" menu items) to a single "Sign up" link routing to `/signup`, where a role-picker page presents Creator / Venue / Vendor cards.

Updated 4 e2e spec files to reflect the new flow:

- `e2e/01-design-system/theme-smoke.spec.ts` — replaced dropdown trigger lookup with the new Sign up link assertion; updated annotation copy to reference the Lovable cream theme; updated `Sign in` → `Log in` to match Header
- `e2e/personas/01-maya-host-signup.spec.ts` — rewrote 4 dropdown-based tests as Sign up → role-picker → role card flows; updated hero heading from `stop planning the same event from scratch` → `know what worked`; updated composer button selector from `start planning` → `send event draft` (matches actual `aria-label`); added a new test verifying the Creator card routes to `/signup/builder` for parity with Venue/Vendor coverage
- `e2e/personas/02-alex-venue-owner.spec.ts` — replaced dropdown test with role-picker flow
- `e2e/personas/03-jordan-vendor.spec.ts` — replaced dropdown test with role-picker flow

All navigation steps use the `Promise.all([page.waitForURL(...), link.click()])` pattern with a 15s timeout to avoid flakiness on first-hit Next.js dev server route compiles.

## Validation

- `npm install` clean
- `npm run type-check` passes
- `npm install` + `npx playwright install chromium` complete
- Targeted persona suite serially: `npx playwright test e2e/personas/{01,02,03}-* --workers=1` → **14 passed, 0 failed (43.3s)**

## Known infrastructure issue (flagged per task constraints)

`e2e/01-design-system/theme-smoke.spec.ts:6` ("homepage uses the Lovable cream theme and signup CTA remains reachable") fails locally — **not** on the selector logic, but on the `expectNoPageHealthIssues` helper that asserts zero console errors. The local dev server produces 400 console errors from Supabase auth calls under the e2e env. The selector portion of the test passes (verified by reading the page-health failure output, which lists the 400s as the violation rather than any missing element). This is an environmental issue with the helper rather than the selector update. The companion sub-test `signup portals render branded role-specific forms` (line 33) passes cleanly.

Not bundled into this PR per the task constraint to surface (not paper over) e2e infrastructure issues. Recommend a follow-up `chore(e2e): allow page-health to whitelist known Supabase warmup 400s in local dev` or similar.

## Test plan

- [ ] CI runs targeted persona suite green
- [ ] CI runs `e2e/01-design-system/theme-smoke.spec.ts` — expected to still fail on page-health helper if running against same env class. Do not gate merge on that.
- [ ] Optionally: spot-check on Vercel Preview deploy of this branch that the live signup flow still matches the assertions

## Rollback

Revert this commit. No production code, no migrations, no env vars touched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
