import { resolveEntityReadiness } from '@/lib/planner/entityStripeReadiness'

describe('resolveEntityReadiness', () => {
  const nowMs = new Date('2026-06-24T12:00:00.000Z').getTime()

  it('returns invited when an entity was invited but not claimed', () => {
    expect(resolveEntityReadiness({
      entityType: 'venue',
      entity: {
        is_claimed: false,
        invited_at: '2026-06-23T12:00:00.000Z',
      },
      nowMs,
    })).toMatchObject({
      status: 'invited',
      label: 'Awaiting claim',
      subtext: 'Invited 1 day ago · email sent',
      icon: 'Clock',
      tone: 'muted',
    })
  })

  it('returns claimed_no_stripe when an entity is claimed without Stripe state', () => {
    expect(resolveEntityReadiness({
      entityType: 'vendor',
      entity: {
        is_claimed: true,
      },
      nowMs,
    })).toMatchObject({
      status: 'claimed_no_stripe',
      label: 'Stripe setup needed',
      icon: 'AlertCircle',
      tone: 'warning',
    })
  })

  it('returns stripe_ready when Stripe is connected', () => {
    expect(resolveEntityReadiness({
      entityType: 'venue',
      entity: {
        stripe_connect_status: 'connected',
      },
      nowMs,
    })).toMatchObject({
      status: 'stripe_ready',
      label: 'Stripe-ready',
      subtext: null,
      icon: 'CheckCircle2',
      tone: 'success',
    })
  })

  it('returns committed when committed amount and date are present', () => {
    expect(resolveEntityReadiness({
      entityType: 'venue',
      entity: {
        stripe_connect_status: 'connected',
      },
      committedAmount: 550000,
      committedAt: '2026-06-20T10:00:00.000Z',
      nowMs,
    })).toMatchObject({
      status: 'committed',
      label: 'Committed · $5,500',
      subtext: 'Quoted Jun 20',
      icon: 'ShieldCheck',
      tone: 'success',
    })
  })

  it('returns settled over committed when both are present', () => {
    expect(resolveEntityReadiness({
      entityType: 'venue',
      entity: {
        stripe_connect_status: 'connected',
      },
      committedAmount: 550000,
      committedAt: '2026-06-20T10:00:00.000Z',
      settledAt: '2026-06-22T10:00:00.000Z',
      settledAmount: 550000,
      nowMs,
    })).toMatchObject({
      status: 'settled',
      label: 'Settled · $5,500',
      subtext: 'Paid Jun 22',
    })
  })

  it('returns null for a catalog entity with no invite, commit, settlement, or Stripe state', () => {
    expect(resolveEntityReadiness({
      entityType: 'venue',
      entity: {
        name: 'Catalog Venue',
      },
      nowMs,
    })).toBeNull()
  })
})
