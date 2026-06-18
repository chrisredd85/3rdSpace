jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import * as Sentry from '@sentry/nextjs'
import {
  jsonWithDeprecatedKeys,
  normalizeLegacyKeys,
  withLegacyResponseKeys,
} from '@/lib/api/legacy-key-compat'

describe('legacy API key compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('accepts legacy request keys and normalizes to canonical keys', () => {
    const normalized = normalizeLegacyKeys(
      { bar_kickback_pct: 12 },
      { bar_kickback_pct: 'bar_chi_pct' },
      { route: '/api/auth/signup', direction: 'request' }
    )

    expect(normalized).toMatchObject({
      bar_kickback_pct: 12,
      bar_chi_pct: 12,
    })
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'legacy_key_used',
        route: '/api/auth/signup',
        key: 'bar_kickback_pct',
      }),
    }))
  })

  it('prefers canonical request keys when both are present', () => {
    const normalized = normalizeLegacyKeys(
      { bar_kickback_pct: 12, bar_chi_pct: 8 },
      { bar_kickback_pct: 'bar_chi_pct' },
      { route: '/api/auth/signup', direction: 'request' }
    )

    expect(normalized).toMatchObject({
      bar_kickback_pct: 12,
      bar_chi_pct: 8,
    })
  })

  it('returns dual response keys and deprecation headers', async () => {
    const body = withLegacyResponseKeys(
      { per_head_chi_cents: 300 },
      { per_head_kickback_cents: 'per_head_chi_cents' },
      { route: '/api/venues', direction: 'response' }
    )
    const response = jsonWithDeprecatedKeys(body, ['per_head_kickback_cents'])

    expect(await response.json()).toEqual({
      per_head_chi_cents: 300,
      per_head_kickback_cents: 300,
    })
    expect(response.headers.get('X-Deprecated-Keys')).toBe('per_head_kickback_cents')
  })
})
