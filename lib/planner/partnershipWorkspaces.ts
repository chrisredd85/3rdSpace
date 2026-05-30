import type {
  Json,
  PartnershipDocument,
  PartnershipDocumentKind,
  PartnershipMessage,
  PartnershipMilestone,
  PartnershipPartnerKind,
  PartnershipThread,
} from '@/lib/types'
import { dollarsToCents, toFiniteNumber } from '@/lib/money'

type PlannerDb = { from: (table: string) => any }

interface OpportunityInviteRow {
  id: string
  brief_id: string
  opportunity_id?: string | null
  target_type: string
  venue_id: string | null
  vendor_profile_id: string | null
  status: string
  proposed_deposit_cents: number | null
  quoted_price_cents: number | null
  response_payload?: Json | null
  venue_response_json?: Json | null
  response_at?: string | null
  responded_at?: string | null
  created_at: string
}

interface PartnerDisplayRow {
  id: string
  name: string
  category: string
  address: string | null
  city: string | null
  contact_name: string | null
  parking_notes: string | null
}

interface VenueRentalBookingContext {
  id: string
  status: string | null
  amount_cents: number
}

interface VenueRentalTransactionContext {
  id: string
  status: string
  amount_cents: number
  processing_fee_cents: number
  refund_amount_cents: number | null
  refund_reason: string | null
  paid_at: string | null
  refund_requested_at: string | null
  refund_approved_at: string | null
  stripe_transfer_id: string | null
}

export interface PartnershipWorkspace {
  thread: PartnershipThread
  partner: PartnerDisplayRow
  invite: {
    id: string
    proposed_deposit_cents: number | null
    quoted_price_cents: number | null
    response_payload: Json
  }
  messages: PartnershipMessage[]
  milestones: PartnershipMilestone[]
  documents: PartnershipDocument[]
  logistics: {
    load_in_time: string | null
    contact_name: string | null
    address: string | null
    parking_notes: string | null
  }
  payment_status: {
    label: string
    deposit_cents: number | null
    is_deposit_paid: boolean
  }
  venue_rental?: {
    venue_booking: VenueRentalBookingContext | null
    transaction: VenueRentalTransactionContext | null
  } | null
  next_required_action: string
}

type PartnershipActionInput =
  | { action: 'send_message'; threadId: string; body: string }
  | { action: 'mark_deposit_placed'; threadId: string }
  | { action: 'upload_document'; threadId: string; kind: PartnershipDocumentKind; url: string; signedAt?: string | null }
  | { action: 'complete_milestone'; threadId: string; milestoneId: string }

/**
 * Lists booked partner workspaces for accepted venue/vendor invites.
 *
 * Accepted invites are surfaced only when the deposit step is unblocked: either
 * no deposit is required, or the invite response payload says deposit collection
 * can proceed.
 */
export async function listPartnershipWorkspaces(
  db: PlannerDb,
  planId: string,
  partnerKind?: PartnershipPartnerKind
): Promise<PartnershipWorkspace[]> {
  const invites = await loadAcceptedEligibleInvites(db, planId, partnerKind)
  if (invites.length === 0) return []
  const planOwnerId = await loadPlanOwnerId(db, planId)

  const workspaces: PartnershipWorkspace[] = []
  for (const invite of invites) {
    const kind = getInvitePartnerKind(invite)
    const partnerId = getInvitePartnerId(invite)
    if (!kind || !partnerId) continue

    const thread = await ensurePartnershipThread(db, planId, kind, partnerId, invite)
    await seedPartnershipThread(db, thread, invite)
    const workspace = await loadPartnershipWorkspace(db, thread, invite, planOwnerId)
    if (workspace) workspaces.push(workspace)
  }

  return workspaces.sort((a, b) => a.partner.name.localeCompare(b.partner.name))
}

/**
 * Applies one host-side workspace mutation and returns the refreshed workspaces.
 */
export async function mutatePartnershipWorkspace(
  db: PlannerDb,
  planId: string,
  input: PartnershipActionInput,
  partnerKind?: PartnershipPartnerKind
) {
  const thread = await loadPlanThread(db, planId, input.threadId)
  if (!thread) throw new Error('Partnership thread not found')

  if (input.action === 'send_message') {
    const body = input.body.trim()
    if (!body) throw new Error('Message body is required')

    const { error } = await db.from('partnership_messages').insert({
      thread_id: thread.id,
      sender_kind: 'host',
      body,
      attachments: [] as unknown as Json,
    })
    if (error) throw new Error('Failed to send partnership message')
  }

  if (input.action === 'mark_deposit_placed') {
    await completeMilestoneByLabel(db, thread.id, 'Deposit placed')
    await updateThreadStatus(db, thread.id, 'active')
    await addAgentMessage(db, thread.id, 'Deposit marked as placed. Next step: collect or upload the signed agreement.')
  }

  if (input.action === 'upload_document') {
    const { error } = await db.from('partnership_documents').insert({
      thread_id: thread.id,
      kind: input.kind,
      url: input.url,
      signed_at: input.signedAt ?? (input.kind === 'contract' ? new Date().toISOString() : null),
    })
    if (error) throw new Error('Failed to upload partnership document')

    if (input.kind === 'contract') {
      await completeMilestoneByLabel(db, thread.id, 'Contract uploaded')
      await addAgentMessage(db, thread.id, 'Contract uploaded. Day-of logistics are now the next required action.')
    }
    if (input.kind === 'coi') {
      await completeMilestoneByLabel(db, thread.id, 'COI uploaded')
    }
  }

  if (input.action === 'complete_milestone') {
    const { error } = await db
      .from('partnership_milestones')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', input.milestoneId)
      .eq('thread_id', thread.id)
    if (error) throw new Error('Failed to complete partnership milestone')
  }

  return listPartnershipWorkspaces(db, planId, partnerKind)
}

/**
 * Returns true when an accepted invite should be visible as a booked partner.
 */
export function isBookedPartnerInviteEligible(invite: {
  status: string
  proposed_deposit_cents?: number | null
  response_payload?: Json | null
  venue_response_json?: Json | null
}) {
  if (invite.status !== 'accepted') return false
  const payload = readResponsePayload(invite)
  const depositCents = invite.proposed_deposit_cents ?? 0

  return (
    depositCents <= 0 ||
    payload.deposit_step_unblocked === true ||
    payload.deposit_unblocked === true ||
    ['unblocked', 'ready', 'authorized', 'paid', 'not_required'].includes(readString(payload.deposit_status) ?? '')
  )
}

/**
 * Applies MVP workspace progression to an in-memory snapshot for regression tests.
 */
export function applyPartnershipProgressionSnapshot(
  workspace: Pick<PartnershipWorkspace, 'payment_status' | 'milestones' | 'documents' | 'next_required_action'>,
  action: 'mark_deposit_placed' | 'upload_contract'
) {
  const next: Pick<PartnershipWorkspace, 'payment_status' | 'milestones' | 'documents' | 'next_required_action'> = {
    payment_status: { ...workspace.payment_status },
    milestones: workspace.milestones.map((milestone) => ({ ...milestone })),
    documents: workspace.documents.map((document) => ({ ...document })),
    next_required_action: workspace.next_required_action,
  }
  const now = '2026-05-05T12:00:00.000Z'

  if (action === 'mark_deposit_placed') {
    next.payment_status = { ...next.payment_status, label: 'Deposit placed', is_deposit_paid: true }
    next.milestones = next.milestones.map((milestone) =>
      milestone.label === 'Deposit placed' ? { ...milestone, completed_at: now } : milestone
    )
  }

  if (action === 'upload_contract') {
    next.documents = [
      ...next.documents,
      {
        id: 'contract-1',
        thread_id: 'thread-1',
        kind: 'contract',
        url: 'simulated://contract.pdf',
        signed_at: now,
        created_at: now,
      },
    ]
    next.milestones = next.milestones.map((milestone) =>
      milestone.label === 'Contract uploaded' ? { ...milestone, completed_at: now } : milestone
    )
  }

  next.next_required_action = getNextRequiredAction(next.milestones, next.documents)
  return next
}

async function loadAcceptedEligibleInvites(
  db: PlannerDb,
  planId: string,
  partnerKind?: PartnershipPartnerKind
) {
  const acceptedInvites: OpportunityInviteRow[] = []

  const { data: briefData, error: briefError } = await db
    .from('venue_opportunity_briefs')
    .select('id')
    .eq('plan_id', planId)

  if (briefError) throw new Error('Failed to load opportunity briefs')

  const briefIds = ((briefData ?? []) as Array<{ id: string }>).map((brief) => brief.id)
  if (briefIds.length > 0 && partnerKind !== 'vendor') {
    let query = db
      .from('venue_opportunity_invites')
      .select('*')
      .in('brief_id', briefIds)
      .eq('status', 'accepted')

    if (partnerKind === 'venue') query = query.eq('target_type', 'venue')

    const { data, error } = await query.order('created_at', { ascending: true })
    if (error) throw new Error('Failed to load accepted opportunity invites')
    acceptedInvites.push(...((data ?? []) as OpportunityInviteRow[]))
  }

  if (partnerKind !== 'venue') {
    const { data: vendorBriefData, error: vendorBriefError } = await db
      .from('vendor_opportunity_briefs')
      .select('id')
      .eq('plan_id', planId)

    if (vendorBriefError) throw new Error('Failed to load vendor opportunity briefs')

    const vendorBriefIds = ((vendorBriefData ?? []) as Array<{ id: string }>).map((brief) => brief.id)
    if (vendorBriefIds.length > 0) {
      const { data: vendorInviteData, error: vendorInviteError } = await db
        .from('vendor_opportunity_invites')
        .select('id, brief_id, vendor_id, status, response_payload, response_at, quoted_amount_cents, created_at')
        .in('brief_id', vendorBriefIds)
        .eq('status', 'accepted')
        .order('created_at', { ascending: true })

      if (vendorInviteError) throw new Error('Failed to load accepted vendor opportunity invites')

      acceptedInvites.push(
        ...((vendorInviteData ?? []) as Array<Record<string, unknown>>).map((invite) => ({
          id: String(invite.id),
          brief_id: String(invite.brief_id),
          target_type: 'vendor',
          venue_id: null,
          vendor_profile_id: typeof invite.vendor_id === 'string' ? invite.vendor_id : null,
          status: String(invite.status),
          proposed_deposit_cents: null,
          quoted_price_cents: typeof invite.quoted_amount_cents === 'number' ? invite.quoted_amount_cents : null,
          response_payload: (invite.response_payload ?? {}) as Json,
          venue_response_json: null,
          response_at: typeof invite.response_at === 'string' ? invite.response_at : null,
          responded_at: typeof invite.response_at === 'string' ? invite.response_at : null,
          created_at: String(invite.created_at),
        }))
      )
    }
  }

  return acceptedInvites.filter(isBookedPartnerInviteEligible)
}

async function ensurePartnershipThread(
  db: PlannerDb,
  planId: string,
  partnerKind: PartnershipPartnerKind,
  partnerId: string,
  invite: OpportunityInviteRow
) {
  const { data: existing, error: existingError } = await db
    .from('partnership_threads')
    .select('*')
    .eq('plan_id', planId)
    .eq('partner_kind', partnerKind)
    .eq('partner_id', partnerId)
    .maybeSingle()

  if (existingError) throw new Error('Failed to load partnership thread')
  if (existing) return existing as PartnershipThread

  const status = (invite.proposed_deposit_cents ?? 0) > 0 ? 'pending_deposit' : 'active'
  const { data, error } = await db
    .from('partnership_threads')
    .insert({
      plan_id: planId,
      partner_kind: partnerKind,
      partner_id: partnerId,
      status,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error('Failed to create partnership thread')
  return data as PartnershipThread
}

async function seedPartnershipThread(db: PlannerDb, thread: PartnershipThread, invite: OpportunityInviteRow) {
  const [{ data: messageData }, { data: milestoneData }] = await Promise.all([
    db.from('partnership_messages').select('id').eq('thread_id', thread.id).limit(1),
    db.from('partnership_milestones').select('id').eq('thread_id', thread.id).limit(1),
  ])

  if (!Array.isArray(messageData) || messageData.length === 0) {
    await addAgentMessage(
      db,
      thread.id,
      'Partner accepted the opportunity. Keep messages, deposit status, documents, and day-of logistics in this workspace.'
    )
  }

  if (!Array.isArray(milestoneData) || milestoneData.length === 0) {
    const acceptedAt = invite.response_at ?? invite.responded_at ?? new Date().toISOString()
    const rows = [
      {
        thread_id: thread.id,
        label: 'Terms accepted',
        due_date: toDateOnly(acceptedAt),
        completed_at: acceptedAt,
      },
      {
        thread_id: thread.id,
        label: 'Deposit placed',
        due_date: null,
        completed_at: null,
      },
      {
        thread_id: thread.id,
        label: 'Contract uploaded',
        due_date: null,
        completed_at: null,
      },
      {
        thread_id: thread.id,
        label: 'Day-of logistics confirmed',
        due_date: null,
        completed_at: null,
      },
    ]

    const { error } = await db.from('partnership_milestones').insert(rows)
    if (error) throw new Error('Failed to seed partnership milestones')
  }
}

async function loadPartnershipWorkspace(
  db: PlannerDb,
  thread: PartnershipThread,
  invite: OpportunityInviteRow,
  planOwnerId: string | null
): Promise<PartnershipWorkspace | null> {
  const [partner, messages, milestones, documents] = await Promise.all([
    loadPartnerDisplayRow(db, thread.partner_kind, thread.partner_id, invite),
    loadThreadRows<PartnershipMessage>(db, 'partnership_messages', thread.id),
    loadThreadRows<PartnershipMilestone>(db, 'partnership_milestones', thread.id),
    loadThreadRows<PartnershipDocument>(db, 'partnership_documents', thread.id),
  ])

  if (!partner) return null
  const payload = readResponsePayload(invite)
  const paymentStatus = getPaymentStatus(invite, milestones)
  const venueRental = thread.partner_kind === 'venue' && planOwnerId
    ? await loadVenueRentalContext(db, {
        planId: thread.plan_id,
        builderId: planOwnerId,
        venueId: thread.partner_id,
      })
    : null

  return {
    thread,
    partner,
    invite: {
      id: invite.id,
      proposed_deposit_cents: invite.proposed_deposit_cents,
      quoted_price_cents: invite.quoted_price_cents,
      response_payload: payload as Json,
    },
    messages,
    milestones,
    documents,
    logistics: {
      load_in_time: readString(payload.load_in_time),
      contact_name: readString(payload.contact_name) ?? partner.contact_name,
      address: readString(payload.address) ?? partner.address,
      parking_notes: readString(payload.parking_notes) ?? partner.parking_notes,
    },
    payment_status: paymentStatus,
    venue_rental: venueRental,
    next_required_action: getNextRequiredAction(milestones, documents),
  }
}

async function loadPlanOwnerId(db: PlannerDb, planId: string) {
  const { data, error } = await db
    .from('plans')
    .select('user_id')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error('Failed to load plan owner')
  return readString((data as Record<string, unknown> | null)?.user_id)
}

async function loadVenueRentalContext(
  db: PlannerDb,
  input: {
    planId: string
    builderId: string
    venueId: string
  }
): Promise<PartnershipWorkspace['venue_rental']> {
  const { data: bookingData, error: bookingError } = await db
    .from('venue_bookings')
    .select('id, status, final_price, quoted_price, total_amount, created_at')
    .eq('organizer_id', input.builderId)
    .eq('venue_id', input.venueId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bookingError) throw new Error('Failed to load confirmed venue booking')
  const bookingRow = bookingData as Record<string, unknown> | null
  if (!bookingRow) return { venue_booking: null, transaction: null }

  const booking = {
    id: readString(bookingRow.id) ?? '',
    status: readString(bookingRow.status),
    amount_cents: resolveLegacyDollarAmountCents(bookingRow),
  }

  if (!booking.id) return { venue_booking: null, transaction: null }

  const { data: transactionData, error: transactionError } = await db
    .from('venue_payment_transactions')
    .select('id, status, amount_cents, processing_fee_cents, refund_amount_cents, refund_reason, paid_at, refund_requested_at, refund_approved_at, stripe_transfer_id')
    .eq('plan_id', input.planId)
    .eq('venue_booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (transactionError) throw new Error('Failed to load venue rental payment transaction')
  const transactionRow = transactionData as Record<string, unknown> | null

  return {
    venue_booking: booking,
    transaction: transactionRow
      ? {
          id: readString(transactionRow.id) ?? '',
          status: readString(transactionRow.status) ?? 'pending_builder_payment',
          amount_cents: readNumber(transactionRow.amount_cents) ?? booking.amount_cents,
          processing_fee_cents: readNumber(transactionRow.processing_fee_cents) ?? 0,
          refund_amount_cents: readNumber(transactionRow.refund_amount_cents),
          refund_reason: readString(transactionRow.refund_reason),
          paid_at: readString(transactionRow.paid_at),
          refund_requested_at: readString(transactionRow.refund_requested_at),
          refund_approved_at: readString(transactionRow.refund_approved_at),
          stripe_transfer_id: readString(transactionRow.stripe_transfer_id),
        }
      : null,
  }
}

async function loadPartnerDisplayRow(
  db: PlannerDb,
  partnerKind: PartnershipPartnerKind,
  partnerId: string,
  invite: OpportunityInviteRow
): Promise<PartnerDisplayRow | null> {
  if (partnerKind === 'venue') {
    const { data, error } = await db
      .from('venues')
      .select('id, venue_name, venue_type, address, city, state')
      .eq('id', partnerId)
      .maybeSingle()
    if (error) throw new Error('Failed to load venue partner')
    const row = (data ?? {}) as Record<string, unknown>
    const payload = readResponsePayload(invite)

    return {
      id: partnerId,
      name: readString(row.venue_name) ?? 'Venue partner',
      category: formatLabel(readString(row.venue_type) ?? 'Venue'),
      address: readString(row.address) ?? readString(row.city),
      city: readString(row.city),
      contact_name: readString(payload.contact_name),
      parking_notes: readString(payload.parking_notes),
    }
  }

  const { data, error } = await db
    .from('vendor_profiles')
    .select('id, name, service_type, vendor_type, service_area, regions_served')
    .eq('id', partnerId)
    .maybeSingle()
  if (error) throw new Error('Failed to load vendor partner')
  const row = (data ?? {}) as Record<string, unknown>
  const payload = readResponsePayload(invite)

  return {
    id: partnerId,
    name: readString(row.name) ?? 'Vendor partner',
    category: formatLabel(readString(row.service_type) ?? readString(row.vendor_type) ?? 'Vendor'),
    address: readString(payload.address) ?? readString(row.service_area) ?? readString(row.regions_served),
    city: readString(row.service_area) ?? readString(row.regions_served),
    contact_name: readString(payload.contact_name),
    parking_notes: readString(payload.parking_notes),
  }
}

async function loadThreadRows<T>(db: PlannerDb, table: string, threadId: string): Promise<T[]> {
  const { data, error } = await db
    .from(table)
    .select('*')
    .eq('thread_id', threadId)
    .order(table === 'partnership_messages' ? 'created_at' : 'created_at', { ascending: true })

  if (error) throw new Error(`Failed to load ${table}`)
  return (data ?? []) as T[]
}

async function loadPlanThread(db: PlannerDb, planId: string, threadId: string): Promise<PartnershipThread | null> {
  const { data, error } = await db
    .from('partnership_threads')
    .select('*')
    .eq('id', threadId)
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) throw new Error('Failed to load partnership thread')
  return (data as PartnershipThread | null) ?? null
}

async function completeMilestoneByLabel(db: PlannerDb, threadId: string, label: string) {
  const { error } = await db
    .from('partnership_milestones')
    .update({ completed_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('label', label)

  if (error) throw new Error(`Failed to complete ${label}`)
}

async function updateThreadStatus(db: PlannerDb, threadId: string, status: 'active' | 'complete' | 'cancelled') {
  const { error } = await db.from('partnership_threads').update({ status }).eq('id', threadId)
  if (error) throw new Error('Failed to update partnership thread status')
}

async function addAgentMessage(db: PlannerDb, threadId: string, body: string) {
  const { error } = await db.from('partnership_messages').insert({
    thread_id: threadId,
    sender_kind: 'agent',
    body,
    attachments: [] as unknown as Json,
  })
  if (error) throw new Error('Failed to add partnership status message')
}

function getInvitePartnerKind(invite: OpportunityInviteRow): PartnershipPartnerKind | null {
  if (invite.target_type === 'venue' && invite.venue_id) return 'venue'
  if (invite.target_type === 'vendor' && invite.vendor_profile_id) return 'vendor'
  return null
}

function getInvitePartnerId(invite: OpportunityInviteRow) {
  return invite.target_type === 'venue' ? invite.venue_id : invite.vendor_profile_id
}

function getPaymentStatus(invite: OpportunityInviteRow, milestones: PartnershipMilestone[]) {
  const payload = readResponsePayload(invite)
  const depositPaid = milestones.some(
    (milestone) => milestone.label === 'Deposit placed' && Boolean(milestone.completed_at)
  )
  const depositCents = invite.proposed_deposit_cents ?? null

  if (depositPaid || readString(payload.deposit_status) === 'paid') {
    return { label: 'Deposit placed', deposit_cents: depositCents, is_deposit_paid: true }
  }

  if (!depositCents || depositCents <= 0 || readString(payload.deposit_status) === 'not_required') {
    return { label: 'No deposit required', deposit_cents: depositCents, is_deposit_paid: true }
  }

  return { label: 'Deposit ready', deposit_cents: depositCents, is_deposit_paid: false }
}

function getNextRequiredAction(milestones: PartnershipMilestone[], documents: PartnershipDocument[]) {
  const depositDone = milestones.some(
    (milestone) => milestone.label === 'Deposit placed' && Boolean(milestone.completed_at)
  )
  if (!depositDone) return 'Place deposit'

  const hasContract = documents.some((document) => document.kind === 'contract')
  if (!hasContract) return 'Upload contract'

  const logisticsDone = milestones.some(
    (milestone) => milestone.label === 'Day-of logistics confirmed' && Boolean(milestone.completed_at)
  )
  if (!logisticsDone) return 'Confirm day-of logistics'

  return 'Ready for event day'
}

function readResponsePayload(invite: {
  response_payload?: Json | null
  venue_response_json?: Json | null
}): Record<string, unknown> {
  if (invite.response_payload && typeof invite.response_payload === 'object' && !Array.isArray(invite.response_payload)) {
    return invite.response_payload as Record<string, unknown>
  }
  if (invite.venue_response_json && typeof invite.venue_response_json === 'object' && !Array.isArray(invite.venue_response_json)) {
    return invite.venue_response_json as Record<string, unknown>
  }
  return {}
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resolveLegacyDollarAmountCents(row: Record<string, unknown>) {
  for (const key of ['final_price', 'quoted_price', 'total_amount']) {
    const value = row[key]
    if (toFiniteNumber(value as number | string | null | undefined) !== null) {
      return dollarsToCents(value as number | string)
    }
  }

  return 0
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (word) => (word.toUpperCase() === 'AV' ? 'AV' : word.charAt(0).toUpperCase() + word.slice(1)))
}

function toDateOnly(value: string) {
  return value.slice(0, 10)
}
