/**
 * Venue hold helper. The planner uses an `agent_action` of `action_type:
 * 'hold_request'` to represent the organizer's intent to lock a venue. Vendor +
 * economics work in the recommend pipeline is gated on the presence of such an
 * action so the system doesn't push vendor cards (or pay for OpenAI economics
 * calls) before a venue is held.
 *
 * "Live" status = anything that isn't a terminal cancel/fail.
 */

type AgentActionsDb = {
  from: (table: 'agent_actions') => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          not: (column: string, op: 'in', value: string) => {
            limit: (count: number) => Promise<{ data: unknown; error: { message?: string } | null }>
          }
        }
      }
    }
  }
}

const TERMINAL_HOLD_STATUSES = "('cancelled','failed')"

export async function hasActiveVenueHold(db: AgentActionsDb, planId: string): Promise<boolean> {
  const { data, error } = await db
    .from('agent_actions')
    .select('id')
    .eq('plan_id', planId)
    .eq('action_type', 'hold_request')
    .not('status', 'in', TERMINAL_HOLD_STATUSES)
    .limit(1)

  if (error) {
    console.error('[planner.venueHold] Active hold lookup error', error)
    return false
  }

  return Array.isArray(data) && data.length > 0
}
