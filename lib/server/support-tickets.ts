import 'server-only'

import { sendResendEmail } from '@/lib/email'
import {
  supportCategoryLabel,
  supportSeverityLabel,
  type SupportCategory,
  type SupportPlanSummary,
  type SupportSeverity,
} from '@/lib/support/tickets'

export type { SupportCategory, SupportPlanSummary, SupportSeverity, SupportStatus, SupportTicketRow } from '@/lib/support/tickets'

export function generateSupportTicketId(now = new Date()) {
  return `TKT-${now.getTime().toString(36).toUpperCase()}`
}

export async function sendSupportTicketEmail(params: {
  ticketId: string
  category: SupportCategory
  severity: SupportSeverity
  subject: string
  description: string
  email: string
  name?: string | null
  userId?: string | null
  relatedPlan?: SupportPlanSummary | null
  metadata?: Record<string, unknown>
}) {
  const to = process.env.SUPPORT_INBOX_EMAIL || 'support@3rdplace.io'
  const from = process.env.SUPPORT_FROM_EMAIL || process.env.NOTIFICATIONS_FROM_EMAIL || process.env.RESEND_FROM_EMAIL
  const contextLines = [
    `Ticket: ${params.ticketId}`,
    `Category: ${supportCategoryLabel(params.category)}`,
    `Severity: ${supportSeverityLabel(params.severity)}`,
    `From: ${params.name ? `${params.name} <${params.email}>` : params.email}`,
    `User ID: ${params.userId ?? 'Unauthenticated'}`,
    `Plan: ${formatPlanSummary(params.relatedPlan)}`,
    `Submitted: ${new Date().toISOString()}`,
  ]

  const text = [
    contextLines.join('\n'),
    '',
    'Subject:',
    params.subject,
    '',
    'Description:',
    params.description,
  ].join('\n')

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#241f1c;line-height:1.55">
      <p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#c85f3f;font-weight:700">3rdPlace support ticket</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;margin:0 0 16px">${escapeHtml(params.subject)}</h1>
      <table style="border-collapse:collapse;margin-bottom:20px">
        ${contextLines.map((line) => {
          const [key, ...rest] = line.split(': ')
          return `<tr><td style="padding:4px 12px 4px 0;color:#7f746c;font-weight:700">${escapeHtml(key)}</td><td style="padding:4px 0">${escapeHtml(rest.join(': '))}</td></tr>`
        }).join('')}
      </table>
      <div style="white-space:pre-wrap;border:1px solid #e0d6ca;background:#fbf7ef;padding:16px;border-radius:8px">${escapeHtml(params.description)}</div>
    </div>
  `

  return sendResendEmail({
    to,
    from: from ?? '',
    subject: `[${params.ticketId}] ${supportSeverityLabel(params.severity)} ${supportCategoryLabel(params.category)} - ${params.subject}`,
    text,
    html,
  })
}

function formatPlanSummary(plan: SupportPlanSummary | null | undefined) {
  if (!plan) return 'None'
  return [
    plan.title,
    plan.event_type ? `type=${plan.event_type}` : null,
    plan.status ? `status=${plan.status}` : null,
    plan.date_window_start ? `starts=${plan.date_window_start}` : null,
  ].filter(Boolean).join(' | ')
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
