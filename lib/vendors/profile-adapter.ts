import type { PricingModel, ServiceType, Vendor } from '@/lib/types'

type VendorProfileRow = Record<string, any>

const SERVICE_TYPE_TO_VENDOR_TYPE: Record<ServiceType, string> = {
  dj: 'DJ / Music',
  catering: 'Caterer',
  bartending: 'Bartender',
  photography: 'Photographer',
  videography: 'Photographer',
  av_tech: 'Audio/Visual Tech',
  event_planning: 'Security / Event Staff',
  florist: 'Decorator / Florist',
  other: 'DJ / Music',
}

const VENDOR_TYPE_TO_SERVICE_TYPE: Record<string, ServiceType> = {
  'DJ / Music': 'dj',
  Bartender: 'bartending',
  Photographer: 'photography',
  Caterer: 'catering',
  'Audio/Visual Tech': 'av_tech',
  'Security / Event Staff': 'event_planning',
  'Decorator / Florist': 'florist',
  'Photo Booth Operator': 'photography',
}

/**
 * Normalizes legacy vendor pricing values into the app's pricing model enum.
 *
 * @param value - Raw pricing value from vendor_profiles.
 * @returns App pricing model.
 */
export function normalizeVendorPricingModel(value: unknown): PricingModel {
  if (value === 'flat' || value === 'package') return 'flat_rate'
  if (value === 'per_person' || value === 'hourly' || value === 'revenue_share' || value === 'hybrid') {
    return value
  }
  return 'flat_rate'
}

/**
 * Converts app service type values into legacy vendor_type labels.
 *
 * @param serviceType - App service type.
 * @returns Vendor profile label accepted by existing constraints.
 */
export function serviceTypeToVendorType(serviceType: ServiceType) {
  return SERVICE_TYPE_TO_VENDOR_TYPE[serviceType] || SERVICE_TYPE_TO_VENDOR_TYPE.other
}

/**
 * Converts a vendor_profiles row into the app-facing Vendor shape.
 *
 * @param row - Raw vendor_profiles row.
 * @returns Normalized Vendor object.
 */
export function normalizeVendorProfile(row: VendorProfileRow): Vendor {
  const serviceType =
    (row.service_type as ServiceType | null) ||
    VENDOR_TYPE_TO_SERVICE_TYPE[row.vendor_type as string] ||
    'other'

  return {
    id: row.id,
    owner_id: row.user_id,
    name: row.name,
    description: row.bio ?? null,
    service_type: serviceType,
    business_name: row.business_name ?? row.name ?? null,
    tax_id: row.tax_id ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip_code: row.zip_code ?? null,
    country: row.country ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    pricing_model: normalizeVendorPricingModel(row.pricing_model),
    hourly_rate: row.hourly_rate ?? null,
    base_rate: row.base_rate ?? null,
    per_person_rate: row.per_person_rate ?? null,
    per_head_chi_cents: row.per_head_chi_cents ?? row.per_head_kickback ?? null,
    per_head_kickback: row.per_head_kickback ?? null,
    contact_email: row.contact_email ?? null,
    is_claimed: row.is_claimed ?? false,
    claimed_user_id: row.claimed_user_id ?? null,
    is_admin_seeded: row.is_admin_seeded ?? false,
    requires_deposit: row.requires_deposit ?? false,
    deposit_amount: row.deposit_amount ?? null,
    deposit_type: row.deposit_type ?? null,
    deposit_percentage: row.deposit_percentage ?? null,
    deposit_refundable: row.deposit_refundable ?? true,
    deposit_terms: row.deposit_terms ?? null,
    service_area: row.service_area ?? null,
    regions_served: row.regions_served ?? null,
    availability_notes: row.availability_notes ?? null,
    lead_time_days: row.lead_time_days ?? null,
    cancellation_terms: row.cancellation_terms ?? null,
    emergency_available: row.emergency_available ?? false,
    emergency_rate_uplift: row.emergency_rate_uplift ?? null,
    is_active: row.is_active ?? row.is_published ?? true,
    is_verified: row.is_verified ?? row.is_published ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Converts app-facing vendor updates into vendor_profiles columns.
 *
 * @param updates - Partial Vendor update.
 * @returns Update payload for vendor_profiles.
 */
export function toVendorProfileUpdate(updates: Partial<Vendor>) {
  const payload: Record<string, unknown> = {}

  if (updates.owner_id !== undefined) payload.user_id = updates.owner_id
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.description !== undefined) payload.bio = updates.description
  if (updates.service_type !== undefined) {
    payload.service_type = updates.service_type
    payload.vendor_type = serviceTypeToVendorType(updates.service_type)
  }
  if (updates.phone !== undefined) payload.phone = updates.phone
  if (updates.pricing_model !== undefined) payload.pricing_model = updates.pricing_model
  if (updates.hourly_rate !== undefined) payload.hourly_rate = updates.hourly_rate
  if (updates.base_rate !== undefined) payload.base_rate = updates.base_rate
  if (updates.per_person_rate !== undefined) payload.per_person_rate = updates.per_person_rate
  if (updates.per_head_chi_cents !== undefined) payload.per_head_kickback = updates.per_head_chi_cents
  else if (updates.per_head_kickback !== undefined) payload.per_head_kickback = updates.per_head_kickback
  if (updates.requires_deposit !== undefined) payload.requires_deposit = updates.requires_deposit
  if (updates.deposit_amount !== undefined) payload.deposit_amount = updates.deposit_amount
  if (updates.deposit_type !== undefined) payload.deposit_type = updates.deposit_type
  if (updates.deposit_percentage !== undefined) payload.deposit_percentage = updates.deposit_percentage
  if (updates.deposit_refundable !== undefined) payload.deposit_refundable = updates.deposit_refundable
  if (updates.deposit_terms !== undefined) payload.deposit_terms = updates.deposit_terms
  if (updates.service_area !== undefined) payload.service_area = updates.service_area
  if (updates.regions_served !== undefined) payload.regions_served = updates.regions_served
  if (updates.availability_notes !== undefined) payload.availability_notes = updates.availability_notes
  if (updates.lead_time_days !== undefined) payload.lead_time_days = updates.lead_time_days
  if (updates.cancellation_terms !== undefined) payload.cancellation_terms = updates.cancellation_terms
  if (updates.emergency_available !== undefined) payload.emergency_available = updates.emergency_available
  if (updates.emergency_rate_uplift !== undefined) payload.emergency_rate_uplift = updates.emergency_rate_uplift
  if (updates.is_active !== undefined) payload.is_published = updates.is_active

  return payload
}

/**
 * Converts a full Vendor object into a vendor_profiles insert payload.
 *
 * @param vendor - App-facing vendor object.
 * @returns Insert payload for vendor_profiles.
 */
export function toVendorProfileInsert(vendor: Omit<Vendor, 'id' | 'created_at' | 'updated_at'>) {
  return {
    ...toVendorProfileUpdate(vendor),
    user_id: vendor.owner_id,
    name: vendor.name,
    vendor_type: serviceTypeToVendorType(vendor.service_type),
    service_type: vendor.service_type,
    bio: vendor.description ?? null,
    phone: vendor.phone ?? null,
    pricing_model: vendor.pricing_model,
    is_published: vendor.is_active,
  }
}
