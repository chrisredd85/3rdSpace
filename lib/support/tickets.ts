export const SUPPORT_CATEGORIES = ['bug', 'question', 'billing', 'account', 'feature_request', 'other'] as const
export const SUPPORT_SEVERITIES = ['low', 'medium', 'high', 'urgent'] as const
export const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

export type SupportCategory = typeof SUPPORT_CATEGORIES[number]
export type SupportSeverity = typeof SUPPORT_SEVERITIES[number]
export type SupportStatus = typeof SUPPORT_STATUSES[number]

export type SupportTicketRow = {
  id: string
  ticket_id: string
  user_id: string | null
  email: string
  name: string | null
  category: SupportCategory
  subject: string
  description: string
  severity: SupportSeverity
  related_plan_id: string | null
  status: SupportStatus
  resolved_at: string | null
  resolved_by: string | null
  resolution_notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type SupportPlanSummary = {
  id: string
  title: string
  status: string | null
  event_type: string | null
  date_window_start?: string | null
  date_window_end?: string | null
}

export function supportCategoryLabel(value: SupportCategory) {
  const labels: Record<SupportCategory, string> = {
    bug: 'Bug',
    question: 'Question',
    billing: 'Billing',
    account: 'Account',
    feature_request: 'Feature request',
    other: 'Other',
  }
  return labels[value]
}

export function supportSeverityLabel(value: SupportSeverity) {
  const labels: Record<SupportSeverity, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    urgent: 'Urgent',
  }
  return labels[value]
}

export function supportStatusLabel(value: SupportStatus) {
  const labels: Record<SupportStatus, string> = {
    open: 'Open',
    in_progress: 'In progress',
    resolved: 'Resolved',
    closed: 'Closed',
  }
  return labels[value]
}
