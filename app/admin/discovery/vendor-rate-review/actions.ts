'use server'

import { revalidatePath } from 'next/cache'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SAFE_VENDOR_TABLE, readSafeDiscoveryVendor, writeVendorFacts } from '@/lib/discovery/vendorRepository'

const reviewPath = '/admin/discovery/vendor-rate-review'
const rateFields = {
  hourly_cents: 'inferred_hourly_rate_cents',
  package_cents: 'inferred_package_rate_cents',
  minimum_cents: 'inferred_minimum_cents',
} as const

export async function approveRate(formData: FormData): Promise<void> {
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
  const { admin, id } = await readVendor(formData)
  await saveReviewStatus(admin, id, 'approved')
}

export async function rejectRate(formData: FormData): Promise<void> {
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
  const { admin, id } = await readVendor(formData)
  await saveReviewStatus(admin, id, 'rejected')
}

export async function editRate(formData: FormData): Promise<void> {
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
  const suppliedRates = Object.entries(rateFields).flatMap(([input, field]) => {
    const cents = readOptionalCents(formData.get(input))
    return cents === undefined ? [] : [{ field, cents }]
  })
  const { admin, id, vendor } = await readVendor(formData)
  if (suppliedRates.length === 0) throw new Error('No evidenced rates to review')
  for (const { field, cents } of suppliedRates) {
    // The safe reader exposes only independently evidenced facts. Provenance
    // references alone cannot justify a different amount, and form labels are
    // not evidence. Reacquire a replacement through the independent fact path.
    if (vendor.vendor_data.values[field] !== cents) {
      throw new Error('Rate changes require matching independently acquired evidence. Reload the saved rates before reviewing.')
    }
  }
  // Do not replay facts read above: another writer may have refreshed them.
  // Blank/omitted values, unknown legacy values and existing evidence stay intact.
  await saveReviewStatus(admin, id, 'edited')
}

async function readVendor(formData: FormData) {
  const id = formData.get('id')
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    throw new Error('Invalid vendor id')
  }
  const admin = createServiceRoleClient()
  const { data, error } = await admin.from(SAFE_VENDOR_TABLE)
    .select('id,inferred_hourly_rate_cents,inferred_package_rate_cents,inferred_minimum_cents,field_provenance')
    .eq('id', id).maybeSingle()
  if (error) throw new Error('Unable to load vendor rates')
  if (!data) throw new Error('Vendor not found')
  return { admin, id, vendor: readSafeDiscoveryVendor(data) }
}

async function saveReviewStatus(admin: ReturnType<typeof createServiceRoleClient>, id: string, status: 'approved' | 'rejected' | 'edited') {
  try {
    const { data, error } = await writeVendorFacts(admin, id, {}, {}, { rate_inference_admin_status: status })
    if (error || !data) throw new Error('Vendor review result unavailable')
  } catch {
    // A transport/read-validation error may follow a committed write. Do not
    // automatically retry, compensate, or claim the mutation rolled back.
    throw new Error('Unable to confirm the saved review. Reload vendor rates before retrying.')
  }
  revalidatePath(reviewPath)
}

function readOptionalCents(value: FormDataEntryValue | null): number | undefined {
  if (value === null || typeof value === 'string' && !value.trim()) return undefined
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) throw new Error('Rates must be whole, non-negative cents')
  const cents = Number(value.trim())
  if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error('Rate is outside the supported cents range')
  return cents
}
