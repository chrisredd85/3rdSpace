import { dollarsToCents } from '@/lib/money'
import { calculateCHI } from '@/lib/finance/community-host-incentive/calculate'
import type {
  CHIAgreementInput,
  CHISettlementResult,
  CHIVerificationSource,
} from '@/lib/finance/community-host-incentive/types'

export type LegacyVenueSettlementAgreement = {
  id: string
  event_id: string | null
  plan_id: string | null
  venue_id: string
  builder_id: string
  venue_owner_id: string
  actual_attendance: number | null
  actual_qualified_attendance?: number | null
  attendance_extracted_value?: number | null
  attendance_proof_url?: string | null
  per_head_amount: number | string | null
  minimum_attendees: number | null
  maximum_payout: number | string | null
  venue_approved?: boolean | null
  venue_approved_at?: string | null
  disputed_at?: string | null
}

export type CHIAgreementRowForLegacySettlement = {
  id: string
  event_id: string | null
  plan_id: string | null
  venue_id: string
  organizer_user_id: string
  venue_owner_user_id: string
  agreement_type: CHIAgreementInput['agreementType']
  per_head_rate_cents: number | null
  fixed_amount_cents: number | null
  threshold_attendees: number | null
  base_amount_cents: number | null
  payout_floor_cents: number | null
  payout_cap_cents: number | null
  venue_approved: boolean
  approved_at: string | null
  approved_by_venue_user_id: string | null
}

export type CHISettlementRowForLegacySettlement = {
  id: string
  agreement_id: string
  event_id: string | null
  status: string
  stripe_invoice_id: string | null
  stripe_transfer_id: string | null
}

export type ResolvedCHIAttendance = {
  verifiedAttendees: number
  verificationSource: CHIVerificationSource
  verificationSourceId?: string
}

export type LegacySettlementCHIResult = {
  chiAgreementInput: CHIAgreementInput
  attendance: ResolvedCHIAttendance
  chiResult: CHISettlementResult
  chiAgreement: CHIAgreementRowForLegacySettlement
  chiSettlement: CHISettlementRowForLegacySettlement
}

const CHI_AGREEMENT_SELECT = [
  'id',
  'event_id',
  'plan_id',
  'venue_id',
  'organizer_user_id',
  'venue_owner_user_id',
  'agreement_type',
  'per_head_rate_cents',
  'fixed_amount_cents',
  'threshold_attendees',
  'base_amount_cents',
  'payout_floor_cents',
  'payout_cap_cents',
  'venue_approved',
  'approved_at',
  'approved_by_venue_user_id',
].join(', ')

const CHI_SETTLEMENT_SELECT = [
  'id',
  'agreement_id',
  'event_id',
  'status',
  'stripe_invoice_id',
  'stripe_transfer_id',
].join(', ')

export async function upsertCommunityHostIncentiveFromLegacy(
  admin: any,
  input: {
    sourceAgreement: LegacyVenueSettlementAgreement
    organizerUserId: string
    venueOwnerUserId: string
    approvedAt: string
    approvedByVenueUserId: string
    principalCents: number
    legacyPaymentId?: string | null
    now: string
    dueDateIso?: string
  }
): Promise<LegacySettlementCHIResult> {
  const chiAgreementInput = buildCHIAgreementInputFromLegacy({
    agreement: input.sourceAgreement,
    principalCents: input.principalCents,
    approvedAt: input.approvedAt,
    approvedByVenueUserId: input.approvedByVenueUserId,
  })
  const attendance = resolveVerifiedAttendance(input.sourceAgreement)
  const chiResult = calculateCHI({
    agreement: chiAgreementInput,
    verifiedAttendees: attendance.verifiedAttendees,
    verificationSource: attendance.verificationSource,
    verificationSourceId: attendance.verificationSourceId,
  })
  const chiAgreement = await upsertCHIAgreementForLegacySettlement(admin, {
    sourceAgreement: input.sourceAgreement,
    chiAgreementInput,
    organizerUserId: input.organizerUserId,
    venueOwnerUserId: input.venueOwnerUserId,
    now: input.now,
    dueDateIso: input.dueDateIso ?? null,
    legacyPaymentId: input.legacyPaymentId ?? null,
  })
  const chiSettlement = await upsertCHISettlementForLegacySettlement(admin, {
    sourceAgreement: input.sourceAgreement,
    chiAgreement,
    attendance,
    chiResult,
    now: input.now,
    legacyPaymentId: input.legacyPaymentId ?? null,
  })

  return {
    chiAgreementInput,
    attendance,
    chiResult,
    chiAgreement,
    chiSettlement,
  }
}

export function resolveVerifiedAttendance(agreement: LegacyVenueSettlementAgreement): ResolvedCHIAttendance {
  const checkedInAttendance =
    readNonNegativeInteger(agreement.actual_qualified_attendance) ??
    readNonNegativeInteger(agreement.actual_attendance)
  if (checkedInAttendance !== null) {
    return {
      verifiedAttendees: checkedInAttendance,
      verificationSource: 'csv_upload',
      verificationSourceId: agreement.attendance_proof_url ?? undefined,
    }
  }

  const extractedAttendance = readNonNegativeInteger(agreement.attendance_extracted_value)
  return {
    verifiedAttendees: extractedAttendance ?? 0,
    verificationSource: extractedAttendance === null ? 'ticketing_api' : 'screenshot_ocr',
    verificationSourceId: agreement.attendance_proof_url ?? undefined,
  }
}

export function buildCHIAgreementInputFromLegacy({
  agreement,
  principalCents,
  approvedAt,
  approvedByVenueUserId,
}: {
  agreement: LegacyVenueSettlementAgreement
  principalCents: number
  approvedAt: string
  approvedByVenueUserId: string
}): CHIAgreementInput {
  const perHeadRateCents = dollarsToCents(agreement.per_head_amount)
  const payoutCapCents = dollarsToCents(agreement.maximum_payout)
  const common = {
    venueApproved: true,
    approvedAt,
    approvedByVenueUserId,
    payoutCapCents: payoutCapCents > 0 ? payoutCapCents : undefined,
  }

  if (perHeadRateCents > 0) {
    return {
      ...common,
      agreementType: 'per_verified_attendee',
      perHeadRateCents,
    }
  }

  if (readNonNegativeInteger(agreement.minimum_attendees) !== null) {
    return {
      ...common,
      agreementType: 'fixed_threshold',
      fixedAmountCents: principalCents,
      thresholdAttendees: agreement.minimum_attendees ?? 0,
    }
  }

  return {
    ...common,
    agreementType: 'manual_venue_approved',
    fixedAmountCents: principalCents,
  }
}

export async function upsertLegacyPaymentCompatibilityForCHI(
  admin: any,
  input: {
    sourceAgreement: LegacyVenueSettlementAgreement
    amountCents: number
    existingPaymentId?: string | null
    status: string
    now: string
  }
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    agreement_id: input.sourceAgreement.id,
    event_id: input.sourceAgreement.event_id,
    payer_id: input.sourceAgreement.venue_owner_id,
    recipient_id: input.sourceAgreement.builder_id,
    amount_cents: input.amountCents,
    currency: 'usd',
    status: input.status,
    settlement_method: 'invoice',
    builder_payout_cents: input.amountCents,
    updated_at: input.now,
  }

  if (input.existingPaymentId) {
    payload.id = input.existingPaymentId
  }

  const { data, error } = await admin
    .from('kickback_payments')
    .upsert(payload, { onConflict: 'agreement_id' })
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to save CHI payment compatibility row')
  }

  if (!data?.id) {
    throw new Error('CHI payment compatibility row was not returned after upsert')
  }

  return data as { id: string }
}

async function upsertCHIAgreementForLegacySettlement(
  admin: any,
  input: {
    sourceAgreement: LegacyVenueSettlementAgreement
    chiAgreementInput: CHIAgreementInput
    organizerUserId: string
    venueOwnerUserId: string
    now: string
    dueDateIso: string | null
    legacyPaymentId: string | null
  }
): Promise<CHIAgreementRowForLegacySettlement> {
  const existing = await loadExistingCHIAgreementForLegacySettlement(
    admin,
    input.sourceAgreement,
    input.organizerUserId
  )
  const payload = {
    agreement_type: input.chiAgreementInput.agreementType,
    per_head_rate_cents: input.chiAgreementInput.perHeadRateCents ?? null,
    fixed_amount_cents: input.chiAgreementInput.fixedAmountCents ?? null,
    threshold_attendees: input.chiAgreementInput.thresholdAttendees ?? null,
    base_amount_cents: input.chiAgreementInput.baseAmountCents ?? null,
    payout_floor_cents: input.chiAgreementInput.payoutFloorCents ?? null,
    payout_cap_cents: input.chiAgreementInput.payoutCapCents ?? null,
    settlement_mode: 'community_host_incentive',
    status: 'approved',
    venue_approved: true,
    approved_at: input.chiAgreementInput.approvedAt,
    approved_by_venue_user_id: input.chiAgreementInput.approvedByVenueUserId,
    settlement_due_at: input.dueDateIso,
    is_legacy_revenue_share: false,
    metadata: {
      source_table: 'event_kickback_agreements',
      source_agreement_id: input.sourceAgreement.id,
      legacy_payment_id: input.legacyPaymentId,
    },
    updated_at: input.now,
  }

  if (existing?.id) {
    await updateOrThrow(
      admin
        .from('community_host_incentive_agreements')
        .update(payload)
        .eq('id', existing.id),
      'Failed to update CHI agreement'
    )

    return {
      ...existing,
      ...payload,
      agreement_type: payload.agreement_type,
      venue_approved: true,
      approved_at: payload.approved_at,
      approved_by_venue_user_id: payload.approved_by_venue_user_id,
    }
  }

  const { data, error } = await admin
    .from('community_host_incentive_agreements')
    .insert({
      event_id: input.sourceAgreement.event_id,
      plan_id: input.sourceAgreement.plan_id,
      venue_id: input.sourceAgreement.venue_id,
      organizer_user_id: input.organizerUserId,
      venue_owner_user_id: input.venueOwnerUserId,
      created_at: input.now,
      ...payload,
    })
    .select(CHI_AGREEMENT_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to create CHI agreement')
  if (!data) throw new Error('Failed to create CHI agreement')
  return data as CHIAgreementRowForLegacySettlement
}

async function loadExistingCHIAgreementForLegacySettlement(
  admin: any,
  agreement: LegacyVenueSettlementAgreement,
  organizerUserId: string
): Promise<CHIAgreementRowForLegacySettlement | null> {
  let query = admin
    .from('community_host_incentive_agreements')
    .select(CHI_AGREEMENT_SELECT)
    .eq('venue_id', agreement.venue_id)
    .eq('organizer_user_id', organizerUserId)

  if (agreement.event_id) {
    query = query.eq('event_id', agreement.event_id)
  } else if (agreement.plan_id) {
    query = query.eq('plan_id', agreement.plan_id)
  } else {
    query = query.is('event_id', null).is('plan_id', null)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load CHI agreement')
  return (data as CHIAgreementRowForLegacySettlement | null) ?? null
}

async function upsertCHISettlementForLegacySettlement(
  admin: any,
  input: {
    sourceAgreement: LegacyVenueSettlementAgreement
    chiAgreement: CHIAgreementRowForLegacySettlement
    attendance: ResolvedCHIAttendance
    chiResult: CHISettlementResult
    now: string
    legacyPaymentId: string | null
  }
): Promise<CHISettlementRowForLegacySettlement> {
  const { data: existing, error: existingError } = await admin
    .from('community_host_incentive_settlements')
    .select(CHI_SETTLEMENT_SELECT)
    .eq('agreement_id', input.chiAgreement.id)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message ?? 'Failed to load CHI settlement')

  const payload = {
    event_id: input.sourceAgreement.event_id,
    verified_attendees: input.attendance.verifiedAttendees,
    verification_source: input.attendance.verificationSource,
    verification_source_id: input.attendance.verificationSourceId ?? null,
    organizer_payout_cents: input.chiResult.organizerPayoutCents,
    calculation_basis: input.chiResult.calculationBasis,
    applied_floor: input.chiResult.appliedFloor,
    applied_cap: input.chiResult.appliedCap,
    status: 'pending',
    is_legacy_revenue_share: false,
    metadata: {
      source_table: 'event_kickback_agreements',
      source_agreement_id: input.sourceAgreement.id,
      legacy_payment_id: input.legacyPaymentId,
    },
    updated_at: input.now,
  }

  if ((existing as CHISettlementRowForLegacySettlement | null)?.id) {
    const settlement = existing as CHISettlementRowForLegacySettlement
    await updateOrThrow(
      admin
        .from('community_host_incentive_settlements')
        .update(payload)
        .eq('id', settlement.id),
      'Failed to update CHI settlement'
    )

    return {
      ...settlement,
      ...payload,
      status: payload.status,
      stripe_invoice_id: settlement.stripe_invoice_id,
      stripe_transfer_id: settlement.stripe_transfer_id,
    }
  }

  const { data, error } = await admin
    .from('community_host_incentive_settlements')
    .insert({
      agreement_id: input.chiAgreement.id,
      created_at: input.now,
      ...payload,
    })
    .select(CHI_SETTLEMENT_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to create CHI settlement')
  if (!data) throw new Error('Failed to create CHI settlement')
  return data as CHISettlementRowForLegacySettlement
}

export async function updateOrThrow(
  query: PromiseLike<{ error?: { message?: string } | null }>,
  fallback: string
) {
  const { error } = await query
  if (error) throw new Error(error.message ?? fallback)
}

export function readNonNegativeInteger(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) return null
  return numeric
}
