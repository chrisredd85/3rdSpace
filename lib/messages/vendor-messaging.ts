import 'server-only'

import { randomUUID } from 'crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export type SenderType = 'builder' | 'vendor'

export type MessageAttachment = {
  name: string
  path: string
  size: number
  type: string
  url?: string
}

export type MessagingProfile = {
  id: string
  user_id: string
  display_name: string
  type: SenderType
}

export type VendorMessageThread = {
  id: string
  booking_id: string
  vendor_id: string
  builder_id: string
  subject: string
  status: string
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type VendorMessage = {
  id: string
  thread_id: string
  sender_id: string
  sender_type: SenderType
  message: string
  attachments: MessageAttachment[] | null
  read_at: string | null
  created_at: string
}

export type ThreadAccess = {
  user: User
  thread: VendorMessageThread
  profile: MessagingProfile
  recipientUserId: string
}

const MESSAGE_ATTACHMENT_BUCKET = 'message-attachments'
const OFFLINE_NOTIFICATION_MINUTES = 10

/**
 * Finds the builder or vendor profile attached to the authenticated user.
 */
export async function getCurrentMessagingProfile(supabase: SupabaseClient<any>, userId: string) {
  const [{ data: builderProfile }, { data: vendorProfile }] = await Promise.all([
    supabase.from('builder_profiles').select('id, user_id, name').eq('user_id', userId).maybeSingle(),
    supabase.from('vendor_profiles').select('id, user_id, name, business_name').eq('user_id', userId).maybeSingle(),
  ])

  if (builderProfile) {
    return {
      id: builderProfile.id,
      user_id: builderProfile.user_id,
      display_name: builderProfile.name || 'Builder',
      type: 'builder' as const,
    }
  }

  if (vendorProfile) {
    return {
      id: vendorProfile.id,
      user_id: vendorProfile.user_id,
      display_name: vendorProfile.business_name || vendorProfile.name || 'Vendor',
      type: 'vendor' as const,
    }
  }

  return null
}

/**
 * Returns true when the profile is one of the two participants in a thread.
 */
export function canAccessThread(thread: VendorMessageThread, profile: MessagingProfile) {
  return profile.type === 'builder'
    ? thread.builder_id === profile.id
    : thread.vendor_id === profile.id
}

/**
 * Fetches a thread and validates that the current user participates in it.
 */
export async function getAuthorizedThread(supabase: SupabaseClient<any>, threadId: string): Promise<ThreadAccess | { error: string; status: number }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { error: 'Unauthorized', status: 401 }
  }

  const profile = await getCurrentMessagingProfile(supabase, user.id)
  if (!profile) {
    return { error: 'No profile found', status: 404 }
  }

  const { data: thread, error: threadError } = await supabase
    .from('vendor_message_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle()

  if (threadError) {
    return { error: threadError.message, status: 500 }
  }

  if (!thread) {
    return { error: 'Thread not found', status: 404 }
  }

  if (!canAccessThread(thread, profile)) {
    return { error: 'Not authorized', status: 403 }
  }

  const recipientUserId = await getRecipientUserId(supabase, thread, profile.type)
  if (!recipientUserId) {
    return { error: 'Recipient profile not found', status: 404 }
  }

  return { user, thread, profile, recipientUserId }
}

/**
 * Finds the auth user id for the other participant in a thread.
 */
export async function getRecipientUserId(supabase: SupabaseClient<any>, thread: VendorMessageThread, senderType: SenderType) {
  const table = senderType === 'builder' ? 'vendor_profiles' : 'builder_profiles'
  const id = senderType === 'builder' ? thread.vendor_id : thread.builder_id
  const { data } = await supabase.from(table).select('user_id').eq('id', id).maybeSingle()
  return data?.user_id || null
}

/**
 * Normalizes an arbitrary value into a list of persisted message attachments.
 */
export function normalizeAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const attachment = item as Partial<MessageAttachment>
      if (!attachment.path && !attachment.url) return null

      return {
        name: String(attachment.name || 'Attachment'),
        path: String(attachment.path || ''),
        size: Number(attachment.size || 0),
        type: String(attachment.type || 'application/octet-stream'),
        url: attachment.url ? String(attachment.url) : undefined,
      }
    })
    .filter(Boolean) as MessageAttachment[]
}

/**
 * Uploads multipart files into the private Supabase message attachment bucket.
 */
export async function uploadMessageAttachments(
  supabase: SupabaseClient<any>,
  params: { threadId: string; userId: string; files: File[] }
) {
  const uploaded: MessageAttachment[] = []

  for (const file of params.files) {
    const safeName = sanitizeFileName(file.name)
    const path = `${params.threadId}/${params.userId}/${Date.now()}-${randomUUID()}-${safeName}`
    const { error } = await supabase.storage.from(MESSAGE_ATTACHMENT_BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

    if (error) {
      throw new Error(error.message)
    }

    uploaded.push({
      name: file.name,
      path,
      size: file.size,
      type: file.type || 'application/octet-stream',
    })
  }

  return uploaded
}

/**
 * Adds temporary signed URLs to private attachment records before returning them to the client.
 */
export async function withSignedAttachmentUrls(supabase: SupabaseClient<any>, messages: VendorMessage[]) {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      attachments: await signAttachments(supabase, message.attachments),
    }))
  )
}

/**
 * Creates signed URLs for attachment paths that are stored in Supabase Storage.
 */
export async function signAttachments(supabase: SupabaseClient<any>, attachments: MessageAttachment[] | null) {
  if (!attachments?.length) return []

  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.url || !attachment.path) return attachment

      const { data } = await supabase.storage
        .from(MESSAGE_ATTACHMENT_BUCKET)
        .createSignedUrl(attachment.path, 60 * 60)

      return {
        ...attachment,
        url: data?.signedUrl,
      }
    })
  )
}

/**
 * Inserts an in-app notification for the canonical notifications table.
 */
export async function createMessageNotification(
  supabase: SupabaseClient<any>,
  params: {
    userId: string
    threadId: string
    senderName: string
    preview: string
  }
) {
  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    notification_type: 'new_message',
    title: 'New message',
    message: `${params.senderName}: ${params.preview}`,
    link_url: `/messages?thread=${params.threadId}`,
    is_read: false,
  })

  if (error) throw error
}

/**
 * Sends an email notification when the recipient appears inactive.
 */
export async function sendOfflineMessageEmail(
  supabase: SupabaseClient<any>,
  params: {
    recipientUserId: string
    threadId: string
    senderName: string
    preview: string
    origin: string
  }
) {
  const { data: recipient } = await supabase
    .from('users')
    .select('email, last_login_at')
    .eq('id', params.recipientUserId)
    .maybeSingle()

  if (!recipient?.email || !isOffline(recipient.last_login_at)) {
    return { sent: false, reason: 'Recipient is active or email is unavailable' }
  }

  return sendMessageEmail({
    to: recipient.email,
    subject: `New message from ${params.senderName}`,
    html: buildMessageEmailHtml({
      senderName: params.senderName,
      preview: params.preview,
      url: `${params.origin}/messages?thread=${params.threadId}`,
    }),
  })
}

/**
 * Sends a message notification email through SendGrid when configured.
 */
export async function sendMessageEmail(params: { to: string; subject: string; html: string }) {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.MESSAGE_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || process.env.INVOICE_FROM_EMAIL

  if (!apiKey || !from) {
    return {
      sent: false,
      reason: 'Email provider is not configured. Set SENDGRID_API_KEY and MESSAGE_FROM_EMAIL.',
    }
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: from },
      subject: params.subject,
      content: [{ type: 'text/html', value: params.html }],
    }),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Email provider rejected the message email')
  }

  return { sent: true, reason: null }
}

/**
 * Builds the HTML body for a message notification email.
 */
export function buildMessageEmailHtml(params: { senderName: string; preview: string; url: string }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
      <h1 style="font-size:22px;margin:0 0 12px;">New message from ${escapeHtml(params.senderName)}</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 20px;color:#475569;">${escapeHtml(params.preview)}</p>
      <a href="${escapeHtml(params.url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700;">Open conversation</a>
    </div>
  </div>
</body>
</html>`
}

/**
 * Truncates message text for previews and email notifications.
 */
export function truncateMessage(value: string, maxLength = 140) {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}...`
}

/**
 * Returns true when a user has no recent login activity in the local user row.
 */
export function isOffline(lastLoginAt?: string | null) {
  if (!lastLoginAt) return true
  const lastLogin = new Date(lastLoginAt).getTime()
  if (!Number.isFinite(lastLogin)) return true
  return Date.now() - lastLogin > OFFLINE_NOTIFICATION_MINUTES * 60 * 1000
}

/**
 * Sanitizes a filename for use in a Supabase Storage path.
 */
export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'attachment'
}

/**
 * Escapes interpolated values for email HTML.
 */
export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
