import type { Json, PricingModel } from '@/lib/types'
import type { VendorServiceCategory } from './service-options'

export interface VendorServiceAddOn {
  name: string
  price: number
  description?: string
}

export interface VendorService {
  id: string
  vendor_id: string
  offering_name: string
  description: string | null
  base_price: number
  pricing_model: PricingModel
  min_quantity: number | null
  max_quantity: number | null
  duration_hours: number | null
  portfolio_images: string[]
  add_ons: VendorServiceAddOn[]
  service_category: VendorServiceCategory
  max_capacity: number | null
  equipment_included: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface VendorServicePayload {
  offering_name: string
  description?: string | null
  base_price: number
  duration_hours?: number | null
  service_category: VendorServiceCategory
  max_capacity?: number | null
  equipment_included?: string[]
  add_ons?: VendorServiceAddOn[]
  is_active?: boolean
}

export type VendorServiceRow = Omit<VendorService, 'add_ons'> & {
  add_ons: Json | null
}

/**
 * Normalizes arrays that may arrive as Postgres arrays, JSON strings, or
 * comma-separated legacy text.
 *
 * @param value - Untyped Supabase value.
 * @returns Clean string array.
 */
export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }

  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  const postgresArray = trimmed.match(/^\{(.*)\}$/)
  const source = postgresArray ? postgresArray[1] : trimmed
  return source
    .split(/[,;]/)
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

/**
 * Normalizes untyped Supabase JSON values into service add-ons.
 *
 * @param value - JSON value from vendor_offerings.add_ons.
 * @returns Sanitized add-on array.
 */
export function normalizeAddOns(value: Json | null | undefined): VendorServiceAddOn[] {
  if (!Array.isArray(value)) return []

  return value.reduce<VendorServiceAddOn[]>((addOns, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return addOns
    const raw = item as Record<string, Json | undefined>
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const price = typeof raw.price === 'number' ? raw.price : Number(raw.price || 0)
    const description = typeof raw.description === 'string' ? raw.description : undefined

    if (!name || Number.isNaN(price) || price < 0) return addOns
    addOns.push({ name, price, description })
    return addOns
  }, [])
}

/**
 * Converts a database row into the app-facing service shape.
 *
 * @param row - Raw vendor_offerings row.
 * @returns Normalized service listing.
 */
export function normalizeVendorService(row: VendorServiceRow): VendorService {
  return {
    ...row,
    base_price: Number(row.base_price || 0),
    min_quantity: row.min_quantity == null ? null : Number(row.min_quantity),
    max_quantity: row.max_quantity == null ? null : Number(row.max_quantity),
    duration_hours: row.duration_hours == null ? null : Number(row.duration_hours),
    max_capacity: row.max_capacity == null ? null : Number(row.max_capacity),
    portfolio_images: normalizeStringArray(row.portfolio_images),
    equipment_included: normalizeStringArray(row.equipment_included),
    add_ons: normalizeAddOns(row.add_ons),
  }
}
