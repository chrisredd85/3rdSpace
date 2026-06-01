# Agentic Outreach Build Plan

This document is the living brief for the 3rdPlace agentic outreach loop. Future sessions should reference this file instead of re-pasting the brief.

## Current State

Last updated: 2026-06-01

- Phase 1 implementation is in progress on `codex/outreach-phase-1`; it is not merged or deployed yet.
- Existing planner code already generates approval-gated outreach drafts through `lib/ai/agents/outreachAgent.ts` and `lib/planner/opportunityOutreach.ts`.
- Existing `approvals` and `agent_actions` tables remain the human approval gate. Do not bypass them.
- Added the Phase 1 foundation: Gmail OAuth routes, encrypted creator email account storage, outreach thread/message tables, explicit thread state machine, Gmail send endpoint, reply polling endpoint, reply classifier, follow-up draft scheduling, and planner outreach UI.
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
