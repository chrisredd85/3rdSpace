import 'server-only'

import type { Stripe } from 'stripe'
import { dollarsToCents } from '@/lib/money'
import type { Json } from '@/lib/types'
import { cascadeInvalidationForEntityChange, type DiscoveryEntityType } from '@/lib/discovery/cascadeInvalidation'

export const DISCOVERY_REPORT_CATEGORIES = [
  'closed',
  'wrong_address',
  'wrong_contact',
  'wrong_capacity',
  'rates_outdated',
  'other',
] as const

export type DiscoveryReportCategory = typeof DISCOVERY_REPORT_CATEGORIES[number]

export type DiscoveryDbClient = {
  from: (table: string) => any
}

type VendorProfileSnapshot = {
  business_name?: string | null
  name?: string | null
  service_type?: string | null
  service_area?: string | null
  regions_served?: string | null
  base_rate?: number | string | null
  contact_email?: string | null
  email?: string | null
}

type VendorProfileRow = VendorProfileSnapshot & {
  id: string
  user_id?: string | null
  discovery_vendor_id?: string | null
}

const SELF_UPDATE_FIELDS = [
  'name',
  'service_type',
  'service_area',
  'regions_served',
  'base_rate',
  'contact_email',
] as const

export function fieldNameForDiscoveryReportCategory(category: DiscoveryReportCategory) {
  switch (category) {
    case 'closed':
      return 'business_status'
    case 'wrong_address':
      return 'formatted_address'
    case 'wrong_contact':
      return 'contact_email'
    case 'wrong_capacity':
      return 'capacity'
    case 'rates_outdated':
      return 'rate'
    default:
      return 'general'
  }
}

export async function createOrganizerDiscoveryReport(input: {
  admin: DiscoveryDbClient
  entityType: DiscoveryEntityType
  entityId: string
  planId: string
  userId: string
  category: DiscoveryReportCategory
  details: string
}) {
  const fieldName = fieldNameForDiscoveryReportCategory(input.category)
  const evidence = {
    category: input.category,
    details: input.details,
    reporter_user_id: input.userId,
    plan_id: input.planId,
  }

  const { data, error } = await input.admin
    .from('discovery_change_log')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      source: 'organizer_report',
      field_name: fieldName,
      old_value: null,
      new_value: { category: input.category, details: input.details } satisfies Json,
      confidence: 0.3,
      source_evidence: JSON.stringify(evidence),
      actor_id: input.userId,
      applied: false,
      applied_at: null,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create discovery report: ${error?.message ?? 'No row returned'}`)
  }

  await createAdminReviewTask(input.admin, {
    planId: input.planId,
    entityType: input.entityType,
    entityId: input.entityId,
    category: input.category,
    details: input.details,
    reporterUserId: input.userId,
    changeLogId: readString((data as Record<string, unknown>).id) ?? '',
  })

  return { id: readString((data as Record<string, unknown>).id) ?? '' }
}

export async function ensureDiscoveryVendorForVendorProfile(input: {
  admin: DiscoveryDbClient
  vendorId: string
}): Promise<string | null> {
  const { data: profile, error: profileError } = await input.admin
    .from('vendor_profiles')
    .select('id,user_id,name,email,contact_email,service_type,service_area,regions_served,base_rate,discovery_vendor_id')
    .eq('id', input.vendorId)
    .maybeSingle()

  if (profileError) throw new Error(`Failed to load vendor profile: ${profileError.message}`)
  if (!profile) return null

  const row = profile as VendorProfileRow
  if (row.discovery_vendor_id) return row.discovery_vendor_id

  const vendorName = readString(row.name ?? row.business_name) ?? 'Vendor'
  const serviceType = readString(row.service_type) ?? 'other'
  const sourceExternalId = `vendor_profile:${row.id}`
  const { data: vendor, error: upsertError } = await input.admin
    .from('discovery_vendors')
    .upsert({
      source: 'vendor_self_service',
      source_external_id: sourceExternalId,
      name: vendorName,
      service_type: serviceType,
      city: null,
      state: 'CA',
      contact_email: readString(row.contact_email ?? row.email),
      website_extraction_status: 'never_attempted',
      last_refreshed_at: new Date().toISOString(),
    }, { onConflict: 'source,source_external_id' })
    .select('id')
    .single()

  if (upsertError || !vendor) {
    throw new Error(`Failed to create discovery vendor link: ${upsertError?.message ?? 'No row returned'}`)
  }

  const discoveryVendorId = readString((vendor as Record<string, unknown>).id)
  if (!discoveryVendorId) return null

  const { error: linkError } = await input.admin
    .from('vendor_profiles')
    .update({ discovery_vendor_id: discoveryVendorId })
    .eq('id', row.id)

  if (linkError) throw new Error(`Failed to link vendor profile to discovery vendor: ${linkError.message}`)
  return discoveryVendorId
}

export async function recordVendorProfileSelfUpdate(input: {
  admin: DiscoveryDbClient
  vendorId: string
  actorId: string
  previous: VendorProfileSnapshot
  next: VendorProfileSnapshot
}) {
  const discoveryVendorId = await ensureDiscoveryVendorForVendorProfile({
    admin: input.admin,
    vendorId: input.vendorId,
  })
  if (!discoveryVendorId) return { changes: 0, discoveryVendorId: null }

  const changes = SELF_UPDATE_FIELDS
    .map((field) => {
      const oldValue = normalizeVendorProfileValue(field, input.previous[field])
      const newValue = normalizeVendorProfileValue(field, input.next[field])
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return null
      return { field, oldValue, newValue }
    })
    .filter((change): change is { field: typeof SELF_UPDATE_FIELDS[number]; oldValue: Json; newValue: Json } => Boolean(change))

  if (changes.length === 0) return { changes: 0, discoveryVendorId }

  const now = new Date().toISOString()
  const { error: updateError } = await input.admin
    .from('discovery_vendors')
    .update(buildDiscoveryVendorUpdate(input.next, now))
    .eq('id', discoveryVendorId)

  if (updateError) throw new Error(`Failed to update discovery vendor freshness fields: ${updateError.message}`)

  const rows = changes.map((change) => ({
    entity_type: 'discovery_vendor',
    entity_id: discoveryVendorId,
    source: 'vendor_self_update',
    field_name: change.field,
    old_value: change.oldValue,
    new_value: change.newValue,
    confidence: 1,
    source_evidence: JSON.stringify({
      route: '/vendor/services',
      vendor_profile_id: input.vendorId,
      updated_by_user_id: input.actorId,
    }),
    actor_id: input.actorId,
    applied: true,
    applied_at: now,
  }))

  const { error: insertError } = await input.admin.from('discovery_change_log').insert(rows)
  if (insertError) throw new Error(`Failed to record vendor self-update change log: ${insertError.message}`)

  for (const change of changes) {
    if (change.field === 'service_area' || change.field === 'regions_served') {
      await cascadeInvalidationForEntityChange({
        supabase: input.admin as never,
        entityType: 'discovery_vendor',
        entityId: discoveryVendorId,
        changedField: change.field,
        newValue: change.newValue,
        actorId: input.actorId,
        source: 'vendor_self_update',
      })
    }
  }

  return { changes: changes.length, discoveryVendorId }
}

export async function recordStripeAccountDiscoveryFreshness(input: {
  admin: DiscoveryDbClient
  entityType: DiscoveryEntityType
  entityId: string
  accountId: string
  eventId: string
  previousStatus: string | null
  nextStatus: string | null
  account: Stripe.Account
  shouldCascade: boolean
}) {
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: recent, error: recentError } = await input.admin
    .from('discovery_change_log')
    .select('id')
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .eq('source', 'stripe_account_event')
    .eq('field_name', 'stripe_connect_status')
    .gt('created_at', recentCutoff)
    .limit(1)

  if (recentError) {
    console.error('[discovery.freshness] stripe_change_recent_lookup_failed', recentError)
  }

  if (Array.isArray(recent) && recent.length > 0) {
    return { inserted: false, cascaded: false }
  }

  const now = new Date().toISOString()
  const { data, error } = await input.admin
    .from('discovery_change_log')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      source: 'stripe_account_event',
      field_name: 'stripe_connect_status',
      old_value: input.previousStatus,
      new_value: input.nextStatus,
      confidence: 1,
      source_evidence: JSON.stringify({
        account_id: input.accountId,
        event_id: input.eventId,
        charges_enabled: input.account.charges_enabled,
        payouts_enabled: input.account.payouts_enabled,
        capabilities: input.account.capabilities ?? null,
        requirements: input.account.requirements ?? null,
      }),
      applied: true,
      applied_at: now,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to record Stripe discovery freshness event: ${error?.message ?? 'No row returned'}`)
  }

  if (input.shouldCascade) {
    await cascadeInvalidationForEntityChange({
      supabase: input.admin as never,
      entityType: input.entityType,
      entityId: input.entityId,
      changedField: 'stripe_connect_status',
      newValue: input.nextStatus,
      source: 'stripe_account_event',
    })
    return { inserted: true, cascaded: true }
  }

  return { inserted: true, cascaded: false }
}

async function createAdminReviewTask(
  admin: DiscoveryDbClient,
  input: {
    planId: string
    entityType: DiscoveryEntityType
    entityId: string
    category: DiscoveryReportCategory
    details: string
    reporterUserId: string
    changeLogId: string
  }
) {
  const { error } = await admin.from('admin_tasks').insert({
    plan_id: input.planId,
    task_type: 'catalog_gap',
    description: `Review organizer report for ${input.entityType.replace('discovery_', '')}: ${input.category.replace(/_/g, ' ')}`,
    status: 'open',
    priority: input.category === 'closed' ? 'high' : 'normal',
    metadata: {
      source: 'organizer_report',
      discovery_change_log_id: input.changeLogId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      category: input.category,
      details: input.details,
      reporter_user_id: input.reporterUserId,
    } satisfies Json,
  })

  if (error) {
    console.error('[discovery.freshness] admin_task_insert_failed', error)
  }
}

function buildDiscoveryVendorUpdate(snapshot: VendorProfileSnapshot, now: string) {
  const update: Record<string, unknown> = {
    last_meaningful_change_at: now,
    data_freshness_status: 'changed',
    updated_at: now,
  }
  const name = readString(snapshot.name ?? snapshot.business_name)
  if (name) update.name = name
  const serviceType = readString(snapshot.service_type)
  if (serviceType) update.service_type = serviceType
  const contactEmail = readString(snapshot.contact_email ?? snapshot.email)
  if (contactEmail) update.contact_email = contactEmail
  const baseRate = normalizeNumber(snapshot.base_rate)
  if (baseRate !== null) {
    update.inferred_package_rate_cents = dollarsToCents(baseRate)
    update.rate_inference_confidence = 1
    update.rate_inference_source_quote = 'Vendor self-updated base rate.'
    update.rate_inference_admin_status = 'pending'
    update.rate_inference_extracted_at = now
  }
  return update
}

function normalizeVendorProfileValue(field: string, value: unknown): Json {
  if (field === 'base_rate') {
    const number = normalizeNumber(value)
    return number === null ? null : dollarsToCents(number)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  return value === undefined ? null : JSON.parse(JSON.stringify(value)) as Json
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
