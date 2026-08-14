import fs from 'node:fs'
import path from 'node:path'

function migration(name: string) {
  return fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', name), 'utf8')
}

describe('Prompt 8 retry and cancellation migrations', () => {
  it('extends retry to handoffs while preserving executing as a valid success state', () => {
    const sql = migration('20260709164000_extend_approved_action_handoff_retry.sql')
    expect(sql).toContain('external_checkout')
    expect(sql).toContain('hold_request')
    expect(sql).toContain('vendor_contact')
    expect(sql).toContain('concierge_queue')
    expect(sql).toContain('finalize_approved_action_handoff_retry')
    expect(sql).toContain("p_success_action_status NOT IN ('executing', 'complete')")
    expect(sql).toContain("v_action.status NOT IN ('executing', 'complete')")
    expect(sql).toContain("v_action.payload_json ->> 'kind' = 'vendor_reply_capture'")
    expect(sql).not.toMatch(/v_action\.action_type\s+IN\s*\([^)]*'payment'/s)
    expect(sql).not.toContain("'opportunity_send_venues'")
    expect(sql).not.toContain("'opportunity_send_vendors'")
    expect(sql).not.toContain("'venue_outreach'")
    expect(sql).not.toContain("'vendor_outreach'")
  })

  it('cancels external work atomically without changing the approval status', () => {
    const sql = migration('20260709165000_cancel_external_checkout_handoff.sql')
    expect(sql).toContain('cancel_external_checkout_handoff')
    expect(sql).toContain("v_action.status <> 'executing'")
    expect(sql).toContain("'completion_confirmation_required', false")
    expect(sql).toContain("'external_checkout.host_cancelled'")
    expect(sql).toContain('approval_status')
    expect(sql).not.toMatch(/UPDATE public\.approvals/i)
    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]+TO service_role/)
  })
})
