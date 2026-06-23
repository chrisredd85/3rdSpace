# Marketing Refresh Status

## Base
- Branch: `codex/marketing-refresh`
- Base: `origin/main` at `81c6631 fix(marketing): remove tied-house terms from public copy (#115)`
- Compliance hotfix dependency: satisfied; marketing strict tied-house preflight passed.

## Changes
- Homepage hero now uses agent-execution framing: `Your event operating agent.`
- Homepage hero subhead/support line and sample product card updated to the requested approval-gated outreach language.
- `How it runs` section now has 4 steps: Plan, Reach out, Approve, Operate.
- Feature cards replaced with the requested four cards: approved outreach, verified quotes, current event brief, guarded payments.
- Added special-events section for yacht parties, rooftops, warehouses, private estates, and outdoor events.
- Pricing page now leads with `Start with 2 free events.` and `Then $30 per event or $69/mo for unlimited.`
- Pricing page now includes the requested event-includes callout and pass-through cost clarification.
- FAQ page keeps existing questions and adds the five requested questions.
- Marketing header nav now orders: How it works, FAQ, Pricing, Sign up, Log in.

## Compliance
- Marketing forbidden-term sweep after changes: 0 matches.
- `TIED_HOUSE_STRICT_OUTPUT=/tmp/marketing-refresh-preflight-strict.log npm run security:tied-house:strict -- 'app/(marketing)' components/marketing`: passed.

## Scope Guardrails
- No new routes.
- No dashboard changes.
- No pricing tier card redesign.
- Existing warm editorial design primitives reused.

## Validation Results
- `npm install`: passed; existing npm audit findings remain.
- `npm test -- __tests__/security/marketing-tied-house.test.ts --runInBand`: passed.
- `TIED_HOUSE_STRICT_OUTPUT=qa-artifacts/marketing-refresh-marketing-strict.log npm run security:tied-house:strict -- 'app/(marketing)' components/marketing`: passed.
- `npm run type-check`: passed.
- `npm run lint`: passed with existing React hook warnings outside this diff.
- `npm run security:tied-house`: passed.
- `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon SUPABASE_SERVICE_ROLE_KEY=dummy-service npm run build`: passed.
- `npm test`: passed — 173/174 suites passed, 1 skipped; 890/899 tests passed, 9 skipped; 4 snapshots passed.
- Full `npm run security:tied-house:strict`: failed on existing non-marketing legacy nomenclature outside this PR scope; marketing-path strict scan remains clean.
- Playwright smoke on `http://127.0.0.1:3025/`, `/pricing`, and `/faq`: passed with no console errors.
- Desktop homepage screenshot: hero text and image/card do not overlap; first viewport is balanced.
- Mobile homepage screenshot: sections stack cleanly, hero CTA visible, no horizontal overflow observed.

## Self-Review Checklist
- [x] Hero replaced with new headline + subhead + support + card
- [x] `How it runs` is 4 steps + repeat-loop benefit line
- [x] 4 feature cards present with specified copy
- [x] Special events section present
- [x] Pricing has `2 free events` hero CTA + `Each event includes` callout + pass-through cost clarification
- [x] 5 new FAQs added, including venue compensation
- [x] Header nav: How it works, FAQ, Pricing, Sign up, Log in
- [x] Primary CTA `Start running events` preserved
- [x] Zero forbidden terms in marketing copy
- [x] Strict grep on marketing paths remains zero
- [x] Existing visual design primitives used
- [x] Mobile viewport sanity preserved
- [x] No --no-verify
