# Server-owned execution control plane

Migration `20260709130000_server_owned_execution_control_plane.sql` closes the
direct PostgREST mutation path into planner approvals, actions, payment
authorization records, outreach delivery state, audit history, and derived UI
caches.

## Rollout order

1. Deploy the application caller conversion first. Every trusted mutation must
   use a service-role client only after the route proves the authenticated user
   owns the plan or resource. Service queries must include explicit aggregate
   predicates; they cannot rely on session RLS for tenant scoping.
2. Ensure every approval that can become `approved` or `authorized` has a
   stable, nonblank `snapshot_hash`. Immediate executable approvals must also
   set `authorized_by` and `authorized_at` in the same write.
3. Run `scripts/security/preflight-server-owned-execution.sql` against hosted
   production in a read-only transaction.
4. Stop if any count is nonzero. Investigate each row and use an auditable
   operator workflow to supersede, cancel, or repair it. Never infer approval,
   invent a snapshot, or deduplicate authorization history in bulk.
5. Apply the migration only after the preflight reports zero contradictions.
6. Run `scripts/security/verify-hosted-control-plane.sql`, followed by the
   Prompt 4 hosted ACL verifier, and smoke the approval PATCH, deposit
   authorization/capture, settlement checkout, Gmail approval, opportunity,
   and plan-revision flows.

The code-first order is safe because service-role writes already work under the
old policies. Reversing the order breaks server routes that still write through
the authenticated session client.

## Enforced invariants

- An action has at most one approval in `pending`, `approved`, `authorized`, or
  `re_approval_required` state.
- An approval and its action have the same `plan_id`.
- An action's optional `approval_id` points back to an approval for that exact
  action and plan.
- `authorized_amount_cents` never exceeds `requested_amount_cents`.
- Both executable statuses, `approved` and `authorized`, require
  `authorized_by`, `authorized_at`, a nonblank snapshot hash, and a future or
  null expiry.
- A payment intent and its approval have the same plan.
- A settlement charge's optional approval belongs to the same settlement run.

`NULL expires_at` deliberately means non-expiring. Making approval TTLs
mandatory is a separate product and migration decision.

## Trusted relation classes

Owner-readable, service-mutation relations:

- Planner authorization: `agent_actions`, `approvals`,
  `agent_authorizations`, `payment_intents`.
- Planner provenance and caches: `plan_messages`, `plan_versions`,
  `plan_revisions`, `planner_plan_updates`, `plan_derived_state`,
  `plan_activity`, `audit_logs`, `agent_action_audit_log`, `agent_runs`.
- Outreach execution: `outreach_threads`, `outreach_messages`,
  `creator_outreach_policies`, venue/vendor opportunity briefs and invites.
- Approval and financial ledgers: `venue_booking_approval_audit`,
  `vendor_transactions`, `platform_fee_transactions`, `settlement_charges`.

Service-only base relations:

- `admin_tasks`, because it contains internal notes, metadata, assignment, and
  operator status. Host-visible progress must come from a server-projected API.
- `kickback_payments`, whose current product readers already use authorized
  server routes and which had no authenticated SELECT policy.

RLS is not the only boundary. The migration revokes authenticated and anonymous
table DML privileges, grants authenticated `SELECT` only where the underlying
owner policy is safe, and grants service role the mutation privileges.

## Caller requirements

Do not replace a session client with a service client wholesale. First load the
owned plan/resource with the session client, then pass a service client only to
the write helper. Every service query must constrain the trusted aggregate by
`plan_id`, `user_id`, or an already-validated parent id.

The Prompt 4 `apply_plan_revision_atomic` RPC remains the writer for
`plan_revisions` and related audit history. The two new invariant trigger
functions are `SECURITY INVOKER`; they do not expand the reviewed
`SECURITY DEFINER` allowlist.
