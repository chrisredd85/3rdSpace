-- Read-only hosted preflight for
-- 20260709130000_server_owned_execution_control_plane.sql.
--
-- Run this in the Supabase SQL editor before applying the migration. The first
-- result set gives counts, the following result sets identify the exact rows,
-- and the final DO block fails closed when any contradiction remains.

BEGIN READ ONLY;

WITH findings AS (
  SELECT
    'multiple_active_approvals'::TEXT AS finding,
    count(*)::BIGINT AS row_count
  FROM (
    SELECT approval.agent_action_id
    FROM public.approvals approval
    WHERE approval.status IN ('pending', 'approved', 'authorized', 're_approval_required')
    GROUP BY approval.agent_action_id
    HAVING count(*) > 1
  ) duplicate_active

  UNION ALL

  SELECT 'approval_action_plan_mismatch', count(*)
  FROM public.approvals approval
  JOIN public.agent_actions action ON action.id = approval.agent_action_id
  WHERE approval.plan_id IS DISTINCT FROM action.plan_id

  UNION ALL

  SELECT 'action_approval_pointer_mismatch', count(*)
  FROM public.agent_actions action
  LEFT JOIN public.approvals approval
    ON approval.id = action.approval_id
   AND approval.agent_action_id = action.id
   AND approval.plan_id = action.plan_id
  WHERE action.approval_id IS NOT NULL
    AND approval.id IS NULL

  UNION ALL

  SELECT 'authorized_above_requested', count(*)
  FROM public.approvals approval
  WHERE approval.authorized_amount_cents IS NOT NULL
    AND approval.authorized_amount_cents > approval.requested_amount_cents

  UNION ALL

  SELECT 'invalid_executable_approval', count(*)
  FROM public.approvals approval
  WHERE approval.status IN ('approved', 'authorized')
    AND (
      approval.authorized_by IS NULL
      OR approval.authorized_at IS NULL
      OR NULLIF(btrim(approval.snapshot_hash), '') IS NULL
      OR (approval.expires_at IS NOT NULL AND approval.expires_at <= transaction_timestamp())
    )

  UNION ALL

  SELECT 'payment_missing_approval', count(*)
  FROM public.payment_intents payment
  LEFT JOIN public.approvals approval ON approval.id = payment.approval_id
  WHERE approval.id IS NULL

  UNION ALL

  SELECT 'payment_approval_plan_mismatch', count(*)
  FROM public.payment_intents payment
  JOIN public.approvals approval ON approval.id = payment.approval_id
  WHERE payment.plan_id IS DISTINCT FROM approval.plan_id

  UNION ALL

  SELECT 'settlement_missing_approval', count(*)
  FROM public.settlement_charges charge
  LEFT JOIN public.approvals approval ON approval.id = charge.approval_id
  WHERE charge.approval_id IS NOT NULL
    AND approval.id IS NULL

  UNION ALL

  SELECT 'settlement_approval_run_mismatch', count(*)
  FROM public.settlement_charges charge
  JOIN public.approvals approval ON approval.id = charge.approval_id
  WHERE charge.approval_id IS NOT NULL
    AND charge.settlement_run_id IS DISTINCT FROM approval.settlement_run_id
)
SELECT finding, row_count
FROM findings
ORDER BY finding;

SELECT
  approval.agent_action_id,
  array_agg(approval.id ORDER BY approval.created_at) AS approval_ids,
  array_agg(approval.status ORDER BY approval.created_at) AS statuses
FROM public.approvals approval
WHERE approval.status IN ('pending', 'approved', 'authorized', 're_approval_required')
GROUP BY approval.agent_action_id
HAVING count(*) > 1
ORDER BY approval.agent_action_id;

SELECT
  approval.id AS approval_id,
  approval.plan_id AS approval_plan_id,
  action.id AS action_id,
  action.plan_id AS action_plan_id
FROM public.approvals approval
JOIN public.agent_actions action ON action.id = approval.agent_action_id
WHERE approval.plan_id IS DISTINCT FROM action.plan_id
ORDER BY approval.id;

SELECT
  action.id AS action_id,
  action.plan_id AS action_plan_id,
  action.approval_id,
  approval.agent_action_id AS approval_action_id,
  approval.plan_id AS approval_plan_id
FROM public.agent_actions action
LEFT JOIN public.approvals approval ON approval.id = action.approval_id
WHERE action.approval_id IS NOT NULL
  AND (
    approval.id IS NULL
    OR approval.agent_action_id IS DISTINCT FROM action.id
    OR approval.plan_id IS DISTINCT FROM action.plan_id
  )
ORDER BY action.id;

SELECT
  approval.id,
  approval.plan_id,
  approval.agent_action_id,
  approval.status,
  approval.requested_amount_cents,
  approval.authorized_amount_cents,
  approval.authorized_by,
  approval.authorized_at,
  approval.snapshot_hash,
  approval.expires_at
FROM public.approvals approval
WHERE (
    approval.authorized_amount_cents IS NOT NULL
    AND approval.authorized_amount_cents > approval.requested_amount_cents
  )
  OR (
    approval.status IN ('approved', 'authorized')
    AND (
      approval.authorized_by IS NULL
      OR approval.authorized_at IS NULL
      OR NULLIF(btrim(approval.snapshot_hash), '') IS NULL
      OR (approval.expires_at IS NOT NULL AND approval.expires_at <= transaction_timestamp())
    )
  )
ORDER BY approval.created_at, approval.id;

SELECT
  payment.id AS payment_intent_id,
  payment.plan_id AS payment_plan_id,
  payment.approval_id,
  approval.plan_id AS approval_plan_id
FROM public.payment_intents payment
LEFT JOIN public.approvals approval ON approval.id = payment.approval_id
WHERE approval.id IS NULL
  OR payment.plan_id IS DISTINCT FROM approval.plan_id
ORDER BY payment.id;

SELECT
  charge.id AS settlement_charge_id,
  charge.settlement_run_id AS charge_run_id,
  charge.approval_id,
  approval.settlement_run_id AS approval_run_id
FROM public.settlement_charges charge
LEFT JOIN public.approvals approval ON approval.id = charge.approval_id
WHERE charge.approval_id IS NOT NULL
  AND (
    approval.id IS NULL
    OR charge.settlement_run_id IS DISTINCT FROM approval.settlement_run_id
  )
ORDER BY charge.id;

DO $assert_clean$
DECLARE
  v_total BIGINT;
BEGIN
  SELECT
    (
      SELECT count(*)
      FROM (
        SELECT agent_action_id
        FROM public.approvals
        WHERE status IN ('pending', 'approved', 'authorized', 're_approval_required')
        GROUP BY agent_action_id
        HAVING count(*) > 1
      ) duplicate_active
    )
    + (
      SELECT count(*)
      FROM public.approvals approval
      JOIN public.agent_actions action ON action.id = approval.agent_action_id
      WHERE approval.plan_id IS DISTINCT FROM action.plan_id
    )
    + (
      SELECT count(*)
      FROM public.agent_actions action
      LEFT JOIN public.approvals approval
        ON approval.id = action.approval_id
       AND approval.agent_action_id = action.id
       AND approval.plan_id = action.plan_id
      WHERE action.approval_id IS NOT NULL AND approval.id IS NULL
    )
    + (
      SELECT count(*)
      FROM public.approvals
      WHERE authorized_amount_cents IS NOT NULL
        AND authorized_amount_cents > requested_amount_cents
    )
    + (
      SELECT count(*)
      FROM public.approvals
      WHERE status IN ('approved', 'authorized')
        AND (
          authorized_by IS NULL
          OR authorized_at IS NULL
          OR NULLIF(btrim(snapshot_hash), '') IS NULL
          OR (expires_at IS NOT NULL AND expires_at <= transaction_timestamp())
        )
    )
    + (
      SELECT count(*)
      FROM public.payment_intents payment
      LEFT JOIN public.approvals approval ON approval.id = payment.approval_id
      WHERE approval.id IS NULL
        OR payment.plan_id IS DISTINCT FROM approval.plan_id
    )
    + (
      SELECT count(*)
      FROM public.settlement_charges charge
      LEFT JOIN public.approvals approval ON approval.id = charge.approval_id
      WHERE charge.approval_id IS NOT NULL
        AND (
          approval.id IS NULL
          OR charge.settlement_run_id IS DISTINCT FROM approval.settlement_run_id
        )
    )
  INTO v_total;

  IF v_total > 0 THEN
    RAISE EXCEPTION 'Server-owned execution preflight failed with % contradiction(s). Review the preceding result sets; do not apply the migration.', v_total;
  END IF;

  RAISE NOTICE 'Server-owned execution preflight passed with zero contradictions.';
END;
$assert_clean$;

ROLLBACK;
