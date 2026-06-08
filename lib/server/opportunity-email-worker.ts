import 'server-only'

import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'
import { enqueueJob, type AppJob } from '@/lib/server/job-queue'

type SupabaseAdminClient = any
type JsonObject = Record<string, any>

type InviteRow = {
  id: string
  opportunity_id: string | null
  brief_id: string | null
  venue_id: string | null
  status: string
  magic_link_token: string | null
  magic_link_expires_at: string | null
  sent_at: string | null
  viewed_at: string | null
  response_at: string | null
  responded_at: string | null
}

type VendorInviteRow = {
  id: string
  brief_id: string
  vendor_id: string
  status: string
  magic_link_token: string | null
  magic_link_expires_at: string | null
  sent_at: string | null
  viewed_at: string | null
  response_at: string | null
  response_payload: JsonObject | null
  quoted_amount_cents: number | null
}

type BriefRow = {
  id: string
  plan_id: string
  organizer_user_id: string | null
  title: string | null
  event_type: string | null
  guest_count: number | null
  date_window_start: string | null
  date_window_end: string | null
  neighborhood: string | null
  budget_cents: number | null
  summary: string | null
  requirements: JsonObject | null
  response_deadline: string | null
}

type VendorBriefRow = {
  id: string
  plan_id: string
  organizer_user_id: string | null
  package_type: string
  summary: string
  requirements: JsonObject | null
  budget_range_cents: string | null
  date_needed: string | null
  response_deadline: string | null
  quote_requested: boolean
}

type VenueRow = {
  id: string
  venue_name: string | null
  contact_email: string | null
  city: string | null
  state: string | null
  standing_capacity: number | null
}

type VendorRow = {
  id: string
  name: string | null
  contact_email: string | null
  service_type: string | null
  vendor_type: string | null
}

type PlanRow = {
  id: string
  user_id: string
  title: string | null
}

type ProfileRow = {
  id: string
  name: string | null
  email: string | null
}

type InviteContext = {
  invite: InviteRow
  brief: BriefRow
  venue: VenueRow | null
  plan: PlanRow | null
  organizer: ProfileRow | null
}

type VendorInviteContext = {
  invite: VendorInviteRow
  brief: VendorBriefRow
  vendor: VendorRow | null
  plan: PlanRow | null
  organizer: ProfileRow | null
}

const OPPORTUNITY_SOURCE = 'opportunity_email_worker'
const RESPONDED_STATUSES = new Set(['accepted', 'declined', 'countered', 'expired', 'concierge_followup', 'cancelled'])

/**
 * Enqueues immediate send jobs for queued venue opportunity invites.
 */
export async function enqueueOpportunityInviteSendJobs(
  admin: SupabaseAdminClient,
  invites: Array<Record<string, unknown>>
) {
  const venueInvites = invites.filter((invite) => {
    const targetType = invite.target_type
    const venueId = invite.venue_id
    return targetType === 'venue' && typeof venueId === 'string' && typeof invite.id === 'string'
  })

  const jobs = []
  for (const invite of venueInvites) {
    const inviteId = typeof invite.id === 'string' ? invite.id : null
    if (!inviteId) continue

    jobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_send_venue_invite',
        payload: { inviteId },
        uniqueKey: `opportunity_send_venue_invite:${inviteId}`,
        maxAttempts: 3,
      })
    )
  }

  return jobs
}

/**
 * Enqueues immediate send jobs for queued vendor opportunity invites.
 */
export async function enqueueVendorOpportunityInviteSendJobs(
  admin: SupabaseAdminClient,
  invites: Array<Record<string, unknown>>
) {
  const vendorInvites = invites.filter((invite) => {
    const vendorId = invite.vendor_id
    return typeof vendorId === 'string' && typeof invite.id === 'string'
  })

  const jobs = []
  for (const invite of vendorInvites) {
    const inviteId = typeof invite.id === 'string' ? invite.id : null
    if (!inviteId) continue

    jobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_send_vendor_invite',
        payload: { inviteId },
        uniqueKey: `opportunity_send_vendor_invite:${inviteId}`,
        maxAttempts: 3,
      })
    )
  }

  return jobs
}

/**
 * Processes one opportunity invite delivery, reminder, or expiration job.
 */
export async function runOpportunityInviteJob(admin: SupabaseAdminClient, job: AppJob) {
  if (job.job_type === 'opportunity_send_venue_invite') {
    return sendVenueInvite(admin, readInviteId(job))
  }

  if (job.job_type === 'opportunity_remind_venue_invite') {
    return remindVenueInvite(admin, readInviteId(job), readReminderLabel(job))
  }

  if (job.job_type === 'opportunity_expire_venue_invite') {
    return expireVenueInvite(admin, readInviteId(job))
  }

  if (job.job_type === 'opportunity_send_vendor_invite') {
    return sendVendorInvite(admin, readInviteId(job))
  }

  if (job.job_type === 'opportunity_remind_vendor_invite') {
    return remindVendorInvite(admin, readInviteId(job), readReminderLabel(job))
  }

  if (job.job_type === 'opportunity_expire_vendor_invite') {
    return expireVendorInvite(admin, readInviteId(job))
  }

  throw new Error(`Unsupported opportunity job type: ${job.job_type}`)
}

async function sendVenueInvite(admin: SupabaseAdminClient, inviteId: string) {
  const context = await loadInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (context.invite.status !== 'queued') {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: buildLogPayload(context),
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  if (context.invite.venue_id) {
    const compliance = await getVenueComplianceStatus(admin as any, context.invite.venue_id)
    if (!compliance.is_compliant) {
      await updateInvite(admin, inviteId, {
        status: 'venue_blocked_compliance',
        blocked_reason: compliance.reason,
      })
      await logWebhookAttempt(admin, {
        eventType: 'opportunity_send_venue_invite',
        entityId: inviteId,
        provider: 'internal',
        outcome: 'skipped',
        requestPayload: buildLogPayload(context),
        responsePayload: { reason: compliance.reason, overdue_count: compliance.overdue_count },
      })
      await updateApprovalMessageStats(admin, context.brief.id)
      return { processed: true, status: 'venue_blocked_compliance', inviteId, reason: compliance.reason }
    }
  }

  if (!context.venue?.contact_email) {
    await updateInvite(admin, inviteId, { status: 'concierge_followup' })
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_venue_invite',
      entityId: inviteId,
      provider: 'resend',
      outcome: 'concierge_followup',
      requestPayload: buildLogPayload(context),
      responsePayload: { reason: 'missing_contact_email' },
      error: 'Venue has no contact_email. Routed to concierge follow-up.',
    })
    await updateApprovalMessageStats(admin, context.brief.id)
    return { processed: true, status: 'concierge_followup', inviteId }
  }

  const email = buildVenueInviteEmail(context)
  const delivery = await sendOpportunityEmail(context.venue.contact_email, email)

  await logWebhookAttempt(admin, {
    eventType: 'opportunity_send_venue_invite',
    entityId: inviteId,
    provider: delivery.provider,
    outcome: delivery.outcome,
    statusCode: delivery.statusCode,
    requestPayload: {
      ...buildLogPayload(context),
      to: context.venue.contact_email,
      subject: email.subject,
    },
    responsePayload: delivery.responsePayload,
    error: delivery.error,
  })

  const sentAt = new Date().toISOString()
  await updateInvite(admin, inviteId, { status: 'sent', sent_at: sentAt })
  if (delivery.outcome !== 'provider_failure') {
    await scheduleFollowUpJobs(admin, context)
  }
  await updateApprovalMessageStats(admin, context.brief.id)

  return {
    processed: true,
    status: 'sent',
    inviteId,
    provider: delivery.provider,
    providerOutcome: delivery.outcome,
  }
}

async function remindVenueInvite(admin: SupabaseAdminClient, inviteId: string, reminderLabel: string) {
  const context = await loadInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId, reminderLabel },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (hasInviteResponded(context.invite)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { ...buildLogPayload(context), reminderLabel },
      responsePayload: { reason: 'already_responded' },
    })
    return { processed: false, ignored: true, reason: 'already_responded' }
  }

  if (!['sent', 'viewed'].includes(context.invite.status)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { ...buildLogPayload(context), reminderLabel },
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  if (!context.venue?.contact_email) {
    await updateInvite(admin, inviteId, { status: 'concierge_followup' })
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_venue_invite',
      entityId: inviteId,
      provider: 'resend',
      outcome: 'concierge_followup',
      requestPayload: { ...buildLogPayload(context), reminderLabel },
      responsePayload: { reason: 'missing_contact_email' },
      error: 'Venue has no contact_email. Routed to concierge follow-up.',
    })
    await updateApprovalMessageStats(admin, context.brief.id)
    return { processed: true, status: 'concierge_followup', inviteId }
  }

  const email = buildVenueReminderEmail(context, reminderLabel)
  const delivery = await sendOpportunityEmail(context.venue.contact_email, email)
  await logWebhookAttempt(admin, {
    eventType: 'opportunity_remind_venue_invite',
    entityId: inviteId,
    provider: delivery.provider,
    outcome: delivery.outcome,
    statusCode: delivery.statusCode,
    requestPayload: {
      ...buildLogPayload(context),
      reminderLabel,
      to: context.venue.contact_email,
      subject: email.subject,
    },
    responsePayload: delivery.responsePayload,
    error: delivery.error,
  })

  return {
    processed: true,
    status: 'reminder_sent',
    inviteId,
    reminderLabel,
    providerOutcome: delivery.outcome,
  }
}

async function expireVenueInvite(admin: SupabaseAdminClient, inviteId: string) {
  const context = await loadInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_expire_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (!['sent', 'viewed'].includes(context.invite.status)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_expire_venue_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: buildLogPayload(context),
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  await updateInvite(admin, inviteId, { status: 'expired' })
  await logWebhookAttempt(admin, {
    eventType: 'opportunity_expire_venue_invite',
    entityId: inviteId,
    provider: 'internal',
    outcome: 'expired',
    requestPayload: buildLogPayload(context),
    responsePayload: { expiredAt: new Date().toISOString() },
  })
  await updateApprovalMessageStats(admin, context.brief.id)

  return { processed: true, status: 'expired', inviteId }
}

async function sendVendorInvite(admin: SupabaseAdminClient, inviteId: string) {
  const context = await loadVendorInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (context.invite.status !== 'queued') {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: buildVendorLogPayload(context),
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  if (!context.vendor?.contact_email) {
    await updateVendorInvite(admin, inviteId, { status: 'concierge_followup' })
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_send_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'resend',
      outcome: 'concierge_followup',
      requestPayload: buildVendorLogPayload(context),
      responsePayload: { reason: 'missing_contact_email' },
      error: 'Vendor has no contact_email. Routed to concierge follow-up.',
    })
    await updateVendorApprovalMessageStats(admin, context.brief.id)
    return { processed: true, status: 'concierge_followup', inviteId }
  }

  const email = buildVendorInviteEmail(context)
  const delivery = await sendOpportunityEmail(context.vendor.contact_email, email)

  await logWebhookAttempt(admin, {
    eventType: 'opportunity_send_vendor_invite',
    entityType: 'vendor_opportunity_invite',
    entityId: inviteId,
    provider: delivery.provider,
    outcome: delivery.outcome,
    statusCode: delivery.statusCode,
    requestPayload: {
      ...buildVendorLogPayload(context),
      to: context.vendor.contact_email,
      subject: email.subject,
    },
    responsePayload: delivery.responsePayload,
    error: delivery.error,
  })

  const sentAt = new Date().toISOString()
  await updateVendorInvite(admin, inviteId, { status: 'sent', sent_at: sentAt })
  if (delivery.outcome !== 'provider_failure') {
    await scheduleVendorFollowUpJobs(admin, context)
  }
  await updateVendorApprovalMessageStats(admin, context.brief.id)

  return {
    processed: true,
    status: 'sent',
    inviteId,
    provider: delivery.provider,
    providerOutcome: delivery.outcome,
  }
}

async function remindVendorInvite(admin: SupabaseAdminClient, inviteId: string, reminderLabel: string) {
  const context = await loadVendorInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId, reminderLabel },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (hasInviteResponded(context.invite)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { ...buildVendorLogPayload(context), reminderLabel },
      responsePayload: { reason: 'already_responded' },
    })
    return { processed: false, ignored: true, reason: 'already_responded' }
  }

  if (!['sent', 'viewed'].includes(context.invite.status)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { ...buildVendorLogPayload(context), reminderLabel },
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  if (!context.vendor?.contact_email) {
    await updateVendorInvite(admin, inviteId, { status: 'concierge_followup' })
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_remind_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'resend',
      outcome: 'concierge_followup',
      requestPayload: { ...buildVendorLogPayload(context), reminderLabel },
      responsePayload: { reason: 'missing_contact_email' },
      error: 'Vendor has no contact_email. Routed to concierge follow-up.',
    })
    await updateVendorApprovalMessageStats(admin, context.brief.id)
    return { processed: true, status: 'concierge_followup', inviteId }
  }

  const email = buildVendorReminderEmail(context, reminderLabel)
  const delivery = await sendOpportunityEmail(context.vendor.contact_email, email)
  await logWebhookAttempt(admin, {
    eventType: 'opportunity_remind_vendor_invite',
    entityType: 'vendor_opportunity_invite',
    entityId: inviteId,
    provider: delivery.provider,
    outcome: delivery.outcome,
    statusCode: delivery.statusCode,
    requestPayload: {
      ...buildVendorLogPayload(context),
      reminderLabel,
      to: context.vendor.contact_email,
      subject: email.subject,
    },
    responsePayload: delivery.responsePayload,
    error: delivery.error,
  })

  return {
    processed: true,
    status: 'reminder_sent',
    inviteId,
    reminderLabel,
    providerOutcome: delivery.outcome,
  }
}

async function expireVendorInvite(admin: SupabaseAdminClient, inviteId: string) {
  const context = await loadVendorInviteContext(admin, inviteId)
  if (!context) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_expire_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: { invite_id: inviteId },
      responsePayload: { reason: 'invite_not_found' },
    })
    return { processed: false, ignored: true, reason: 'invite_not_found' }
  }

  if (!['sent', 'viewed'].includes(context.invite.status)) {
    await logWebhookAttempt(admin, {
      eventType: 'opportunity_expire_vendor_invite',
      entityType: 'vendor_opportunity_invite',
      entityId: inviteId,
      provider: 'internal',
      outcome: 'skipped',
      requestPayload: buildVendorLogPayload(context),
      responsePayload: { reason: `status_${context.invite.status}` },
    })
    return { processed: false, ignored: true, reason: `status_${context.invite.status}` }
  }

  await updateVendorInvite(admin, inviteId, { status: 'expired' })
  await logWebhookAttempt(admin, {
    eventType: 'opportunity_expire_vendor_invite',
    entityType: 'vendor_opportunity_invite',
    entityId: inviteId,
    provider: 'internal',
    outcome: 'expired',
    requestPayload: buildVendorLogPayload(context),
    responsePayload: { expiredAt: new Date().toISOString() },
  })
  await updateVendorApprovalMessageStats(admin, context.brief.id)

  return { processed: true, status: 'expired', inviteId }
}

async function scheduleFollowUpJobs(admin: SupabaseAdminClient, context: InviteContext) {
  const deadline = parseDate(context.brief.response_deadline)
  if (!deadline) return []

  const now = Date.now()
  const scheduledJobs = []
  const reminderOffsets = [
    { label: '72h', milliseconds: 72 * 60 * 60 * 1000 },
    { label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  ]

  for (const reminder of reminderOffsets) {
    const scheduledAt = new Date(deadline.getTime() - reminder.milliseconds)
    if (scheduledAt.getTime() <= now) continue

    scheduledJobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_remind_venue_invite',
        payload: { inviteId: context.invite.id, reminderLabel: reminder.label },
        uniqueKey: `opportunity_remind_venue_invite:${context.invite.id}:${reminder.label}`,
        scheduledAt: scheduledAt.toISOString(),
        maxAttempts: 3,
      })
    )
  }

  if (deadline.getTime() > now) {
    scheduledJobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_expire_venue_invite',
        payload: { inviteId: context.invite.id },
        uniqueKey: `opportunity_expire_venue_invite:${context.invite.id}`,
        scheduledAt: deadline.toISOString(),
        maxAttempts: 1,
      })
    )
  }

  return scheduledJobs
}

async function scheduleVendorFollowUpJobs(admin: SupabaseAdminClient, context: VendorInviteContext) {
  const deadline = parseDate(context.brief.response_deadline)
  if (!deadline) return []

  const now = Date.now()
  const scheduledJobs = []
  const reminderOffsets = [
    { label: '72h', milliseconds: 72 * 60 * 60 * 1000 },
    { label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  ]

  for (const reminder of reminderOffsets) {
    const scheduledAt = new Date(deadline.getTime() - reminder.milliseconds)
    if (scheduledAt.getTime() <= now) continue

    scheduledJobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_remind_vendor_invite',
        payload: { inviteId: context.invite.id, reminderLabel: reminder.label },
        uniqueKey: `opportunity_remind_vendor_invite:${context.invite.id}:${reminder.label}`,
        scheduledAt: scheduledAt.toISOString(),
        maxAttempts: 3,
      })
    )
  }

  if (deadline.getTime() > now) {
    scheduledJobs.push(
      await enqueueJob(admin, {
        jobType: 'opportunity_expire_vendor_invite',
        payload: { inviteId: context.invite.id },
        uniqueKey: `opportunity_expire_vendor_invite:${context.invite.id}`,
        scheduledAt: deadline.toISOString(),
        maxAttempts: 1,
      })
    )
  }

  return scheduledJobs
}

async function loadInviteContext(admin: SupabaseAdminClient, inviteId: string): Promise<InviteContext | null> {
  const { data: invite, error: inviteError } = await admin
    .from('venue_opportunity_invites')
    .select('*')
    .eq('id', inviteId)
    .maybeSingle()

  if (inviteError) throw new Error(`Failed to load opportunity invite: ${inviteError.message}`)
  if (!invite) return null

  const briefId = invite.brief_id ?? invite.opportunity_id
  if (!briefId) throw new Error('Opportunity invite is missing brief_id')

  const [{ data: brief, error: briefError }, venueResult] = await Promise.all([
    admin.from('venue_opportunity_briefs').select('*').eq('id', briefId).single(),
    invite.venue_id
      ? admin
          .from('venues')
          .select('id, venue_name, contact_email, city, state, standing_capacity')
          .eq('id', invite.venue_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (briefError || !brief) throw new Error(`Failed to load opportunity brief: ${briefError?.message ?? 'not found'}`)
  if (venueResult.error) throw new Error(`Failed to load invite venue: ${venueResult.error.message}`)

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id, user_id, title')
    .eq('id', brief.plan_id)
    .maybeSingle()

  if (planError) throw new Error(`Failed to load invite plan: ${planError.message}`)

  const { data: organizer, error: organizerError } = plan?.user_id
    ? await admin.from('profiles').select('id, name, email').eq('id', plan.user_id).maybeSingle()
    : { data: null, error: null }

  if (organizerError) throw new Error(`Failed to load invite organizer: ${organizerError.message}`)

  return {
    invite: invite as InviteRow,
    brief: brief as BriefRow,
    venue: (venueResult.data as VenueRow | null) ?? null,
    plan: (plan as PlanRow | null) ?? null,
    organizer: (organizer as ProfileRow | null) ?? null,
  }
}

async function loadVendorInviteContext(admin: SupabaseAdminClient, inviteId: string): Promise<VendorInviteContext | null> {
  const { data: invite, error: inviteError } = await admin
    .from('vendor_opportunity_invites')
    .select('*')
    .eq('id', inviteId)
    .maybeSingle()

  if (inviteError) throw new Error(`Failed to load vendor opportunity invite: ${inviteError.message}`)
  if (!invite) return null

  const [{ data: brief, error: briefError }, { data: vendor, error: vendorError }] = await Promise.all([
    admin.from('vendor_opportunity_briefs').select('*').eq('id', invite.brief_id).single(),
    admin
      .from('vendor_profiles')
      .select('id, name, contact_email, service_type, vendor_type')
      .eq('id', invite.vendor_id)
      .maybeSingle(),
  ])

  if (briefError || !brief) throw new Error(`Failed to load vendor opportunity brief: ${briefError?.message ?? 'not found'}`)
  if (vendorError) throw new Error(`Failed to load invite vendor: ${vendorError.message}`)

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id, user_id, title')
    .eq('id', brief.plan_id)
    .maybeSingle()

  if (planError) throw new Error(`Failed to load vendor invite plan: ${planError.message}`)

  const { data: organizer, error: organizerError } = plan?.user_id
    ? await admin.from('profiles').select('id, name, email').eq('id', plan.user_id).maybeSingle()
    : { data: null, error: null }

  if (organizerError) throw new Error(`Failed to load vendor invite organizer: ${organizerError.message}`)

  return {
    invite: invite as VendorInviteRow,
    brief: brief as VendorBriefRow,
    vendor: (vendor as VendorRow | null) ?? null,
    plan: (plan as PlanRow | null) ?? null,
    organizer: (organizer as ProfileRow | null) ?? null,
  }
}

async function sendOpportunityEmail(
  to: string,
  email: { subject: string; text: string; html: string }
) {
  const provider = 'resend'
  const apiKey = process.env.RESEND_API_KEY
  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.OPPORTUNITY_FROM_EMAIL ||
    process.env.NOTIFICATIONS_FROM_EMAIL ||
    '3rdPlace <hello@3rdplace.io>'

  if (!apiKey) {
    const invalidEmail = !looksLikeEmail(to)
    return {
      provider,
      outcome: invalidEmail ? 'provider_failure' : 'stubbed',
      statusCode: invalidEmail ? 422 : 202,
      responsePayload: invalidEmail
        ? { stubbed: true, accepted: false, reason: 'invalid_email' }
        : { stubbed: true, accepted: true },
      error: invalidEmail ? 'Email address appears invalid. Stubbed send recorded for operator visibility.' : null,
    }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  })

  const responseText = await response.text()
  const responsePayload = parseJson(responseText) ?? { body: responseText }

  if (!response.ok) {
    return {
      provider,
      outcome: 'provider_failure',
      statusCode: response.status,
      responsePayload,
      error: responseText || 'Resend rejected the opportunity email',
    }
  }

  return {
    provider,
    outcome: 'sent',
    statusCode: response.status,
    responsePayload,
    error: null,
  }
}

function buildVenueInviteEmail(context: InviteContext) {
  const subject = buildSubject(context)
  const responseUrl = buildResponseUrl(context.invite.magic_link_token, null)
  const declineUrl = buildResponseUrl(context.invite.magic_link_token, 'decline')
  const body = [
    context.brief.summary || context.brief.title || 'A 3rdPlace organizer wants to host an event at your venue.',
    `Capacity ask: ${context.brief.guest_count ?? 'TBD'} guests.`,
    `Budget range: ${formatBudget(context.brief.budget_cents)}.`,
    `Review/respond: ${responseUrl}`,
    `Decline: ${declineUrl}`,
    `Sent by 3rdPlace on behalf of ${getOrganizerFirstName(context)}.`,
  ].join('\n\n')

  return {
    subject,
    text: body,
    html: `<p>${escapeHtml(context.brief.summary || context.brief.title || 'A 3rdPlace organizer wants to host an event at your venue.')}</p>
<p><strong>Capacity ask:</strong> ${escapeHtml(context.brief.guest_count ?? 'TBD')} guests</p>
<p><strong>Budget range:</strong> ${escapeHtml(formatBudget(context.brief.budget_cents))}</p>
<p><a href="${escapeHtml(responseUrl)}">Review the opportunity</a></p>
<p><a href="${escapeHtml(declineUrl)}">Decline this opportunity</a></p>
<p style="color:#64748b;font-size:12px;">Sent by 3rdPlace on behalf of ${escapeHtml(getOrganizerFirstName(context))}.</p>`,
  }
}

function buildVenueReminderEmail(context: InviteContext, reminderLabel: string) {
  const subject = `Reminder: ${buildSubject(context)}`
  const responseUrl = buildResponseUrl(context.invite.magic_link_token, null)
  const body = `Quick reminder: this 3rdPlace hosting opportunity is waiting for your response (${reminderLabel} reminder).\n\nReview/respond: ${responseUrl}`

  return {
    subject,
    text: body,
    html: `<p>Quick reminder: this 3rdPlace hosting opportunity is waiting for your response.</p>
<p><a href="${escapeHtml(responseUrl)}">Review the opportunity</a></p>`,
  }
}

function buildVendorInviteEmail(context: VendorInviteContext) {
  const subject = buildVendorSubject(context)
  const responseUrl = buildResponseUrl(context.invite.magic_link_token, null)
  const declineUrl = buildResponseUrl(context.invite.magic_link_token, 'decline')
  const quoteLine = context.brief.quote_requested
    ? 'Please include quote amount, scope, and availability holds in your response.'
    : 'Please confirm availability and any scope notes.'
  const body = [
    context.brief.summary || 'A 3rdPlace organizer wants a vendor quote for an upcoming event.',
    `Package type: ${context.brief.package_type}.`,
    `Budget range: ${formatBudgetRangeText(context.brief.budget_range_cents)}.`,
    quoteLine,
    `Review/respond: ${responseUrl}`,
    `Decline: ${declineUrl}`,
    `Sent by 3rdPlace on behalf of ${getVendorOrganizerFirstName(context)}.`,
  ].join('\n\n')

  return {
    subject,
    text: body,
    html: `<p>${escapeHtml(context.brief.summary || 'A 3rdPlace organizer wants a vendor quote for an upcoming event.')}</p>
<p><strong>Package type:</strong> ${escapeHtml(context.brief.package_type)}</p>
<p><strong>Budget range:</strong> ${escapeHtml(formatBudgetRangeText(context.brief.budget_range_cents))}</p>
<p>${escapeHtml(quoteLine)}</p>
<p><a href="${escapeHtml(responseUrl)}">Review the request</a></p>
<p><a href="${escapeHtml(declineUrl)}">Decline this request</a></p>
<p style="color:#64748b;font-size:12px;">Sent by 3rdPlace on behalf of ${escapeHtml(getVendorOrganizerFirstName(context))}.</p>`,
  }
}

function buildVendorReminderEmail(context: VendorInviteContext, reminderLabel: string) {
  const subject = `Reminder: ${buildVendorSubject(context)}`
  const responseUrl = buildResponseUrl(context.invite.magic_link_token, null)
  const body = `Quick reminder: this 3rdPlace vendor request is waiting for your response (${reminderLabel} reminder).\n\nReview/respond: ${responseUrl}`

  return {
    subject,
    text: body,
    html: `<p>Quick reminder: this 3rdPlace vendor request is waiting for your response.</p>
<p><a href="${escapeHtml(responseUrl)}">Review the request</a></p>`,
  }
}

function buildSubject(context: InviteContext) {
  const eventType = context.brief.event_type || 'Event'
  const area = context.brief.neighborhood || context.venue?.city || 'Bay Area'
  const dateWindow = formatDateWindow(context.brief)
  return `${eventType} hosting opportunity — ${area}, ${dateWindow}`
}

function buildVendorSubject(context: VendorInviteContext) {
  const packageType = context.brief.package_type || context.vendor?.service_type || 'Vendor'
  const planTitle = context.plan?.title || 'Event'
  const dateNeeded = context.brief.date_needed || 'date flexible'
  return `${packageType} quote request — ${planTitle}, ${dateNeeded}`
}

function buildResponseUrl(token: string | null, action: 'decline' | null) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  const safeToken = token ?? 'missing-token'
  const url = new URL(`/v/respond/${safeToken}`, baseUrl)
  if (action) url.searchParams.set('action', action)
  return url.toString()
}

function buildLogPayload(context: InviteContext) {
  return {
    invite_id: context.invite.id,
    brief_id: context.brief.id,
    plan_id: context.brief.plan_id,
    venue_id: context.invite.venue_id,
    venue_name: context.venue?.venue_name ?? null,
  }
}

function buildVendorLogPayload(context: VendorInviteContext) {
  return {
    invite_id: context.invite.id,
    brief_id: context.brief.id,
    plan_id: context.brief.plan_id,
    vendor_id: context.invite.vendor_id,
    vendor_name: context.vendor?.name ?? null,
    package_type: context.brief.package_type,
  }
}

async function logWebhookAttempt(
  admin: SupabaseAdminClient,
  params: {
    eventType: string
    entityType?: string
    entityId: string
    provider: string
    outcome: string
    statusCode?: number | null
    requestPayload: JsonObject
    responsePayload?: JsonObject | null
    error?: string | null
  }
) {
  const { error } = await admin.from('webhook_logs').insert({
    source: OPPORTUNITY_SOURCE,
    event_type: params.eventType,
    entity_type: params.entityType ?? 'venue_opportunity_invite',
    entity_id: params.entityId,
    provider: params.provider,
    outcome: params.outcome,
    status_code: params.statusCode ?? null,
    request_payload: params.requestPayload,
    response_payload: params.responsePayload ?? {},
    error: params.error ?? null,
  })

  if (error) throw new Error(`Failed to log opportunity email attempt: ${error.message}`)
}

async function updateInvite(admin: SupabaseAdminClient, inviteId: string, updates: Record<string, unknown>) {
  const { error } = await admin.from('venue_opportunity_invites').update(updates).eq('id', inviteId)
  if (error) throw new Error(`Failed to update opportunity invite: ${error.message}`)
}

async function updateVendorInvite(admin: SupabaseAdminClient, inviteId: string, updates: Record<string, unknown>) {
  const { error } = await admin.from('vendor_opportunity_invites').update(updates).eq('id', inviteId)
  if (error) throw new Error(`Failed to update vendor opportunity invite: ${error.message}`)
}

async function updateApprovalMessageStats(admin: SupabaseAdminClient, briefId: string) {
  const stats = await loadInviteStats(admin, briefId)
  const { data: messages, error } = await admin
    .from('plan_messages')
    .select('id, metadata')
    .eq('plan_id', stats.plan_id)
    .eq('message_type', 'approval_request')

  if (error) throw new Error(`Failed to load approval messages for invite stats: ${error.message}`)

  await Promise.all(
    ((messages ?? []) as Array<{ id: string; metadata: JsonObject | null }>).map(async (message) => {
      if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) return

      const opportunity = message.metadata.opportunity
      if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) return
      if ((opportunity as JsonObject).id !== briefId) return

      const approval = message.metadata.approval
      const nextMetadata = {
        ...message.metadata,
        invite_stats: stats,
        approval:
          approval && typeof approval === 'object' && !Array.isArray(approval)
            ? { ...approval, invite_stats: stats }
            : approval,
      }

      const { error: updateError } = await admin
        .from('plan_messages')
        .update({ metadata: nextMetadata })
        .eq('id', message.id)

      if (updateError) throw new Error(`Failed to update approval invite stats: ${updateError.message}`)
    })
  )
}

async function updateVendorApprovalMessageStats(admin: SupabaseAdminClient, briefId: string) {
  const stats = await loadVendorInviteStats(admin, briefId)
  const { data: messages, error } = await admin
    .from('plan_messages')
    .select('id, metadata')
    .eq('plan_id', stats.plan_id)
    .eq('message_type', 'approval_request')

  if (error) throw new Error(`Failed to load approval messages for vendor invite stats: ${error.message}`)

  await Promise.all(
    ((messages ?? []) as Array<{ id: string; metadata: JsonObject | null }>).map(async (message) => {
      if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) return

      const opportunity = message.metadata.opportunity
      if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) return
      const opportunityId = (opportunity as JsonObject).vendor_opportunity_brief_id ?? (opportunity as JsonObject).id
      if (opportunityId !== briefId) return

      const approval = message.metadata.approval
      const nextMetadata = {
        ...message.metadata,
        invite_stats: stats,
        approval:
          approval && typeof approval === 'object' && !Array.isArray(approval)
            ? { ...approval, invite_stats: stats }
            : approval,
      }

      const { error: updateError } = await admin
        .from('plan_messages')
        .update({ metadata: nextMetadata })
        .eq('id', message.id)

      if (updateError) throw new Error(`Failed to update vendor approval invite stats: ${updateError.message}`)
    })
  )
}

async function loadInviteStats(admin: SupabaseAdminClient, briefId: string) {
  const [{ data: brief, error: briefError }, { data: invites, error: inviteError }] = await Promise.all([
    admin.from('venue_opportunity_briefs').select('id, plan_id').eq('id', briefId).single(),
    admin.from('venue_opportunity_invites').select('id, status, sent_at, viewed_at, response_at, responded_at').eq('brief_id', briefId),
  ])

  if (briefError || !brief) throw new Error(`Failed to load brief for invite stats: ${briefError?.message ?? 'not found'}`)
  if (inviteError) throw new Error(`Failed to load invites for stats: ${inviteError.message}`)

  const rows = (invites ?? []) as InviteRow[]
  const sentRows = rows.filter((invite) => Boolean(invite.sent_at) || ['sent', 'viewed', 'accepted', 'declined', 'countered', 'expired'].includes(invite.status))
  const viewedRows = rows.filter((invite) => Boolean(invite.viewed_at) || ['viewed', 'accepted', 'declined', 'countered'].includes(invite.status))
  const respondedRows = rows.filter((invite) => hasInviteResponded(invite) && invite.status !== 'expired' && invite.status !== 'cancelled')

  return {
    plan_id: brief.plan_id,
    brief_id: briefId,
    total_count: rows.length,
    queued_count: rows.filter((invite) => invite.status === 'queued').length,
    sent_count: sentRows.length,
    viewed_count: viewedRows.length,
    responded_count: respondedRows.length,
    concierge_followup_count: rows.filter((invite) => invite.status === 'concierge_followup').length,
    expired_count: rows.filter((invite) => invite.status === 'expired').length,
    last_sent_at: sentRows
      .map((invite) => invite.sent_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort()
      .at(-1) ?? null,
  }
}

async function loadVendorInviteStats(admin: SupabaseAdminClient, briefId: string) {
  const [{ data: brief, error: briefError }, { data: invites, error: inviteError }] = await Promise.all([
    admin.from('vendor_opportunity_briefs').select('id, plan_id').eq('id', briefId).single(),
    admin.from('vendor_opportunity_invites').select('id, status, sent_at, viewed_at, response_at').eq('brief_id', briefId),
  ])

  if (briefError || !brief) throw new Error(`Failed to load vendor brief for invite stats: ${briefError?.message ?? 'not found'}`)
  if (inviteError) throw new Error(`Failed to load vendor invites for stats: ${inviteError.message}`)

  const rows = (invites ?? []) as VendorInviteRow[]
  const sentRows = rows.filter((invite) => Boolean(invite.sent_at) || ['sent', 'viewed', 'accepted', 'declined', 'countered', 'expired'].includes(invite.status))
  const viewedRows = rows.filter((invite) => Boolean(invite.viewed_at) || ['viewed', 'accepted', 'declined', 'countered'].includes(invite.status))
  const respondedRows = rows.filter((invite) => hasInviteResponded(invite) && invite.status !== 'expired')

  return {
    plan_id: brief.plan_id,
    brief_id: briefId,
    total_count: rows.length,
    queued_count: rows.filter((invite) => invite.status === 'queued').length,
    sent_count: sentRows.length,
    viewed_count: viewedRows.length,
    responded_count: respondedRows.length,
    concierge_followup_count: rows.filter((invite) => invite.status === 'concierge_followup').length,
    expired_count: rows.filter((invite) => invite.status === 'expired').length,
    last_sent_at: sentRows
      .map((invite) => invite.sent_at)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort()
      .at(-1) ?? null,
  }
}

function readInviteId(job: AppJob) {
  const inviteId = job.payload.inviteId
  if (typeof inviteId !== 'string' || !inviteId) throw new Error('Missing inviteId')
  return inviteId
}

function readReminderLabel(job: AppJob) {
  const reminderLabel = job.payload.reminderLabel
  return typeof reminderLabel === 'string' && reminderLabel ? reminderLabel : 'reminder'
}

function hasInviteResponded(invite: { status: string; response_at?: string | null; responded_at?: string | null }) {
  return RESPONDED_STATUSES.has(invite.status) || Boolean(invite.response_at || invite.responded_at)
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateWindow(brief: BriefRow) {
  if (brief.date_window_start && brief.date_window_end && brief.date_window_start !== brief.date_window_end) {
    return `${brief.date_window_start} to ${brief.date_window_end}`
  }
  return brief.date_window_start || brief.date_window_end || 'date flexible'
}

function formatBudget(cents: number | null) {
  if (!cents || cents <= 0) return 'Budget TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatBudgetRangeText(range: string | null) {
  if (!range) return 'Budget TBD'
  const matches = range.match(/\d+/g)
  if (!matches || matches.length === 0) return 'Budget TBD'
  const [lowerRaw, upperRaw] = matches
  const lower = Number(lowerRaw)
  const upper = Number(upperRaw ?? lowerRaw)
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return 'Budget TBD'
  if (lower <= 0) return formatBudget(upper)
  return `${formatBudget(lower)} - ${formatBudget(upper)}`
}

function getOrganizerFirstName(context: InviteContext) {
  const name = context.organizer?.name || context.organizer?.email || 'the organizer'
  return name.split(/\s+/)[0] || 'the organizer'
}

function getVendorOrganizerFirstName(context: VendorInviteContext) {
  const name = context.organizer?.name || context.organizer?.email || 'the organizer'
  return name.split(/\s+/)[0] || 'the organizer'
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseJson(value: string) {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
