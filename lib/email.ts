import 'server-only'

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
