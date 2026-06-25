import 'server-only'

import { sendEmailNotification } from '@/lib/email'
import { getStripeGateErrorMessage, type GateBlockReason } from '@/lib/planner/stripeReadinessGate'

type SupabaseAdminClient = { from: (table: string) => any }

type EntityContact = {
  id: string
  name: string
  email: string | null
}

export async function notifyEntityStripeSetup(opts: {
  supabase: SupabaseAdminClient
  entityType: 'venue' | 'vendor'
  entityId: string
  planId?: string | null
  organizerId?: string | null
  reason: GateBlockReason
  force?: boolean
}): Promise<{ sent: boolean; rate_limited?: boolean; notification_id?: string | null; reason?: string }> {
  const contact = opts.entityType === 'venue'
    ? await loadVenueContact(opts.supabase, opts.entityId)
    : await loadVendorContact(opts.supabase, opts.entityId)
  const notificationEntityId = contact?.id ?? opts.entityId

  const recent = await loadRecentNotification(opts.supabase, opts.entityType, notificationEntityId)
  if (recent && !opts.force) {
    return { sent: false, rate_limited: true, notification_id: recent.id }
  }

  const inserted = await insertNotification(opts.supabase, {
    entityType: opts.entityType,
    entityId: notificationEntityId,
    planId: opts.planId ?? null,
    organizerId: opts.organizerId ?? null,
    reason: opts.reason,
    sent: false,
    sentAt: null,
    metadata: {
      requested_entity_id: opts.entityId,
      contact_email_present: Boolean(contact?.email),
    },
  })

  if (!contact?.email) {
    return {
      sent: false,
      notification_id: inserted?.id ?? null,
      reason: `${opts.entityType} contact email not found`,
    }
  }

  const result = await sendEmailNotification({
    to: contact.email,
    subject: 'Action needed: complete Stripe setup to receive payments',
    templateType: 'payment_due',
    actionUrl: buildStripeSetupUrl(opts.entityType),
    body: [
      `Hi ${contact.name},`,
      getStripeGateErrorMessage({
        entityType: opts.entityType,
        entityName: contact.name,
        reason: opts.reason,
      }),
      'An organizer is ready to authorize a payment in 3rdPlace, but payouts are blocked until Stripe Connect is complete.',
      'Please finish Stripe-hosted onboarding. 3rdPlace never sees your bank details.',
    ].join('\n\n'),
  })

  if (result.sent && inserted?.id) {
    await markNotificationSent(opts.supabase, inserted.id)
  }

  return {
    sent: Boolean(result.sent),
    notification_id: inserted?.id ?? null,
    reason: !result.sent && result.reason ? result.reason : undefined,
  }
}

export async function recordStripeReadyUnblockNotice(opts: {
  supabase: SupabaseAdminClient
  entityType: 'venue' | 'vendor' | 'organizer'
  entityId: string
  stripeAccountId: string
  eventId: string
}) {
  await insertNotification(opts.supabase, {
    entityType: opts.entityType,
    entityId: opts.entityId,
    planId: null,
    organizerId: null,
    reason: 'onboarding_incomplete',
    sent: false,
    sentAt: null,
    channel: 'webhook_log',
    metadata: {
      action: 'stripe_ready_unblock_available',
      stripe_account_id: opts.stripeAccountId,
      stripe_event_id: opts.eventId,
    },
  })
}

async function loadRecentNotification(
  supabase: SupabaseAdminClient,
  entityType: 'venue' | 'vendor',
  entityId: string,
): Promise<{ id: string } | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('stripe_setup_notifications')
    .select('id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load recent Stripe setup notification')
  return (data as { id: string } | null) ?? null
}

async function insertNotification(
  supabase: SupabaseAdminClient,
  input: {
    entityType: 'venue' | 'vendor' | 'organizer'
    entityId: string
    planId: string | null
    organizerId: string | null
    reason: GateBlockReason
    sent: boolean
    sentAt: string | null
    channel?: 'email' | 'webhook_log' | 'in_app'
    metadata: Record<string, unknown>
  },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('stripe_setup_notifications')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      plan_id: input.planId,
      organizer_id: input.organizerId,
      reason: input.reason,
      channel: input.channel ?? 'email',
      sent: input.sent,
      sent_at: input.sentAt,
      metadata: input.metadata,
    })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to insert Stripe setup notification')
  return (data as { id: string } | null) ?? null
}

async function markNotificationSent(supabase: SupabaseAdminClient, notificationId: string) {
  const { error } = await supabase
    .from('stripe_setup_notifications')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) throw new Error(error.message ?? 'Failed to mark Stripe setup notification sent')
}

async function loadVenueContact(supabase: SupabaseAdminClient, entityId: string): Promise<EntityContact | null> {
  const byId = await queryVenueContact(supabase, 'id', entityId)
  if (byId) return byId
  return queryVenueContact(supabase, 'owner_id', entityId)
}

async function queryVenueContact(
  supabase: SupabaseAdminClient,
  column: 'id' | 'owner_id',
  value: string,
): Promise<EntityContact | null> {
  const { data, error } = await supabase
    .from('venues')
    .select('id, venue_name, contact_email, owner_id')
    .eq(column, value)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue contact')
  const row = data as { id: string; venue_name: string | null; contact_email: string | null; owner_id: string | null } | null
  if (!row) return null
  return {
    id: row.id,
    name: row.venue_name ?? 'the venue',
    email: row.contact_email ?? await loadUserEmail(supabase, row.owner_id),
  }
}

async function loadVendorContact(supabase: SupabaseAdminClient, entityId: string): Promise<EntityContact | null> {
  const { data, error } = await supabase
    .from('vendor_profiles')
    .select('id, name, contact_email, user_id')
    .eq('id', entityId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load vendor contact')
  const row = data as { id: string; name: string | null; contact_email: string | null; user_id: string | null } | null
  if (!row) return null
  return {
    id: row.id,
    name: row.name ?? 'the vendor',
    email: row.contact_email ?? await loadUserEmail(supabase, row.user_id),
  }
}

async function loadUserEmail(supabase: SupabaseAdminClient, userId: string | null) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load user email')
  const email = (data as { email?: string | null } | null)?.email
  return typeof email === 'string' && email.trim().length > 0 ? email : null
}

function buildStripeSetupUrl(entityType: 'venue' | 'vendor') {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.3rdplace.io').replace(/\/$/, '')
  return `${baseUrl}/${entityType === 'venue' ? 'venue/profile/complete' : 'vendor'}?stripe=setup`
}
