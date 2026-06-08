import { z } from 'zod'

export const liveTriggerKeySchema = z.enum([
  'breakeven_crossed',
  'velocity_drop',
  'tier_imbalance',
  'refund_spike',
  'capacity_warning',
  'sellout_imminent',
  'cost_overrun',
  'margin_room_for_upgrade',
])

export const liveTriggerSchema = z.object({
  trigger_key: liveTriggerKeySchema,
  severity: z.enum(['info', 'recommend', 'urgent']),
  suggested_action: z.string().trim().min(1),
  evidence: z.record(z.union([z.number(), z.string()])),
})

const actualsConfidenceSchema = z.enum(['low', 'medium', 'high'])

export const pnlSnapshotSchema = z.object({
  revenue: z.object({
    gross_revenue_cents: z.number().int(),
    refunds_cents: z.number().int(),
    platform_fees_cents: z.number().int(),
    taxes_collected_cents: z.number().int(),
    net_revenue_cents: z.number().int(),
    tickets_sold: z.number().int().nonnegative(),
    tickets_refunded: z.number().int().nonnegative(),
    tickets_checked_in: z.number().int().nonnegative().nullable(),
    tier_breakdown: z.array(z.object({
      tier_name: z.string().trim().min(1),
      sold: z.number().int().nonnegative(),
      gross_cents: z.number().int(),
      sellout_pct: z.number().nullable(),
    })),
    velocity: z.object({
      last_24h_cents: z.number().int(),
      last_7d_cents: z.number().int(),
      since_launch_cents: z.number().int(),
      projected_sellout_at: z.string().nullable(),
    }),
    data_sources: z.array(z.string()),
    confidence: z.object({
      revenue: actualsConfidenceSchema,
      attendance: actualsConfidenceSchema,
    }),
    last_event_at: z.string().nullable(),
  }),
  costs: z.object({
    estimated_cents: z.number().int().nonnegative(),
    committed_cents: z.number().int().nonnegative(),
    paid_cents: z.number().int().nonnegative(),
  }),
  net: z.object({
    conservative_cents: z.number().int(),
    expected_cents: z.number().int(),
    optimistic_cents: z.number().int(),
  }),
  breakeven: z.object({
    tickets_needed: z.number().int().nonnegative(),
    tickets_to_go: z.number().int().nonnegative(),
    crossed_at: z.string().nullable(),
  }),
  margin_pct: z.number(),
  rev_share_adjustments: z.array(z.object({
    party_name: z.string(),
    type: z.string(),
    amount_cents: z.number().int(),
  })),
  terms_conflict: z.boolean().default(false),
})

export type LiveTrigger = z.infer<typeof liveTriggerSchema>
export type PnLSnapshot = z.infer<typeof pnlSnapshotSchema>
export type LiveTriggerHistory = {
  now?: string | Date
  previous?: PnLSnapshot | null
}
export type LiveRefundRiskLevel = 'low' | 'watch' | 'high' | 'urgent'
export type LiveAttendanceSignalStatus = 'unknown' | 'on_track' | 'watch' | 'high_no_show'
export type LiveOperatingSignals = {
  refund_risk: {
    level: LiveRefundRiskLevel
    refund_ratio: number
    refunds_cents: number
    tickets_refunded: number
    tickets_sold: number
  }
  attendance: {
    status: LiveAttendanceSignalStatus
    active_tickets: number
    checked_in: number | null
    no_show_count: number | null
    no_show_rate: number | null
    confidence: PnLSnapshot['revenue']['confidence']['attendance']
  }
  cost_commitments: {
    estimated_cents: number
    committed_cents: number
    paid_cents: number
    total_expected_cents: number
  }
  profit_target: {
    target_cents: number | null
    current_expected_net_cents: number
    gap_cents: number | null
  }
}
export type LiveOperatingSignalOptions = {
  profitTargetCents?: number | null
}

const VELOCITY_DROP_RATIO = 0.3
const REFUND_RECOMMEND_RATIO = 0.2
const REFUND_URGENT_RATIO = 0.3
const CAPACITY_WARNING_PCT = 0.9
const SELLOUT_IMMINENT_HOURS = 48
const TIER_IMBALANCE_RATIO = 3
const MIN_TIER_IMBALANCE_SOLD = 5
const MARGIN_ROOM_PCT = 25
const UPGRADE_ROOM_CENTS = 100000

export function evaluateLiveTriggers(
  rawPnl: PnLSnapshot,
  history: LiveTriggerHistory = {}
): LiveTrigger[] {
  const pnl = pnlSnapshotSchema.parse(rawPnl)
  const now = normalizeNow(history.now)
  const triggers: LiveTrigger[] = []

  const breakeven = evaluateBreakevenCrossed(pnl)
  if (breakeven) triggers.push(breakeven)

  const velocityDrop = evaluateVelocityDrop(pnl)
  if (velocityDrop) triggers.push(velocityDrop)

  const tierImbalance = evaluateTierImbalance(pnl)
  if (tierImbalance) triggers.push(tierImbalance)

  const refundSpike = evaluateRefundSpike(pnl)
  if (refundSpike) triggers.push(refundSpike)

  const selloutImminent = evaluateSelloutImminent(pnl, now)
  if (selloutImminent) triggers.push(selloutImminent)

  const capacityWarning = evaluateCapacityWarning(pnl)
  if (capacityWarning) triggers.push(capacityWarning)

  const costOverrun = evaluateCostOverrun(pnl)
  if (costOverrun) triggers.push(costOverrun)

  const marginRoom = evaluateMarginRoomForUpgrade(pnl)
  if (marginRoom) triggers.push(marginRoom)

  return triggers
}

export function buildLiveEventOperatingSignals(
  rawPnl: PnLSnapshot,
  options: LiveOperatingSignalOptions = {}
): LiveOperatingSignals {
  const pnl = pnlSnapshotSchema.parse(rawPnl)
  const activeTickets = Math.max(pnl.revenue.tickets_sold - pnl.revenue.tickets_refunded, 0)
  const refundRevenueRatio = pnl.revenue.gross_revenue_cents > 0
    ? pnl.revenue.refunds_cents / pnl.revenue.gross_revenue_cents
    : 0
  const refundTicketRatio = pnl.revenue.tickets_sold > 0
    ? pnl.revenue.tickets_refunded / pnl.revenue.tickets_sold
    : 0
  const refundRatio = round(Math.max(refundRevenueRatio, refundTicketRatio))
  const checkedIn = pnl.revenue.tickets_checked_in
  const noShowCount = checkedIn === null ? null : Math.max(activeTickets - checkedIn, 0)
  const noShowRate = checkedIn === null || activeTickets <= 0
    ? null
    : round(noShowCount! / activeTickets)
  const targetCents = normalizeCents(options.profitTargetCents)

  return {
    refund_risk: {
      level: classifyRefundRisk(refundRatio),
      refund_ratio: refundRatio,
      refunds_cents: pnl.revenue.refunds_cents,
      tickets_refunded: pnl.revenue.tickets_refunded,
      tickets_sold: pnl.revenue.tickets_sold,
    },
    attendance: {
      status: classifyAttendanceSignal(noShowRate),
      active_tickets: activeTickets,
      checked_in: checkedIn,
      no_show_count: noShowCount,
      no_show_rate: noShowRate,
      confidence: pnl.revenue.confidence.attendance,
    },
    cost_commitments: {
      estimated_cents: pnl.costs.estimated_cents,
      committed_cents: pnl.costs.committed_cents,
      paid_cents: pnl.costs.paid_cents,
      total_expected_cents: pnl.costs.estimated_cents + pnl.costs.committed_cents + pnl.costs.paid_cents,
    },
    profit_target: {
      target_cents: targetCents,
      current_expected_net_cents: pnl.net.expected_cents,
      gap_cents: targetCents === null ? null : Math.max(targetCents - pnl.net.expected_cents, 0),
    },
  }
}

function evaluateBreakevenCrossed(pnl: PnLSnapshot): LiveTrigger | null {
  if (!pnl.breakeven.crossed_at) return null

  return {
    trigger_key: 'breakeven_crossed',
    severity: 'info',
    suggested_action: 'Mark breakeven as crossed and shift monitoring to margin protection.',
    evidence: {
      crossed_at: pnl.breakeven.crossed_at,
      net_revenue_cents: pnl.revenue.net_revenue_cents,
      tickets_sold: pnl.revenue.tickets_sold,
      tickets_needed: pnl.breakeven.tickets_needed,
    },
  }
}

function evaluateVelocityDrop(pnl: PnLSnapshot): LiveTrigger | null {
  if (pnl.revenue.velocity.last_7d_cents <= 0) return null

  const last24hRateCentsPerHour = pnl.revenue.velocity.last_24h_cents / 24
  const last7dRateCentsPerHour = pnl.revenue.velocity.last_7d_cents / (24 * 7)
  if (last7dRateCentsPerHour <= 0) return null
  if (last24hRateCentsPerHour >= last7dRateCentsPerHour * VELOCITY_DROP_RATIO) return null

  return {
    trigger_key: 'velocity_drop',
    severity: 'recommend',
    suggested_action: 'Review promotion, reminder timing, or creator channels because the last 24 hours are materially below the 7-day pace.',
    evidence: {
      last_24h_cents: pnl.revenue.velocity.last_24h_cents,
      last_7d_cents: pnl.revenue.velocity.last_7d_cents,
      last_24h_rate_cents_per_hour: round(last24hRateCentsPerHour),
      last_7d_rate_cents_per_hour: round(last7dRateCentsPerHour),
      threshold_ratio: VELOCITY_DROP_RATIO,
    },
  }
}

function evaluateTierImbalance(pnl: PnLSnapshot): LiveTrigger | null {
  const activeTiers = pnl.revenue.tier_breakdown
    .filter((tier) => tier.sold > 0)
    .sort((first, second) => second.sold - first.sold)

  if (activeTiers.length < 2) return null

  const strongest = activeTiers[0]
  const weakest = activeTiers[activeTiers.length - 1]
  if (!strongest || !weakest || strongest.sold < MIN_TIER_IMBALANCE_SOLD) return null

  const ratio = strongest.sold / Math.max(weakest.sold, 1)
  if (ratio < TIER_IMBALANCE_RATIO) return null

  return {
    trigger_key: 'tier_imbalance',
    severity: 'recommend',
    suggested_action: 'Check whether the slower tier needs clearer positioning, bundling, or should be retired for the next drop.',
    evidence: {
      strongest_tier: strongest.tier_name,
      strongest_sold: strongest.sold,
      weakest_tier: weakest.tier_name,
      weakest_sold: weakest.sold,
      sold_ratio: round(ratio),
    },
  }
}

function evaluateRefundSpike(pnl: PnLSnapshot): LiveTrigger | null {
  const refundRevenueRatio = pnl.revenue.gross_revenue_cents > 0
    ? pnl.revenue.refunds_cents / pnl.revenue.gross_revenue_cents
    : 0
  const refundTicketRatio = pnl.revenue.tickets_sold > 0
    ? pnl.revenue.tickets_refunded / pnl.revenue.tickets_sold
    : 0
  const ratio = Math.max(refundRevenueRatio, refundTicketRatio)
  if (ratio < REFUND_RECOMMEND_RATIO) return null

  return {
    trigger_key: 'refund_spike',
    severity: ratio >= REFUND_URGENT_RATIO ? 'urgent' : 'recommend',
    suggested_action: 'Audit refund reasons and check whether event timing, venue terms, or attendee messaging changed.',
    evidence: {
      refunds_cents: pnl.revenue.refunds_cents,
      gross_revenue_cents: pnl.revenue.gross_revenue_cents,
      tickets_refunded: pnl.revenue.tickets_refunded,
      tickets_sold: pnl.revenue.tickets_sold,
      refund_ratio: round(ratio),
    },
  }
}

function evaluateSelloutImminent(pnl: PnLSnapshot, now: Date): LiveTrigger | null {
  const projectedSelloutAt = pnl.revenue.velocity.projected_sellout_at
  if (!projectedSelloutAt) return null

  const projected = new Date(projectedSelloutAt)
  const hoursUntilSellout = (projected.getTime() - now.getTime()) / (60 * 60 * 1000)
  if (!Number.isFinite(hoursUntilSellout) || hoursUntilSellout < 0 || hoursUntilSellout > SELLOUT_IMMINENT_HOURS) {
    return null
  }

  return {
    trigger_key: 'sellout_imminent',
    severity: 'urgent',
    suggested_action: 'Draft a waitlist, capacity, or final-ticket plan for host approval before any messaging or terms change.',
    evidence: {
      projected_sellout_at: projectedSelloutAt,
      hours_until_sellout: round(hoursUntilSellout),
      tickets_sold: pnl.revenue.tickets_sold,
    },
  }
}

function evaluateCapacityWarning(pnl: PnLSnapshot): LiveTrigger | null {
  const nearCapacityTier = pnl.revenue.tier_breakdown
    .filter((tier) => tier.sellout_pct !== null)
    .sort((first, second) => (second.sellout_pct ?? 0) - (first.sellout_pct ?? 0))[0]

  if (!nearCapacityTier || nearCapacityTier.sellout_pct === null || nearCapacityTier.sellout_pct < CAPACITY_WARNING_PCT) {
    return null
  }

  return {
    trigger_key: 'capacity_warning',
    severity: nearCapacityTier.sellout_pct >= 1 ? 'urgent' : 'recommend',
    suggested_action: 'Confirm venue capacity, check-in staffing, and whether any remaining ticket inventory should be capped.',
    evidence: {
      tier_name: nearCapacityTier.tier_name,
      sellout_pct: nearCapacityTier.sellout_pct,
      sold: nearCapacityTier.sold,
    },
  }
}

function evaluateCostOverrun(pnl: PnLSnapshot): LiveTrigger | null {
  const expectedCostBasisCents = pnl.costs.paid_cents + pnl.costs.committed_cents + pnl.costs.estimated_cents
  if (expectedCostBasisCents <= pnl.revenue.net_revenue_cents) return null
  if (expectedCostBasisCents <= 0) return null

  return {
    trigger_key: 'cost_overrun',
    severity: pnl.net.expected_cents < 0 ? 'urgent' : 'recommend',
    suggested_action: 'Freeze optional spend and review any unapproved cost commitments before adding scope.',
    evidence: {
      expected_cost_basis_cents: expectedCostBasisCents,
      net_revenue_cents: pnl.revenue.net_revenue_cents,
      expected_net_cents: pnl.net.expected_cents,
    },
  }
}

function evaluateMarginRoomForUpgrade(pnl: PnLSnapshot): LiveTrigger | null {
  if (pnl.margin_pct < MARGIN_ROOM_PCT || pnl.net.expected_cents < UPGRADE_ROOM_CENTS) return null

  return {
    trigger_key: 'margin_room_for_upgrade',
    severity: 'info',
    suggested_action: 'There is room for a targeted upgrade, but any new spend still needs approval before committing.',
    evidence: {
      margin_pct: pnl.margin_pct,
      expected_net_cents: pnl.net.expected_cents,
      minimum_upgrade_room_cents: UPGRADE_ROOM_CENTS,
    },
  }
}

function normalizeNow(value: LiveTriggerHistory['now']) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  return new Date()
}

function round(value: number) {
  return Math.round(value * 10000) / 10000
}

function normalizeCents(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(Math.round(value), 0)
}

function classifyRefundRisk(ratio: number): LiveRefundRiskLevel {
  if (ratio >= REFUND_URGENT_RATIO) return 'urgent'
  if (ratio >= REFUND_RECOMMEND_RATIO) return 'high'
  if (ratio >= 0.1) return 'watch'
  return 'low'
}

function classifyAttendanceSignal(noShowRate: number | null): LiveAttendanceSignalStatus {
  if (noShowRate === null) return 'unknown'
  if (noShowRate >= 0.25) return 'high_no_show'
  if (noShowRate >= 0.1) return 'watch'
  return 'on_track'
}
