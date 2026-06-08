import type { AgentActionType } from '@/lib/types/planner'

export const EXECUTION_MODES = [
  'controlled_payment',
  'external_checkout',
  'concierge_admin_queue',
] as const

export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const EXECUTABLE_AGENT_ACTION_TYPES = [
  'payment',
  'external_link',
  'concierge_queue',
  'email',
  'hold',
  'hold_request',
  'vendor_contact',
  'external_checkout',
  'opportunity_send_venues',
  'opportunity_send_vendors',
] as const satisfies readonly AgentActionType[]

export type ExecutableAgentActionType = (typeof EXECUTABLE_AGENT_ACTION_TYPES)[number]

const executionModeSet = new Set<ExecutionMode>(EXECUTION_MODES)
const executableAgentActionSet = new Set<AgentActionType>(EXECUTABLE_AGENT_ACTION_TYPES)
const externalCheckoutProviders = new Set([
  'eventbrite',
  'opentable',
  'partiful',
  'posh',
  'seatgeek',
  'luma',
])

export interface ExecutionModeClassificationInput {
  actionType?: AgentActionType | string | null
  provider?: string | null
  targetType?: string | null
  externalUrl?: string | null
  hasControlledPaymentAccount?: boolean | null
  routeToAdminQueue?: boolean | null
}

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && executionModeSet.has(value as ExecutionMode)
}

export function isExecutableAgentActionType(value: unknown): value is ExecutableAgentActionType {
  return typeof value === 'string' && executableAgentActionSet.has(value as AgentActionType)
}

export function requiresApprovalForAgentAction(actionType: AgentActionType | string | null | undefined): boolean {
  return isExecutableAgentActionType(actionType)
}

/**
 * The product contract has exactly three execution modes. Unknown or unsupported
 * actions default to the admin queue so execution cannot silently bypass approval.
 */
export function classifyExecutionMode(input: ExecutionModeClassificationInput): ExecutionMode {
  const actionType = normalize(input.actionType)
  const provider = normalize(input.provider)
  const targetType = normalize(input.targetType)

  if (
    input.routeToAdminQueue ||
    actionType === 'concierge_queue' ||
    targetType === 'concierge' ||
    targetType === 'admin_task'
  ) {
    return 'concierge_admin_queue'
  }

  if (
    actionType === 'external_checkout' ||
    actionType === 'external_link' ||
    Boolean(input.externalUrl) ||
    (provider !== null && externalCheckoutProviders.has(provider))
  ) {
    return 'external_checkout'
  }

  if (
    input.hasControlledPaymentAccount ||
    actionType === 'payment' ||
    actionType === 'hold'
  ) {
    return 'controlled_payment'
  }

  return 'concierge_admin_queue'
}

function normalize(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null
}
