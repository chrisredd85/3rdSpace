# Supply Needs + Bulk Outreach Technical Plan

## Goal

Make special or ambiguous supply requests flow through the planner without turning 3rdPlace into a marketplace:

1. The planner detects when normal venue/vendor matching is not enough.
2. The crawler surfaces contact evidence before outreach, including contact forms when no email is available.
3. The organizer can approve outreach as one batch across selected venues.
4. The system compares only real replies/quotes before commitment.
5. Booking, payment, and outbound messages remain approval-gated.

## Implementation Shape

- Extend the existing `special_supply` metadata model instead of adding a second supply-needs system.
- Persist crawler-discovered contact forms on `discovery_venues` and `discovery_vendors`.
- Return a fourth contact state: `contact_form_available`.
- Show contact-form links in the planner brief, outreach search, and mobile rescue panel.
- Change venue outreach batch creation to one Gmail approval with multiple targets.
- Keep contact-form-only candidates out of Gmail batches until an email is provided.

## Scenario Inspection

Scenario: "I want to host a golf event in Oakland for 40 people and charge $15 per ticket."

Why this should be special supply:

- "Golf" is ambiguous: it may mean full course, driving range, indoor simulator, or Topgolf-style reserved bays.
- Pricing depends on duration, format, bay/count capacity, included food and beverage, equipment, instruction, and cancellation terms.
- Google Places can discover leads, but it cannot verify event package pricing or whether a lead accepts private events.

Applied behavior:

- Tag as `event_complexity = special_supply_required`.
- Use `special_supply.kind = golf_activity`.
- Ask whether to scout full courses, driving ranges, simulators, or all options.
- Search quote-required golf leads.
- Crawl websites for emails, contact forms, package hints, and capacity clues.
- Show contact-form links if email is unavailable.
- Create one bulk outreach approval for selected email-ready leads.
- Compare only real provider replies before accepting a quote or starting payment.

## Guardrails

- No auto-send. Gmail send still requires an approval record.
- No auto-submit of contact forms.
- Contact-form leads are opportunities, not failures.
- Final commitment/payment remains per selected venue/vendor after quote comparison.
