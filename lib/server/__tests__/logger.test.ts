jest.mock('server-only', () => ({}), { virtual: true })

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { ensureRequestIdHeaders, getRequestLogger, Logger, redact } from '@/lib/server/logger'

describe('server logger', () => {
  const originalCrypto = global.crypto

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: {
        randomUUID: jest.fn(() => 'generated-request-id'),
      },
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  })

  it('captures errors in Sentry with redacted context', () => {
    const logger = new Logger({ request_id: 'req-1', api_token: 'secret-token' })
    const error = new Error('failed')

    logger.error('Payment failed', error, { user_id: 'user-1', password: 'secret-password' })

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: {
        request_id: 'req-1',
        api_token: '[REDACTED]',
        user_id: 'user-1',
        password: '[REDACTED]',
      },
    })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"api_token":"[REDACTED]"'))
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('secret-token'))
  })

  it('adds warning breadcrumbs with redacted context', () => {
    const logger = new Logger({ request_id: 'req-1' })

    logger.warn('Webhook duplicate', { stripe_secret: 'whsec_123', stripe_event_id: 'evt_123' })

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      level: 'warning',
      message: 'Webhook duplicate',
      data: {
        request_id: 'req-1',
        stripe_secret: '[REDACTED]',
        stripe_event_id: 'evt_123',
      },
    })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"stripe_secret":"[REDACTED]"'))
  })

  it('merges child logger contexts', () => {
    const logger = new Logger({ request_id: 'req-1', plan_id: 'plan-1' })
      .child({ approval_id: 'approval-1' })

    logger.info('Approval updated', { status: 'approved' })

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"request_id":"req-1"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"plan_id":"plan-1"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"approval_id":"approval-1"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"status":"approved"'))
  })

  it('redacts nested sensitive fields and circular references', () => {
    const value: Record<string, unknown> = {
      nested: {
        authorization: 'Bearer token',
        safe: 'visible',
      },
    }
    value.self = value

    expect(redact(value)).toEqual({
      nested: {
        authorization: '[REDACTED]',
        safe: 'visible',
      },
      self: '[Circular]',
    })
  })

  it('flows request IDs through middleware helpers and request loggers', () => {
    const requestHeaders = ensureRequestIdHeaders(new Headers())
    expect(requestHeaders.requestId).toBe('generated-request-id')
    expect(requestHeaders.headers.get('x-request-id')).toBe('generated-request-id')

    const request = {
      headers: requestHeaders.headers,
      nextUrl: { pathname: '/api/test' },
    } as any
    const logger = getRequestLogger(request)

    logger.info('Request handled')

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"request_id":"generated-request-id"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"route":"/api/test"'))
  })
})
