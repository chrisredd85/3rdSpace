# Vendor Discovery Audit

This audit was produced while fixing sparse venue recommendation recovery. It answers whether vendor discovery can be safely wired into the same Places fallback path in this PR.

## Findings

### What is wired today

- The planner recommendation route loads venue catalog rows from `venues`, but vendor catalog rows only come from `vendor_profiles` where `is_published = true`. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/app/api/planner/plans/[planId]/recommend/route.ts:2172` and `/Users/chrisredd/3rdSpace.recommendation-recovery/app/api/planner/plans/[planId]/recommend/route.ts:2187`.
- Suggested vendors are driven by the archetype `vendor_stack`; if `vendor_need_status` is `none`, vendor suggestions are skipped. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/app/api/planner/plans/[planId]/recommend/route.ts:2202` and `/Users/chrisredd/3rdSpace.recommendation-recovery/app/api/planner/plans/[planId]/recommend/route.ts:2208`.
- The primary vendor ranker queries `vendor_profiles`, filters by service type, checks manual availability and existing bookings, then gates results. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/vendors/vendorRanker.ts:92` and `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/vendors/vendorRanker.ts:171`.
- Vendor gates require service type match, service-area coverage, availability, budget headroom, published status, and insurance where applicable. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/vendors/vendorGates.ts:34`.
- Vendor self-serve setup writes directly into `vendor_profiles` and publishes claimed vendors. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/server/account-setup.ts:500` and `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/server/account-setup.ts:516`.
- The networking mixer archetype can request check-in, photographer, catering, AV, bartending, and security services. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/planner/archetypes/data.ts:26`.

### What is missing

- There is no `discovery_vendors` table, route, or Places client path for vendor discovery. Repo search for `discovery_vendors`, `discover-vendors`, `searchPlacesForVendor`, and vendor/Places combinations returned no production implementation.
- Supply Scout staging is venue-only (`supply_scout_venue_leads`) and promotes into `discovery_venues`; there is no vendor equivalent. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/supabase/migrations/20260601000004_add_supply_scout_leads.sql:7` and `/Users/chrisredd/3rdSpace.recommendation-recovery/supabase/migrations/20260601000004_add_supply_scout_leads.sql:30`.
- The event page scraper extracts event and venue signals only; it does not find or persist vendors. Evidence: `/Users/chrisredd/3rdSpace.recommendation-recovery/lib/integrations/scrape/eventPage.ts:5`.

## Sparse Catalog Risk

Vendor recommendations can still go sparse because the planner only searches published `vendor_profiles`. The transcript returned vendors because the catalog had matching seeded or claimed vendor profiles for the requested service types; that does not prove external vendor discovery exists.

Useful production SQL checks before building vendor discovery:

```sql
select service_type, count(*)
from vendor_profiles
where is_published = true
group by service_type
order by count(*) asc;

select service_type, service_area, regions_served, count(*)
from vendor_profiles
where is_published = true
group by service_type, service_area, regions_served
order by service_type, count(*) asc;
```

## Recommendation

Do not add vendor Places fallback in this PR. It is not a small safe hook because vendors need separate schema, RLS, contact resolution, service-type mapping, and approval payload semantics. This PR should ship venue recovery only.

A follow-up vendor discovery PR should add:

1. Additive `discovery_vendors` table with RLS and fields parallel to `discovery_venues`, but service-oriented: service type, service area, portfolio/social links, extracted contacts, organizer-provided contacts, source confidence.
2. A Places/service search mapper for vendor types (`photographer`, `catering`, `security`, `dj`, `florist`, etc.) with honest confidence labeling because Google Places categories are weaker for mobile services than venues.
3. Website/contact extraction reuse or a sibling extractor that can resolve vendor emails from portfolio/business websites.
4. Planner route and UI sections that keep vendor outreach approval-gated and distinguish catalog vendors from unverified vendor leads.
5. Tests for service-type mapping, organizer-provided contact rescue, RLS, and per-message approval payloads.
