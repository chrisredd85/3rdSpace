import { randomBytes } from 'node:crypto'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export interface VendorOpportunityCreateInput {
  db: PlannerDb
  plan: Plan
  userId: string
  vendorIds: string[]
  packageType: string
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
  quoteRequested?: boolean
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  outreachMessage?: Json | null
  issueTokens?: boolean
}

export interface VendorOpportunityInviteWithVendor {
  id: string
  brief_id: string
  vendor_id: string
  status: string
  magic_link_token: string | null
  magic_link_expires_at: string | null
  sent_at: string | null
  viewed_at: string | null
  response_at: string | null
  response_payload: Json
  quoted_amount_cents: number | null
  created_at: string
  vendor: {
    id: string
    name: string
    service_type: string | null
    vendor_type: string
    is_claimed: boolean
    is_admin_seeded: boolean
  } | null
}

export interface VendorOpportunityBriefWithInvites {
  id: string
  plan_id: string
  package_type: string
  summary: string
  requirements: Json
  budget_range_cents: string | null
  date_needed: string | null
  response_deadline: string | null
  quote_requested: boolean
  created_at: string
  invites: VendorOpportunityInviteWithVendor[]
}

const VENDOR_DISPLAY_SELECT = `
  id,
  name,
  service_type,
  vendor_type,
  is_claimed,
  is_admin_seeded
`

const VENDOR_BRIEF_SELECT = `
  id,
  plan_id,
  organizer_user_id,
  package_type,
  summary,
  requirements,
  budget_range_cents,
  date_needed,
  response_deadline,
  quote_requested,
  approval_status,
  outreach_message,
  created_at
`

const VENDOR_INVITE_SELECT = `
  id,
  brief_id,
  vendor_id,
  status,
  magic_link_token,
  magic_link_expires_at,
  sent_at,
  viewed_at,
  response_at,
  response_payload,
  quoted_amount_cents,
  created_at
`

/**
 * Creates a vendor opportunity brief and queued quote/availability invite rows.
 */
export async function createVendorOpportunityBrief(input: VendorOpportunityCreateInput) {
  const vendorIds = Array.from(new Set(input.vendorIds)).filter(isUuid)
  if (vendorIds.length === 0) throw new Error('At least one valid vendor id is required')

  const vendorRows = await loadVendorRows(input.db, vendorIds)
  const now = new Date()
  const tokenExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const budgetRange = buildBudgetRange(input.plan.budget_cap_cents)
  const dateNeeded = input.plan.date_window_start ?? input.plan.date_window_end

  const { data: briefData, error: briefError } = await input.db
    .from('vendor_opportunity_briefs')
    .insert({
      plan_id: input.plan.id,
      organizer_user_id: input.userId,
      package_type: input.packageType,
      summary: input.summary,
      requirements: input.requirements as Json,
      budget_range_cents: budgetRange,
      date_needed: dateNeeded,
      response_deadline: input.responseDeadline,
      quote_requested: input.quoteRequested ?? true,
      approval_status: input.approvalStatus ?? 'pending',
      outreach_message: input.outreachMessage ?? null,
    })
    .select(VENDOR_BRIEF_SELECT)
    .single()

  if (briefError || !briefData) {
    console.error('Vendor opportunity brief insert error:', briefError)
    throw new Error('Failed to create vendor opportunity brief')
  }

  const brief = briefData as Record<string, unknown>
  const inviteRows = vendorIds.map((vendorId) => ({
    brief_id: brief.id,
    vendor_id: vendorId,
    status: vendorRows.get(vendorId)?.is_claimed === false ? 'concierge_followup' : 'queued',
    response_payload: {} as Json,
    quoted_amount_cents: null,
    magic_link_token: input.issueTokens ? randomToken() : null,
    magic_link_expires_at: input.issueTokens ? tokenExpiry : null,
  }))

  const { data: inviteData, error: inviteError } = await input.db
    .from('vendor_opportunity_invites')
    .insert(inviteRows)
    .select(VENDOR_INVITE_SELECT)

  if (inviteError || !inviteData) {
    console.error('Vendor opportunity invite insert error:', inviteError)
    throw new Error('Failed to create vendor opportunity invites')
  }

  return {
    brief,
    invites: inviteData as Record<string, unknown>[],
  }
}

/**
 * Adds unique 14-day magic-link tokens to queued vendor invites for an existing brief.
 */
export async function ensureVendorOpportunityInviteTokens(db: PlannerDb, briefId: string) {
  const { data, error } = await db
    .from('vendor_opportunity_invites')
    .select(VENDOR_INVITE_SELECT)
    .eq('brief_id', briefId)

  if (error) {
    console.error('Vendor opportunity invite token lookup error:', error)
    throw new Error('Failed to load vendor opportunity invites')
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const updatedRows = await Promise.all(
    rows.map(async (row) => {
      if (typeof row.magic_link_token === 'string' && row.magic_link_token.length > 0) {
        return row
      }

      const { data: updated, error: updateError } = await db
        .from('vendor_opportunity_invites')
        .update({
          status: row.status === 'concierge_followup' ? 'concierge_followup' : 'queued',
          magic_link_token: randomToken(),
          magic_link_expires_at: expiresAt,
        })
        .eq('id', row.id)
        .select(VENDOR_INVITE_SELECT)
        .single()

      if (updateError || !updated) {
        console.error('Vendor opportunity invite token update error:', updateError)
        throw new Error('Failed to update vendor opportunity invite token')
      }

      return updated as Record<string, unknown>
    })
  )

  return updatedRows
}

/**
 * Lists vendor opportunity briefs and invites for display.
 */
export async function listVendorOpportunityBriefs(db: PlannerDb, planId: string) {
  const { data: briefData, error: briefError } = await db
    .from('vendor_opportunity_briefs')
    .select(VENDOR_BRIEF_SELECT)
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })

  if (briefError) {
    console.error('Vendor opportunity brief list error:', briefError)
    throw new Error('Failed to load vendor opportunity briefs')
  }

  const briefs = (briefData ?? []) as Record<string, unknown>[]
  if (briefs.length === 0) return []

  const briefIds = briefs.map((brief) => String(brief.id))
  const { data: inviteData, error: inviteError } = await db
    .from('vendor_opportunity_invites')
    .select(VENDOR_INVITE_SELECT)
    .in('brief_id', briefIds)
    .order('created_at', { ascending: true })

  if (inviteError) {
    console.error('Vendor opportunity invite list error:', inviteError)
    throw new Error('Failed to load vendor opportunity invites')
  }

  const invites = (inviteData ?? []) as Record<string, unknown>[]
  const vendorIds = invites
    .map((invite) => invite.vendor_id)
    .filter((id): id is string => typeof id === 'string')
  const vendors = await loadVendorRows(db, vendorIds)

  return briefs.map((brief) => ({
    ...brief,
    invites: invites
      .filter((invite) => invite.brief_id === brief.id)
      .map((invite) => ({
        ...invite,
        vendor: typeof invite.vendor_id === 'string' ? vendors.get(invite.vendor_id) ?? null : null,
      })),
  })) as VendorOpportunityBriefWithInvites[]
}

function buildBudgetRange(budgetCapCents: number | null): string | null {
  if (!budgetCapCents || budgetCapCents <= 0) return null
  return `[0,${Math.round(budgetCapCents)}]`
}

async function loadVendorRows(db: PlannerDb, vendorIds: string[]) {
  const ids = Array.from(new Set(vendorIds)).filter(isUuid)
  if (ids.length === 0) return new Map<string, Record<string, unknown>>()

  const { data, error } = await db
    .from('vendor_profiles')
    .select(VENDOR_DISPLAY_SELECT)
    .in('id', ids)

  if (error) {
    console.error('Vendor opportunity vendor lookup error:', error)
    throw new Error('Failed to load vendors')
  }

  return new Map(((data ?? []) as Record<string, unknown>[]).map((vendor) => [String(vendor.id), vendor]))
}

function randomToken() {
  return randomBytes(32).toString('hex')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
