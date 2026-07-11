/**
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))

import {
  isAuthorizedStripeWebhookReplay,
  loadQueuedStripeWebhookReplay,
  STRIPE_WEBHOOK_REPLAY_HEADER,
} from '@/lib/stripe/webhookReplayAuth'

describe('Stripe webhook replay authorization', () => {
  const originalSecret = process.env.CRON_SECRET

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('requires the cron secret and reloads the authoritative queued payload', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const request = new Request('https://www.3rdplace.io/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        authorization: 'Bearer cron-test-secret',
        [STRIPE_WEBHOOK_REPLAY_HEADER]: '1',
      },
    })
    expect(isAuthorizedStripeWebhookReplay(request)).toBe(true)

    const authoritativePayload = {
      id: 'evt_queued',
      type: 'invoice.paid',
      data: { object: { id: 'in_authoritative' } },
    }
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { payload: authoritativePayload },
        error: null,
      }),
    }
    const event = await loadQueuedStripeWebhookReplay(
      { from: jest.fn().mockReturnValue(query) },
      { eventId: 'evt_queued', endpointPath: '/api/webhooks/stripe' },
    )

    expect(event).toMatchObject(authoritativePayload)
    expect(query.eq).toHaveBeenCalledWith('processed', false)
    expect(query.not).toHaveBeenCalledWith('maintenance_deferred_at', 'is', null)
  })

  it('rejects a replay marker with the wrong secret', () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const request = new Request('https://www.3rdplace.io/api/webhooks/stripe', {
      headers: {
        authorization: 'Bearer wrong-secret',
        [STRIPE_WEBHOOK_REPLAY_HEADER]: '1',
      },
    })

    expect(isAuthorizedStripeWebhookReplay(request)).toBe(false)
  })
})
