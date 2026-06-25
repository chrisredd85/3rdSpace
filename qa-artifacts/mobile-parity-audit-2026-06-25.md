# Mobile Parity Audit — 2026-06-25

## Scope

Read-only audit of production mobile parity against the recent desktop planner readiness checklist.

Current code state inspected:

- `origin/main` / local `main`: `855d24fe106771886e952550737cd2f0d15f4443`
- Desktop checklist attachment baseline was older: `04b6333f5f2ba124f60a12c60d8bebe508b59d8b`
- Current production mobile architecture is **not only** `/mobile-mockup`.

Mobile surfaces inspected:

- `components/planner/mobile/PlannerResponsiveLayout.tsx`
  - `mobileRouteMap` maps `/planner`, `/planner/venues`, `/planner/payments`, `/planner/messages`, `/planner/vendors`, `/planner/analytics`, `/planner/tickets`, `/planner/billing`, and `/planner/settings` into `MobilePlanner` at lines 12-23.
  - Mobile takeover happens below `1024px` at lines 30-47.
- `components/planner/PlannerShell.tsx`
  - Mobile-promoted planner paths include `/planner/experiences` plus the core planner routes at lines 22-34.
  - The sidebar collapses on narrow viewports at lines 60-66.
- `components/planner/mobile/MobilePlanner.tsx`
  - Real mobile section/view router exists at lines 33-58.
  - Real mobile data loads planner payload, mobile home, budget, activity, billing, ticketing, connections, and analytics at lines 679-724.
  - Outreach views still route to `SkippedOutreachView` at lines 647-665 and 1521-1523.
- `lib/planner/mobileReadModels.ts`
  - Mobile home/budget/activity/analytics read models exist at lines 29-78.
  - Budget read model tracks committed totals and projected delta at lines 158-190.
  - Analytics read model is aggregate-only at lines 213-272.
- `lib/planner/dbSelects.ts`
  - Plan select already includes committed quote fields and metadata at lines 1-28.
  - Recommendation select includes metadata at lines 40-52.

No browser viewport run was performed in this pass. This is a source-level parity audit.

## Executive Summary

Mobile does **not** yet check every desktop readiness box.

Production mobile is better than the old mockup-only picture: it has real planner routes, real plan/approval/recommendation data, real ticket counts/check-ins in the brief, billing state, mobile ticketing totals, and mobile analytics aggregates.

The gaps are concentrated in the newer operating loop:

- discovery contact status and rescue
- outreach draft/reply surfaces
- batch outreach approval creation
- Stripe readiness badges and blocked approval states
- post-reply quote comparison
- accept/cancel committed venue/vendor quotes
- richer profit/baseline/delta language
- ticketing setup instructions when disconnected

## Desktop Readiness Checklist vs Mobile

| Checklist area | Mobile status | Evidence | Gap |
|---|---|---|---|
| Places default discovery source | partial | Mobile venues/vendors consume planner recommendations from `/api/planner/plans/[planId]`; `MobilePlanner` renders venue rows at lines 1225-1260 and vendor rows at lines 1446-1519. | Mobile does not show that candidates came from Places, catalog, outreach, or fallback search. It also does not expose discovery summaries or search-source confidence. |
| Multi-area phrase normalization | partial | Mobile new-plan entry is free text at `MobilePlanner.tsx` lines 1012-1064. Backend normalization benefits mobile indirectly through recommendations. | No mobile chips for parsed areas like `Downtown Oakland` + `Uptown Oakland`, no correction affordance, and no visible "searching these areas" state. |
| Unknown capacity / amenity softened filters | partial | Mobile venue detail shows recommendation detail but does not render capacity confidence or fallback copy. Desktop has `Capacity TBD` copy and inferred capacity surfaces. | Mobile should show known capacity, inferred capacity, or `Capacity TBD — confirm with venue`. |
| Website extraction / contact enrichment | missing | `MobilePlanner` has no route or component for extraction status. Outreach views are still skipped/in-development at lines 267-273 and 1684-1708. | Mobile does not show `checking website`, extracted email, organizer-provided email, rescue count, or extraction failure. |
| Vendor Places fallback | partial | Mobile vendor rows show planner recommendations at lines 1483-1518. | Mobile does not distinguish catalog vendors from Places-sourced vendor leads, rate confidence, website extraction status, or contact readiness. |
| LLM-inferred capacity surfacing | missing | Mobile venue rows show price/status only at lines 1234-1255; detail does not show inferred capacity confidence/source. | Needs desktop-equivalent capacity copy and source/confidence labels. |
| Approve-batch outreach route | missing | Desktop route/API exists, but mobile outreach section returns `SkippedOutreachView` at lines 1521-1523. | Mobile cannot select multiple ready venues/vendors and create per-recipient outreach approvals. |
| Pending outreach chip + routing to Approvals | partial | Mobile header review chip links to `/planner/payments` at lines 797-807; planner view has a review CTA at lines 889-1008. | Chip is generic pending approvals, not outreach-specific. It does not say "outreach drafts pending" or route from a specific venue/vendor draft. |
| Contact status and manual email rescue | missing | Mobile venues/vendors show only recommendation status pills at lines 1247-1250 and 1504-1507. | No `ready to reach out`, `contact pending`, `add email`, `awaiting claim`, inline email paste, or immediate move from rescue to ready. |
| Approval gate / no auto-send | partial | Mobile copy states "Nothing sends, holds, books, or pays until you approve it" at line 910 and approvals render at lines 1377-1410. | Mobile can view pending approvals, but it does not create batch approvals or execute approve/cancel from the mobile card. |
| Gmail reply classification and term extraction | missing | Mobile messages route explicitly says parsed venue replies are hidden until outreach pipeline lands at lines 1418-1422. | Mobile does not show parsed replies, extracted terms, quote confidence, or reply status. |
| "Best fit based on responses" comparison | missing | No mobile component reads response tables or quote-comparison data. | Mobile cannot compare returned venue/vendor options financially or by event goal after replies. |
| Commit venue / commit vendor acceptance | missing | `PLAN_SELECT_COLUMNS` includes committed quote fields at lines 19-24, but `MobilePlanner` does not expose accept/cancel actions. | Mobile cannot accept a verified quote or see committed venue/vendor banners in the decision flow. |
| Brief financial recompute from committed quotes | partial | Mobile budget read model has committed totals/projected delta at `mobileReadModels.ts` lines 158-190. `BudgetView` renders target/low/high/buffer and lines at `MobilePlanner.tsx` lines 1264-1304. | Mobile does not label the recompute as coming from accepted quotes, does not show before/after delta, and does not show committed quote terms in the brief. |
| Settlement security / token hardening | N/A for host mobile | Settlement token pages are venue/provider-facing security flows, not planner mobile host UI. | No mobile planner gap, but mobile payment approvals should still surface Stripe readiness and blocked states. |
| Invite known venue/vendor | missing | Current main has desktop invite forms and buttons, but no `Invite` hits inside `components/planner/mobile/MobilePlanner.tsx`. | Mobile cannot invite a known venue/vendor from the planner mobile surface. |
| Stripe readiness badges | missing | Desktop `EntityReadinessBadge` is used by `PlannerLivePlanPanel`; mobile rows use simple status pills. | Mobile does not show setup required, claim needed, Stripe missing, or payment blocked status on venue/vendor rows or approval cards. |
| Authorization pre-flight gating | partial | `DepositApprovalView` shows money approval details at lines 1332-1375. | It does not render the blocked state, disabled approve action, setup reminder, or readiness reason from desktop. |
| Analytics baseline source | partial | Mobile analytics shows current-year events, average margin, repeat-ready, best format, and recent events at lines 1560-1602. | No baseline badge like "Based on your last N events", no projection source, and no per-attendee net/range panel. |
| Ticketing setup guide | partial | Mobile ticketing shows connection count, events loaded, tickets sold, and revenue at lines 1604-1651. | When disconnected, it does not provide Eventbrite OAuth instructions, Posh/Luma webhook guidance, Partiful link/CSV guidance, or CSV import path. |
| Event brief ticket/check-in counts | done | `BriefView` computes and renders ticket/RSVP count and checked-in count at lines 1107-1185. | This specific requirement is mobile-covered. |
| Free event access display | partial | Mobile billing renders "Can create event" and "Free events remaining" at lines 1653-1680. | It displays billing state, but this audit did not verify mobile copy explains that outreach/date movement consumes free access. |

## Mobile Parity Summary

- Confirmed done: 1 area.
- Partial: 10 areas.
- Missing: 9 areas.
- N/A to mobile host planner: 1 area.

Mobile is usable for high-level plan review, approval visibility, basic venues/vendors, ticket totals, billing status, and analytics summaries. It is not yet mobile-complete for the newer agent operating loop: discovery rescue, outreach approvals, reply/quote decisions, Stripe readiness, and committed quote acceptance.

## Highest-Impact Mobile Gaps

1. **Approval safety parity**
   - Add readiness badges and blocked states to mobile venue/vendor rows and money approval cards.
   - This is the biggest trust gap because mobile currently shows money approvals without the same Stripe readiness context desktop has.

2. **Outreach/discovery parity**
   - Replace `SkippedOutreachView` with real outreach state: ready contacts, add-email rescue, pending drafts, sent messages, and replies.
   - This is central to the product loop: chat/plan -> discovery -> approval -> outreach -> compare.

3. **Quote decision parity**
   - Show venue/vendor reply quote cards on mobile with accept/cancel committed quote actions.
   - Mobile needs to support the moment where the organizer chooses the best option after outreach.

4. **Ticketing setup guide parity**
   - Add disconnected-state setup instructions for Eventbrite, Posh, Luma, Partiful, and CSV.
   - Current mobile ticketing is a summary, not a setup guide.

5. **Invite-known partner parity**
   - Desktop can invite known venues/vendors into active plans. Mobile should expose the same path.

## Recommended Completion Order

1. **Mobile approval safety pass**
   - Effort: medium.
   - Reuse `EntityReadinessBadge`.
   - Add blocked Stripe readiness state to mobile approval/deposit cards.
   - Make approval cards deep-link to desktop/full approvals if mobile execution remains deferred.

2. **Mobile discovery/contact pass**
   - Effort: medium-large.
   - Add contact status chips to venue/vendor rows.
   - Add inline "Add contact email" rescue.
   - Add "Create outreach approvals" batch action only for ready contacts.
   - Preserve one approval record per recipient.

3. **Mobile outreach/reply pass**
   - Effort: large.
   - Replace skipped outreach with drafts, sent messages, and parsed reply terms.
   - Show quote amounts, availability, confidence/source, and "needs follow-up" states.

4. **Mobile quote acceptance pass**
   - Effort: large.
   - Add accept/cancel actions for venue/vendor quote choices.
   - Surface committed banners in brief, venues/vendors, and budget.
   - Show budget/profit delta from accepted quotes.

5. **Mobile ticketing setup pass**
   - Effort: small-medium.
   - Condense `PlannerTicketingSetupGuideSection` and `PlannerTicketingImportSection` into mobile cards.
   - Show instructions only when disconnected or setup-pending.

6. **Mobile analytics/profit baseline pass**
   - Effort: medium.
   - Extend `MobileAnalyticsReadModel` to include baseline source/basis.
   - Add realistic/range/per-attendee net copy where mobile budget/profit is shown.

7. **Mobile invite-known partner pass**
   - Effort: small-medium.
   - Add invite known venue/vendor CTAs from mobile venues/vendors, reusing existing forms or routing to desktop surfaces.

## Mobile-Only Debt

- `MobilePlanner.tsx` still contains stale copy that says outreach/reply/sent/policy surfaces are "in development" even though desktop outreach and replies exist.
- `MobilePlanner.tsx` interfaces do not fully model fields already selected by `PLAN_SELECT_COLUMNS` and `RECOMMENDATION_SELECT_COLUMNS`, especially committed quote fields and recommendation metadata.
- `mobileReadModels.ts` is not rich enough for current planner behavior. It should include contact readiness, source, capacity inference, accepted quote state, response summary, ticketing setup state, and baseline source.
- `/mobile-mockup` remains useful as visual reference but should not be treated as production parity evidence. Production mobile is `MobilePlanner`.

## Follow-Up Chips

1. **P0 mobile trust parity: Stripe readiness + blocked approval states**
2. **P1 mobile outreach parity: contact rescue + batch approval creation**
3. **P1 mobile quote parity: reply quote cards + accept/cancel committed quote**
4. **P2 mobile ticketing setup guide**
5. **P2 mobile baseline/profit read model**

## Bottom Line

Mobile is **not yet checked off** for the full desktop readiness checklist. It is safe for plan review and basic navigation, but not yet complete for the newest approval-gated discovery/outreach/quote loop. The highest-risk miss is Stripe readiness and blocked approval visibility on mobile; the highest product-value miss is mobile outreach and quote comparison.
