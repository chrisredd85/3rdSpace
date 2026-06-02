import { z } from 'zod'

export const costCommitmentCategories = [
  'venue',
  'vendor',
  'staff',
  'marketing',
  'platform_fee',
  'tax',
  'other',
] as const

export const costCommitmentStates = [
  'estimated',
  'quoted',
  'accepted',
  'invoiced',
  'paid',
  'cancelled',
] as const

export const costCommitmentConfidenceLevels = ['low', 'medium', 'high'] as const

export const costCommitmentEvidenceTypes = [
  'contract',
  'invoice',
  'receipt',
  'screenshot',
  'none',
] as const

export const costCommitmentSources = [
  'manual',
  'outreach_reply',
  'receipt_upload',
  'csv_import',
  'api_import',
  'webhook',
] as const

export const costCommitmentCategorySchema = z.enum(costCommitmentCategories)
export const costCommitmentStateSchema = z.enum(costCommitmentStates)
export const costCommitmentConfidenceSchema = z.enum(costCommitmentConfidenceLevels)
export const costCommitmentEvidenceTypeSchema = z.enum(costCommitmentEvidenceTypes)
export const costCommitmentSourceSchema = z.enum(costCommitmentSources)

export const commitmentSummarySchema = z.object({
  category: costCommitmentCategorySchema,
  amount_cents: z.number().int().nonnegative(),
  state: costCommitmentStateSchema,
  confidence: costCommitmentConfidenceSchema.default('low'),
})

export const costCommitmentSchema = commitmentSummarySchema.extend({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable(),
  org_id: z.string().uuid(),
  party_id: z.string().uuid().nullable(),
  party_name: z.string().nullable(),
  description: z.string().nullable(),
  currency: z.string().trim().min(1).default('USD'),
  evidence_url: z.string().nullable(),
  evidence_type: costCommitmentEvidenceTypeSchema,
  source: costCommitmentSourceSchema,
  source_ref: z.string().trim().min(1).nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  committed_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const costCommitmentInputSchema = z.object({
  id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable().optional(),
  org_id: z.string().uuid(),
  category: costCommitmentCategorySchema,
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().trim().min(1).default('USD'),
  state: costCommitmentStateSchema.default('estimated'),
  confidence: costCommitmentConfidenceSchema.default('low'),
  evidence_url: z.string().trim().min(1).nullable().optional(),
  evidence_type: costCommitmentEvidenceTypeSchema.default('none'),
  source: costCommitmentSourceSchema.default('manual'),
  source_ref: z.string().trim().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  committed_at: z.string().nullable().optional(),
  paid_at: z.string().nullable().optional(),
})

export type CostCommitmentCategory = z.infer<typeof costCommitmentCategorySchema>
export type CostCommitmentState = z.infer<typeof costCommitmentStateSchema>
export type CostCommitmentConfidence = z.infer<typeof costCommitmentConfidenceSchema>
export type CostConfidence = 'confirmed' | 'mixed' | 'estimated'
export type CommitmentSummary = z.infer<typeof commitmentSummarySchema>
export type Commitment = z.infer<typeof costCommitmentSchema>
export type CostCommitmentInput = z.input<typeof costCommitmentInputSchema>

export type CommitmentTotals = {
  estimated_cents: number
  committed_cents: number
  paid_cents: number
}

export type CommitmentTotalsSummary = {
  byCategory: Record<CostCommitmentCategory, CommitmentTotals>
  overall: CommitmentTotals
}

type SupabaseLikeClient = {
  from: (table: string) => unknown
}

type QueryBuilder = {
  select?: (columns?: string) => QueryBuilder
  eq?: (column: string, value: unknown) => QueryBuilder
  order?: (column: string, options?: Record<string, unknown>) => QueryBuilder
  maybeSingle?: () => Promise<{ data: unknown; error: QueryError | null }>
  single?: () => Promise<{ data: unknown; error: QueryError | null }>
  insert?: (values: unknown) => QueryBuilder
  update?: (values: unknown) => QueryBuilder
  limit?: (count: number) => QueryBuilder
}

type QueryError = {
  message?: string
}

const committedStates = new Set<CostCommitmentState>(['accepted', 'invoiced', 'paid'])
const estimatedStates = new Set<CostCommitmentState>(['estimated', 'quoted'])

export async function listCommitments(
  supabase: SupabaseLikeClient,
  eventId: string
): Promise<Commitment[]> {
  let query = asQuery(supabase.from('event_cost_commitments'))
    .select?.('*')
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('created_at', { ascending: true })

  const result = await executeQuery(query)
  if (result.error) throw new Error(result.error.message ?? 'Failed to load cost commitments')

  return z.array(costCommitmentSchema).parse(result.data ?? [])
}

export async function upsertCommitment(
  supabase: SupabaseLikeClient,
  input: CostCommitmentInput
): Promise<Commitment> {
  const parsed = costCommitmentInputSchema.parse(input)
  const now = new Date().toISOString()
  const payload = {
    ...parsed,
    updated_at: now,
  }
  const existingId = await findExistingCommitmentId(supabase, parsed)

  if (existingId) {
    const result = await asQuery(supabase.from('event_cost_commitments'))
      .update?.(payload)
      .eq?.('id', existingId)
      .select?.('*')
      .single?.()
    if (!result) throw new Error('Cost commitment update failed')
    if (result.error) throw new Error(result.error.message ?? 'Failed to update cost commitment')
    return costCommitmentSchema.parse(result.data)
  }

  const result = await asQuery(supabase.from('event_cost_commitments'))
    .insert?.({
      ...payload,
      created_at: now,
    })
    .select?.('*')
    .single?.()
  if (!result) throw new Error('Cost commitment insert failed')
  if (result.error) throw new Error(result.error.message ?? 'Failed to create cost commitment')
  return costCommitmentSchema.parse(result.data)
}

export function computeCommittedTotals(
  commitments: CommitmentSummary[]
): CommitmentTotalsSummary {
  const byCategory = Object.fromEntries(
    costCommitmentCategories.map((category) => [category, emptyTotals()])
  ) as Record<CostCommitmentCategory, CommitmentTotals>
  const overall = emptyTotals()

  commitments.forEach((commitment) => {
    const parsed = commitmentSummarySchema.parse(commitment)
    if (parsed.state === 'cancelled') return

    const categoryTotals = byCategory[parsed.category]
    addToTotals(categoryTotals, parsed)
    addToTotals(overall, parsed)
  })

  return { byCategory, overall }
}

export function inferCostConfidence(
  commitments: CommitmentSummary[] | null | undefined
): CostConfidence {
  const activeCommitments = (commitments ?? [])
    .map((commitment) => commitmentSummarySchema.parse(commitment))
    .filter((commitment) => commitment.state !== 'cancelled')

  if (activeCommitments.length === 0) return 'estimated'
  const committedCount = activeCommitments.filter((commitment) => committedStates.has(commitment.state)).length
  const estimatedCount = activeCommitments.filter((commitment) => estimatedStates.has(commitment.state)).length

  if (committedCount === activeCommitments.length) return 'confirmed'
  if (committedCount > 0 && estimatedCount > 0) return 'mixed'
  return 'estimated'
}

function emptyTotals(): CommitmentTotals {
  return {
    estimated_cents: 0,
    committed_cents: 0,
    paid_cents: 0,
  }
}

function addToTotals(totals: CommitmentTotals, commitment: CommitmentSummary) {
  if (estimatedStates.has(commitment.state)) {
    totals.estimated_cents += commitment.amount_cents
  }
  if (committedStates.has(commitment.state)) {
    totals.committed_cents += commitment.amount_cents
  }
  if (commitment.state === 'paid') {
    totals.paid_cents += commitment.amount_cents
  }
}

async function findExistingCommitmentId(
  supabase: SupabaseLikeClient,
  input: z.output<typeof costCommitmentInputSchema>
) {
  if (input.party_id) {
    const result = await asQuery(supabase.from('event_cost_commitments'))
      .select?.('id')
      .eq?.('event_id', input.event_id)
      .eq?.('party_id', input.party_id)
      .eq?.('category', input.category)
      .limit?.(1)
      .maybeSingle?.()
    if (result?.error) throw new Error(result.error.message ?? 'Failed to load existing cost commitment')
    const id = readString(readRecord(result?.data)?.id)
    if (id) return id
  }

  if (input.source_ref) {
    const result = await asQuery(supabase.from('event_cost_commitments'))
      .select?.('id')
      .eq?.('event_id', input.event_id)
      .eq?.('source', input.source)
      .eq?.('source_ref', input.source_ref)
      .eq?.('category', input.category)
      .limit?.(1)
      .maybeSingle?.()
    if (result?.error) throw new Error(result.error.message ?? 'Failed to load existing cost commitment')
    const id = readString(readRecord(result?.data)?.id)
    if (id) return id
  }

  return input.id ?? null
}

function asQuery(value: unknown): QueryBuilder {
  return value as QueryBuilder
}

async function executeQuery(query: QueryBuilder | undefined): Promise<{ data: unknown; error: QueryError | null }> {
  if (!query) return { data: null, error: { message: 'Invalid Supabase query' } }
  if (query.maybeSingle) return query.maybeSingle()
  if ('then' in query && typeof (query as { then?: unknown }).then === 'function') {
    return query as unknown as Promise<{ data: unknown; error: QueryError | null }>
  }
  return { data: null, error: { message: 'Supabase query cannot be executed' } }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
