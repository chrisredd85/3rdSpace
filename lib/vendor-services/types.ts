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
    portfolio_images: row.portfolio_images || [],
    equipment_included: row.equipment_included || [],
    add_ons: normalizeAddOns(row.add_ons),
  }
}
