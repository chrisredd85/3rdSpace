import fs from 'node:fs'
import path from 'node:path'

describe('write-pause migration contract', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260709100000_add_write_pause_control.sql'),
    'utf8',
  )
  const operatorScript = fs.readFileSync(
    path.join(process.cwd(), 'scripts/release/toggle-write-pause.sh'),
    'utf8',
  )

  it('uses an RLS-protected durable singleton with atomic revisions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.release_runtime_controls')
    expect(sql).toContain("CHECK (control_key = 'write_pause')")
    expect(sql).toContain('NEW.revision := OLD.revision + 1')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE public.release_runtime_controls')
    expect(sql).toContain("CHECK (state IN ('open', 'paused', 'draining'))")
    expect(sql).toContain("NEW.enabled := NEW.state <> 'open'")
  })

  it('adds a durable, indexed Stripe maintenance queue state', () => {
    expect(sql).toContain('maintenance_deferred_at TIMESTAMPTZ')
    expect(sql).toContain("'deferred_maintenance'")
    expect(sql).toContain('idx_stripe_webhook_events_maintenance_deferred')
    expect(sql).toContain('AND processed IS FALSE')
    expect(sql).toContain('reservation_token UUID')
  })

  it('serializes draining deliveries with the final zero-to-open decision', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.transition_release_runtime_control(')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.complete_write_pause_drain(')
    expect(sql).toMatch(/complete_write_pause_drain[\s\S]*?FOR UPDATE;[\s\S]*?maintenance_deferred_at IS NOT NULL[\s\S]*?in_flight IS TRUE[\s\S]*?SET state = 'open'/)
    expect(sql).toMatch(/reserve_stripe_webhook_event\([\s\S]*?p_replay_authorized BOOLEAN[\s\S]*?FOR SHARE;/)
    expect(sql).toContain("v_control_state IN ('paused', 'draining')")
    expect(sql).toContain("MESSAGE = 'authorized webhook replay requires draining state'")
    expect(sql).toContain("'code', 'queue_not_empty'")
  })

  it('fences webhook owners and reclaims only leases at least five minutes old', () => {
    expect(sql).toContain('p_reservation_token UUID')
    expect(sql).toContain('swe.reservation_token = p_reservation_token')
    expect(sql).toContain('SET reservation_token = NULL')
    expect(sql).toContain("p_older_than < INTERVAL '5 minutes'")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.defer_stripe_webhook_for_maintenance(')
    expect(sql).toMatch(/record_stripe_webhook_event_result\([\s\S]*?p_reservation_token UUID[\s\S]*?SECURITY INVOKER/)
    expect(sql).toMatch(/defer_stripe_webhook_for_maintenance\([\s\S]*?SECURITY INVOKER/)
  })

  it('keeps the six-argument schema-first caller from owning deferred work', () => {
    expect(sql).toMatch(
      /CASE WHEN v_reservation\.deferred THEN true ELSE COALESCE\(v_reservation\.in_flight, false\) END,[\s\S]*?CASE WHEN v_reservation\.deferred THEN false ELSE COALESCE\(v_reservation\.reserved_now, false\) END/,
    )
  })

  it('does not expand the privileged-function allowlist for new control RPCs', () => {
    expect(sql).toMatch(/transition_release_runtime_control\([\s\S]*?SECURITY INVOKER/)
    expect(sql).toMatch(/complete_write_pause_drain\([\s\S]*?SECURITY INVOKER/)
    expect(sql).toMatch(/p_replay_authorized BOOLEAN[\s\S]*?SECURITY INVOKER/)
  })

  it('drains without a fixed event cap, honors the stale lease, and re-pauses on failure', () => {
    expect(operatorScript).toContain('WRITE_PAUSE_DRAIN_TIMEOUT_SECONDS:-900')
    expect(operatorScript).not.toContain('attempts >= 20')
    expect(operatorScript).toContain('set_state draining')
    expect(operatorScript).toContain('set_state open')
    expect(operatorScript).toContain('repause_after_failure')
    expect(operatorScript).toContain("transition_code' <<<\"$finalized\")\" != 'queue_not_empty'")
  })

  it('blocks legacy direct database writes before browser grants are removed', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reject_write_during_release_pause()')
    expect(sql).toContain("RAISE SQLSTATE 'PGRST'")
    expect(sql).toContain('{"status":503')
    expect(sql).toContain("'plans'")
    expect(sql).toContain("'approvals'")
    expect(sql).toContain("'payment_intents'")
    expect(sql).toContain("'venue_bookings'")
    expect(sql).toContain("'partnership_threads'")
    expect(sql).toContain("'partnership_messages'")
    expect(sql).toContain("'partnership_milestones'")
    expect(sql).toContain("'partnership_documents'")
    expect(sql).toContain("'event_financial_summary'")
    expect(sql).toContain('FOR EACH STATEMENT EXECUTE FUNCTION public.reject_write_during_release_pause()')
  })
})
