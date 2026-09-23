import { z } from 'zod'
import type { Database } from '@/lib/types/database-generated'
import type { FieldProvenance } from './provenance'

const text = z.string().trim().min(1)
const count = z.number().int().nonnegative()
const cents = z.number().int().nonnegative()

/** Existing column names only. Provider-only fields and arbitrary JSON are deliberately absent. */
export const discoveryFieldSchemas = {
  venue: {
    name: text, address: text, neighborhood: text, city: text, state: text,
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    contact_email: text, contact_phone: text, website: text, instagram_handle: text,
    capacity_seated: count, capacity_standing: count, capacity_cocktail: count,
    inferred_capacity_seated: count, inferred_capacity_standing: count,
    vibe_tags: z.array(text), alcohol_policy: text, av_available: z.boolean(), parking_notes: text,
    price_hint_cents_low: cents, price_hint_cents_high: cents, price_hint_note: text,
  } satisfies Partial<Record<keyof Database['public']['Tables']['discovery_venues']['Row'], z.ZodTypeAny>>,
  vendor: {
    name: text, service_type: text, formatted_address: text, city: text, state: text,
    website: text, phone: text, contact_email: text, organizer_provided_email: text,
    inferred_hourly_rate_cents: cents, inferred_package_rate_cents: cents, inferred_minimum_cents: cents,
  } satisfies Partial<Record<keyof Database['public']['Tables']['discovery_vendors']['Row'], z.ZodTypeAny>>,
} as const

export type DiscoveryKind = keyof typeof discoveryFieldSchemas
export type DiscoveryField<K extends DiscoveryKind> = keyof typeof discoveryFieldSchemas[K] & string
export type DiscoveryFieldProvenance<K extends DiscoveryKind> = Partial<Record<DiscoveryField<K>, FieldProvenance>>
export type DiscoveryValue = string | number | boolean | string[]
