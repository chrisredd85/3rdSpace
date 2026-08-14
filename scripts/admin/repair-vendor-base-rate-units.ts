import { createClient } from '@supabase/supabase-js'
import {
  buildVendorBaseRateRepairRpcArgs,
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

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
}

type ScriptClient = ReturnType<typeof createScriptServiceRoleClient>

async function applyCandidate(supabase: ScriptClient, candidate: VendorBaseRateRepairCandidate) {
  const reviewOnly = candidate.action === 'review' || candidate.proposedBaseRateCents === null
  const args = buildVendorBaseRateRepairRpcArgs({
    candidate,
    action: reviewOnly
      ? 'vendor_base_rate_unit_review_required'
      : 'vendor_base_rate_unit_repaired',
    adminUserId: process.env.ADMIN_USER_ID || null,
    metadata: reviewOnly ? { review_reason: candidate.reason } : {},
  })
  const { error } = await supabase.rpc('repair_vendor_base_rate_atomic', args)

  if (error) {
    throw new Error(`atomic vendor base-rate repair failed for ${candidate.row.id}: ${error.message}`)
  }

  return {
    id: candidate.row.id,
    status: reviewOnly ? 'flagged_for_review' as const : 'converted' as const,
  }
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
