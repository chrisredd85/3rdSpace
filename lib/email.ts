import 'server-only'

import { centsToDollars, dollarsToCents } from '@/lib/money'

export type EmailTemplateType =
  | 'new_booking'
  | 'booking_approved'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'new_message'
  | 'payment_received'
  | 'invoice_sent'
  | 'payment_due'
  | 'review_received'
  | 'review_request'
  | 'generic'

export type EmailNotificationParams = {
  to: string
  subject: string
  body: string
  actionUrl?: string
  templateType?: EmailTemplateType
}

export type ResendEmailAttachment = {
  filename: string
  content: Buffer | string
}

export type ResendEmailParams = {
  to: string | string[]
  from: string
  subject: string
  html: string
  text?: string
  attachments?: ResendEmailAttachment[]
}

export async function sendResendEmail(params: ResendEmailParams) {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey || !params.from) {
    return {
      sent: false,
      reason: 'Email provider is not configured. Set RESEND_API_KEY and a verified from email.',
      responsePayload: null,
    }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.attachments?.length
        ? {
            attachments: params.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: Buffer.isBuffer(attachment.content)
                ? attachment.content.toString('base64')
                : attachment.content,
            })),
          }
        : {}),
    }),
  })

  const responseText = await response.text()
  const responsePayload = parseJson(responseText) ?? { body: responseText }

  if (!response.ok) {
    throw new Error(responseText || 'Email provider rejected the email')
  }

  return { sent: true, reason: null, responsePayload }
}

/**
 * Sends a templated notification email through Resend when configured.
 */
export async function sendEmailNotification(params: EmailNotificationParams) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATIONS_FROM_EMAIL || process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    console.log('[notifications.email] Email provider is not configured', {
      to: params.to,
      subject: params.subject,
      body: params.body,
      actionUrl: params.actionUrl,
    })
    return {
      sent: false,
      reason: 'Email provider is not configured. Set RESEND_API_KEY and NOTIFICATIONS_FROM_EMAIL.',
    }
  }

  return sendResendEmail({
    from,
    to: params.to,
    subject: params.subject,
    html: buildNotificationEmailHtml(params),
  })
}

// ─────────────────────────────────────────────────────────────────────
// Kickback settlement notifications (Phase 1 rev share PR)
// ─────────────────────────────────────────────────────────────────────

type KickbackNotificationPayment = {
  id: string
  agreement_id: string | null
  event_id: string | null
  payer_id: string | null
  recipient_id: string | null
  amount: number | string | null
  amount_cents?: number | string | null
  processing_fee_cents?: number | string | null
  builder_payout_cents?: number | string | null
  invoice_hosted_url?: string | null
  due_date?: string | null
  refund_amount_cents?: number | string | null
  refund_reason?: string | null
  status?: string | null
}

type KickbackNotificationAgreement = {
  id: string
  event_id: string | null
  plan_id?: string | null
  venue_id: string | null
  reported_revenue_cents?: number | string | null
  bar_revenue_share_percent?: number | string | null
  ticket_revenue_share_percent?: number | string | null
  lift_share_percentage?: number | string | null
  per_head_amount?: number | string | null
}

type KickbackNotificationContext = {
  payment: KickbackNotificationPayment
  agreement: KickbackNotificationAgreement | null
  eventTitle: string
  eventDate: string | null
  venueName: string
  venueEmail: string | null
  builderName: string
  builderEmail: string | null
  reportedRevenueCents: number
  principalCents: number
  processingFeeCents: number
  builderPayoutCents: number
  refundAmountCents: number
  invoiceUrl: string | null
  dueDate: string | null
  settlementSource: string
}

export async function sendVenueInvoiceEmail({ paymentId }: { paymentId: string }) {
  const context = await loadKickbackNotificationContext(paymentId)
  if (!context.venueEmail) return skippedEmail('Venue email not found')

  const totalDueCents = context.principalCents + context.processingFeeCents
  return sendEmailNotification({
    to: context.venueEmail,
    subject: `Payment due - Revenue share for ${context.eventTitle}`,
    templateType: 'payment_due',
    actionUrl: context.invoiceUrl ?? buildAppUrl('/venue/payouts'),
    body: [
      `Hi ${context.venueName},`,
      `${context.builderName}'s event "${context.eventTitle}"${formatOptionalDate(context.eventDate)} generated ${formatMoney(context.reportedRevenueCents)} in reported venue revenue.`,
      `Based on your ${context.settlementSource}, the amount owed is ${formatMoney(context.principalCents)}.`,
      `With ACH processing fee: ${formatMoney(totalDueCents)}.`,
      `Due: ${formatOptionalDueDate(context.dueDate)}.`,
      'You can pay from the Stripe-hosted invoice or from your venue dashboard.',
    ].join('\n\n'),
  })
}

export async function sendBuilderPaidEmail({ paymentId }: { paymentId: string }) {
  const context = await loadKickbackNotificationContext(paymentId)
  if (!context.builderEmail) return skippedEmail('Builder email not found')

  return sendEmailNotification({
    to: context.builderEmail,
    subject: `You received ${formatMoney(context.builderPayoutCents)} from ${context.venueName}`,
    templateType: 'payment_received',
    actionUrl: buildAppUrl('/planner/payments'),
    body: [
      `Hi ${context.builderName},`,
      `${context.venueName} just paid the revenue share for your event "${context.eventTitle}".`,
      `Amount: ${formatMoney(context.builderPayoutCents)}.`,
      `Source: ${context.settlementSource}${context.reportedRevenueCents > 0 ? ` on ${formatMoney(context.reportedRevenueCents)} reported by the venue` : ''}.`,
      'Status: transferred to your connected Stripe account.',
    ].join('\n\n'),
  })
}

export async function sendVenuePaymentFailedEmail({ paymentId }: { paymentId: string }) {
  const context = await loadKickbackNotificationContext(paymentId)
  if (!context.venueEmail) return skippedEmail('Venue email not found')

  const totalDueCents = context.principalCents + context.processingFeeCents
  return sendEmailNotification({
    to: context.venueEmail,
    subject: `Payment did not go through - ${context.eventTitle}`,
    templateType: 'payment_due',
    actionUrl: context.invoiceUrl ?? buildAppUrl('/venue/payouts'),
    body: [
      `Hi ${context.venueName},`,
      `The payment for ${context.eventTitle} revenue share (${formatMoney(totalDueCents)}) did not process.`,
      'This usually happens with an expired card or insufficient ACH funds.',
      'Please retry from the invoice link or your venue dashboard.',
    ].join('\n\n'),
  })
}

export async function sendBuilderRefundRequestEmail({ paymentId }: { paymentId: string }) {
  const context = await loadKickbackNotificationContext(paymentId)
  if (!context.builderEmail) return skippedEmail('Builder email not found')

  return sendEmailNotification({
    to: context.builderEmail,
    subject: `Refund requested for ${context.eventTitle}: ${formatMoney(context.refundAmountCents)}`,
    templateType: 'payment_due',
    actionUrl: buildAppUrl('/planner/payments'),
    body: [
      `Hi ${context.builderName},`,
      `${context.venueName} requested a refund for "${context.eventTitle}".`,
      `Requested amount: ${formatMoney(context.refundAmountCents)}.`,
      `Reason: ${context.payment.refund_reason || 'No reason provided.'}`,
      'Review the request in your planner payments page.',
    ].join('\n\n'),
  })
}

export async function sendVenueRefundDeniedEmail({
  paymentId,
  builderNote,
}: {
  paymentId: string
  builderNote?: string | null
}) {
  const context = await loadKickbackNotificationContext(paymentId)
  if (!context.venueEmail) return skippedEmail('Venue email not found')

  return sendEmailNotification({
    to: context.venueEmail,
    subject: `Refund request declined - ${context.eventTitle}`,
    templateType: 'payment_due',
    actionUrl: buildAppUrl('/venue/payouts'),
    body: [
      `Hi ${context.venueName},`,
      `Your refund request for "${context.eventTitle}" was declined.`,
      builderNote ? `Builder note: ${builderNote}` : 'No builder note was included.',
    ].join('\n\n'),
  })
}

export async function sendRefundCompletedEmail({
  paymentId,
  isFullRefund,
}: {
  paymentId: string
  isFullRefund: boolean
}) {
  const context = await loadKickbackNotificationContext(paymentId)
  const recipients = [context.venueEmail, context.builderEmail].filter(Boolean) as string[]
  if (recipients.length === 0) return skippedEmail('No refund notification recipients found')

  const body = [
    `The ${isFullRefund ? 'full' : 'partial'} refund for "${context.eventTitle}" has completed.`,
    `Refund amount: ${formatMoney(context.refundAmountCents)}.`,
    'The processing fee was not refunded.',
  ].join('\n\n')

  const results = await Promise.all(
    recipients.map((to) =>
      sendEmailNotification({
        to,
        subject: `${isFullRefund ? 'Full' : 'Partial'} refund completed - ${context.eventTitle}`,
        templateType: 'payment_received',
        actionUrl: buildAppUrl('/planner/payments'),
        body,
      })
    )
  )

  return {
    sent: results.some((result) => result.sent),
    reason: results.every((result) => !result.sent) ? results[0]?.reason ?? 'Refund emails were not sent' : null,
    responsePayload: results,
  }
}

export async function sendVenueOverdueWarningEmail({
  venueId,
  overdueCount,
}: {
  venueId: string
  overdueCount: number
}) {
  const admin = await createKickbackEmailAdminClient()
  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, venue_name, contact_email, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) throw new Error(venueError.message ?? 'Failed to load venue')
  if (!venue) return skippedEmail('Venue not found')

  const ownerId = (venue as any).owner_id
  const owner = ownerId ? await loadUserEmail(admin, ownerId) : null
  const to = (venue as any).contact_email || owner?.email || null
  if (!to) return skippedEmail('Venue email not found')

  const venueName = (venue as any).venue_name || owner?.name || 'there'
  const subject =
    overdueCount >= 3
      ? 'Bookings paused - submit overdue revenue reports to re-enable'
      : overdueCount === 2
        ? 'Second reminder - 2 overdue revenue reports'
        : 'Reminder - please submit your revenue report'

  return sendEmailNotification({
    to,
    subject,
    templateType: 'payment_due',
    actionUrl: buildAppUrl('/venue/payouts'),
    body: [
      `Hi ${venueName},`,
      `You have ${overdueCount} overdue revenue ${overdueCount === 1 ? 'report' : 'reports'}.`,
      overdueCount >= 3
        ? 'New bookings are paused until the overdue reports are submitted.'
        : overdueCount === 2
          ? 'One more overdue report will pause new bookings.'
          : 'Please submit the report from your venue dashboard.',
      'Submitting the revenue report re-enables booking eligibility automatically once you are below the threshold.',
    ].join('\n\n'),
  })
}

async function loadKickbackNotificationContext(paymentId: string): Promise<KickbackNotificationContext> {
  const admin = await createKickbackEmailAdminClient()
  const { data: payment, error: paymentError } = await admin
    .from('kickback_payments')
    .select(
      [
        'id',
        'agreement_id',
        'event_id',
        'payer_id',
        'recipient_id',
        'amount',
        'amount_cents',
        'processing_fee_cents',
        'builder_payout_cents',
        'invoice_hosted_url',
        'due_date',
        'refund_amount_cents',
        'refund_reason',
        'status',
      ].join(', ')
    )
    .eq('id', paymentId)
    .maybeSingle()

  if (paymentError) throw new Error(paymentError.message ?? 'Failed to load kickback payment')
  if (!payment) throw new Error('Kickback payment not found')

  const typedPayment = payment as KickbackNotificationPayment
  const agreement = typedPayment.agreement_id
    ? await loadKickbackAgreement(admin, typedPayment.agreement_id)
    : null
  const venue = agreement?.venue_id ? await loadVenue(admin, agreement.venue_id) : null
  const venueOwnerId = (venue as any)?.owner_id || typedPayment.payer_id
  const venueOwner = venueOwnerId ? await loadUserEmail(admin, venueOwnerId) : null
  const builder = typedPayment.recipient_id ? await loadUserEmail(admin, typedPayment.recipient_id) : null
  const builderProfileName = typedPayment.recipient_id
    ? await loadBuilderProfileName(admin, typedPayment.recipient_id)
    : null
  const eventLabel = await loadKickbackEventLabel(admin, typedPayment.event_id || agreement?.event_id || null, agreement?.plan_id ?? null)
  const principalCents = readNotificationCents(typedPayment.amount_cents, typedPayment.amount)
  const processingFeeCents = readIntegerCents(typedPayment.processing_fee_cents)

  return {
    payment: typedPayment,
    agreement,
    eventTitle: eventLabel.title,
    eventDate: eventLabel.date,
    venueName: (venue as any)?.venue_name || venueOwner?.name || 'there',
    venueEmail: (venue as any)?.contact_email || venueOwner?.email || null,
    builderName: builderProfileName || builder?.name || 'Event builder',
    builderEmail: builder?.email ?? null,
    reportedRevenueCents: readIntegerCents(agreement?.reported_revenue_cents),
    principalCents,
    processingFeeCents,
    builderPayoutCents: readIntegerCents(typedPayment.builder_payout_cents) || principalCents,
    refundAmountCents: readIntegerCents(typedPayment.refund_amount_cents),
    invoiceUrl: typedPayment.invoice_hosted_url ?? null,
    dueDate: typedPayment.due_date ?? null,
    settlementSource: formatSettlementSource(agreement),
  }
}

async function loadKickbackAgreement(admin: any, agreementId: string): Promise<KickbackNotificationAgreement | null> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select(
      [
        'id',
        'event_id',
        'plan_id',
        'venue_id',
        'reported_revenue_cents',
        'bar_revenue_share_percent',
        'ticket_revenue_share_percent',
        'lift_share_percentage',
        'per_head_amount',
      ].join(', ')
    )
    .eq('id', agreementId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load kickback agreement')
  return (data as KickbackNotificationAgreement | null) ?? null
}

async function loadVenue(admin: any, venueId: string) {
  const { data, error } = await admin
    .from('venues')
    .select('id, venue_name, contact_email, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue')
  return data ?? null
}

async function loadUserEmail(admin: any, userId: string): Promise<{ email: string | null; name: string | null } | null> {
  const { data, error } = await admin
    .from('users')
    .select('id, email, company_name')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load user email')
  if (!data) return null

  return {
    email: (data as any).email ?? null,
    name: (data as any).company_name ?? null,
  }
}

async function loadBuilderProfileName(admin: any, userId: string) {
  const { data, error } = await admin
    .from('builder_profiles')
    .select('name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load builder profile')
  return (data as { name?: string | null } | null)?.name ?? null
}

async function loadKickbackEventLabel(admin: any, eventId: string | null, planId: string | null) {
  if (eventId) {
    const { data, error } = await admin
      .from('events')
      .select('event_name, event_date')
      .eq('id', eventId)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to load event')
    if (data) {
      return {
        title: (data as any).event_name || 'event',
        date: (data as any).event_date ?? null,
      }
    }
  }

  if (planId) {
    const { data, error } = await admin
      .from('plans')
      .select('title, date_window_start')
      .eq('id', planId)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to load plan')
    if (data) {
      return {
        title: (data as any).title || 'event',
        date: (data as any).date_window_start ?? null,
      }
    }
  }

  return { title: 'event', date: null }
}

function readIntegerCents(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) ? Math.round(numeric) : 0
}

function readNotificationCents(centsValue: number | string | null | undefined, legacyDollarValue: number | string | null | undefined) {
  const cents = readIntegerCents(centsValue)
  if (cents > 0) return cents
  return dollarsToCents(legacyDollarValue)
}

function readPositiveNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function formatSettlementSource(agreement: KickbackNotificationAgreement | null) {
  const barShare = readPositiveNumber(agreement?.bar_revenue_share_percent)
  if (barShare > 0) return `${barShare}% bar revenue share agreement`

  const ticketShare = readPositiveNumber(agreement?.ticket_revenue_share_percent)
  if (ticketShare > 0) return `${ticketShare}% ticket revenue share agreement`

  const liftShare = readPositiveNumber(agreement?.lift_share_percentage)
  if (liftShare > 0) return `${liftShare}% lift share agreement`

  const perHeadCents = dollarsToCents(agreement?.per_head_amount)
  if (perHeadCents > 0) return `${formatMoney(perHeadCents)} per attendee agreement`

  return 'revenue share agreement'
}

function formatMoney(cents: number | string | null | undefined) {
  return `$${centsToDollars(cents).toFixed(2)}`
}

function formatOptionalDate(date: string | null) {
  return date ? ` on ${formatEmailDate(date)}` : ''
}

function formatOptionalDueDate(date: string | null) {
  return date ? formatEmailDate(date) : '7 days from invoice send'
}

function formatEmailDate(date: string) {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

function buildAppUrl(path: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function skippedEmail(reason: string) {
  return {
    sent: false,
    reason,
    responsePayload: null,
  }
}

async function createKickbackEmailAdminClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/server')
  return createServiceRoleClient() as any
}

/**
 * Builds a branded HTML template for notification emails.
 */
export function buildNotificationEmailHtml(params: EmailNotificationParams) {
  const eyebrow = getTemplateEyebrow(params.templateType || 'generic')

  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:#0f172a;color:#ffffff;padding:18px 24px;">
        <p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;">${escapeHtml(eyebrow)}</p>
        <h1 style="margin:6px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(params.subject)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;">${escapeHtml(params.body)}</p>
        ${params.actionUrl ? `<a href="${escapeHtml(params.actionUrl)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700;">View details</a>` : ''}
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;color:#94a3b8;font-size:12px;">You can update notification preferences in your 3rdSpace account.</p>
  </div>
</body>
</html>`
}

/**
 * Returns the small category label used in notification email headers.
 */
function getTemplateEyebrow(type: EmailTemplateType) {
  switch (type) {
    case 'new_booking':
    case 'booking_approved':
    case 'booking_rejected':
    case 'booking_cancelled':
      return 'Booking update'
    case 'new_message':
      return 'New message'
    case 'payment_received':
    case 'payment_due':
      return 'Payment update'
    case 'invoice_sent':
      return 'Invoice'
    case 'review_received':
    case 'review_request':
      return 'Review'
    default:
      return 'Notification'
  }
}

/**
 * Escapes interpolated values for HTML email output.
 */
function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function parseJson(value: string) {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}
