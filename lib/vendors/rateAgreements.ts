export type VendorAgreementRateType = 'flat' | 'per_person' | 'hourly'

export interface ConfirmedVendorRateAgreement {
  amount: number
  rate_type: VendorAgreementRateType
  source_event_id: string | null
  source_event_name?: string | null
  source_event_date?: string | null
  confirmed_at: string | null
}

export interface VendorRatePrefill {
  amount: number | null
  rate_type: VendorAgreementRateType | null
  source: 'confirmed_agreement' | 'public_base_rate' | 'none'
  provenance_label: string | null
  last_confirmed: ConfirmedVendorRateAgreement | null
}

export interface RateAgreementCommitPlan {
  should_insert: boolean
  warning: string | null
  warning_delta_pct: number | null
  provenance_state: 'same_confirmed_rate' | 'edited_confirmed_rate' | 'first_known_rate'
}

export async function getVendorRatePrefill(
  db: any,
  organizerUserId: string,
  vendorId: string
): Promise<VendorRatePrefill> {
  const lastConfirmed = await loadLastConfirmedRate(db, organizerUserId, vendorId)
  if (lastConfirmed) {
    return {
      amount: lastConfirmed.amount,
      rate_type: lastConfirmed.rate_type,
      source: 'confirmed_agreement',
      provenance_label: buildRateProvenanceLabel(lastConfirmed),
      last_confirmed: lastConfirmed,
    }
  }

  const { data: vendor } = await db
    .from('vendor_profiles')
    .select('base_rate, pricing_model')
    .eq('id', vendorId)
    .maybeSingle()

  const publicBaseRate = typeof vendor?.base_rate === 'number' ? vendor.base_rate / 100 : null
  return {
    amount: publicBaseRate,
    rate_type: normalizeRateType(vendor?.pricing_model),
    source: publicBaseRate ? 'public_base_rate' : 'none',
    provenance_label: null,
    last_confirmed: null,
  }
}

export async function commitVendorRateAgreement(
  db: any,
  input: {
    organizerUserId: string
    vendorId: string
    sourceEventId?: string | null
    amount: number
    rateType: VendorAgreementRateType
  }
): Promise<RateAgreementCommitPlan> {
  const lastConfirmed = await loadLastConfirmedRate(db, input.organizerUserId, input.vendorId)
  const plan = buildRateAgreementCommitPlan({
    lastConfirmedAmount: lastConfirmed?.amount ?? null,
    newAmount: input.amount,
    vendorName: 'this vendor',
  })

  if (!plan.should_insert) return plan

  const { error } = await db
    .from('vendor_rate_agreements')
    .insert({
      organizer_user_id: input.organizerUserId,
      vendor_id: input.vendorId,
      source_event_id: input.sourceEventId || null,
      amount: roundMoney(input.amount),
      rate_type: input.rateType,
      status: 'proposed',
    })

  if (error) {
    throw new Error(`Could not save proposed vendor rate agreement: ${error.message}`)
  }

  return plan
}

export function buildRateAgreementCommitPlan(input: {
  lastConfirmedAmount: number | null
  newAmount: number
  vendorName?: string | null
}): RateAgreementCommitPlan {
  const newAmount = roundMoney(input.newAmount)
  const lastAmount = input.lastConfirmedAmount == null ? null : roundMoney(input.lastConfirmedAmount)

  if (lastAmount == null) {
    return {
      should_insert: true,
      warning: null,
      warning_delta_pct: null,
      provenance_state: 'first_known_rate',
    }
  }

  if (lastAmount === newAmount) {
    return {
      should_insert: false,
      warning: null,
      warning_delta_pct: null,
      provenance_state: 'same_confirmed_rate',
    }
  }

  const delta = Math.abs(newAmount - lastAmount) / lastAmount
  const deltaPct = Math.round(delta * 100)
  return {
    should_insert: true,
    warning: delta > 0.2
      ? `This is ${deltaPct}% different from your last rate with ${input.vendorName || 'this vendor'}. Looks intentional?`
      : null,
    warning_delta_pct: delta > 0.2 ? deltaPct : null,
    provenance_state: 'edited_confirmed_rate',
  }
}

async function loadLastConfirmedRate(
  db: any,
  organizerUserId: string,
  vendorId: string
): Promise<ConfirmedVendorRateAgreement | null> {
  const { data: rows, error } = await db
    .from('vendor_rate_agreements')
    .select('amount, rate_type, source_event_id, confirmed_at')
    .eq('vendor_id', vendorId)
    .eq('organizer_user_id', organizerUserId)
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: false })
    .limit(1)

  if (error) return null
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null

  let eventName: string | null = null
  let eventDate: string | null = null
  if (row.source_event_id) {
    const { data: event } = await db
      .from('events')
      .select('event_name, event_date')
      .eq('id', row.source_event_id)
      .maybeSingle()
    eventName = event?.event_name || null
    eventDate = event?.event_date || null
  }

  return {
    amount: Number(row.amount),
    rate_type: normalizeRateType(row.rate_type) || 'flat',
    source_event_id: row.source_event_id,
    source_event_name: eventName,
    source_event_date: eventDate,
    confirmed_at: row.confirmed_at,
  }
}

function buildRateProvenanceLabel(agreement: ConfirmedVendorRateAgreement) {
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(agreement.amount)
  const eventName = agreement.source_event_name || 'a previous event'
  const date = agreement.source_event_date || agreement.confirmed_at
  const dateLabel = date
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
    : 'last confirmed booking'
  return `${amount} — your rate from ${eventName}, ${dateLabel}`
}

function normalizeRateType(value: unknown): VendorAgreementRateType | null {
  if (value === 'flat' || value === 'flat_rate') return 'flat'
  if (value === 'per_person') return 'per_person'
  if (value === 'hourly') return 'hourly'
  return null
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}
