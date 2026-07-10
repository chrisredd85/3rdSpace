import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260709160000_complete_concierge_execution.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8')

describe('concierge execution migration', () => {
  it('links one idempotent admin task to the approved action and canonical event', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS agent_action_id UUID/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS approval_id UUID/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS event_id UUID/i)
    expect(sql).toMatch(/CREATE UNIQUE INDEX admin_tasks_agent_action_unique/i)
    expect(sql).toMatch(/FOREIGN KEY \(agent_action_id, plan_id\)[\s\S]*REFERENCES public\.agent_actions\(id, plan_id\)/i)
    expect(sql).toMatch(/admin_task_action_approval_plan_mismatch/i)
    expect(sql).toMatch(/admin_task_canonical_event_mismatch/i)
    expect(sql).toMatch(/ON CONFLICT \(agent_action_id\) WHERE agent_action_id IS NOT NULL[\s\S]*DO NOTHING/i)
    expect(sql).toMatch(/IF v_action\.status = 'approved' THEN[\s\S]*SET status = 'executing'/i)
  })

  it('keeps queue, completion, cancellation, and vendor draft commands service-only', () => {
    for (const functionName of [
      'enqueue_approved_admin_task',
      'prepare_approved_vendor_contact_draft',
      'complete_admin_task_execution',
      'cancel_admin_task_execution',
      'cancel_approved_admin_task',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`))
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM PUBLIC, anon, authenticated`))
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]*TO service_role`))
    }
  })

  it('writes only structured hold outcomes and never treats a soft hold as a booking', () => {
    expect(sql).toMatch(/latest_venue_hold_outcome JSONB/i)
    expect(sql).toMatch(/protect_venue_hold_outcome/i)
    expect(sql).toMatch(/'hold_confirmed', 'venue_unavailable'/i)
    expect(sql).toMatch(/Changed hold terms require a new approval version/i)
    expect(sql).not.toMatch(/SET\s+venue_confirmed\s*=\s*true/i)
    expect(sql).not.toMatch(/INSERT INTO public\.(venue_bookings|vendor_bookings|payment_intents)/i)
  })

  it('creates vendor work as an unsent draft requiring a separate send approval', () => {
    expect(sql).toMatch(/'draft_kind', 'vendor_contact'/i)
    expect(sql).toMatch(/'approval_required_for_send', true/i)
    expect(sql).toMatch(/'outbound_message_sent', false/i)
    expect(sql).toMatch(/delivery_status[\s\S]*NULL/i)
    expect(sql).not.toMatch(/gmail_message_id\s*=|sendOpportunityEmail|gmail\.users\.messages\.send/i)
  })

  it('records host messages without copying internal notes into their content', () => {
    expect(sql).toMatch(/left\(v_host_message, 1000\)/i)
    expect(sql).toMatch(/p_internal_note/i)
    expect(sql).not.toMatch(/content\s*,?[\s\S]{0,120}p_internal_note/i)
  })

  it('atomically projects operator completion into action and host-visible state', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_admin_task_execution/i)
    expect(sql).toMatch(/SET status = 'complete',[\s\S]*executed_at = v_now/i)
    expect(sql).toMatch(/SET latest_venue_hold_outcome = v_hold_outcome/i)
    expect(sql).toMatch(/INSERT INTO public\.plan_messages[\s\S]*'concierge_task_completed'/i)
    expect(sql).toMatch(/'admin_task_outcome', v_public_outcome/i)
  })

  it('cancels approved or executing action work without a send, booking, or payment', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.cancel_approved_admin_task/i)
    expect(sql).toMatch(/task_row\.agent_action_id = p_action_id[\s\S]*task_row\.approval_id = p_approval_id/i)
    expect(sql).toMatch(/v_action\.status NOT IN \('approved', 'executing', 'cancelled'\)/i)
    expect(sql).toMatch(/SET status = 'cancelled',[\s\S]*'handoff_status', 'cancelled'/i)
    expect(sql).toMatch(/'concierge_task_cancelled'/i)
    expect(sql).toMatch(/Nothing was sent, booked, or paid/i)
  })
})
