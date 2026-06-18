import {
  buildLiveEventOperatingSignals,
  evaluateLiveTriggers,
  type PnLSnapshot,
} from '@/lib/live-events/triggers'

describe('evaluateLiveTriggers', () => {
  it('fires breakeven and velocity-drop triggers with verbatim evidence numbers', () => {
    const triggers = evaluateLiveTriggers(makePnl({
      revenue: {
        velocity: {
          last_24h_cents: 1000,
          last_7d_cents: 100000,
          since_launch_cents: 160000,
          projected_sellout_at: null,
        },
      },
      breakeven: {
        tickets_needed: 40,
        tickets_to_go: 0,
        crossed_at: '2026-06-01T20:00:00.000Z',
      },
    }))

    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger_key: 'breakeven_crossed',
        severity: 'info',
        evidence: expect.objectContaining({
          crossed_at: '2026-06-01T20:00:00.000Z',
          net_revenue_cents: 120000,
          tickets_sold: 60,
          tickets_needed: 40,
        }),
      }),
      expect.objectContaining({
        trigger_key: 'velocity_drop',
        severity: 'recommend',
        evidence: expect.objectContaining({
          last_24h_cents: 1000,
          last_7d_cents: 100000,
          threshold_ratio: 0.3,
        }),
      }),
    ]))
  })

  it('fires tier imbalance, capacity warning, and sellout imminent from tier and velocity facts', () => {
    const triggers = evaluateLiveTriggers(makePnl({
      revenue: {
        tier_breakdown: [
          { tier_name: 'GA', sold: 30, gross_cents: 150000, sellout_pct: 0.95 },
          { tier_name: 'VIP', sold: 5, gross_cents: 75000, sellout_pct: 0.25 },
        ],
        velocity: {
          last_24h_cents: 60000,
          last_7d_cents: 220000,
          since_launch_cents: 225000,
          projected_sellout_at: '2026-06-02T18:00:00.000Z',
        },
      },
    }), { now: '2026-06-02T00:00:00.000Z' })

    expect(triggers.map((trigger) => trigger.trigger_key)).toEqual(expect.arrayContaining([
      'tier_imbalance',
      'capacity_warning',
      'sellout_imminent',
    ]))
    expect(triggers.find((trigger) => trigger.trigger_key === 'tier_imbalance')?.evidence).toMatchObject({
      strongest_tier: 'GA',
      strongest_sold: 30,
      weakest_tier: 'VIP',
      weakest_sold: 5,
      sold_ratio: 6,
    })
    expect(triggers.find((trigger) => trigger.trigger_key === 'sellout_imminent')?.evidence).toMatchObject({
      projected_sellout_at: '2026-06-02T18:00:00.000Z',
      hours_until_sellout: 18,
    })
  })

  it('fires refund spike and cost overrun when actuals are refund-heavy and costs exceed net', () => {
    const triggers = evaluateLiveTriggers(makePnl({
      revenue: {
        gross_revenue_cents: 100000,
        refunds_cents: 35000,
        net_revenue_cents: 55000,
        tickets_sold: 50,
        tickets_refunded: 16,
      },
      costs: {
        estimated_cents: 20000,
        committed_cents: 50000,
        paid_cents: 10000,
      },
      net: {
        conservative_cents: -5000,
        expected_cents: -25000,
        optimistic_cents: 45000,
      },
    }))

    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger_key: 'refund_spike',
        severity: 'urgent',
        evidence: expect.objectContaining({
          refunds_cents: 35000,
          gross_revenue_cents: 100000,
          tickets_refunded: 16,
          tickets_sold: 50,
          refund_ratio: 0.35,
        }),
      }),
      expect.objectContaining({
        trigger_key: 'cost_overrun',
        severity: 'urgent',
        evidence: expect.objectContaining({
          expected_cost_basis_cents: 80000,
          net_revenue_cents: 55000,
          expected_net_cents: -25000,
        }),
      }),
    ]))
  })

  it('fires margin room for upgrade only when expected net and margin clear thresholds', () => {
    const triggers = evaluateLiveTriggers(makePnl({
      margin_pct: 35,
      net: {
        conservative_cents: 150000,
        expected_cents: 180000,
        optimistic_cents: 250000,
      },
    }))

    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger_key: 'margin_room_for_upgrade',
        severity: 'info',
        evidence: expect.objectContaining({
          margin_pct: 35,
          expected_net_cents: 180000,
          minimum_upgrade_room_cents: 100000,
        }),
      }),
    ]))
  })

  it('does not invent triggers when thresholds are not met', () => {
    const triggers = evaluateLiveTriggers(makePnl({
      revenue: {
        refunds_cents: 1000,
        velocity: {
          last_24h_cents: 45000,
          last_7d_cents: 100000,
          since_launch_cents: 120000,
          projected_sellout_at: null,
        },
      },
      margin_pct: 8,
    }))

    expect(triggers.map((trigger) => trigger.trigger_key)).not.toEqual(expect.arrayContaining([
      'velocity_drop',
      'refund_spike',
      'sellout_imminent',
      'margin_room_for_upgrade',
    ]))
  })

  it('calculates refund, no-show, cost, and profit target signals from deterministic P&L facts', () => {
    const signals = buildLiveEventOperatingSignals(makePnl({
      revenue: {
        refunds_cents: 25_000,
        tickets_sold: 100,
        tickets_refunded: 20,
        tickets_checked_in: 60,
      },
      costs: {
        estimated_cents: 30_000,
        committed_cents: 70_000,
        paid_cents: 20_000,
      },
      net: {
        conservative_cents: 40_000,
        expected_cents: 80_000,
        optimistic_cents: 120_000,
      },
    }), { profitTargetCents: 150_000 })

    expect(signals.refund_risk).toMatchObject({
      level: 'high',
      refund_ratio: 0.2,
      refunds_cents: 25_000,
      tickets_refunded: 20,
      tickets_sold: 100,
    })
    expect(signals.attendance).toMatchObject({
      status: 'high_no_show',
      active_tickets: 80,
      checked_in: 60,
      no_show_count: 20,
      no_show_rate: 0.25,
    })
    expect(signals.cost_commitments).toMatchObject({
      estimated_cents: 30_000,
      committed_cents: 70_000,
      paid_cents: 20_000,
      total_expected_cents: 120_000,
    })
    expect(signals.profit_target).toMatchObject({
      target_cents: 150_000,
      current_expected_net_cents: 80_000,
      gap_cents: 70_000,
    })
  })
})

function makePnl(overrides: DeepPartial<PnLSnapshot> = {}): PnLSnapshot {
  return mergeDeep({
    revenue: {
      gross_revenue_cents: 150000,
      refunds_cents: 0,
      platform_fees_cents: 10000,
      taxes_collected_cents: 20000,
      net_revenue_cents: 120000,
      tickets_sold: 60,
      tickets_refunded: 0,
      tickets_checked_in: null,
      tier_breakdown: [
        { tier_name: 'GA', sold: 60, gross_cents: 150000, sellout_pct: 0.6 },
      ],
      velocity: {
        last_24h_cents: 30000,
        last_7d_cents: 150000,
        since_launch_cents: 150000,
        projected_sellout_at: null,
      },
      data_sources: ['csv_import'],
      confidence: {
        revenue: 'high',
        attendance: 'low',
      },
      last_event_at: '2026-06-01T20:00:00.000Z',
    },
    costs: {
      estimated_cents: 0,
      committed_cents: 100000,
      paid_cents: 0,
    },
    net: {
      conservative_cents: 20000,
      expected_cents: 20000,
      optimistic_cents: 120000,
    },
    breakeven: {
      tickets_needed: 50,
      tickets_to_go: 10,
      crossed_at: null,
    },
    margin_pct: 16.6667,
    consumption_share_adjustments: [],
    terms_conflict: false,
  }, overrides)
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K]
}

function mergeDeep<T>(base: T, overrides: DeepPartial<T>): T {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return base

  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = output[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      output[key] = mergeDeep(baseValue, value as Record<string, unknown>)
    } else {
      output[key] = value
    }
  }
  return output as T
}
