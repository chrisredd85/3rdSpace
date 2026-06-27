import 'server-only'

import { GmailConnectionRequiredError, createOrReuseGmailOutreachApproval } from '@/lib/outreach/gmailApprovalFlow'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  DISCOVERY_VENUE_SELECT,
  buildDefaultOutreachBody,
  buildDefaultOutreachSubject,
  resolveDiscoveryVenueContact,
  type DiscoveryVenueRow,
  type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

type DraftRequestStatus =
  | 'extraction_pending'
  | 'email_required'
  | 'draft_created'
  | 'gmail_required'

type CandidateDraftRequest = {
  status: DraftRequestStatus
  requested_by_user_id: string
  requested_at: string
  updated_at: string
  approval_id?: string | null
  approval_message_id?: string | null
  error?: string | null
}

export type EnqueueVenueDraftStatus = 'draft_created' | 'extraction_pending' | 'email_required'

export type EnqueueVenueDraftResult = {
  status: EnqueueVenueDraftStatus
  discoveryVenueId: string
  venueName: string
  candidateId: string
  gmailApprovalId?: string
  approvalMessageId?: string | null
  redirectUrl?: string | null
}

export type EnqueueVenueDraftBatchResult = {
  prepared: boolean
  handledVenueIds: string[]
  unhandledVenueIds: string[]
  results: EnqueueVenueDraftResult[]
  draftCreatedCount: number
  extractionPendingCount: number
  emailRequiredCount: number
}

type CandidateWithVenue = {
  candidate: PlanDiscoveryVenueCandidateRow
  venue: DiscoveryVenueRow
}

export async function enqueueDraftAfterVenueApproval(input: {
  db: PlannerDb
  planId: string
  userId: string
  discoveryVenueId: string
  subject?: string | null
  bodyText?: string | null
}): Promise<EnqueueVenueDraftResult> {
  const admin = createServiceRoleClient() as PlannerDb
  const plan = await loadPlan(admin, input.planId, input.userId)
  if (!plan) throw new Error('Plan not found')

  const row = await loadCandidateWithVenue(admin, input.planId, input.discoveryVenueId)
  if (!row) throw new Error('Discovery venue candidate not found')

  const existing = await loadExistingGmailDraftForVenue(admin, input.planId, input.discoveryVenueId)
  if (existing) {
    await markCandidateApprovalCreated(admin, row.candidate, input.userId, {
      approvalId: existing.approvalId,
      approvalMessageId: existing.approvalMessageId,
    })
    return {
      status: 'draft_created',
      discoveryVenueId: input.discoveryVenueId,
      venueName: row.venue.name,
      candidateId: row.candidate.id,
      gmailApprovalId: existing.approvalId,
      approvalMessageId: existing.approvalMessageId,
    }
  }

  const contact = resolveDiscoveryVenueContact(row.venue)
  if (contact.email && contact.confidence !== 'low') {
    try {
      const subject = input.subject ?? buildDefaultOutreachSubject(plan)
      const bodyText = input.bodyText ?? buildDefaultOutreachBody(plan)
      const draft = await createOrReuseGmailOutreachApproval(input.db, {
        userId: input.userId,
        planId: plan.id,
        reuseExisting: false,
        targets: [{
          kind: 'venue',
          name: row.venue.name,
          email: contact.email,
          discoveryVenueId: row.venue.id,
        }],
        subject,
        bodyText,
      })
      await markCandidateApprovalCreated(admin, row.candidate, input.userId, {
        approvalId: draft.approval.id,
        approvalMessageId: draft.approvalMessageId,
      })
      return {
        status: 'draft_created',
        discoveryVenueId: row.venue.id,
        venueName: row.venue.name,
        candidateId: row.candidate.id,
        gmailApprovalId: draft.approval.id,
        approvalMessageId: draft.approvalMessageId,
        redirectUrl: draft.redirectUrl,
      }
    } catch (error) {
      if (error instanceof GmailConnectionRequiredError) {
        await markCandidateDraftRequest(admin, row.candidate, {
          status: 'gmail_required',
          requestedByUserId: input.userId,
          error: error.message,
        })
      }
      throw error
    }
  }

  if (contact.status === 'contact_form_available') {
    await markCandidateDraftRequest(admin, row.candidate, {
      status: 'email_required',
      requestedByUserId: input.userId,
    })
    return {
      status: 'email_required',
      discoveryVenueId: row.venue.id,
      venueName: row.venue.name,
      candidateId: row.candidate.id,
    }
  }

  if (row.venue.website) {
    await markCandidateDraftRequest(admin, row.candidate, {
      status: 'extraction_pending',
      requestedByUserId: input.userId,
    })
    await markWebsiteExtractionNeeded(admin, row.venue)
    return {
      status: 'extraction_pending',
      discoveryVenueId: row.venue.id,
      venueName: row.venue.name,
      candidateId: row.candidate.id,
    }
  }

  await markCandidateDraftRequest(admin, row.candidate, {
    status: 'email_required',
    requestedByUserId: input.userId,
  })
  return {
    status: 'email_required',
    discoveryVenueId: row.venue.id,
    venueName: row.venue.name,
    candidateId: row.candidate.id,
  }
}

export async function enqueueDraftsAfterVenueApproval(input: {
  db: PlannerDb
  planId: string
  userId: string
  venueIds: string[]
}): Promise<EnqueueVenueDraftBatchResult> {
  return enqueueDraftBatchAfterVenueApproval(input)
}

export async function enqueueDraftBatchAfterVenueApproval(input: {
  db: PlannerDb
  planId: string
  userId: string
  venueIds: string[]
  subject?: string | null
  bodyText?: string | null
}): Promise<EnqueueVenueDraftBatchResult> {
  const uniqueVenueIds = Array.from(new Set(input.venueIds))
  const admin = createServiceRoleClient() as PlannerDb
  const plan = await loadPlan(admin, input.planId, input.userId)
  if (!plan) throw new Error('Plan not found')

  const rows = await loadCandidateRowsWithVenues(admin, input.planId, uniqueVenueIds)
  const rowByVenueId = new Map(rows.map((row) => [row.venue.id, row]))
  const handledVenueIds = uniqueVenueIds.filter((venueId) => rowByVenueId.has(venueId))
  const unhandledVenueIds = uniqueVenueIds.filter((venueId) => !rowByVenueId.has(venueId))
  const results: EnqueueVenueDraftResult[] = []
  const targetRows: Array<CandidateWithVenue & { email: string }> = []

  for (const venueId of handledVenueIds) {
    const row = rowByVenueId.get(venueId)
    if (!row) continue
    const existing = await loadExistingGmailDraftForVenue(admin, input.planId, venueId)
    if (existing) {
      await markCandidateApprovalCreated(admin, row.candidate, input.userId, {
        approvalId: existing.approvalId,
        approvalMessageId: existing.approvalMessageId,
      })
      results.push({
        status: 'draft_created',
        discoveryVenueId: row.venue.id,
        venueName: row.venue.name,
        candidateId: row.candidate.id,
        gmailApprovalId: existing.approvalId,
        approvalMessageId: existing.approvalMessageId,
      })
      continue
    }

    const contact = resolveDiscoveryVenueContact(row.venue)
    if (contact.email && contact.confidence !== 'low') {
      targetRows.push({ ...row, email: contact.email })
      continue
    }

    if (contact.status === 'contact_form_available') {
      await markCandidateDraftRequest(admin, row.candidate, {
        status: 'email_required',
        requestedByUserId: input.userId,
      })
      results.push({
        status: 'email_required',
        discoveryVenueId: row.venue.id,
        venueName: row.venue.name,
        candidateId: row.candidate.id,
      })
      continue
    }

    if (row.venue.website) {
      await markCandidateDraftRequest(admin, row.candidate, {
        status: 'extraction_pending',
        requestedByUserId: input.userId,
      })
      await markWebsiteExtractionNeeded(admin, row.venue)
      results.push({
        status: 'extraction_pending',
        discoveryVenueId: row.venue.id,
        venueName: row.venue.name,
        candidateId: row.candidate.id,
      })
      continue
    }

    await markCandidateDraftRequest(admin, row.candidate, {
      status: 'email_required',
      requestedByUserId: input.userId,
    })
    results.push({
      status: 'email_required',
      discoveryVenueId: row.venue.id,
      venueName: row.venue.name,
      candidateId: row.candidate.id,
    })
  }

  if (targetRows.length > 0) {
    try {
      const subject = input.subject ?? buildDefaultOutreachSubject(plan)
      const bodyText = input.bodyText ?? buildDefaultOutreachBody(plan)
      const draft = await createOrReuseGmailOutreachApproval(input.db, {
        userId: input.userId,
        planId: plan.id,
        reuseExisting: false,
        targets: targetRows.map((row) => ({
          kind: 'venue',
          name: row.venue.name,
          email: row.email,
          discoveryVenueId: row.venue.id,
        })),
        subject,
        bodyText,
      })

      for (const row of targetRows) {
        await markCandidateApprovalCreated(admin, row.candidate, input.userId, {
          approvalId: draft.approval.id,
          approvalMessageId: draft.approvalMessageId,
        })
        results.push({
          status: 'draft_created',
          discoveryVenueId: row.venue.id,
          venueName: row.venue.name,
          candidateId: row.candidate.id,
          gmailApprovalId: draft.approval.id,
          approvalMessageId: draft.approvalMessageId,
          redirectUrl: draft.redirectUrl,
        })
      }
    } catch (error) {
      if (error instanceof GmailConnectionRequiredError) {
        await Promise.all(targetRows.map((row) => markCandidateDraftRequest(admin, row.candidate, {
          status: 'gmail_required',
          requestedByUserId: input.userId,
          error: error.message,
        })))
      }
      throw error
    }
  }

  return {
    prepared: results.length > 0,
    handledVenueIds,
    unhandledVenueIds,
    results,
    draftCreatedCount: results.filter((result) => result.status === 'draft_created').length,
    extractionPendingCount: results.filter((result) => result.status === 'extraction_pending').length,
    emailRequiredCount: results.filter((result) => result.status === 'email_required').length,
  }
}

export async function enqueuePendingDraftsForDiscoveryVenue(input: {
  db: PlannerDb
  discoveryVenueId: string
}): Promise<EnqueueVenueDraftResult[]> {
  const admin = createServiceRoleClient() as PlannerDb
  const { data, error } = await admin
    .from('plan_discovery_venue_candidates')
    .select('*')
    .eq('discovery_venue_id', input.discoveryVenueId)
    .limit(50)

  if (error) throw new Error(error.message)

  const pending = ((data ?? []) as PlanDiscoveryVenueCandidateRow[])
    .filter((candidate) => candidate.status !== 'dismissed')
    .filter(candidateHasPendingDraftRequest)
  const results: EnqueueVenueDraftResult[] = []
  for (const candidate of pending) {
    const request = readDraftRequest(candidate)
    const userId = request?.requested_by_user_id
    if (!userId) continue
    try {
      results.push(await enqueueDraftAfterVenueApproval({
        db: input.db,
        planId: candidate.plan_id,
        userId,
        discoveryVenueId: input.discoveryVenueId,
      }))
    } catch (error) {
      console.error('[planner.discovery-outreach-drafts] pending_enqueue_failed', {
        plan_id: candidate.plan_id,
        discovery_venue_id: input.discoveryVenueId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

export async function enqueuePendingDraftsForUserVenue(input: {
  db: PlannerDb
  userId: string
  discoveryVenueId: string
}): Promise<EnqueueVenueDraftResult[]> {
  const admin = createServiceRoleClient() as PlannerDb
  const { data, error } = await admin
    .from('plan_discovery_venue_candidates')
    .select('*, plans!inner(id,user_id)')
    .eq('discovery_venue_id', input.discoveryVenueId)
    .eq('plans.user_id', input.userId)
    .limit(20)

  if (error) throw new Error(error.message)

  const candidates = (Array.isArray(data) ? data : []) as Array<PlanDiscoveryVenueCandidateRow & { plans?: unknown }>
  const pending = candidates
    .filter((candidate) => candidate.status !== 'dismissed')
    .filter(candidateHasPendingDraftRequest)
  const results: EnqueueVenueDraftResult[] = []
  for (const candidate of pending) {
    results.push(await enqueueDraftAfterVenueApproval({
      db: input.db,
      planId: candidate.plan_id,
      userId: input.userId,
      discoveryVenueId: input.discoveryVenueId,
    }))
  }
  return results
}

async function loadPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadCandidateRowsForPlan(
  db: PlannerDb,
  planId: string,
  venueIds: string[]
): Promise<PlanDiscoveryVenueCandidateRow[]> {
  if (venueIds.length === 0) return []
  const { data, error } = await db
    .from('plan_discovery_venue_candidates')
    .select('*')
    .eq('plan_id', planId)
    .in('discovery_venue_id', venueIds)

  if (error) throw new Error(error.message)
  return ((data ?? []) as PlanDiscoveryVenueCandidateRow[])
    .filter((candidate) => candidate.dismissed_at == null)
}

async function loadCandidateRowsWithVenues(
  db: PlannerDb,
  planId: string,
  venueIds: string[]
): Promise<CandidateWithVenue[]> {
  const candidates = await loadCandidateRowsForPlan(db, planId, venueIds)
  if (candidates.length === 0) return []

  const { data: venues, error: venueError } = await db
    .from('discovery_venues')
    .select(DISCOVERY_VENUE_SELECT)
    .in('id', candidates.map((candidate) => candidate.discovery_venue_id))

  if (venueError) throw new Error(venueError.message)
  const venueById = new Map(((venues ?? []) as DiscoveryVenueRow[]).map((venue) => [venue.id, venue]))
  return candidates.flatMap((candidate) => {
    const venue = venueById.get(candidate.discovery_venue_id)
    return venue ? [{ candidate, venue }] : []
  })
}

async function loadCandidateWithVenue(
  db: PlannerDb,
  planId: string,
  discoveryVenueId: string
): Promise<CandidateWithVenue | null> {
  const { data: candidate, error } = await db
    .from('plan_discovery_venue_candidates')
    .select('*')
    .eq('plan_id', planId)
    .eq('discovery_venue_id', discoveryVenueId)
    .is('dismissed_at', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!candidate) return null

  const { data: venue, error: venueError } = await db
    .from('discovery_venues')
    .select(DISCOVERY_VENUE_SELECT)
    .eq('id', discoveryVenueId)
    .maybeSingle()

  if (venueError) throw new Error(venueError.message)
  return venue
    ? {
      candidate: candidate as PlanDiscoveryVenueCandidateRow,
      venue: venue as DiscoveryVenueRow,
    }
    : null
}

async function loadExistingGmailDraftForVenue(
  db: PlannerDb,
  planId: string,
  discoveryVenueId: string
): Promise<{ approvalId: string; approvalMessageId: string | null } | null> {
  const { data, error } = await db
    .from('plan_messages')
    .select('id,metadata')
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)

  for (const message of Array.isArray(data) ? data : []) {
    const metadata = readRecord(message.metadata)
    if (readString(metadata?.kind) !== 'gmail_approved_outreach') continue
    const ids = readStringArray(metadata?.discovery_venue_ids)
    const partnerTargets = Array.isArray(metadata?.partner_targets) ? metadata.partner_targets : []
    const hasTarget = ids.includes(discoveryVenueId) || partnerTargets.some((target) => {
      const record = readRecord(target)
      return readString(record?.discovery_venue_id) === discoveryVenueId
    })
    if (!hasTarget) continue

    const approval = readRecord(metadata?.approval)
    const approvalId = readString(approval?.id)
    const status = readString(approval?.status) ?? readString(metadata?.status)
    if (!approvalId || status === 'cancelled' || status === 'rejected' || status === 'expired') continue
    return {
      approvalId,
      approvalMessageId: readString(message.id),
    }
  }
  return null
}

async function markCandidateApprovalCreated(
  db: PlannerDb,
  candidate: PlanDiscoveryVenueCandidateRow,
  userId: string,
  approval: { approvalId: string; approvalMessageId?: string | null }
) {
  const now = new Date().toISOString()
  const nextRequest = buildNextDraftRequest(candidate, {
    status: 'draft_created',
    requestedByUserId: userId,
    approvalId: approval.approvalId,
    approvalMessageId: approval.approvalMessageId ?? null,
    now,
  })
  const { error } = await db
    .from('plan_discovery_venue_candidates')
    .update({
      status: 'approval_created',
      outreach_approval_created_at: now,
      places_request_json: {
        ...(readRecord(candidate.places_request_json) ?? {}),
        outreach_draft_request: nextRequest,
      } as Json,
    })
    .eq('id', candidate.id)

  if (error) throw new Error(error.message)
}

async function markCandidateDraftRequest(
  db: PlannerDb,
  candidate: PlanDiscoveryVenueCandidateRow,
  input: {
    status: DraftRequestStatus
    requestedByUserId: string
    approvalId?: string | null
    approvalMessageId?: string | null
    error?: string | null
  }
) {
  const nextRequest = buildNextDraftRequest(candidate, {
    ...input,
    now: new Date().toISOString(),
  })
  const { error } = await db
    .from('plan_discovery_venue_candidates')
    .update({
      places_request_json: {
        ...(readRecord(candidate.places_request_json) ?? {}),
        outreach_draft_request: nextRequest,
      } as Json,
    })
    .eq('id', candidate.id)

  if (error) throw new Error(error.message)
}

async function markWebsiteExtractionNeeded(db: PlannerDb, venue: DiscoveryVenueRow) {
  if (!venue.website) return
  if (venue.website_extraction_status && venue.website_extraction_status !== 'never_attempted') return
  const { error } = await db
    .from('discovery_venues')
    .update({ website_extraction_status: 'never_attempted' })
    .eq('id', venue.id)

  if (error) console.error('[planner.discovery-outreach-drafts] extraction_mark_failed', {
    discovery_venue_id: venue.id,
    error: error.message,
  })
}

function candidateHasPendingDraftRequest(candidate: PlanDiscoveryVenueCandidateRow) {
  const request = readDraftRequest(candidate)
  return request?.status === 'extraction_pending' || request?.status === 'email_required'
}

function readDraftRequest(candidate: PlanDiscoveryVenueCandidateRow): CandidateDraftRequest | null {
  const metadata = readRecord(candidate.places_request_json)
  const request = readRecord(metadata?.outreach_draft_request)
  if (!request) return null
  const status = readString(request.status)
  const userId = readString(request.requested_by_user_id)
  const requestedAt = readString(request.requested_at)
  const updatedAt = readString(request.updated_at)
  if (!isDraftRequestStatus(status) || !userId || !requestedAt || !updatedAt) return null
  return {
    status,
    requested_by_user_id: userId,
    requested_at: requestedAt,
    updated_at: updatedAt,
    approval_id: readString(request.approval_id),
    approval_message_id: readString(request.approval_message_id),
    error: readString(request.error),
  }
}

function buildNextDraftRequest(
  candidate: PlanDiscoveryVenueCandidateRow,
  input: {
    status: DraftRequestStatus
    requestedByUserId: string
    approvalId?: string | null
    approvalMessageId?: string | null
    error?: string | null
    now: string
  }
): CandidateDraftRequest {
  const current = readDraftRequest(candidate)
  return {
    status: input.status,
    requested_by_user_id: current?.requested_by_user_id ?? input.requestedByUserId,
    requested_at: current?.requested_at ?? input.now,
    updated_at: input.now,
    approval_id: input.approvalId ?? current?.approval_id ?? null,
    approval_message_id: input.approvalMessageId ?? current?.approval_message_id ?? null,
    error: input.error ?? null,
  }
}

function isDraftRequestStatus(value: string | null): value is DraftRequestStatus {
  return value === 'extraction_pending' ||
    value === 'email_required' ||
    value === 'draft_created' ||
    value === 'gmail_required'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const value = readString(item)
      return value ? [value] : []
    })
    : []
}
