import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/types/database-generated'
import {
  buildVendorBaseRateRepairAuditInsert,
  classifyVendorBaseRateRepair,
  shouldApplyVendorBaseRateRepair,
  type VendorBaseRateRepairCandidate,
  type VendorBaseRateRepairRow,
} from '@/lib/vendors/vendorBaseRateRepair'

function createScriptServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')

  return createClient<Database, 'public'>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
}

type ScriptClient = ReturnType<typeof createScriptServiceRoleClient>

async function writeAuditLog(
  supabase: ScriptClient,
  candidate: VendorBaseRateRepairCandidate,
  action: string,
  afterBaseRate: number | null,
  metadata: Record<string, Json | undefined> = {}
) {
  const auditRow = buildVendorBaseRateRepairAuditInsert({
    candidate,
    action,
    afterBaseRate,
    adminUserId: process.env.ADMIN_USER_ID || null,
    metadata,
  })
  const { error } = await supabase.from('admin_audit_log').insert(auditRow)

  if (error) {
    throw new Error(`admin_audit_log insert failed for ${candidate.row.id}: ${error.message}`)
  }
}

async function applyCandidate(supabase: ScriptClient, candidate: VendorBaseRateRepairCandidate) {
  if (candidate.action === 'review' || candidate.proposedBaseRateCents === null) {
    await writeAuditLog(
      supabase,
      candidate,
      'vendor_base_rate_unit_review_required',
      candidate.currentBaseRate,
      { review_reason: candidate.reason }
    )
    return { id: candidate.row.id, status: 'flagged_for_review' as const }
  }

  // The pre-mutation audit row is mandatory. If it cannot be written, no rate is changed.
  await writeAuditLog(
    supabase,
    candidate,
    'vendor_base_rate_unit_repair_started',
    candidate.proposedBaseRateCents
  )

  const updatedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('vendor_profiles')
    .update({
      base_rate: candidate.proposedBaseRateCents,
      updated_at: updatedAt,
    })
    .eq('id', candidate.row.id)
    .eq('base_rate', candidate.currentBaseRate)
    .select('id, base_rate')
    .maybeSingle()

  if (error) throw new Error(`vendor_profiles update failed for ${candidate.row.id}: ${error.message}`)
  if (!data) {
    throw new Error(`vendor_profiles:${candidate.row.id} changed after the dry-run read; no update applied`)
  }

  await writeAuditLog(
    supabase,
    candidate,
    'vendor_base_rate_unit_repaired',
    candidate.proposedBaseRateCents,
    { updated_at: updatedAt }
  )

  return { id: candidate.row.id, status: 'converted' as const }
}

async function run() {
  const apply = shouldApplyVendorBaseRateRepair(process.argv.slice(2))
  const supabase = createScriptServiceRoleClient()
  const { data, error } = await supabase
    .from('vendor_profiles')
    .select('id, name, pricing_model, base_rate, updated_at')
    .gt('base_rate', 0)
    .lt('base_rate', 500)
    .order('base_rate', { ascending: true })

  if (error) throw new Error(`Could not audit vendor base rates: ${error.message}`)

  const candidates = ((data ?? []) as VendorBaseRateRepairRow[])
    .map(classifyVendorBaseRateRepair)
    .filter((candidate): candidate is VendorBaseRateRepairCandidate => candidate !== null)

  const preview = candidates.map((candidate) => ({
    id: candidate.row.id,
    name: candidate.row.name,
    pricing_model: candidate.row.pricing_model,
    current_base_rate: candidate.currentBaseRate,
    proposed_base_rate_cents: candidate.proposedBaseRateCents,
    action: candidate.action,
    reason: candidate.reason,
  }))

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', candidates: preview }, null, 2))
    return
  }

  const results = []
  for (const candidate of candidates) {
    try {
      results.push(await applyCandidate(supabase, candidate))
    } catch (error) {
      results.push({
        id: candidate.row.id,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log(JSON.stringify({ mode: 'apply', candidates: preview, results }, null, 2))
  if (results.some((result) => result.status === 'failed')) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
