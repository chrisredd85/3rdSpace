import type { Json, Plan } from '@/lib/types'
import type { VendorAgreementRateType } from '@/lib/vendors/rateAgreements'
import { getPlanCanonicalEventId } from '@/lib/planner/eventIdentity'

export type PlannerVendorSelectionDb = { from: (table: string) => any }

export interface SelectedPlanVendorLine {
  id: string
  vendor_id: string
  reference_id: string
  type: 'vendor'
  external_name: string
  service_type: string | null
  price_cents: number
  rate_amount: number
  rate_type: VendorAgreementRateType
  source_event_id: string | null
  rate_source: string
  rate_provenance_label: string | null
  claim_status: string | null
  is_claimed: boolean | null
  [key: string]: Json | undefined
}

export async function enrichPlanSelectedVendors(
  db: PlannerVendorSelectionDb,
  plan: Plan,
  organizerUserId: string
): Promise<Plan> {
  const metadata = readRecord(plan.metadata)
  const shoppingList = readRecord(metadata?.shopping_list)
  const selectedVendors = readSelectedVendorRecords(shoppingList?.selected_vendors)

  const vendorIds = selectedVendors
    .map((vendor) => readString(vendor.vendor_id ?? vendor.reference_id ?? vendor.id))
    .filter((id): id is string => Boolean(id))

  if (vendorIds.length === 0) return plan

  const [{ data: vendors }, { data: agreements }] = await Promise.all([
    db
      .from('vendor_profiles')
      .select('id, name, service_type, base_rate, per_person_rate, pricing_model, claim_status, is_claimed')
      .in('id', vendorIds),
    db
      .from('vendor_rate_agreements')
      .select('vendor_id, amount, rate_type, source_event_id, confirmed_at, status')
      .eq('organizer_user_id', organizerUserId)
      .eq('status', 'confirmed')
      .in('vendor_id', vendorIds)
      .order('confirmed_at', { ascending: false, nullsFirst: false }),
  ])

  const vendorById = new Map(((vendors ?? []) as Record<string, unknown>[]).map((vendor) => [String(vendor.id), vendor]))
  const agreementByVendorId = new Map<string, Record<string, unknown>>()
  for (const agreement of (agreements ?? []) as Record<string, unknown>[]) {
    const vendorId = readString(agreement.vendor_id)
    if (vendorId && !agreementByVendorId.has(vendorId)) agreementByVendorId.set(vendorId, agreement)
  }

  const eventIds = Array.from(new Set(
    Array.from(agreementByVendorId.values())
      .map((agreement) => readString(agreement.source_event_id))
      .filter((id): id is string => Boolean(id))
  ))
  const eventNames = await loadEventNames(db, eventIds)

  const enriched = selectedVendors.map((selected) => {
    const vendorId = readString(selected.vendor_id ?? selected.reference_id ?? selected.id)
    if (!vendorId) return selected

    const vendor = vendorById.get(vendorId)
    const agreement = agreementByVendorId.get(vendorId)
    const next = {
      ...selected,
      vendor_id: vendorId,
      id: vendorId,
      reference_id: vendorId,
      external_name: readString(vendor?.business_name) ?? readString(vendor?.name) ?? readString(selected.external_name) ?? 'Vendor',
      service_type: readString(vendor?.service_type) ?? readString(selected.service_type),
      claim_status: readString(vendor?.claim_status) ?? readString(selected.claim_status),
      is_claimed: readBoolean(vendor?.is_claimed) ?? readBoolean(selected.is_claimed),
    }

    if (!agreement) return next

    const amount = readNumber(agreement.amount)
    const nextRecord = next as Record<string, unknown>
    const rateType = readRateType(agreement.rate_type) ?? readRateType(nextRecord.rate_type) ?? 'flat'
    const sourceEventId = readString(agreement.source_event_id)
    const eventName = sourceEventId ? eventNames.get(sourceEventId) ?? null : null
    return {
      ...next,
      rate_amount: amount,
      rate_type: rateType,
      price_cents: typeof amount === 'number' ? estimateCommittedPriceCents(amount, rateType, plan.guest_count) : readNumber(nextRecord.price_cents),
      rate_source: 'confirmed_private_rate',
      rate_provenance_label: buildProvenanceLabel(amount, eventName, readString(agreement.confirmed_at)),
    }
  })

  return {
    ...plan,
    metadata: {
      ...metadata,
      shopping_list: {
        ...shoppingList,
        selected_vendors: enriched,
      },
    } as Json,
  }
}

export function buildSelectedVendorLine(input: {
  vendor: Record<string, unknown>
  rateAmount: number
  rateType: VendorAgreementRateType
  priceCents: number
  sourceEventId: string | null
  provenanceLabel: string | null
}): SelectedPlanVendorLine {
  const vendorId = readString(input.vendor.id) ?? ''
  return {
    id: vendorId,
    vendor_id: vendorId,
    reference_id: vendorId,
    type: 'vendor',
    external_name: readString(input.vendor.business_name) ?? readString(input.vendor.name) ?? 'Vendor',
    service_type: readString(input.vendor.service_type),
    price_cents: input.priceCents,
    rate_amount: input.rateAmount,
    rate_type: input.rateType,
    source_event_id: input.sourceEventId,
    rate_source: 'organizer_entered',
    rate_provenance_label: input.provenanceLabel,
    claim_status: readString(input.vendor.claim_status),
    is_claimed: readBoolean(input.vendor.is_claimed),
  }
}

export function mergeSelectedVendorIntoMetadata(metadataValue: unknown, selectedVendor: Record<string, unknown>) {
  const metadata = readRecord(metadataValue) ?? {}
  const shoppingList = readRecord(metadata.shopping_list) ?? {}
  const currentVendors = readSelectedVendorRecords(shoppingList.selected_vendors)
  const vendorId = readString(selectedVendor.vendor_id ?? selectedVendor.reference_id ?? selectedVendor.id)
  const selectedVendors = [
    selectedVendor,
    ...currentVendors.filter((vendor) => readString(vendor.vendor_id ?? vendor.reference_id ?? vendor.id) !== vendorId),
  ]

  return {
    ...metadata,
    shopping_list: {
      ...shoppingList,
      selected_vendors: selectedVendors,
      updated_at: new Date().toISOString(),
    },
  }
}

export function getPlanSourceEventId(plan: Plan) {
  return getPlanCanonicalEventId(plan)
}

export function estimateCommittedPriceCents(amountDollars: number, rateType: VendorAgreementRateType, guestCount: number | null) {
  const amountCents = Math.max(Math.round(amountDollars * 100), 0)
  return rateType === 'per_person'
    ? amountCents * Math.max(guestCount ?? 0, 0)
    : amountCents
}

async function loadEventNames(db: PlannerVendorSelectionDb, eventIds: string[]) {
  const result = new Map<string, string>()
  if (eventIds.length === 0) return result

  const { data } = await db
    .from('events')
    .select('id, event_name')
    .in('id', eventIds)

  for (const event of (data ?? []) as Record<string, unknown>[]) {
    const id = readString(event.id)
    const name = readString(event.event_name)
    if (id && name) result.set(id, name)
  }
  return result
}

function buildProvenanceLabel(amount: number | null, eventName: string | null, date: string | null) {
  if (typeof amount !== 'number' || amount <= 0) return null
  const amountLabel = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
  const dateLabel = date
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
    : 'last confirmed booking'
  return `${amountLabel} — your rate from ${eventName || 'a previous event'}, ${dateLabel}`
}

function readSelectedVendorRecords(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = readRecord(item)
        return record ? [record] : []
      })
    : []
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readRateType(value: unknown): VendorAgreementRateType | null {
  return value === 'flat' || value === 'per_person' || value === 'hourly' ? value : null
}
