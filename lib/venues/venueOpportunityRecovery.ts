import 'server-only'

import type Stripe from 'stripe'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { sendEmailNotification } from '@/lib/email'
import { centsToDollars } from '@/lib/money'
import { getOpportunityResponseContext } from '@/lib/opportunities/tokenValidate'
import { enqueueJob, type AppJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import {
  getAppBaseUrl,
  getStripeClient,
  saveVenueStripeAccount,
  type VenueStripeAccountRecord,
} from '@/lib/stripe/connect'

type SupabaseAdminClient = any

export type VenueStripeReminderDay = 'day0' | 'day1' | 'day7' | 'day14'

export type VenueOpportunityRecoveryContext = {
  token: string
  invite: Record<string, unknown>
  brief: Record<string, unknown>
  venue: Record<string, unknown>
  organizer: Record<string, unknown> | null
  owner: Record<string, unknown> | null
  stripeAccount: VenueStripeAccountRecord | null
  amountCents: number
  stripeReady: boolean
}

const REMINDER_SCHEDULE: Array<{ day: VenueStripeReminderDay; delayDays: number }> = [
  { day: 'day0', delayDays: 0 },
  { day: 'day1', delayDays: 1 },
  { day: 'day7', delayDays: 7 },
  { day: 'day14', delayDays: 14 },
]

const TERMINAL_INVITE_STATUSES = new Set(['declined', 'expired', 'cancelled'])
const BLOCKED_STRIPE_STATUSES = new Set(['restricted', 'disabled'])

export async function loadVenueOpportunityRecoveryContext(
  admin: SupabaseAdminClient,
  token: string
): Promise<VenueOpportunityRecoveryContext | null> {
  const responseContext = await getOpportunityResponseContext(admin, token)
  if (!responseContext || responseContext.kind !== 'venue') return null

  const venueId = readString(responseContext.invite.venue_id)
  if (!venueId) return null

  const [{ data: venue, error: venueError }, { data: organizer, error: organizerError }] = await Promise.all([
    admin
      .from('venues')
      .select('id, venue_name, contact_email, owner_id, claimed_user_id, is_claimed, address, city, state, standing_capacity, venue_type, is_admin_seeded')
      .eq('id', venueId)
      .maybeSingle(),
    readString(responseContext.brief.organizer_user_id)
      ? admin
          .from('users')
          .select('id, email, company_name, name')
          .eq('id', responseContext.brief.organizer_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (venueError) throw new Error(`Failed to load venue: ${venueError.message}`)
  if (organizerError) throw new Error(`Failed to load organizer: ${organizerError.message}`)
  if (!venue) return null

  const ownerId = readString((venue as Record<string, unknown>).owner_id)
  const [{ data: owner, error: ownerError }, { data: stripeAccount, error: stripeError }] = await Promise.all([
    ownerId
      ? admin.from('users').select('id, email, company_name, name, role, user_type').eq('id', ownerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ownerId
      ? admin
          .from('venue_stripe_accounts')
          .select('stripe_account_id, account_status, charges_enabled, payouts_enabled, requirements_due, owner_id')
          .eq('owner_id', ownerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (ownerError) throw new Error(`Failed to load venue owner: ${ownerError.message}`)
  if (stripeError) throw new Error(`Failed to load venue Stripe account: ${stripeError.message}`)

  const account = (stripeAccount as VenueStripeAccountRecord | null) ?? null

  return {
    token,
    invite: responseContext.invite,
    brief: responseContext.brief,
    venue: venue as Record<string, unknown>,
    organizer: (organizer as Record<string, unknown> | null) ?? null,
    owner: (owner as Record<string, unknown> | null) ?? null,
    stripeAccount: account,
    amountCents: resolveVenueOpportunityAmountCents(responseContext.invite, responseContext.brief),
    stripeReady: isVenueStripeReady(account),
  }
}

export function isVenueStripeReady(account: VenueStripeAccountRecord | null) {
  if (!account?.stripe_account_id) return false
  if (BLOCKED_STRIPE_STATUSES.has(String(account.account_status ?? ''))) return false
  return Boolean(account.payouts_enabled)
}

export async function handleAcceptedVenueOpportunityRecovery(
  admin: SupabaseAdminClient,
  token: string
) {
  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  if (!context) return { status: 'not_found' as const }
  if (context.amountCents <= 0) return { status: 'no_payment_required' as const, context }
  if (context.stripeReady) return { status: 'stripe_ready' as const, context }

  await markVenueOpportunityPendingStripeSetup(admin, context)
  await enqueueVenueStripeSetupReminderJobs(admin, context)

  return { status: 'pending_stripe_setup' as const, context }
}

export async function claimVenueOpportunityForUser(
  admin: SupabaseAdminClient,
  params: {
    token: string
    userId: string
  }
) {
  const context = await loadVenueOpportunityRecoveryContext(admin, params.token)
  if (!context) return { ok: false as const, error: 'Venue opportunity not found.' }

  const existingOwnerId = readString(context.venue.owner_id)
  if (existingOwnerId && existingOwnerId !== params.userId) {
    return { ok: false as const, error: 'This venue opportunity is already attached to another venue account.' }
  }

  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, email, company_name, name, role, user_type')
    .eq('id', params.userId)
    .maybeSingle()

  if (userError || !user) return { ok: false as const, error: 'Venue owner account not found.' }

  const role = readString((user as Record<string, unknown>).role)
  const userType = readString((user as Record<string, unknown>).user_type)
  if (role !== 'owner' && userType !== 'venue_owner') {
    return { ok: false as const, error: 'Sign in with a venue account to claim this opportunity.' }
  }

  const now = new Date().toISOString()
  const venueName = readString(context.venue.venue_name) ?? readString((user as Record<string, unknown>).company_name) ?? 'Venue'

  const { error: ownerProfileError } = await admin
    .from('owner_profiles')
    .upsert(
      {
        user_id: params.userId,
        name: readString((user as Record<string, unknown>).name) ?? venueName,
        business_name: venueName,
        business_type: readString(context.venue.venue_type) ?? 'venue',
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )

  if (ownerProfileError) {
    return { ok: false as const, error: `Could not prepare venue profile: ${ownerProfileError.message}` }
  }

  const { error: venueError } = await admin
    .from('venues')
    .update({
      owner_id: params.userId,
      claimed_user_id: params.userId,
      is_claimed: true,
      contact_email: readString(context.venue.contact_email) ?? readString((user as Record<string, unknown>).email),
      updated_at: now,
    })
    .eq('id', context.venue.id)
    .or(`owner_id.is.null,owner_id.eq.${params.userId}`)

  if (venueError) {
    return { ok: false as const, error: `Could not claim venue: ${venueError.message}` }
  }

  const { error: inviteError } = await admin
    .from('venue_opportunity_invites')
    .update({
      is_claimed: true,
      updated_at: now,
    })
    .eq('id', context.invite.id)

  if (inviteError) {
    return { ok: false as const, error: `Could not attach opportunity: ${inviteError.message}` }
  }

  return {
    ok: true as const,
    redirectTo: getVenueProfileCompletePath(params.token),
  }
}

export async function startVenueOpportunityStripeResume(
  admin: SupabaseAdminClient,
  request: Request,
  token: string
) {
  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  if (!context) return { ok: false as const, redirectTo: '/venue/claim?error=not_found' }

  const ownerId = readString(context.venue.owner_id)
  if (!ownerId || !context.owner) {
    return { ok: false as const, redirectTo: `/venue/claim?token=${encodeURIComponent(token)}` }
  }

  const stripe = getStripeClient()
  const baseUrl = getAppBaseUrl(request)
  const returnPath = `/venue/opportunity/${encodeURIComponent(token)}/stripe-complete`
  const refreshPath = `/api/venue/opportunity/${encodeURIComponent(token)}/stripe-resume?refresh=1`

  let account: Stripe.Account | null = null

  if (context.stripeAccount?.stripe_account_id) {
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'venue_stripe_accounts',
      rowId: ownerId,
      currentAccountId: context.stripeAccount.stripe_account_id,
    })
    account = validation.account ?? null
  }

  if (!account) {
    account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: readString(context.owner.email) ?? undefined,
      business_profile: {
        name: readString(context.venue.venue_name) ?? readString(context.owner.company_name) ?? undefined,
        url: baseUrl,
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        venue_owner_id: ownerId,
        venue_id: String(context.venue.id),
        opportunity_invite_id: String(context.invite.id),
        user_id: ownerId,
      },
    })
  }

  await saveVenueStripeAccount(admin as any, ownerId, account)
  await markVenueOpportunityPendingStripeSetup(admin, context)

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${baseUrl}${refreshPath}`,
    return_url: `${baseUrl}${returnPath}`,
    type: 'account_onboarding',
  })

  return { ok: true as const, url: accountLink.url }
}

export async function processVenueStripeSetupReminderJob(
  admin: SupabaseAdminClient,
  job: AppJob
) {
  const token = readString(job.payload.token)
  const reminderDay = readString(job.payload.reminderDay) as VenueStripeReminderDay | null
  if (!token || !isReminderDay(reminderDay)) throw new Error('Missing venue Stripe reminder payload')

  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  if (!context) return { ignored: true, reason: 'opportunity_not_found' }
  if (TERMINAL_INVITE_STATUSES.has(readString(context.invite.status) ?? '')) {
    return { ignored: true, reason: 'terminal_status' }
  }

  if (context.stripeReady) {
    const result = await handleVenueStripeReadyForOwner(admin, readString(context.venue.owner_id) ?? '')
    return { ignored: false, stripeReady: true, result }
  }

  const result = await sendVenueStripeSetupReminderEmail(context, reminderDay)
  return { sent: result.sent, reminderDay }
}

export async function handleVenueStripeReadyForOwner(
  admin: SupabaseAdminClient,
  ownerId: string
) {
  if (!ownerId) return { updated: 0 }

  const { data: venues, error: venuesError } = await admin
    .from('venues')
    .select('id')
    .eq('owner_id', ownerId)

  if (venuesError) throw new Error(`Failed to load claimed venues: ${venuesError.message}`)
  const venueIds = ((venues ?? []) as Array<{ id?: string }>).map((venue) => venue.id).filter(Boolean)
  if (venueIds.length === 0) return { updated: 0 }

  let updated = 0
  for (const venueId of venueIds) {
    const { data: invites, error: invitesError } = await admin
      .from('venue_opportunity_invites')
      .select('id, magic_link_token, status')
      .eq('venue_id', venueId)
      .eq('status', 'pending_stripe_setup')

    if (invitesError) throw new Error(`Failed to load pending venue opportunities: ${invitesError.message}`)

    for (const invite of (invites ?? []) as Array<Record<string, unknown>>) {
      const token = readString(invite.magic_link_token)
      if (!token) continue
      const context = await loadVenueOpportunityRecoveryContext(admin, token)
      if (!context) continue

      const now = new Date().toISOString()
      const { data: saved, error: updateError } = await admin
        .from('venue_opportunity_invites')
        .update({
          status: 'payment_confirmation_requested',
          stripe_ready_at: now,
          payment_confirmation_requested_at: now,
          updated_at: now,
        })
        .eq('id', context.invite.id)
        .eq('status', 'pending_stripe_setup')
        .select('id')
        .maybeSingle()

      if (updateError) throw new Error(`Failed to mark venue opportunity Stripe-ready: ${updateError.message}`)
      if (!saved) continue

      await cancelVenueStripeReminderJobs(admin, String(context.invite.id))
      await Promise.all([
        sendVenueStripeReadyEmail(context),
        sendOrganizerVenuePaymentReadyEmail(context),
      ])
      updated += 1
    }
  }

  return { updated }
}

export async function declineVenueOpportunity(
  admin: SupabaseAdminClient,
  params: {
    token: string
    reason?: string | null
  }
) {
  const context = await loadVenueOpportunityRecoveryContext(admin, params.token)
  if (!context) return { ok: false as const, error: 'Venue opportunity not found.' }

  const now = new Date().toISOString()
  const reason = params.reason?.trim() || null
  const responsePayload = {
    action: 'decline',
    status: 'declined',
    notes: reason,
    responded_at: now,
  }

  const { error } = await admin
    .from('venue_opportunity_invites')
    .update({
      status: 'declined',
      response_at: now,
      responded_at: now,
      declined_at: now,
      decline_reason: reason,
      response_payload: responsePayload,
      venue_response_json: responsePayload,
      updated_at: now,
    })
    .eq('id', context.invite.id)

  if (error) return { ok: false as const, error: `Could not decline opportunity: ${error.message}` }

  await cancelVenueStripeReminderJobs(admin, String(context.invite.id))
  await Promise.all([
    sendVenueDeclineConfirmationEmail(context),
    sendOrganizerVenueDeclinedEmail(context, reason),
  ])

  return { ok: true as const }
}

export async function updateVenueProfileFromCompleteForm(
  admin: SupabaseAdminClient,
  params: {
    userId: string
    token?: string | null
    venueName: string
    address: string
    city: string
    state: string
    zipCode: string
    capacity: number
    venueType?: string | null
    contactEmail?: string | null
  }
) {
  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id')
    .eq('owner_id', params.userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (venueError) return { ok: false as const, error: 'Could not load venue profile.' }
  if (!venue?.id) return { ok: false as const, error: 'Venue profile not found.' }

  const { error } = await admin
    .from('venues')
    .update({
      venue_name: params.venueName,
      address: params.address,
      city: params.city,
      state: params.state.toUpperCase(),
      zip_code: params.zipCode,
      standing_capacity: params.capacity,
      seated_capacity: params.capacity,
      venue_type: params.venueType ?? null,
      contact_email: params.contactEmail ?? null,
      is_claimed: true,
      claimed_user_id: params.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', (venue as { id: string }).id)

  if (error) return { ok: false as const, error: `Could not update venue profile: ${error.message}` }

  return {
    ok: true as const,
    redirectTo: params.token
      ? `/api/venue/opportunity/${encodeURIComponent(params.token)}/stripe-resume`
      : '/venue/payouts',
  }
}

async function markVenueOpportunityPendingStripeSetup(
  admin: SupabaseAdminClient,
  context: VenueOpportunityRecoveryContext
) {
  if (TERMINAL_INVITE_STATUSES.has(readString(context.invite.status) ?? '')) return
  const now = new Date().toISOString()
  const { error } = await admin
    .from('venue_opportunity_invites')
    .update({
      status: 'pending_stripe_setup',
      stripe_setup_started_at: readString(context.invite.stripe_setup_started_at) ?? now,
      updated_at: now,
    })
    .eq('id', context.invite.id)

  if (error) throw new Error(`Failed to mark venue opportunity pending Stripe setup: ${error.message}`)
}

async function enqueueVenueStripeSetupReminderJobs(
  admin: SupabaseAdminClient,
  context: VenueOpportunityRecoveryContext
) {
  for (const reminder of REMINDER_SCHEDULE) {
    await enqueueJob(admin as SupabaseJobClient, {
      jobType: 'venue.stripe_setup_reminder',
      uniqueKey: getVenueStripeReminderUniqueKey(String(context.invite.id), reminder.day),
      scheduledAt: addDays(new Date(), reminder.delayDays).toISOString(),
      maxAttempts: 3,
      payload: {
        token: context.token,
        inviteId: String(context.invite.id),
        venueId: String(context.venue.id),
        planId: readString(context.brief.plan_id) ?? '',
        reminderDay: reminder.day,
      },
    })
  }
}

async function cancelVenueStripeReminderJobs(admin: SupabaseAdminClient, inviteId: string) {
  for (const reminder of REMINDER_SCHEDULE) {
    await admin
      .from('app_jobs')
      .update({
        status: 'succeeded',
        result: { cancelled: true, reason: 'venue_stripe_ready' },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('unique_key', getVenueStripeReminderUniqueKey(inviteId, reminder.day))
      .eq('status', 'pending')
  }
}

async function sendVenueStripeSetupReminderEmail(
  context: VenueOpportunityRecoveryContext,
  reminderDay: VenueStripeReminderDay
) {
  const to = getVenueEmail(context)
  if (!to) return skippedEmail('Venue email not found')

  const venueName = getVenueName(context)
  const title = getEventTitle(context)
  const actionUrl = buildAppUrl(`/api/venue/opportunity/${encodeURIComponent(context.token)}/stripe-resume`)
  const reminderCopy = getReminderCopy(reminderDay)

  return sendEmailNotification({
    to,
    subject: reminderCopy.subject(title),
    templateType: 'payment_due',
    actionUrl,
    body: [
      `Hi ${venueName},`,
      reminderCopy.lead(title),
      `Expected venue payment: ${formatMoney(context.amountCents)}.`,
      'The organizer cannot confirm payment until Stripe Connect is complete.',
      'This setup uses Stripe-hosted onboarding. 3rdPlace never sees your bank details.',
    ].join('\n\n'),
  })
}

async function sendVenueStripeReadyEmail(context: VenueOpportunityRecoveryContext) {
  const to = getVenueEmail(context)
  if (!to) return skippedEmail('Venue email not found')

  return sendEmailNotification({
    to,
    subject: `Stripe is ready for ${getEventTitle(context)}`,
    templateType: 'payment_received',
    actionUrl: buildAppUrl(`/venue/opportunity/${encodeURIComponent(context.token)}/stripe-complete`),
    body: [
      `Hi ${getVenueName(context)},`,
      `Your Stripe payout setup is ready for "${getEventTitle(context)}".`,
      'We notified the organizer to review and confirm the venue payment from their planner workspace.',
      'No payment is charged automatically by this step.',
    ].join('\n\n'),
  })
}

async function sendOrganizerVenuePaymentReadyEmail(context: VenueOpportunityRecoveryContext) {
  const to = readString(context.organizer?.email)
  if (!to) return skippedEmail('Organizer email not found')

  const planId = readString(context.brief.plan_id)
  const actionUrl = buildAppUrl(planId ? `/planner?plan=${encodeURIComponent(planId)}&tab=approvals` : '/planner')

  return sendEmailNotification({
    to,
    subject: `${getVenueName(context)} finished payout setup`,
    templateType: 'payment_due',
    actionUrl,
    body: [
      `Hi ${getOrganizerName(context)},`,
      `${getVenueName(context)} finished Stripe payout setup for "${getEventTitle(context)}".`,
      `Expected venue payment: ${formatMoney(context.amountCents)}.`,
      'Review the opportunity in your planner and confirm payment when the terms still look correct.',
      '3rdPlace does not charge the venue payment automatically.',
    ].join('\n\n'),
  })
}

async function sendVenueDeclineConfirmationEmail(context: VenueOpportunityRecoveryContext) {
  const to = getVenueEmail(context)
  if (!to) return skippedEmail('Venue email not found')

  return sendEmailNotification({
    to,
    subject: `Declined - ${getEventTitle(context)}`,
    templateType: 'generic',
    actionUrl: buildAppUrl(`/v/respond/${encodeURIComponent(context.token)}`),
    body: [
      `Hi ${getVenueName(context)},`,
      `We recorded that "${getEventTitle(context)}" is not a fit this time.`,
      'The organizer has been notified.',
    ].join('\n\n'),
  })
}

async function sendOrganizerVenueDeclinedEmail(
  context: VenueOpportunityRecoveryContext,
  reason: string | null
) {
  const to = readString(context.organizer?.email)
  if (!to) return skippedEmail('Organizer email not found')

  return sendEmailNotification({
    to,
    subject: `${getVenueName(context)} declined ${getEventTitle(context)}`,
    templateType: 'generic',
    actionUrl: buildAppUrl(`/planner?plan=${encodeURIComponent(readString(context.brief.plan_id) ?? '')}&tab=recommendations`),
    body: [
      `Hi ${getOrganizerName(context)},`,
      `${getVenueName(context)} declined the opportunity for "${getEventTitle(context)}".`,
      reason ? `Reason: ${reason}` : 'No reason was included.',
      'Review your recommendations to pick another venue or adjust the brief.',
    ].join('\n\n'),
  })
}

function resolveVenueOpportunityAmountCents(invite: Record<string, unknown>, brief: Record<string, unknown>) {
  return firstPositiveNumber([
    readNumber(invite.proposed_deposit_cents),
    readNumber(invite.quoted_price_cents),
    readNumber(brief.deposit_target_cents),
    readNumber(brief.budget_cents),
  ])
}

function firstPositiveNumber(values: Array<number | null>) {
  return values.find((value): value is number => typeof value === 'number' && value > 0) ?? 0
}

function getVenueStripeReminderUniqueKey(inviteId: string, day: VenueStripeReminderDay) {
  return `venue-stripe-setup:${inviteId}:${day}`
}

function getReminderCopy(day: VenueStripeReminderDay) {
  if (day === 'day1') {
    return {
      subject: (title: string) => `Reminder: finish payout setup for ${title}`,
      lead: (title: string) => `Your acceptance for "${title}" is saved, but payout setup is still incomplete.`,
    }
  }
  if (day === 'day7') {
    return {
      subject: (title: string) => `Payout setup still needed for ${title}`,
      lead: (title: string) => `"${title}" is still waiting on Stripe payout setup before payment can be confirmed.`,
    }
  }
  if (day === 'day14') {
    return {
      subject: (title: string) => `Final reminder: ${title} payout setup`,
      lead: (title: string) => `This is the final automatic reminder for "${title}" before 3rdPlace routes the stalled payment to operations.`,
    }
  }
  return {
    subject: (title: string) => `Finish payout setup for ${title}`,
    lead: (title: string) => `Thanks for accepting "${title}". Complete Stripe payout setup so the organizer can confirm payment.`,
  }
}

function getVenueEmail(context: VenueOpportunityRecoveryContext) {
  return readString(context.venue.contact_email) ?? readString(context.owner?.email)
}

function getVenueName(context: VenueOpportunityRecoveryContext) {
  return readString(context.venue.venue_name) ?? readString(context.owner?.company_name) ?? 'there'
}

function getOrganizerName(context: VenueOpportunityRecoveryContext) {
  return readString(context.organizer?.company_name) ?? readString(context.organizer?.name) ?? 'there'
}

function getEventTitle(context: VenueOpportunityRecoveryContext) {
  return readString(context.brief.title) ?? 'your event'
}

function getVenueProfileCompletePath(token: string) {
  return `/venue/profile/complete?opportunity_token=${encodeURIComponent(token)}`
}

function formatMoney(cents: number) {
  return `$${centsToDollars(cents).toFixed(2)}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function buildAppUrl(path: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function isReminderDay(value: string | null): value is VenueStripeReminderDay {
  return value === 'day0' || value === 'day1' || value === 'day7' || value === 'day14'
}

function skippedEmail(reason: string) {
  return {
    sent: false,
    reason,
    responsePayload: null,
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}
