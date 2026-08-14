import { expect, test } from '@playwright/test'
import { loginAsPersona } from './helpers/auth'
import { hasSupabaseAdminEnv } from './helpers/env'
import { LEGAL_TERMS_VERSION } from '@/lib/legal/constants'

const EVENT_ID = '00000000-0000-4000-8000-000000000041'

test.describe('Planner live event intelligence', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Planner live event smoke is covered in Chromium.')
  })

  test('renders event-scoped live operating intelligence', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 940 })

    test.skip(!hasSupabaseAdminEnv(), 'Set Supabase admin env to create a builder for planner live event checks.')

    const credentials = {
      email: `test-builder-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`,
      password: 'TestPassword123!',
    }
    const signupResponse = await page.request.post('/api/auth/signup', {
      data: {
        userType: 'community_builder',
        email: credentials.email,
        password: credentials.password,
        name: 'Planner Live Test',
        organization_name: 'Planner Live QA',
        event_types: ['mixer'],
        preferred_amenities: ['bar', 'sound'],
        ticket_platforms: ['eventbrite'],
        signup_terms_version: LEGAL_TERMS_VERSION,
        signup_terms_accepted: true,
      },
    })
    expect(signupResponse.ok()).toBeTruthy()
    await loginAsPersona(page, 'builder', credentials)

    await page.route(`**/api/planner/events/${EVENT_ID}/live`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enqueued: true, job: { id: 'job-1', status: 'pending' } }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ snapshot: liveSnapshot() }),
      })
    })

    await page.goto(`/planner/events/${EVENT_ID}/live`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: /^Live event$/ })).toBeVisible()
    await expect(page.getByText('Tickets sold')).toBeVisible()
    await expect(page.getByText('Gross revenue')).toBeVisible()
    await expect(page.getByText('Net revenue')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Refund risk' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Attendance signal' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Profit target gap' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Cost commitments' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live agent feed' })).toBeVisible()
    await expect(page.getByText(/Approval is required before anything sends/i)).toBeVisible()
  })
})

function liveSnapshot() {
  return {
    event: {
      id: EVENT_ID,
      name: 'Live QA Night',
      status: 'confirmed',
      event_date: '2026-06-20',
      capacity: 100,
    },
    pnl: {
      revenue: {
        gross_revenue_cents: 240000,
        refunds_cents: 12000,
        platform_fees_cents: 16000,
        taxes_collected_cents: 8000,
        net_revenue_cents: 204000,
        tickets_sold: 72,
        tickets_refunded: 4,
        tickets_checked_in: 52,
        tier_breakdown: [
          { tier_name: 'GA', sold: 60, gross_cents: 180000, sellout_pct: 0.75 },
          { tier_name: 'VIP', sold: 12, gross_cents: 60000, sellout_pct: 0.6 },
        ],
        velocity: {
          last_24h_cents: 30000,
          last_7d_cents: 140000,
          since_launch_cents: 240000,
          projected_sellout_at: null,
        },
        data_sources: ['eventbrite_webhook'],
        confidence: { revenue: 'high', attendance: 'medium' },
        last_event_at: '2026-06-10T20:00:00.000Z',
      },
      costs: {
        estimated_cents: 25000,
        committed_cents: 90000,
        paid_cents: 30000,
      },
      net: {
        conservative_cents: 84000,
        expected_cents: 59000,
        optimistic_cents: 174000,
      },
      breakeven: {
        tickets_needed: 50,
        tickets_to_go: 0,
        crossed_at: '2026-06-09T18:00:00.000Z',
      },
      margin_pct: 28.92,
      rev_share_adjustments: [],
      terms_conflict: false,
    },
    kpis: {
      tickets_sold: 72,
      active_tickets: 68,
      capacity: 100,
      gross_revenue_cents: 240000,
      net_revenue_cents: 204000,
      breakeven_progress_pct: 1,
      refund_risk_level: 'low',
      no_show_rate: 0.2353,
      profit_target_gap_cents: null,
    },
    velocity_points: [
      { bucket_start: '2026-06-10T18:00:00.000Z', gross_cents: 0, orders: 0 },
      { bucket_start: '2026-06-10T19:00:00.000Z', gross_cents: 15000, orders: 3 },
      { bucket_start: '2026-06-10T20:00:00.000Z', gross_cents: 30000, orders: 6 },
    ],
    signals: {
      refund_risk: {
        level: 'low',
        refund_ratio: 0.0556,
        refunds_cents: 12000,
        tickets_refunded: 4,
        tickets_sold: 72,
      },
      attendance: {
        status: 'watch',
        active_tickets: 68,
        checked_in: 52,
        no_show_count: 16,
        no_show_rate: 0.2353,
        confidence: 'medium',
      },
      cost_commitments: {
        estimated_cents: 25000,
        committed_cents: 90000,
        paid_cents: 30000,
        total_expected_cents: 145000,
      },
      profit_target: {
        target_cents: null,
        current_expected_net_cents: 59000,
        gap_cents: null,
      },
    },
    costs: {
      estimated_cents: 25000,
      committed_cents: 90000,
      paid_cents: 30000,
      total_expected_cents: 145000,
    },
    revenue_terms: {
      impacts: [],
      summary: {
        sales_tax_cents: 8000,
        platform_fee_cents: 16000,
        venue_kickback_cents: 0,
        sponsor_credit_cents: 0,
        vendor_rev_share_cents: 0,
        venue_minimum_spend_cents: 0,
        other_cents: 0,
      },
    },
    recommendations: [
      {
        id: '00000000-0000-4000-8000-000000000042',
        event_id: EVENT_ID,
        org_id: '00000000-0000-4000-8000-000000000043',
        trigger_key: 'capacity_warning',
        severity: 'recommend',
        suggested_action: 'Confirm venue capacity before changing inventory.',
        evidence: { sellout_pct: 0.75, sold: 72 },
        agent_narrative: 'Confirm venue capacity before changing inventory.',
        state: 'open',
        action_contract: {
          execution_mode: 'analysis_only',
          requires_approval_before_execution: true,
          approval_id: null,
          note: 'Create a planner approval before changing terms.',
        },
        created_at: '2026-06-10T20:00:00.000Z',
        updated_at: '2026-06-10T20:00:00.000Z',
      },
    ],
    freshness: {
      data_sources: ['eventbrite_webhook'],
      last_event_at: '2026-06-10T20:00:00.000Z',
      has_connected_source: true,
      connected_platforms: ['eventbrite'],
      has_recent_csv: false,
    },
    empty_state: { show: false, reason: '' },
  }
}
