# Operator runbook: venue_stripe_setup_stalled

## When this fires

Day 14 after an organizer committed to pay a venue, the venue still has not completed Stripe Connect onboarding. All four automated emails fired with no result. Admin intervention is needed.

## What to check first

Sentry event tags: `venue_id`, `opportunity_id`, `organizer_id`, `amount_cents`, `days_pending`.

1. **Look up the venue's contact info.** Query `venues` and `venue_opportunity_invites` for the `venue_id` and `opportunity_id`. Note their preferred contact channel from `venues.contact_preferences`.

2. **Reach out personally.** Use whatever channel they prefer, usually email or phone.

   Script: "Hey, I'm with 3rdPlace — saw that an organizer is waiting to pay you $[X] for [event]. We've sent a few reminders but Stripe setup hasn't gone through. Want help getting that sorted, or did something change with your availability?"

## Decision tree based on response

- **Yes, want to continue:** ask what specifically is blocking them on Stripe. Common issues: business type confusion, tax info concern, identity document rejection. Walk them through the specific block. Send them a fresh resume link from the admin tools.

- **Wants to decline:** confirm the decline. Trigger the decline action on their behalf via `/admin/venue-opportunities/<id>/decline`, which should be the admin override of the token-gated route. This fires the organizer venue-declined template and the venue decline-confirmation template.

- **No response after 48 more hours:** mark venue as inactive by setting `venues.discoverable = false` and `venues.profile_completion_state = 'inactive'`. Trigger decline on their behalf so the organizer can find another venue. Send the organizer a personal note explaining the venue went dark and that 3rdPlace is sorry.

## What not to do

- Do not rely on email reply parsing. The reminder system is one-way.
- Do not manually create Stripe accounts on the venue's behalf. They must complete Stripe onboarding themselves for identity verification compliance.
- Do not auto-charge the organizer or refund anything. In the MVP flow there is no charge yet to reverse.

## When to escalate

If more than three `venue_stripe_setup_stalled` alerts fire in a single week, something systemic is wrong. Investigate whether the reminder copy is underperforming, Stripe onboarding has unexpected friction, or the system is using the wrong venue contact emails.

