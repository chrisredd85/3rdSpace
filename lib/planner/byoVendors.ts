/**
 * BYO (bring-your-own) vendor helpers.
 *
 * When the organizer says "I already have my own DJ — they cost $500", the
 * intake agent captures it in `byo_vendors`. We persist the list in
 * `plan.metadata.byo_vendors` so the economics pipeline can fold the cost in,
 * the recommender can skip suggesting that service type from the catalog, and
 * the UI can render a "Yours" section.
 *
 * Merge semantics: a fresh entry for an existing `service_type` replaces the
 * prior one (cost / name updates). Service types absent from the new list are
 * NOT removed — agents occasionally forget to repeat them, and dropping a BYO
 * entry silently would corrupt the organizer's plan.
 */
import type { ByoVendor } from '@/lib/ai/agents/intakeAgent'

export const BYO_VENDORS_METADATA_KEY = 'byo_vendors'

export function readByoVendors(metadata: unknown): ByoVendor[] {
  const root = isRecord(metadata) ? metadata : null
  const raw = root?.[BYO_VENDORS_METADATA_KEY]
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!isRecord(item)) return []
    const serviceType = typeof item.service_type === 'string' ? item.service_type.trim().toLowerCase().replace(/[\s-]+/g, '_') : null
    if (!serviceType) return []
    return [{
      service_type: serviceType,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null,
      cost_cents: typeof item.cost_cents === 'number' && Number.isFinite(item.cost_cents) && item.cost_cents >= 0 ? Math.round(item.cost_cents) : null,
    }]
  })
}

export function mergeByoVendors(existing: ByoVendor[], incoming: ByoVendor[]): ByoVendor[] {
  if (incoming.length === 0) return existing
  const byType = new Map<string, ByoVendor>()
  for (const entry of existing) byType.set(entry.service_type, entry)
  for (const entry of incoming) byType.set(entry.service_type, entry)
  return Array.from(byType.values())
}

export function sumByoVendorCostsCents(vendors: ByoVendor[]): number {
  return vendors.reduce((total, vendor) => total + (vendor.cost_cents ?? 0), 0)
}

export function byoVendorServiceTypes(vendors: ByoVendor[]): Set<string> {
  return new Set(vendors.map((vendor) => vendor.service_type))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
