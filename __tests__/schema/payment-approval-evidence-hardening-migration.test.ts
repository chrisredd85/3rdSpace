import { readFileSync } from 'node:fs'
import path from 'node:path'

const migration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260709113000_harden_payment_approval_execution_evidence.sql'
  ),
  'utf8'
)
const appliedMigration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260709090000_add_payment_intents_capturing_status.sql'
  ),
  'utf8'
)

function reservationFunction(sql: string): string {
  const definition = sql.match(
    /CREATE OR REPLACE FUNCTION public\.reserve_planner_deposit_capture[\s\S]*?\n\$\$;/
  )?.[0]
  if (!definition) {
    throw new Error('reserve_planner_deposit_capture definition not found')
  }
  return definition
}

describe('payment approval evidence hardening migration', () => {
  it('fails closed on incomplete executable-approval evidence', () => {
    expect(migration).toContain("NULLIF(btrim(p_expected_snapshot_hash), '') IS NULL")
    expect(migration).toContain('v_approval.authorized_by IS NULL')
    expect(migration).toContain('v_approval.authorized_at IS NULL')
    expect(migration).toContain("NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL")
    expect(migration).toContain(
      'v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash'
    )
    expect(migration).toContain(
      'v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= now()'
    )
  })

  it('preserves the existing function signature and lock order', () => {
    const signature = [
      'p_payment_intent_id uuid',
      'p_plan_id uuid',
      'p_approval_id uuid',
      'p_expected_snapshot_hash text',
      'p_expected_amount_cents integer',
      'p_expected_partner_kind text',
      'p_expected_partner_id uuid',
      'p_capture_attempt_id uuid',
    ]
    for (const parameter of signature) {
      expect(migration).toContain(parameter)
    }
    expect(migration).toContain(') RETURNS SETOF public.payment_intents')

    const planLock = migration.indexOf('FROM public.plans')
    const approvalLock = migration.indexOf('FROM public.approvals')
    const actionLock = migration.indexOf('FROM public.agent_actions')
    const paymentLock = migration.indexOf('FROM public.payment_intents')
    expect(planLock).toBeGreaterThanOrEqual(0)
    expect(planLock).toBeLessThan(approvalLock)
    expect(approvalLock).toBeLessThan(actionLock)
    expect(actionLock).toBeLessThan(paymentLock)
    expect(migration).toMatch(/FROM public\.plans[\s\S]*?FOR UPDATE;/)
    expect(migration).toMatch(/FROM public\.approvals[\s\S]*?FOR UPDATE;/)
    expect(migration).toMatch(/FROM public\.agent_actions[\s\S]*?FOR UPDATE;/)
    expect(migration).toMatch(/FROM public\.payment_intents[\s\S]*?FOR UPDATE;/)
  })

  it('changes the applied function body only by adding the reviewed evidence guards', () => {
    const expected = reservationFunction(appliedMigration)
      .replace(
        'IF p_capture_attempt_id IS NULL\n',
        "IF p_capture_attempt_id IS NULL\n    OR NULLIF(btrim(p_expected_snapshot_hash), '') IS NULL\n"
      )
      .replace(
        "IF v_approval.status NOT IN ('approved', 'authorized')\n",
        "IF v_approval.status NOT IN ('approved', 'authorized')\n" +
          '    OR v_approval.authorized_by IS NULL\n' +
          '    OR v_approval.authorized_at IS NULL\n' +
          "    OR NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL\n"
      )

    expect(reservationFunction(migration)).toBe(expected)
  })

  it('preserves the prior status, amount, partner, and payment checks', () => {
    expect(migration).toContain("v_approval.status NOT IN ('approved', 'authorized')")
    expect(migration).toContain('v_approval.superseded_at IS NOT NULL')
    expect(migration).toContain('v_approved_amount_cents <> p_expected_amount_cents')
    expect(migration).toContain("v_action.action_type <> 'payment'")
    expect(migration).toContain("v_action.status NOT IN ('approved', 'executing')")
    expect(migration).toContain('v_action.approval_id IS DISTINCT FROM p_approval_id')
    expect(migration).toContain('v_action.target_type IS DISTINCT FROM p_expected_partner_kind')
    expect(migration).toContain('v_action.target_id IS DISTINCT FROM p_expected_partner_id')
    expect(migration).toContain('v_action.amount_cents IS DISTINCT FROM p_expected_amount_cents')
    expect(migration).toContain("v_payment.status NOT IN ('requested', 'authorized')")
    expect(migration).toContain('v_payment.stripe_payment_intent_id IS NULL')
    expect(migration).toContain('v_payment.amount_cents <> p_expected_amount_cents')
    expect(migration).toContain('v_payment.partner_kind <> p_expected_partner_kind')
    expect(migration).toContain('v_payment.partner_id <> p_expected_partner_id')
    expect(migration).toContain(
      'v_payment.platform_fee_cents <> COALESCE(v_approval.fees_cents, 0)'
    )
  })

  it('keeps the function security-definer and service-role only', () => {
    expect(migration).toContain('LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public')
    expect(migration).toContain(
      ') FROM PUBLIC, anon, authenticated;'
    )
    expect(migration).toContain(
      ') TO service_role;'
    )
  })
})
