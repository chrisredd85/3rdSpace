import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { sendEmailNotification, type EmailTemplateType } from '@/lib/email'

export type NotificationType =
  | 'new_booking_request'
  | 'booking_confirmed'
  | 'booking_declined'
  | 'booking_approved'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'new_booking'
  | 'new_message'
  | 'payment_received'
  | 'invoice_sent'
  | 'payment_due'
  | 'review_posted'
  | 'review_received'
  | 'review_request'
  | 'reminder'
  | 'cancellation'

export type NotificationPreferences = {
  email_enabled: boolean
  push_enabled: boolean
  sound_enabled: boolean
  preferences: Record<string, { email?: boolean; in_app?: boolean; push?: boolean }>
}

export type CreateNotificationParams = {
  userId: string
  type: NotificationType | string
  title: string
  message: string
  actionUrl?: string
  relatedId?: string
  metadata?: Record<string, unknown>
  groupKey?: string
  sendEmail?: boolean
}

const OFFLINE_NOTIFICATION_MINUTES = 10

/**
 * Creates a grouped in-app notification and emails offline users when preferences allow it.
 */
export async function createNotification(params: CreateNotificationParams) {
  const supabase = getNotificationClient()
  const preferences = await getNotificationPreferences(params.userId, supabase)

  if (!isInAppEnabled(preferences, params.type)) {
    return null
  }

  const actionUrl = params.actionUrl || null
  const metadata = params.metadata || {}
  const groupKey = params.groupKey || `${params.userId}:${params.type}:${params.relatedId || params.title}`

  const { data: notificationId, error: rpcError } = await (supabase as any).rpc('insert_grouped_notification', {
    p_user_id: params.userId,
    p_type: params.type,
    p_title: params.title,
    p_message: params.message,
    p_link: actionUrl,
    p_related_id: params.relatedId || null,
    p_metadata: metadata,
    p_group_key: groupKey,
  })

  if (rpcError) {
    console.error('[notifications] Failed to create grouped notification', rpcError)
    return null
  }

  const { data: notification } = await (supabase as any)
    .from('notifications')
    .select('*')
    .eq('id', notificationId)
    .maybeSingle()

  if (params.sendEmail !== false) {
    await sendOfflineNotificationEmail(supabase, params, preferences).catch((error) => {
      console.error('[notifications] Failed to send offline email', error)
    })
  }

  return notification
}

/**
 * Loads a user's notification preferences, defaulting to enabled in-app and email notifications.
 */
export async function getNotificationPreferences(userId: string, supabase: SupabaseClient<any> = getNotificationClient()) {
  const { data } = await (supabase as any)
    .from('notification_preferences')
    .select('email_enabled, push_enabled, sound_enabled, preferences')
    .eq('user_id', userId)
    .maybeSingle()

  return {
    email_enabled: data?.email_enabled ?? true,
    push_enabled: data?.push_enabled ?? false,
    sound_enabled: data?.sound_enabled ?? false,
    preferences: data?.preferences || {},
  } satisfies NotificationPreferences
}

/**
 * Creates or updates notification preferences for a user.
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<NotificationPreferences>,
  supabase: SupabaseClient<any> = createClient() as any
) {
  const payload = {
    user_id: userId,
    email_enabled: preferences.email_enabled ?? true,
    push_enabled: preferences.push_enabled ?? false,
    sound_enabled: preferences.sound_enabled ?? false,
    preferences: preferences.preferences || {},
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await (supabase as any)
    .from('notification_preferences')
    .upsert(payload)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Returns whether in-app notifications are enabled for a type.
 */
export function isInAppEnabled(preferences: NotificationPreferences, type: string) {
  return preferences.preferences?.[type]?.in_app !== false
}

/**
 * Returns whether email notifications are enabled for a type.
 */
export function isEmailEnabled(preferences: NotificationPreferences, type: string) {
  return preferences.email_enabled && preferences.preferences?.[type]?.email !== false
}

/**
 * Sends an email notification only when the user appears offline and preferences allow it.
 */
async function sendOfflineNotificationEmail(
  supabase: SupabaseClient<any>,
  params: CreateNotificationParams,
  preferences: NotificationPreferences
) {
  if (!isEmailEnabled(preferences, params.type)) {
    return { sent: false, reason: 'Email disabled by notification preferences' }
  }

  const { data: user } = await (supabase as any)
    .from('users')
    .select('email, last_login_at')
    .eq('id', params.userId)
    .maybeSingle()

  if (!user?.email || !isOffline(user.last_login_at)) {
    return { sent: false, reason: 'User is active or email is unavailable' }
  }

  return sendEmailNotification({
    to: user.email,
    subject: params.title,
    body: params.message,
    actionUrl: params.actionUrl,
    templateType: mapNotificationToEmailTemplate(params.type),
  })
}

/**
 * Maps notification types to email templates.
 */
function mapNotificationToEmailTemplate(type: string): EmailTemplateType {
  switch (type) {
    case 'new_booking_request':
    case 'new_booking':
      return 'new_booking'
    case 'booking_confirmed':
    case 'booking_approved':
      return 'booking_approved'
    case 'booking_declined':
    case 'booking_rejected':
      return 'booking_rejected'
    case 'booking_cancelled':
    case 'cancellation':
      return 'booking_cancelled'
    case 'new_message':
      return 'new_message'
    case 'payment_received':
      return 'payment_received'
    case 'invoice_sent':
      return 'invoice_sent'
    case 'payment_due':
      return 'payment_due'
    case 'review_posted':
    case 'review_received':
      return 'review_received'
    case 'review_request':
      return 'review_request'
    default:
      return 'generic'
  }
}

/**
 * Returns true when the user has no recent login activity.
 */
function isOffline(lastLoginAt?: string | null) {
  if (!lastLoginAt) return true
  const lastLogin = new Date(lastLoginAt).getTime()
  if (!Number.isFinite(lastLogin)) return true
  return Date.now() - lastLogin > OFFLINE_NOTIFICATION_MINUTES * 60 * 1000
}

/**
 * Uses service role when available so trigger/helper code can notify other users.
 */
function getNotificationClient() {
  try {
    return createServiceRoleClient() as any
  } catch {
    return createClient() as any
  }
}
