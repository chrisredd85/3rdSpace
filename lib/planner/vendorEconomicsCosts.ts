export type VendorCostConfidence = 'confirmed' | 'estimated' | 'mixed'

export interface VendorCostSelection {
  vendor_id: string
  price_cents?: number | null
  base_rate_cents?: number | null
  service_type?: string | null
}

export interface VendorCostProfile {
  id: string
  base_rate?: number | null
  per_person_rate?: number | null
  pricing_model?: string | null
  service_type?: string | null
}

export interface VendorCostAgreement {
  vendor_id: string
  organizer_user_id: string
  status: string
  amount: number | string
  rate_type: string
  confirmed_at?: string | null
  created_at?: string | null
}

export interface VendorCostRelationship {
  vendor_id: string
  organizer_user_id: string
}

export interface VendorEconomicsCostLine {
  vendor_id: string
  cost_cents: number
  public_base_cost_cents: number | null
  source: 'confirmed_private_rate' | 'public_profile_rate' | 'selection_estimate' | 'unknown'
  rate_type: string | null
  negotiated_savings_cents: number
}

export interface VendorEconomicsCostSummary {
  vendor_cost_cents: number
  cost_confidence: VendorCostConfidence
  negotiated_savings_cents: number
  vendor_count: number
  confirmed_vendor_count: number
  estimated_vendor_count: number
  lines: VendorEconomicsCostLine[]
}

export async function loadVendorEconomicsCostSummary(
  db: { from: (table: string) => any },
  input: {
    plan: { metadata?: unknown }
    organizerUserId: string
    expectedAttendance: number
    vendorRecommendations?: VendorCostSelection[]
  }
): Promise<VendorEconomicsCostSummary> {
  const selections = extractVendorCostSelections(input.plan, input.vendorRecommendations ?? [])
  if (selections.length === 0) {
    return buildVendorEconomicsCostSummary({
      organizerUserId: input.organizerUserId,
      expectedAttendance: input.expectedAttendance,
      selections,
      profiles: [],
      confirmedAgreements: [],
      relationships: [],
    })
  }

  const vendorIds = selections.map((selection) => selection.vendor_id)
  const [{ data: profileRows }, { data: agreementRows }, { data: relationshipRows }] = await Promise.all([
    db
      .from('vendor_profiles')
      .select('id, base_rate, per_person_rate, pricing_model, service_type')
      .in('id', vendorIds),
    db
      .from('vendor_rate_agreements')
      .select('vendor_id, organizer_user_id, status, amount, rate_type, confirmed_at, created_at')
      .eq('organizer_user_id', input.organizerUserId)
      .eq('status', 'confirmed')
      .in('vendor_id', vendorIds)
      .order('confirmed_at', { ascending: false, nullsFirst: false }),
    db
      .from('organizer_vendor_relationships')
      .select('vendor_id, organizer_user_id')
      .eq('organizer_user_id', input.organizerUserId)
      .in('vendor_id', vendorIds),
  ])

  return buildVendorEconomicsCostSummary({
    organizerUserId: input.organizerUserId,
    expectedAttendance: input.expectedAttendance,
    selections,
    profiles: (profileRows ?? []) as VendorCostProfile[],
    confirmedAgreements: (agreementRows ?? []) as VendorCostAgreement[],
    relationships: (relationshipRows ?? []) as VendorCostRelationship[],
  })
}

export function buildVendorEconomicsCostSummary(input: {
  organizerUserId: string
  expectedAttendance: number
  selections: VendorCostSelection[]
  profiles: VendorCostProfile[]
  confirmedAgreements: VendorCostAgreement[]
  relationships: VendorCostRelationship[]
}): VendorEconomicsCostSummary {
  const profileByVendorId = new Map(input.profiles.map((profile) => [profile.id, profile]))
  const agreementByVendorId = getLatestOrganizerConfirmedAgreements(input.confirmedAgreements, input.organizerUserId)
  const tierOneVendorIds = new Set(
    input.relationships
      .filter((relationship) => relationship.organizer_user_id === input.organizerUserId)
      .map((relationship) => relationship.vendor_id)
  )

  let confirmedVendorCount = 0
  let estimatedVendorCount = 0
  const lines = input.selections.map((selection): VendorEconomicsCostLine => {
    const profile = profileByVendorId.get(selection.vendor_id)
    const agreement = agreementByVendorId.get(selection.vendor_id)
    const publicBaseCostCents = estimatePublicProfileCostCents(
      profile,
      Math.max(input.expectedAttendance, 0),
      selection.price_cents ?? selection.base_rate_cents ?? null
    )

    if (agreement) {
      confirmedVendorCount += 1
      const confirmedCostCents = estimateAgreementCostCents(agreement, Math.max(input.expectedAttendance, 0))
      const negotiatedSavingsCents =
        tierOneVendorIds.has(selection.vendor_id) && publicBaseCostCents !== null
          ? Math.max(publicBaseCostCents - confirmedCostCents, 0)
          : 0

      return {
        vendor_id: selection.vendor_id,
        cost_cents: confirmedCostCents,
        public_base_cost_cents: publicBaseCostCents,
        source: 'confirmed_private_rate',
        rate_type: agreement.rate_type,
        negotiated_savings_cents: negotiatedSavingsCents,
      }
    }

    estimatedVendorCount += 1
    const selectionEstimate = toIntegerCents(selection.price_cents ?? selection.base_rate_cents)
    const estimatedCostCents = publicBaseCostCents ?? selectionEstimate ?? 0
    return {
      vendor_id: selection.vendor_id,
      cost_cents: estimatedCostCents,
      public_base_cost_cents: publicBaseCostCents,
      source: publicBaseCostCents !== null
        ? 'public_profile_rate'
        : selectionEstimate !== null
          ? 'selection_estimate'
          : 'unknown',
      rate_type: profile?.pricing_model ?? null,
      negotiated_savings_cents: 0,
    }
  })

  return {
    vendor_cost_cents: lines.reduce((sum, line) => sum + line.cost_cents, 0),
    cost_confidence: getCostConfidence(input.selections.length, confirmedVendorCount),
    negotiated_savings_cents: lines.reduce((sum, line) => sum + line.negotiated_savings_cents, 0),
    vendor_count: input.selections.length,
    confirmed_vendor_count: confirmedVendorCount,
    estimated_vendor_count: estimatedVendorCount,
    lines,
  }
}

function extractVendorCostSelections(
  plan: { metadata?: unknown },
  fallbackRecommendations: VendorCostSelection[]
): VendorCostSelection[] {
  const metadata = asRecord(plan.metadata)
  const shoppingList = asRecord(metadata?.shopping_list)
  const selectedVendors = Array.isArray(shoppingList?.selected_vendors)
    ? shoppingList.selected_vendors
    : []
  const planSelections = selectedVendors
    .map((item): VendorCostSelection | null => {
      const record = asRecord(item)
      const vendorId = readString(record?.vendor_id ?? record?.reference_id ?? record?.id)
      if (!vendorId) return null
      return {
        vendor_id: vendorId,
        price_cents: readNumber(record?.price_cents),
        base_rate_cents: readNumber(record?.base_rate_cents),
        service_type: readString(record?.service_type),
      }
    })
    .filter((selection): selection is VendorCostSelection => Boolean(selection))

  const sourceSelections = planSelections.length > 0 ? planSelections : fallbackRecommendations
  const uniqueSelections = new Map<string, VendorCostSelection>()
  for (const selection of sourceSelections) {
    if (!selection.vendor_id || uniqueSelections.has(selection.vendor_id)) continue
    uniqueSelections.set(selection.vendor_id, selection)
  }
  return Array.from(uniqueSelections.values())
}

function getLatestOrganizerConfirmedAgreements(
  agreements: VendorCostAgreement[],
  organizerUserId: string
): Map<string, VendorCostAgreement> {
  const result = new Map<string, VendorCostAgreement>()
  const sorted = [...agreements]
    .filter((agreement) =>
      agreement.organizer_user_id === organizerUserId &&
      agreement.status === 'confirmed'
    )
    .sort((first, second) =>
      Date.parse(second.confirmed_at ?? second.created_at ?? '') -
      Date.parse(first.confirmed_at ?? first.created_at ?? '')
    )

  for (const agreement of sorted) {
    if (!result.has(agreement.vendor_id)) result.set(agreement.vendor_id, agreement)
  }
  return result
}

function estimateAgreementCostCents(agreement: VendorCostAgreement, expectedAttendance: number): number {
  const amountCents = dollarsToCents(agreement.amount)
  return agreement.rate_type === 'per_person'
    ? amountCents * expectedAttendance
    : amountCents
}

function estimatePublicProfileCostCents(
  profile: VendorCostProfile | undefined,
  expectedAttendance: number,
  fallbackSelectionPriceCents: number | null
): number | null {
  if (!profile) return toIntegerCents(fallbackSelectionPriceCents)
  const perPersonRate = toIntegerCents(profile.per_person_rate)
  if (profile.pricing_model === 'per_person' && perPersonRate !== null) {
    return perPersonRate * expectedAttendance
  }
  const baseRate = toIntegerCents(profile.base_rate)
  if (baseRate !== null) return baseRate
  if (perPersonRate !== null) return perPersonRate * expectedAttendance
  return toIntegerCents(fallbackSelectionPriceCents)
}

function getCostConfidence(vendorCount: number, confirmedVendorCount: number): VendorCostConfidence {
  if (vendorCount === 0) return 'estimated'
  if (confirmedVendorCount === 0) return 'estimated'
  if (confirmedVendorCount === vendorCount) return 'confirmed'
  return 'mixed'
}

function dollarsToCents(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function toIntegerCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(Math.round(value), 0)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
