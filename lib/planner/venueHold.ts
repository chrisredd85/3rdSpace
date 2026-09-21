/**
 * Venue hold helper. The planner uses an `agent_action` of `action_type:
 * 'hold_request'` to represent the organizer's intent to lock a venue. Vendor +
 * economics work in the recommend pipeline is gated on the presence of such an
 * action so the system doesn't push vendor cards (or pay for OpenAI economics
 * calls) before a venue is held.
 *
 * A hold is active only after operator completion records `hold_confirmed`.
 * Approval or queue state alone is not evidence that a venue is being held.
 */

type HoldActionQueryResult = {
  data: unknown[] | null
  error: { message?: string } | null
}

type HoldActionQuery = PromiseLike<HoldActionQueryResult> & {
  eq(column: string, value: string): HoldActionQuery
  limit(count: number): Promise<HoldActionQueryResult>
}

type AgentActionsDb = {
  from: (table: 'agent_actions') => {
    select: (columns: string) => HoldActionQuery
  }
}

export async function hasActiveVenueHold(db: AgentActionsDb, planId: string): Promise<boolean> {
  const { data, error } = await db
    .from('agent_actions')
    .select('id,status,result_metadata')
    .eq('plan_id', planId)
    .eq('action_type', 'hold_request')
    .eq('status', 'complete')
    .limit(10)

  if (error) {
    console.error('[planner.venueHold] Active hold lookup error', error)
    return false
  }

  return Array.isArray(data) && data.some((row) => {
    const record = readRecord(row)
    const metadata = readRecord(record?.result_metadata)
    const outcome = readRecord(metadata?.admin_task_outcome)
    return outcome?.outcome === 'hold_confirmed'
  })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
