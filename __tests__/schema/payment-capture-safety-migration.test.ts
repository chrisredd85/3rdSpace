import { readFileSync } from 'node:fs'
import path from 'node:path'

const migration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260709090000_add_payment_intents_capturing_status.sql'
  ),
  'utf8'
)

describe('planner payment capture safety migration', () => {
  it('blocks pending partner payments and resolves venue owner accounts to venue ids', () => {
    expect(migration).toContain("WHERE status IN ('pending', 'requested', 'authorized')")
    expect(migration).toContain('v_venue_ids uuid[]')
    expect(migration).toContain('FROM public.venues')
    expect(migration).toContain('WHERE owner_id = ANY(v_venue_owner_ids)')
    expect(migration).toContain("partner_kind = 'venue' AND partner_id = ANY(v_venue_ids)")
  })

  it('keeps blocked, refunded, and unknown-refund rows in the approval uniqueness guard', () => {
    const index = migration.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_approval[\s\S]*?;/
    )?.[0]
    expect(index).toContain("'blocked_by_account_state'")
    expect(index).toContain("'refunded'")
    expect(index).toContain("'refund_reconciliation_required'")
  })

  it('enforces server-safe fee and cumulative refund constraints', () => {
    expect(migration).toContain(
      'CHECK (platform_fee_cents >= 0 AND platform_fee_cents <= amount_cents)'
    )
    expect(migration).toContain(
      'CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents)'
    )
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.apply_planner_deposit_refund')
    expect(migration).toContain('GREATEST(\n    v_previous_refund')
    expect(migration).toContain("SET status = 'reversal_required'")
  })

  it('preflights hosted fee and approval conflicts before adding stricter guards', () => {
    expect(migration).toContain('platform_fee_cents > amount_cents')
    expect(migration).toContain(
      'payment capture safety preflight failed: % payment_intents have platform_fee_cents outside 0..amount_cents'
    )
    expect(migration).toContain('HAVING COUNT(*) > 1')
    expect(migration).toContain(
      'payment capture safety preflight failed: % approval(s) have multiple active/refunded payment_intents'
    )
    expect(migration).toContain("status IN ('captured', 'refunded')")
    expect(migration).toContain(
      'payment capture safety preflight failed: % captured/refunded payment_intents have zero amount_cents and require repair'
    )
  })

  it('keeps one cumulative refund-reversal task and never reopens it for stale truth', () => {
    const reversalIndex = migration.match(
      /CREATE UNIQUE INDEX admin_tasks_one_payment_refund_reversal[\s\S]*?;/
    )?.[0]
    expect(reversalIndex).toContain("WHERE task_type = 'payment_refund_reversal'")
    expect(reversalIndex).not.toContain('status IN')
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.sync_planner_refund_reversal_task'
    )
    expect(migration).toContain(
      'IF p_refunded_amount_cents <= v_recorded_refund THEN'
    )
    expect(migration).toContain(
      'IF v_effective_refund > v_previous_refund THEN'
    )
    expect(migration).toContain(
      "WHEN status IN ('complete', 'cancelled') THEN 'open'"
    )

    const payoutFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.ensure_planner_deposit_payout[\s\S]*?\n\$\$;/
    )?.[0]
    const refundFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.apply_planner_deposit_refund[\s\S]*?\n\$\$;/
    )?.[0]
    expect(payoutFunction).toContain('FOR UPDATE')
    expect(refundFunction).toContain('FOR UPDATE')
  })

  it('atomically revalidates approval truth before reserving capture', () => {
    const reservationFunction = migration.match(
      /CREATE OR REPLACE FUNCTION public\.reserve_planner_deposit_capture[\s\S]*?\n\$\$;/
    )?.[0]
    expect(reservationFunction).toBeDefined()
    const planLock = reservationFunction!.indexOf('FROM public.plans')
    const approvalLock = reservationFunction!.indexOf('FROM public.approvals')
    const actionLock = reservationFunction!.indexOf('FROM public.agent_actions')
    const paymentLock = reservationFunction!.indexOf('FROM public.payment_intents')
    expect(planLock).toBeGreaterThanOrEqual(0)
    expect(planLock).toBeLessThan(approvalLock)
    expect(approvalLock).toBeLessThan(actionLock)
    expect(actionLock).toBeLessThan(paymentLock)
    expect(reservationFunction).toMatch(/FROM public\.plans[\s\S]*?FOR UPDATE;/)
    expect(reservationFunction).toMatch(/FROM public\.approvals[\s\S]*?FOR UPDATE;/)
    expect(reservationFunction).toMatch(/FROM public\.agent_actions[\s\S]*?FOR UPDATE;/)
    expect(reservationFunction).toMatch(/FROM public\.payment_intents[\s\S]*?FOR UPDATE;/)
    expect(reservationFunction).toContain("v_approval.status NOT IN ('approved', 'authorized')")
    expect(reservationFunction).toContain('v_approval.expires_at <= now()')
    expect(reservationFunction).toContain(
      'v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash'
    )
    expect(reservationFunction).toContain("v_action.status NOT IN ('approved', 'executing')")
    expect(reservationFunction).toContain("status = 'capturing'")
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.reserve_planner_deposit_capture('
    )
  })

  it('turns the deployed status-only refund write into durable unknown work', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.preserve_unknown_planner_refund_truth()'
    )
    expect(migration).toContain("NEW.status = 'refunded'")
    expect(migration).toContain(
      "NEW.status := 'refund_reconciliation_required'"
    )
    expect(migration).toContain(
      "v_payment.status NOT IN ('captured', 'refunded', 'refund_reconciliation_required')"
    )
  })

  it('limits money-state RPCs to the service role', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.apply_planner_deposit_refund(text, integer, integer, text, text, boolean)'
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.ensure_planner_deposit_payout(uuid)'
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.unblock_stripe_account_settlements(text, text)'
    )
    expect(migration).toContain(
      ') FROM PUBLIC, anon, authenticated, service_role;'
    )
  })
})
