# Agentic Outreach Build Plan

This document is the living brief for the 3rdPlace agentic outreach loop. Future sessions should reference this file instead of re-pasting the brief.

## Current State

Last updated: 2026-06-01

- Phase 1 implementation is in progress on `codex/outreach-phase-1`; it is not merged or deployed yet.
- Existing planner code already generates approval-gated outreach drafts through `lib/ai/agents/outreachAgent.ts` and `lib/planner/opportunityOutreach.ts`.
- Existing `approvals` and `agent_actions` tables remain the human approval gate. Do not bypass them.
- Added the Phase 1 foundation: Gmail OAuth routes, encrypted creator email account storage, outreach thread/message tables, explicit thread state machine, Gmail send endpoint, reply polling endpoint, reply classifier, follow-up draft scheduling, and planner outreach UI.
- Phase 2 discovery/non-onboarded outreach is implemented on `codex/outreach-phase-2` as infrastructure: discovery venue schema/RLS, seed loader contract, Google Places enrichment cron, DB-backed discovery ranker/agent, discovery-aware Gmail threads/signals, claim-listing flow, and creator Discover UI.
- Phase 2 is not production-complete until `scripts/data/bay-area-venues.json` is populated with 200-300 manually verified Bay Area venue records. The repo intentionally keeps the file empty until verified data is available.
- Phase 4 multi-channel outreach is implemented on `codex/outreach-phase-4` on top of the Phase 2 foundation as guarded infrastructure for Instagram manual-send drafts, Twilio SMS, voice availability scripts/calls, channel selection, compliance events, and admin channel observability.
- Phase 4 cannot go to production traffic until the operator completes A2P 10DLC/Twilio registration, chooses and configures the voice provider, verifies caller identity, confirms provider terms, and documents TCPA/CA bot-disclosure compliance.
- Phase 5 earned autonomy foundation is implemented on `codex/outreach-phase-5`: versioned creator policy engine, trust-score job, scheduled autonomous sends with a real undo window, pause/undo controls, autonomy notifications, admin audit visibility, low-stakes autonomous reply/follow-up hooks, and eval harness contracts.
- New creators must have zero autonomous actions until they explicitly opt in. No autonomous action may spend money, sign terms, make legal commitments, or bypass the approval model for high-stakes decisions.
- Phase 5 is not production-complete until the operator labels the 200-reply and 100-scenario eval corpora, connects eval enforcement in CI for agent-code PRs, validates trust-score telemetry against real approval/edit events, and reviews the autonomy policy UX/legal language.
- `lib/types/database-generated.ts` still needs regeneration once Docker/Supabase local services are available.
- Update this section after each phase ships so the brief remains accurate.

## Phase 1: Email Send, Reply Ingest, Thread State

### Context

This repo is 3rdPlace, a Next.js + Supabase + OpenAI event planner. Creators use a chat-based agent to plan events. The platform already generates outreach drafts to venues and vendors, but does not yet send them or handle replies.

The job for Phase 1 is to close that email loop.

### Strategic Constraint

3rdPlace is not a marketplace for this outreach flow, and money does not touch the platform. The outreach agent works on behalf of the creator. Emails are sent from the creator's own Gmail account via OAuth, not from a platform domain.

This is critical for response rates. Build for the creator-account model.

### What Exists

Do not duplicate these systems:

- `lib/ai/agents/outreachAgent.ts`: GPT-4o draft generator. Output schema is stable; do not change it.
- `lib/planner/opportunityOutreach.ts`: orchestrates draft generation, gates on approvals and venue compliance, logs to `agent_runs`.
- Drafts are stored inside `agent_actions` and planner messages with `approval_status: 'pending'`.
- `approvals` and `agent_actions`: keep using these for the human approval gate.
- `venues` and `vendor_profiles`: onboarded supply. Targets currently come from these tables only.

### Build Scope

#### 1. Gmail OAuth Per Creator

- Add `creator_email_accounts`:
  - `id`
  - `user_id`
  - `provider` set to `gmail`
  - `email_address`
  - `oauth_access_token` encrypted
  - `oauth_refresh_token` encrypted
  - `token_expires_at`
  - `history_id`
  - `label_id`
  - `created_at`
  - `revoked_at`
- Add OAuth routes:
  - `app/api/integrations/gmail/connect/route.ts`
  - `app/api/integrations/gmail/callback/route.ts`
- Use Google OAuth 2.0 scopes:
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.modify`
- Store tokens encrypted. Use an existing helper if available; otherwise add AES-256-GCM with `EMAIL_TOKEN_ENCRYPTION_KEY`.
- Add creator-facing settings UI:
  - `app/(planner)/planner/settings/integrations/page.tsx`
  - Show connect and disconnect state.

#### 2. Outreach Thread State Machine

- Add `outreach_threads`:
  - `id`
  - `plan_id`
  - `user_id`
  - `target_type` as `venue | vendor`
  - `target_id` nullable
  - `target_name`
  - `target_email`
  - `channel` as `email`
  - `state` as `draft | awaiting_reply | in_negotiation | confirmed | declined | stale | cancelled`
  - `last_event_at`
  - `next_action_at`
  - `created_at`
  - `updated_at`
- Add `outreach_messages`:
  - `id`
  - `thread_id`
  - `direction` as `outbound | inbound`
  - `gmail_message_id`
  - `gmail_thread_id`
  - `subject`
  - `body_text`
  - `body_html`
  - `headers_json`
  - `sent_at`
  - `received_at`
  - `classification_json`
  - `created_at`
- Add `lib/outreach/threadState.ts` with `transition(thread, event)` returning the new state and rejecting invalid transitions.

#### 3. Send Pipeline

- Add `lib/outreach/send.ts` with `sendOutreachDraft({ threadId, draftMessageId, userId })`.
- The send pipeline must:
  - Verify the parent `agent_action` has an approved or authorized `approvals` row.
  - Load the creator's connected Gmail account and refresh the token if needed.
  - Send through Gmail API `users.messages.send`, MIME-encoded, with `Reply-To` set to the creator's address.
  - Track returned `gmail_message_id` and `gmail_thread_id`.
  - Insert an outbound `outreach_messages` row.
  - Transition the thread from `draft` to `awaiting_reply`.
  - Set `next_action_at` to `now() + 3 days`.
- Add POST endpoint:
  - `app/api/planner/plans/[planId]/outreach/[threadId]/send/route.ts`
  - Requires an authenticated creator who owns the plan.

#### 4. Reply Ingestion

- Gmail watch and Pub/Sub are out of scope for Phase 1. Use polling instead.
- Add cron-style endpoint:
  - `app/api/internal/jobs/outreach-poll/route.ts`
  - Protect with `CRON_SECRET` header.
- For each connected Gmail account with active threads in `awaiting_reply | in_negotiation`:
  - List messages in those Gmail thread IDs newer than the last known inbound message.
  - Store new inbound messages in `outreach_messages`.
  - Run the reply classifier agent.
  - Update thread state through the state machine.
- Wire into the existing job runner or Vercel Cron. Prefer the existing project pattern when possible.
- Add a Vercel cron entry running every 10 minutes.

#### 5. Reply Classifier Agent

- Add `lib/ai/agents/replyClassifier.ts`, mirroring the structure of `outreachAgent.ts`.
- Use GPT-4o-mini.
- Log every run to `agent_runs`.
- Input: thread context plus new inbound message body.
- Output schema:

```json
{
  "intent": "available | unavailable | needs_info | redirect | price_quote | contract_request | other",
  "confidence": 0.0,
  "extracted": {
    "price_cents": null,
    "date_confirmed": false,
    "capacity_confirmed": false,
    "alternative_date": null,
    "required_action_from_creator": null
  },
  "suggested_next_state": "draft | awaiting_reply | in_negotiation | confirmed | declined | stale | cancelled",
  "requires_human_review": true,
  "summary_for_creator": "string"
}
```

- If `confidence < 0.7` or `requires_human_review === true`, the thread stays in its current state and surfaces to the creator as needing attention.
- Never auto-reply in Phase 1. Every outbound message goes through draft plus approval.

#### 6. Follow-Up Scheduling

- The poll job also handles follow-ups.
- For threads where `state = 'awaiting_reply'`, `next_action_at <= now()`, and no inbound message has arrived:
  - Generate a follow-up draft with `runOutreachAgent`.
  - Use `outreach_type: 'follow_up'`.
  - Populate `previous_thread_summary`.
  - Insert a pending `agent_action` requiring approval.
  - Bump `next_action_at` by another 4 days.
  - After 2 follow-ups with no response, transition thread to `stale`.

#### 7. Creator UI

- Add page:
  - `app/(planner)/planner/outreach/page.tsx`
- Show all threads for the creator's active plans, grouped by plan, with:
  - state badges
  - last activity
  - needs-your-attention highlights
- Add thread detail:
  - `app/(planner)/planner/outreach/[threadId]/page.tsx`
- Show:
  - full message history
  - classifier summaries on inbound messages
  - approve, edit, and send controls on outbound drafts

### Non-Goals For Phase 1

- Outreach to non-onboarded venues. This is Phase 2 and needs a discovery dataset.
- Instagram DMs, SMS, or phone.
- Auto-replies without creator approval.
- Embedded insurance or COI verification beyond what already exists.
- Booking memo generation, e-sign, or payment.

### Quality Bar

- Every database write in app code goes through typed Supabase queries, not raw SQL strings.
- All new tables have RLS policies.
- Creators can only see their own threads, messages, and email accounts.
- Service role is used for polling jobs.
- Token encryption is real. Never store raw OAuth tokens.
- Unit tests:
  - thread state transitions
  - reply classifier output parsing
  - send pipeline approval gate
- Integration test:
  - full loop with Gmail API mocked
- Observability:
  - every outbound send and inbound classification logs to `agent_runs` with token counts and durations where applicable
- No silent failures in the poll job. Capture/log every error and continue processing other threads.

### Migration Plan

- Generate Supabase migrations in `supabase/migrations/` for the three new tables with RLS policies.
- Match the existing migration naming and style.
- Regenerate types into `lib/types/database-generated.ts` per the existing workflow.

### Phase 1 Deliverable

A working email-only outreach loop where a creator can:

1. Connect their Gmail.
2. Approve an outreach draft.
3. Send it to a venue from their Gmail account.
4. See replies appear in the planner with classifier-extracted info.
5. See follow-up drafts generated automatically after 3 days of silence.
6. Approve, edit, and send those follow-ups through the same approval-gated workflow.

Target PR title:

`feat(outreach): Phase 1 - Gmail send + reply ingest + thread state`

The PR should include every new table, endpoint, and env var the operator needs to set.

## Phase 2: Discovery Dataset And Non-Onboarded Outreach

### Context

Phase 1 shipped the email loop: creators connect Gmail, drafts get approved, sent, replies ingested, and threads tracked. Today the agent can only reach venues already in the `venues` table, which is onboarded supply. The strategic bet is that the agent should reach any viable Bay Area venue, not just onboarded ones.

Phase 2 builds that broader venue universe.

### What Exists

Do not duplicate these systems:

- `outreach_threads`, `outreach_messages`, and `creator_email_accounts` from Phase 1.
- `runOutreachAgent` already accepts a `target_partner` with arbitrary name, email, and contact info. It does not require a `venues` row.
- `getVenueComplianceStatus` in `lib/planner/venueComplianceGate.ts` applies only to onboarded venues. Non-onboarded outreach skips it.

### Build Scope

#### 1. Discovery Venue Table

- Add `discovery_venues`:
  - `id`
  - `name`
  - `address`
  - `neighborhood`
  - `city`
  - `state`
  - `lat`
  - `lng`
  - `contact_email`
  - `contact_phone`
  - `website`
  - `instagram_handle`
  - `capacity_seated`
  - `capacity_standing`
  - `capacity_cocktail`
  - `vibe_tags` as `text[]`
  - `alcohol_policy`
  - `av_available`
  - `parking_notes`
  - `price_hint_cents_low`
  - `price_hint_cents_high`
  - `price_hint_note`
  - `source` as `google_places | manual_seed | creator_referral | claimed | scrape`
  - `source_external_id`
  - `last_enriched_at`
  - `last_verified_at`
  - `is_claimed`
  - `claimed_venue_id`
  - `created_at`
  - `updated_at`
- Add a unique constraint on `(source, source_external_id)` to prevent duplicates.
- Add full-text search on name, neighborhood, and vibe tags.

#### 2. Seed Loader

- Add `scripts/seed-discovery-venues.ts`.
- Load 200-300 hand-curated Bay Area venues from `scripts/data/bay-area-venues.json`.
- Include neighborhood, capacity, vibe tags, and contact email when publicly available.
- Idempotent and re-runnable without duplicates.
- The JSON file is the cold-start dataset.
- Seed data must be real and manually verified before production. Do not hallucinate records.

#### 3. Google Places Enrichment Job

- Add endpoint:
  - `app/api/internal/jobs/discovery-enrich/route.ts`
- Protect it with `CRON_SECRET`.
- Each run:
  - Pulls 50 venues from `discovery_venues`, ordered by `last_enriched_at` ascending with nulls first.
  - Calls Google Places API Details to refresh hours, phone, website, rating, and photos.
  - Updates fields and bumps `last_enriched_at`.
- Add Vercel cron entry every 6 hours.
- Add env var:
  - `GOOGLE_PLACES_API_KEY`

#### 4. Venue Discovery Agent

- Add `lib/ai/agents/venueDiscoveryAgent.ts`.
- Input: event plan plus creator preferences including neighborhood, budget, vibe, and headcount.
- Output: ranked list of 8-12 candidate venues from `discovery_venues` union `venues`, with per-venue match reasoning and confidence score.
- Ranking signals:
  - vibe tag overlap
  - capacity fit
  - neighborhood proximity
  - budget alignment with price hints
  - prior creator response history
  - recency of last successful booking by any creator on the platform
- Onboarded venues get a small ranking boost, such as `+0.1`, because they opted in.
- Do not exclude non-onboarded venues.
- The agent does not contact anyone. It produces candidates that flow into the existing approval and outreach pipeline.
- Hard rule: the discovery agent must never invent a venue not in `discovery_venues` or `venues`; enforce this in prompt and post-output validation.

#### 5. Wire Candidates Into Outreach

- Extend `lib/planner/opportunityOutreach.ts` to accept targets from `venues` or `discovery_venues`.
- Add `target_source` on `outreach_threads` as `onboarded | discovery`.
- For discovery targets, skip the COI compliance gate because it does not apply until the venue has given requirements.
- Update the venue opportunity briefs flow at `app/(planner)/planner/venues/page.tsx` so discovery candidates appear alongside onboarded options, visually labeled:
  - `Onboarded`
  - `Reaching out`

#### 6. Claim-This-Listing Flow

- Outbound email to a non-onboarded venue must include a trackable claim link:
  - `https://3rdplace.app/v/[discovery_venue_id]/claim?token=...`
- Add page:
  - `app/v/[discoveryVenueId]/claim/page.tsx`
- On claim:
  - Set `discovery_venues.is_claimed = true`.
  - Set `claimed_venue_id`.
  - Migrate any existing `outreach_threads.target_id` pointing at the discovery venue to reference the new `venues.id`.
  - Send the venue a welcome email with pending inquiries.
- Track claim conversion rate in `agent_runs` metadata or a dedicated `discovery_venue_events` audit table.

#### 7. Per-Venue Response History

- Add `discovery_venue_signals`:
  - `id`
  - `discovery_venue_id` or `venue_id`
  - `event_type` as `email_sent | reply_received | booked | declined | stale`
  - `thread_id`
  - `latency_seconds`
  - `created_at`
- Update Phase 1 send and reply ingest to insert signals.
- Discovery ranking uses aggregates:
  - `response_rate_30d`
  - `avg_reply_latency_seconds`
  - `booking_rate_30d`

#### 8. Search UI For Creators

- Add page:
  - `app/(planner)/planner/venues/discover/page.tsx`
- Creators can filter union of onboarded and discovery venues by:
  - neighborhood
  - capacity
  - vibe
  - price
- Use response-time labeling.
- Adding a venue to an event still routes through the agent plus approval gate.

### Non-Goals For Phase 2

- Scraping Peerspace, Giggster, or Tagvenue.
- Auto-acquiring contact emails. If a venue email is not publicly listed on its site or Google Places, surface Instagram instead. Sending logic for Instagram is Phase 4.
- Embedding the agent inside venue dashboards.

### Quality Bar

- RLS: `discovery_venues` is readable by any authenticated user and writable only by service role.
- Google Places quota: enforce 50 venues per run and log calls.
- Seed data is real. Verify each of the 200 manually before commit. Not scraped, not hallucinated.
- The discovery agent must never invent a venue not in `discovery_venues` or `venues`. Enforce this through both the system prompt and DB-backed post-output validation.

### Phase 2 Deliverable

A working discovery outreach loop where a creator can:

1. Plan an event in a neighborhood with zero onboarded venues.
2. Receive a candidate set of 10 real Bay Area venues from the discovery dataset.
3. Approve outreach to 5 of them.
4. See the emails sent through the Phase 1 Gmail pipeline.
5. See replies come back.
6. See one venue claim its listing through the trackable claim link.

Target PR title:

`feat(outreach): Phase 2 - discovery dataset + non-onboarded venue outreach`

## Phase 4: Multi-Channel Send

### Context

Email-only outreach caps response rates around 35-45% even with smart follow-ups. The next unlock is matching channel to venue: some venues respond to Instagram DMs, some to texts, and some only to phone calls. This phase adds Instagram, SMS, and voice with explicit human-in-the-loop guardrails.

### What Exists

- Email pipeline from Phase 1.
- Discovery dataset and non-onboarded outreach from Phase 2.
- Venue/contact memory from Phase 3.
- `venue_contact_profiles.preferred_channel` should drive channel selection when available.

### Build Scope

#### 1. Channel-Aware Thread Model

- Extend `outreach_threads.channel` to include `instagram`, `sms`, and `voice`.
- Extend `outreach_messages` for non-email payloads:
  - `channel_external_id`
  - `attachments_json`
  - `transcript_text`
  - `recording_url`
  - `sent_manually`

#### 2. Instagram DM Drafts

- Do not automate personal Instagram DMs.
- Generate an IG DM draft and open the creator's Instagram app via deep link:
  - `instagram://direct/new?text=...&recipient=@handle`
- After creator confirmation, mark an outbound message:
  - `channel = instagram`
  - `direction = outbound`
  - `sent_manually = true`
- Add manual reply logging on thread detail so creators can paste IG replies and run the reply classifier.

#### 3. SMS Via Twilio

- Store creator verified numbers in `creator_phone_numbers`.
- Outbound SMS is sent only after creator approval and only from a verified creator number.
- Include `Reply STOP to opt out.` on every outbound SMS.
- Add inbound webhook:
  - `app/api/integrations/twilio/inbound-sms/route.ts`
- Match inbound number to the right thread and run the reply classifier.
- Honor `STOP` and `UNSUBSCRIBE` automatically.

#### 4. Voice Via Operator-Chosen Provider

- Phase 4 voice is only for simple availability checks.
- Creator approves every call script before the call.
- Voice script must disclose agency/automation clearly:
  - "I'm calling on behalf of [creator]..."
- No autonomous voice calls.
- Track transcript and run the reply classifier.

#### 5. Channel Selection Logic

Priority order:

1. `venue_contact_profiles.preferred_channel`
2. Available contact methods
3. Historical response rate by channel/category
4. Creator-enabled channels

If multiple channels are viable, the agent can suggest a channel mix. Creator approval is required before any send/call.

#### 6. Channel-Specific Draft Generators

- Extend `outreachAgent` to accept `channel`.
- Email: professional 4-6 sentence message with subject.
- SMS: 1-2 short sentences, no subject, opt-out included at send time.
- Instagram: 2-3 sentence DM.
- Voice: conversational script, key questions, and max call duration.

#### 7. Per-Channel Observability

- Add admin dashboard:
  - `app/admin/outreach/page.tsx`
- Show per-channel response rate, conversion, provider cost, and compliance events.

### Non-Goals

- WhatsApp.
- Mass send or broadcast.
- Voicemail drops without human consent.

### Quality Bar

- Preserve the creator-account-not-platform-account principle.
- SMS uses creator-verified numbers only.
- Instagram is creator-sent via deep link only.
- Voice discloses the agency relationship and AI/automation.
- No SMS production traffic until A2P/TCPA readiness is complete.
- SMS only to public business contact numbers.

### Phase 4 Deliverable

A guarded multi-channel outreach loop where a creator can approve and track Instagram DM, SMS, and voice outreach in one thread.

Target PR title:

`feat(outreach): Phase 4 - multi-channel send (IG DM, SMS, voice)`

## Phase 5: Earned Autonomy And Policy Engine

### Context

Phases 1-4 give creators a multi-channel outreach loop where every action is gated by approval. That remains the default. At scale, though, a creator running frequent events can face approval fatigue across venue inquiries, follow-ups, and simple reply handling. Phase 5 introduces earned autonomy: the agent may act without per-message approval only inside explicit creator-defined guardrails, with policy-version auditability, notifications, pause, and undo.

### What Exists

- Multi-channel outreach across email, Instagram manual handoff, SMS, and voice.
- Per-thread state, messages, reply classification, follow-up generation, `agent_runs`, compliance events, and admin channel observability.
- Existing `approvals` and `agent_actions` remain the fallback path whenever autonomy is not permitted.

### Build Scope

#### 1. Per-Creator Policy Engine

- Add `creator_outreach_policies`:
  - `id`
  - `user_id`
  - `version`
  - `max_unattended_budget_cents`
  - `allowed_autonomous_actions` as `text[]`
  - `quiet_hours_start_local`
  - `quiet_hours_end_local`
  - `max_inquiries_per_event`
  - `max_followups_per_thread`
  - `blacklisted_venue_ids`
  - `blacklisted_keywords`
  - `require_approval_for_first_contact`
  - `trust_level`
  - `created_at`
  - `updated_at`
- Policies are versioned. Every autonomous decision records the policy id and version consulted.
- Default autonomy for new creators is zero; autonomy never auto-enables without explicit opt-in.

#### 2. Trust Score Derivation

- Add a weekly background job to recompute `trust_level` from:
  - Agent drafts approved as-is vs. edited.
  - Classifier decisions overruled by the creator.
  - Resolved bookings without disputes.
  - Time since the last pause/stop override.
- Higher trust may raise score automatically, but must not add new allowed autonomous actions. Creator policy opt-in is separate from trust.

#### 3. Action Gate Middleware

- Add `lib/outreach/policyGate.ts` with:

```ts
canActAutonomously({ userId, action, context })
```

- Return:

```ts
{
  allowed: boolean
  reason: string
  required_approval_type?: string
}
```

- Every outreach send/reply/follow-up path checks the gate. If blocked, create a pending approval or surface a required-approval notification. If allowed, proceed and write an autonomous audit entry.

#### 4. Autonomous Reply Generation

- Permit low-stakes autonomous replies only when policy allows:
  - `needs_info` clarifying replies.
  - `price_quote` acknowledgement and hold request when price is under cap.
  - Follow-up generation and sending.
- Always escalate high-stakes intents:
  - `contract_request`
  - unavailable replies with alternative proposals
  - price above budget cap
  - anything involving legal terms, money movement, signing, cancellation, indemnification, or liability

#### 5. Creator Notifications

- Add `outreach_notifications`:
  - `id`
  - `user_id`
  - `thread_id`
  - `notification_type`
  - `payload_json`
  - `read_at`
  - `created_at`
- Notification types:
  - `agent_acted_autonomously`
  - `requires_approval`
  - `quote_received`
  - `booking_confirmed`
  - `thread_stale`
  - `policy_blocked_action`
- Every autonomous action creates a notification with undo affordance for up to 4 hours.

#### 6. Kill Switch And Undo

- Add a pause-agent action that:
  - Creates a new policy version with `allowed_autonomous_actions = []`.
  - Cancels scheduled outbound sends.
  - Flags open threads as `awaiting_creator_review`.
- Add undo-last-action support:
  - Cancel scheduled sends that have not been dispatched.
  - For already sent autonomous messages, create a correction/apology draft requiring creator review instead of silently sending another autonomous message.

#### 7. Observability And Audit

- Add `app/admin/outreach/autonomy/page.tsx` showing:
  - Trust level over time by creator.
  - Autonomous action volume and approval-rate trend.
  - Policy gate blocks and reasons.
  - Disputes, pause, and undo events.
  - Per-thread audit log with policy version, decision, model/action metadata, and human intervention.
- Audit retention for autonomous decisions is at least 2 years.

#### 8. Eval Suite

- Add fixture contracts for:
  - 200 hand-labeled representative replies.
  - 100 hand-labeled outreach scenarios.
- Add an eval runner skeleton that can run in CI when fixtures are populated and block if key intent accuracy drops by more than 3%.
- The repo should not invent the corpus. Empty fixture files are acceptable until labeled data exists.

### Quality Bar

- New creators start with zero autonomous actions.
- All autonomous sends have a real delay: 5 minutes for email, 30 seconds for SMS, no delay for voice.
- Every autonomous action is reversible or explicitly marked irreversible by a creator-consented policy category.
- No autonomous action sends money, signs terms, or creates legally binding commitments.
- Every new table has RLS policies.
- All monetary values are stored as integer cents.

### Phase 5 Deliverable

A power-user creator with explicit autonomy enabled and high trust can let the agent send low-stakes outreach and follow-ups within guardrails, while the creator still approves final venue decisions, above-cap quotes, and anything legally binding.

Target PR title:

`feat(outreach): Phase 5 - earned autonomy + policy engine`
