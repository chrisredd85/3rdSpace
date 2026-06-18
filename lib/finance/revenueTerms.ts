import { z } from 'zod'
import {
  canonicalizeEventRevenueTermType,
  isVendorConsumptionShareTerm,
  isVenueChiTerm,
} from './chi-nomenclature-sync'

export const revenueTermTypes = [
  'sales_tax',
  'ticketing_fee',
  'service_fee',
  'venue_chi',
  'venue_kickback',
  'venue_minimum_spend',
  'vendor_consumption_share',
  'vendor_rev_share',
  'sponsor_credit',
  'other',
] as const

export const revenueTermAppliesTo = [
  'gross_ticket_revenue',
  'net_ticket_revenue',
  'bar_revenue',
  'per_ticket',
  'per_attendee',
] as const

export const revenueTermConfidenceLevels = ['low', 'medium', 'high'] as const
export const revenueTermSources = ['manual', 'platform_default', 'outreach_reply'] as const
export const ticketingPlatformsWithDefaultTerms = ['posh', 'eventbrite'] as const

export const revenueTermTypeSchema = z.enum(revenueTermTypes)
export const revenueTermAppliesToSchema = z.enum(revenueTermAppliesTo)
export const revenueTermConfidenceSchema = z.enum(revenueTermConfidenceLevels)
export const revenueTermSourceSchema = z.enum(revenueTermSources)
export const ticketingPlatformWithDefaultTermSchema = z.enum(ticketingPlatformsWithDefaultTerms)

export const revenueTermSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  org_id: z.string().uuid(),
  term_type: revenueTermTypeSchema,
  rate: z.union([z.number(), z.string()]).nullable(),
  flat_cents: z.union([z.number().int(), z.string()]).nullable(),
  applies_to: revenueTermAppliesToSchema,
  party_id: z.string().uuid().nullable(),
  party_name: z.string().nullable(),
  notes: z.string().nullable(),
  confidence: revenueTermConfidenceSchema,
  source: revenueTermSourceSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

export const revenueTermInputSchema = z.object({
  id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
  org_id: z.string().uuid(),
  term_type: revenueTermTypeSchema,
  rate: z.number().nonnegative().nullable().optional(),
  flat_cents: z.number().int().nonnegative().nullable().optional(),
  applies_to: revenueTermAppliesToSchema,
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  confidence: revenueTermConfidenceSchema.default('low'),
  source: revenueTermSourceSchema.default('manual'),
}).refine(
  (term) => term.rate !== null && term.rate !== undefined || term.flat_cents !== null && term.flat_cents !== undefined,
  { message: 'Revenue terms need a rate or flat amount' }
)

export const revenueTermBasisSchema = z.object({
  gross_ticket_revenue_cents: z.number().int().nonnegative(),
  refunds_cents: z.number().int().nonnegative().default(0),
  platform_fees_cents: z.number().int().nonnegative().default(0),
  taxes_collected_cents: z.number().int().nonnegative().default(0),
  net_ticket_revenue_cents: z.number().int().default(0),
  bar_revenue_cents: z.number().int().nonnegative().default(0),
  tickets_sold: z.number().int().nonnegative(),
  tickets_refunded: z.number().int().nonnegative().default(0),
  tickets_checked_in: z.number().int().nonnegative().nullable().default(null),
})

export const revenueTermImpactSchema = z.object({
  term_id: z.string().uuid().nullable(),
  term_type: revenueTermTypeSchema,
  party_id: z.string().uuid().nullable(),
  party_name: z.string().nullable(),
  applies_to: revenueTermAppliesToSchema,
  basis_cents: z.number().int().nonnegative(),
  unit_count: z.number().int().nonnegative().nullable(),
  amount_cents: z.number().int().nonnegative(),
  net_revenue_delta_cents: z.number().int(),
  cost_delta_cents: z.number().int().nonnegative(),
})

export type RevenueTermType = z.infer<typeof revenueTermTypeSchema>
export type RevenueTermAppliesTo = z.infer<typeof revenueTermAppliesToSchema>
export type RevenueTermConfidence = z.infer<typeof revenueTermConfidenceSchema>
export type RevenueTermSource = z.infer<typeof revenueTermSourceSchema>
export type TicketingPlatformWithDefaultTerm = z.infer<typeof ticketingPlatformWithDefaultTermSchema>
export type RevenueTerm = z.infer<typeof revenueTermSchema>
export type RevenueTermInput = z.input<typeof revenueTermInputSchema>
export type RevenueTermBasis = z.input<typeof revenueTermBasisSchema>
export type ParsedRevenueTermBasis = z.output<typeof revenueTermBasisSchema>
export type RevenueTermImpact = z.infer<typeof revenueTermImpactSchema>

export type RevenueTermsSummary = {
  impacts: RevenueTermImpact[]
  sales_tax_cents: number
  platform_fee_cents: number
  venue_chi_cents: number
  vendor_consumption_share_cents: number
  sponsor_credit_cents: number
  venue_minimum_spend_cents: number
  other_cents: number
}

export type BaseActualsForTerms = {
  gross_revenue_cents: number
  refunds_cents: number
  platform_fees_cents: number
  taxes_collected_cents: number
  net_revenue_cents: number
  tickets_sold: number
  tickets_refunded: number
  tickets_checked_in: number | null
}

type SupabaseLikeClient = {
  from: (table: string) => unknown
}

type QueryBuilder = PromiseLike<QueryResult> & {
  select?: (columns?: string) => QueryBuilder
  eq?: (column: string, value: unknown) => QueryBuilder
  order?: (column: string, options?: Record<string, unknown>) => QueryBuilder
  limit?: (count: number) => QueryBuilder
  maybeSingle?: () => Promise<QueryResult>
  single?: () => Promise<QueryResult>
  insert?: (values: unknown) => QueryBuilder
  update?: (values: unknown) => QueryBuilder
  delete?: () => QueryBuilder
  upsert?: (values: unknown, options?: Record<string, unknown>) => QueryBuilder
}

type QueryResult = {
  data: unknown
  error: QueryError | null
}

type QueryError = {
  message?: string
}

const PLATFORM_DEFAULTS: Record<TicketingPlatformWithDefaultTerm, {
  partyName: string
  envKey: string
  fallbackRate: number
  notes: string
}> = {
  posh: {
    partyName: 'Posh',
    envKey: 'POSH_DEFAULT_SERVICE_FEE_RATE',
    fallbackRate: 0.05,
    notes: 'Default Posh service fee assumption. Replace with the organizer account rate when known.',
  },
  eventbrite: {
    partyName: 'Eventbrite',
    envKey: 'EVENTBRITE_DEFAULT_SERVICE_FEE_RATE',
    fallbackRate: 0.065,
    notes: 'Default Eventbrite service fee assumption. Replace with the organizer account rate when known.',
  },
}

export async function listRevenueTerms(
  supabase: SupabaseLikeClient,
  eventId: string
): Promise<RevenueTerm[]> {
  let query = asQuery(supabase.from('event_revenue_terms'))
    .select?.('*')
    .eq?.('event_id', eventId)

  if (query?.order) query = query.order('created_at', { ascending: true })
  const result = await executeQuery(query)
  if (result.error) throw new Error(result.error.message ?? 'Failed to load revenue terms')

  return z.array(revenueTermSchema).parse(result.data ?? [])
}

export async function upsertRevenueTerm(
  supabase: SupabaseLikeClient,
  input: RevenueTermInput
): Promise<RevenueTerm> {
  const parsed = revenueTermInputSchema.parse(input)
  const now = new Date().toISOString()
  const payload = {
    ...parsed,
    term_type: canonicalizeEventRevenueTermType(parsed.term_type),
    party_id: parsed.party_id ?? null,
    party_name: parsed.party_name ?? null,
    notes: parsed.notes ?? null,
    rate: parsed.rate ?? null,
    flat_cents: parsed.flat_cents ?? null,
    updated_at: now,
  }

  if (parsed.id) {
    const result = await asQuery(supabase.from('event_revenue_terms'))
      .update?.(payload)
      .eq?.('id', parsed.id)
      .eq?.('event_id', parsed.event_id)
      .select?.('*')
      .single?.()
    if (!result) throw new Error('Revenue term update failed')
    if (result.error) throw new Error(result.error.message ?? 'Failed to update revenue term')
    return revenueTermSchema.parse(result.data)
  }

  const result = await asQuery(supabase.from('event_revenue_terms'))
    .insert?.({
      ...payload,
      created_at: now,
    })
    .select?.('*')
    .single?.()
  if (!result) throw new Error('Revenue term insert failed')
  if (result.error) throw new Error(result.error.message ?? 'Failed to create revenue term')
  return revenueTermSchema.parse(result.data)
}

export async function deleteRevenueTerm(input: {
  supabase: SupabaseLikeClient
  eventId: string
  termId: string
}) {
  const query = asQuery(input.supabase.from('event_revenue_terms'))
    .delete?.()
    .eq?.('id', input.termId)
    .eq?.('event_id', input.eventId)
  if (!query) throw new Error('Revenue term delete failed')
  const resolved = await executeQuery(query)
  if (resolved.error) throw new Error(resolved.error.message ?? 'Failed to delete revenue term')
}

export function calculateRevenueTermImpact(
  rawTerm: RevenueTerm | RevenueTermInput,
  rawBasis: RevenueTermBasis
): RevenueTermImpact {
  const term = normalizeRevenueTerm(rawTerm)
  const basis = revenueTermBasisSchema.parse(rawBasis)
  const basisCents = resolveBasisCents(term.applies_to, basis)
  const unitCount = resolveUnitCount(term.applies_to, basis)
  const amountCents = calculateAmountCents(term, basisCents, unitCount)
  const netRevenueDeltaCents = netDeltaForTerm(term.term_type, amountCents)
  const costDeltaCents = costDeltaForTerm(term.term_type, amountCents)

  return revenueTermImpactSchema.parse({
    term_id: term.id,
    term_type: term.term_type,
    party_id: term.party_id,
    party_name: term.party_name,
    applies_to: term.applies_to,
    basis_cents: basisCents,
    unit_count: unitCount,
    amount_cents: amountCents,
    net_revenue_delta_cents: netRevenueDeltaCents,
    cost_delta_cents: costDeltaCents,
  })
}

export function summarizeRevenueTermImpacts(
  terms: Array<RevenueTerm | RevenueTermInput>,
  basis: RevenueTermBasis
): RevenueTermsSummary {
  const impacts = terms.map((term) => calculateRevenueTermImpact(term, basis))
  const summary: RevenueTermsSummary = {
    impacts,
    sales_tax_cents: 0,
    platform_fee_cents: 0,
    venue_chi_cents: 0,
    vendor_consumption_share_cents: 0,
    sponsor_credit_cents: 0,
    venue_minimum_spend_cents: 0,
    other_cents: 0,
  }

  for (const impact of impacts) {
    if (impact.term_type === 'sales_tax') summary.sales_tax_cents += impact.amount_cents
    if (impact.term_type === 'ticketing_fee' || impact.term_type === 'service_fee') {
      summary.platform_fee_cents += impact.amount_cents
    }
    if (isVenueChiTerm(impact.term_type)) {
      summary.venue_chi_cents += impact.amount_cents
    }
    if (impact.term_type === 'sponsor_credit') summary.sponsor_credit_cents += impact.amount_cents
    if (isVendorConsumptionShareTerm(impact.term_type)) {
      summary.vendor_consumption_share_cents += impact.amount_cents
    }
    if (impact.term_type === 'venue_minimum_spend') summary.venue_minimum_spend_cents += impact.amount_cents
    if (impact.term_type === 'other') summary.other_cents += impact.amount_cents
  }

  return summary
}

export function buildRevenueTermBasis(input: {
  gross_revenue_cents: number
  refunds_cents?: number
  platform_fees_cents?: number
  taxes_collected_cents?: number
  bar_revenue_cents?: number
  tickets_sold: number
  tickets_refunded?: number
  tickets_checked_in?: number | null
}): ParsedRevenueTermBasis {
  const gross = Math.max(Math.round(input.gross_revenue_cents), 0)
  const refunds = Math.max(Math.round(input.refunds_cents ?? 0), 0)
  const platformFees = Math.max(Math.round(input.platform_fees_cents ?? 0), 0)
  const taxes = Math.max(Math.round(input.taxes_collected_cents ?? 0), 0)

  return revenueTermBasisSchema.parse({
    gross_ticket_revenue_cents: gross,
    refunds_cents: refunds,
    platform_fees_cents: platformFees,
    taxes_collected_cents: taxes,
    net_ticket_revenue_cents: gross - refunds - platformFees - taxes,
    bar_revenue_cents: input.bar_revenue_cents ?? 0,
    tickets_sold: input.tickets_sold,
    tickets_refunded: input.tickets_refunded ?? 0,
    tickets_checked_in: input.tickets_checked_in ?? null,
  })
}

export function buildRevenueTermBasisFromActuals(
  actuals: BaseActualsForTerms,
  barRevenueCents = 0
): ParsedRevenueTermBasis {
  return buildRevenueTermBasis({
    gross_revenue_cents: actuals.gross_revenue_cents,
    refunds_cents: actuals.refunds_cents,
    platform_fees_cents: actuals.platform_fees_cents,
    taxes_collected_cents: actuals.taxes_collected_cents,
    bar_revenue_cents: barRevenueCents,
    tickets_sold: actuals.tickets_sold,
    tickets_refunded: actuals.tickets_refunded,
    tickets_checked_in: actuals.tickets_checked_in,
  })
}

export function applyRevenueTermsToActuals<TActuals extends BaseActualsForTerms>(
  actuals: TActuals,
  terms: Array<RevenueTerm | RevenueTermInput>,
  options: { bar_revenue_cents?: number } = {}
): TActuals {
  if (terms.length === 0) return actuals

  const basis = buildRevenueTermBasisFromActuals(actuals, options.bar_revenue_cents ?? 0)
  const summary = summarizeRevenueTermImpacts(terms, basis)
  const platformFeesCents = Math.max(actuals.platform_fees_cents, summary.platform_fee_cents)
  const taxesCollectedCents = Math.max(actuals.taxes_collected_cents, summary.sales_tax_cents)

  return {
    ...actuals,
    platform_fees_cents: platformFeesCents,
    taxes_collected_cents: taxesCollectedCents,
    net_revenue_cents:
      actuals.gross_revenue_cents -
      actuals.refunds_cents -
      platformFeesCents -
      taxesCollectedCents +
      summary.venue_chi_cents +
      summary.sponsor_credit_cents,
  }
}

export function getPlatformDefaultServiceFeeRate(platform: TicketingPlatformWithDefaultTerm) {
  const defaults = PLATFORM_DEFAULTS[platform]
  const configured = Number(process.env[defaults.envKey])
  return normalizeRate(Number.isFinite(configured) ? configured : defaults.fallbackRate)
}

export async function seedPlatformServiceFeeTermsForOrg(input: {
  supabase: SupabaseLikeClient
  orgId: string
  platform: TicketingPlatformWithDefaultTerm
}) {
  const platform = ticketingPlatformWithDefaultTermSchema.parse(input.platform)
  const query = asQuery(input.supabase.from('events'))
    .select?.('id')
    .eq?.('builder_id', input.orgId)
  const { data, error } = await executeQuery(query)

  if (error) throw new Error(error.message ?? 'Failed to load events for revenue term seeding')
  const eventIds = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => typeof row.id === 'string' ? row.id : null)
    .filter((id): id is string => Boolean(id))

  const results: RevenueTerm[] = []
  for (const eventId of eventIds) {
    const term = await seedPlatformServiceFeeTermForEvent({
      supabase: input.supabase,
      orgId: input.orgId,
      eventId,
      platform,
    })
    if (term) results.push(term)
  }
  return results
}

export async function seedPlatformServiceFeeTermForEvent(input: {
  supabase: SupabaseLikeClient
  orgId: string
  eventId: string
  platform: TicketingPlatformWithDefaultTerm
}) {
  const platform = ticketingPlatformWithDefaultTermSchema.parse(input.platform)
  const defaults = PLATFORM_DEFAULTS[platform]
  const existing = await findPlatformDefaultTerm(input.supabase, {
    eventId: input.eventId,
    partyName: defaults.partyName,
  })
  if (existing) return existing

  return upsertRevenueTerm(input.supabase, {
    event_id: input.eventId,
    org_id: input.orgId,
    term_type: 'service_fee',
    rate: getPlatformDefaultServiceFeeRate(platform),
    flat_cents: null,
    applies_to: 'gross_ticket_revenue',
    party_name: defaults.partyName,
    notes: defaults.notes,
    confidence: 'medium',
    source: 'platform_default',
  })
}

function normalizeRevenueTerm(rawTerm: RevenueTerm | RevenueTermInput) {
  const record = rawTerm as Partial<RevenueTerm>

  return {
    id: typeof record.id === 'string' ? record.id : null,
    term_type: canonicalizeEventRevenueTermType(revenueTermTypeSchema.parse(record.term_type)) as RevenueTermType,
    rate: readNumber(record.rate),
    flat_cents: readInteger(record.flat_cents),
    applies_to: revenueTermAppliesToSchema.parse(record.applies_to),
    party_id: typeof record.party_id === 'string' ? record.party_id : null,
    party_name: typeof record.party_name === 'string' && record.party_name.trim()
      ? record.party_name.trim()
      : null,
  }
}

function resolveBasisCents(appliesTo: RevenueTermAppliesTo, basis: ParsedRevenueTermBasis) {
  if (appliesTo === 'gross_ticket_revenue') return Math.max(basis.gross_ticket_revenue_cents, 0)
  if (appliesTo === 'net_ticket_revenue') return Math.max(basis.net_ticket_revenue_cents, 0)
  if (appliesTo === 'bar_revenue') return Math.max(basis.bar_revenue_cents, 0)
  return 0
}

function resolveUnitCount(appliesTo: RevenueTermAppliesTo, basis: ParsedRevenueTermBasis) {
  if (appliesTo === 'per_ticket') return Math.max(basis.tickets_sold - basis.tickets_refunded, 0)
  if (appliesTo === 'per_attendee') return basis.tickets_checked_in ?? Math.max(basis.tickets_sold - basis.tickets_refunded, 0)
  return null
}

function calculateAmountCents(
  term: ReturnType<typeof normalizeRevenueTerm>,
  basisCents: number,
  unitCount: number | null
) {
  const rate = normalizeRate(term.rate)
  const flatCents = Math.max(term.flat_cents ?? 0, 0)

  if (unitCount !== null) {
    return Math.max(Math.round(unitCount * flatCents), 0)
  }

  return Math.max(Math.round(basisCents * rate) + flatCents, 0)
}

function netDeltaForTerm(termType: RevenueTermType, amountCents: number) {
  if (termType === 'sales_tax' || termType === 'ticketing_fee' || termType === 'service_fee') {
    return -amountCents
  }
  if (isVenueChiTerm(termType) || termType === 'sponsor_credit') {
    return amountCents
  }
  return 0
}

function costDeltaForTerm(termType: RevenueTermType, amountCents: number) {
  if (isVendorConsumptionShareTerm(termType) || termType === 'venue_minimum_spend') {
    return amountCents
  }
  return 0
}

function normalizeRate(value: number | null) {
  if (!Number.isFinite(value ?? Number.NaN)) return 0
  const rate = Math.max(value ?? 0, 0)
  return rate > 1 ? rate / 100 : rate
}

async function findPlatformDefaultTerm(
  supabase: SupabaseLikeClient,
  input: { eventId: string; partyName: string }
) {
  const result = await asQuery(supabase.from('event_revenue_terms'))
    .select?.('*')
    .eq?.('event_id', input.eventId)
    .eq?.('term_type', 'service_fee')
    .eq?.('source', 'platform_default')
    .eq?.('party_name', input.partyName)
    .limit?.(1)
    .maybeSingle?.()

  if (result?.error) throw new Error(result.error.message ?? 'Failed to load platform revenue term')
  return result?.data ? revenueTermSchema.parse(result.data) : null
}

async function executeQuery(query: QueryBuilder | undefined): Promise<QueryResult> {
  if (!query) return { data: null, error: { message: 'Invalid Supabase query' } }
  if ('then' in query && typeof query.then === 'function') {
    return query as unknown as Promise<QueryResult>
  }
  if (query.maybeSingle) return query.maybeSingle()
  return { data: null, error: { message: 'Supabase query cannot be executed' } }
}

function asQuery(value: unknown): QueryBuilder {
  return value as QueryBuilder
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readInteger(value: unknown) {
  const numberValue = readNumber(value)
  return numberValue === null ? null : Math.round(numberValue)
}
