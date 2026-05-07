import 'server-only'

export type TicketTierCategory =
  | 'early_bird'
  | 'ga'
  | 'vip'
  | 'comp'
  | 'promo'
  | 'donation'
  | 'add_on'

export interface NormalizedTicketSaleRow {
  platform: string
  ticket_tier_category: TicketTierCategory
  ticket_tier_name: string
  ticket_quantity: number
  total_amount_cents: number
  fees_cents: number
  currency: string
  is_refund?: boolean | null
}

export interface TicketTierRollup {
  platform: string
  ticket_tier_category: TicketTierCategory
  ticket_tier_name: string
  tickets_sold: number
  tickets_refunded: number
  gross_revenue_cents: number
  fees_cents: number
  net_revenue_cents: number
  average_ticket_price_cents: number
}

const categoryPatterns: Array<{ category: TicketTierCategory; pattern: RegExp }> = [
  { category: 'early_bird', pattern: /\b(early\s*bird|presale|pre[-\s]?sale|first\s*release|first\s*tier|tier\s*1)\b/i },
  { category: 'vip', pattern: /\b(vip|premium|reserved|backstage|table|bottle|priority|all[-\s]?access)\b/i },
  { category: 'add_on', pattern: /\b(add[-\s]?on|addon|merch|parking|meal\s*add[-\s]?on|drink\s*ticket|extra)\b/i },
  { category: 'comp', pattern: /\b(comp|complimentary|free|guest\s*list|invite|invited)\b/i },
  { category: 'promo', pattern: /\b(promo|discount|code|waitlist|wait\s*list|standby|student|member)\b/i },
  { category: 'donation', pattern: /\b(donation|donate|pay\s*what\s*you\s*can|suggested)\b/i },
  { category: 'ga', pattern: /\b(general\s*admission|ga|general|standard|regular|admission)\b/i },
]

/**
 * Normalizes a provider ticket tier/class name into a cross-platform category.
 */
export function classifyTicketTier(name?: string | null, priceCents?: number | null): TicketTierCategory {
  const normalized = name?.trim()

  if (priceCents === 0 && !normalized) return 'comp'
  if (!normalized) return 'ga'

  const match = categoryPatterns.find((entry) => entry.pattern.test(normalized))
  if (match) return match.category
  if (priceCents === 0) return 'comp'

  return 'ga'
}

/**
 * Converts a provider major-unit amount, usually dollars, into integer cents.
 */
export function centsFromMajorAmount(value: unknown): number | null {
  const amount = readNumber(value)
  if (amount === null) return null
  return Math.round(amount * 100)
}

/**
 * Converts a provider minor-unit amount into integer cents.
 */
export function centsFromMinorAmount(value: unknown): number | null {
  const amount = readNumber(value)
  if (amount === null) return null
  return Math.round(amount)
}

/**
 * Converts integer cents into the existing dollar-decimal columns used by legacy financial summaries.
 */
export function majorAmountFromCents(valueCents: number | null | undefined): number | null {
  if (typeof valueCents !== 'number' || !Number.isFinite(valueCents)) return null
  return Math.round(valueCents) / 100
}

/**
 * Normalizes currency values to lowercase ISO-ish strings.
 */
export function normalizeCurrency(value: unknown, fallback = 'usd') {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.trim().toLowerCase()
}

/**
 * Builds ticket-tier rollups from normalized sale rows.
 */
export function buildTicketTierRollups(rows: NormalizedTicketSaleRow[]): TicketTierRollup[] {
  const rollups = new Map<string, TicketTierRollup>()

  rows.forEach((row) => {
    const tierName = row.ticket_tier_name || 'Unknown'
    const category = row.ticket_tier_category || classifyTicketTier(tierName)
    const key = `${row.platform}:${category}:${tierName}`
    const quantity = Number.isFinite(row.ticket_quantity) ? row.ticket_quantity : 0
    const positiveQuantity = row.is_refund ? 0 : Math.max(quantity, 0)
    const refundedQuantity = row.is_refund ? Math.abs(quantity) : 0
    const existing = rollups.get(key) ?? {
      platform: row.platform,
      ticket_tier_category: category,
      ticket_tier_name: tierName,
      tickets_sold: 0,
      tickets_refunded: 0,
      gross_revenue_cents: 0,
      fees_cents: 0,
      net_revenue_cents: 0,
      average_ticket_price_cents: 0,
    }

    existing.tickets_sold += positiveQuantity
    existing.tickets_refunded += refundedQuantity
    existing.gross_revenue_cents += row.total_amount_cents || 0
    existing.fees_cents += row.fees_cents || 0
    existing.net_revenue_cents = existing.gross_revenue_cents - existing.fees_cents
    existing.average_ticket_price_cents =
      existing.tickets_sold > 0 ? Math.round(existing.gross_revenue_cents / existing.tickets_sold) : 0

    rollups.set(key, existing)
  })

  return [...rollups.values()].sort((a, b) => {
    const categoryOrder = ticketTierSortIndex(a.ticket_tier_category) - ticketTierSortIndex(b.ticket_tier_category)
    if (categoryOrder !== 0) return categoryOrder
    return b.gross_revenue_cents - a.gross_revenue_cents
  })
}

/**
 * Reads a provider amount from Eventbrite-style cost objects.
 */
export function centsFromEventbriteCost(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return centsFromMinorAmount(record.minor_value) ?? centsFromMajorAmount(record.major_value)
}

function ticketTierSortIndex(category: TicketTierCategory) {
  const order: TicketTierCategory[] = [
    'early_bird',
    'ga',
    'vip',
    'comp',
    'promo',
    'donation',
    'add_on',
  ]
  return order.indexOf(category)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}
