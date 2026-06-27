import { plannerDraftStorageKey } from '@/lib/planner/migrateDraft'
import type { Plan, PlanMessage } from '@/lib/types'

export const planTabs = [
  { id: 'chat', label: 'Chat' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'data', label: 'Data' },
  { id: 'timeline', label: 'Timeline' },
] as const

export const quickActionChips = [
  { label: 'Add date window', template: 'Date: [June 1-5]' },
  { label: 'Set guest target', template: 'Guest target: ' },
  { label: 'Model profit window', template: 'Model profit for ' },
] as const

export const activeConversationStorageKey = plannerDraftStorageKey

export type PlannerTab = (typeof planTabs)[number]['id']
export type ApprovalUiStatus = 'approved' | 'rejected' | 'superseded'
export type PlannerPersistenceMode = 'loading' | 'server' | 'draft'
export type PendingConversionActionType = 'save' | 'hold' | 'authorize'
export type BillingRequiredHandler = (message?: string | null) => void

export interface PlannerAgentActionRequest {
  actionType: string
  targetType?: string | null
  targetId?: string | null
  payloadJson?: Record<string, unknown> | null
  requestedAmountCents?: number | null
}

export interface PendingConversionAction {
  type: PendingConversionActionType
  payload?: {
    agentAction?: PlannerAgentActionRequest
    approvalId?: string
    authorizedAmountCents?: number
    externalUrl?: string
    reason?: 'recommendations' | string
  }
}

export interface PlannerTemplateSummary {
  id: string
  name: string
  description: string | null
  snapshot: unknown
  created_at: string
}

export interface PlannerTemplateApplyOptions {
  create_new_plan?: boolean
  date_window_start?: string | null
  date_window_end?: string | null
  guest_count?: number | null
  budget_cap_cents?: number | null
  neighborhood?: string | null
  use_same_venue?: boolean
  use_same_vendors?: boolean
}

export interface PlannerAccountSummary {
  email?: string | null
  userType?: string | null
  role?: string | null
  companyName?: string | null
}

export interface EventPlanPayload {
  event_name: string | null
  expected_attendance: number | null
  city: string | null
  venue_type: string | null
  budget: number | null
  event_date: string | null
  monetization_model: string | null
  headcount_min: number | null
  headcount_max: number | null
  ticket_price_target: number | null
  profit_goal: number | null
}

export interface ResponseAnalysisOutput {
  availability_status: 'available' | 'unavailable' | 'tentative' | 'unknown'
  service_type?: string | null
  quoted_price_cents: number | null
  minimum_spend_cents: number | null
  deposit_required_cents: number | null
  availability_notes?: string | null
  capacity_notes: string | null
  included_services: string[]
  exclusions: string[]
  hidden_fees: string[]
  cancellation_terms: string | null
  notes?: string | null
  required_next_steps: string[]
  summary: string
  risk_flags: string[]
  extracted_questions: string[]
}

export interface TimelineMilestone {
  title: string
  due_date: string
  category: string
  is_blocking: boolean
}

export interface TimelineOutput {
  planning_milestones: TimelineMilestone[]
  day_of_timeline: Array<{
    time: string
    activity: string
    owner: string
    notes: string | null
  }>
  staffing_needs: string[]
  reminders: string[]
  dependency_warnings: string[]
  impossible_timeline: boolean
}

export interface PublicDraftIntakeData {
  agent_draft: {
    content: string
    message_type: PlanMessage['message_type']
    metadata: Record<string, unknown>
  }
  plan_patch: Partial<Plan>
}

export type PlannerStateLoadResult =
  | { status: 'unauthorized' }
  | { status: 'loaded'; plan: Plan | null; messages: PlanMessage[] }
