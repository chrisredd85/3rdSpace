jest.mock('server-only', () => ({}))

import { decryptSecret, encryptSecret, getTokenCryptoKey } from '@/lib/server/token-crypto'
import {
  listMissingRequiredProductionSecrets,
  validateRequiredProductionSecrets,
} from '@/lib/server/required-secrets'
import {
  createVendorClaimToken,
  getVendorInviteSecret,
  verifyVendorClaimToken,
} from '@/lib/vendors/vendorInviteTokens'
import {
  createVenueClaimToken,
  getVenueInviteSecret,
  verifyVenueClaimToken,
} from '@/lib/venues/venueInviteTokens'

const LOCAL_FALLBACK = 'local-dev-only-do-not-use-in-prod'
const LONG_SECRET = 'test-secret-value-with-at-least-32-characters'
const REQUIRED_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'CRON_SECRET',
  'SETTLEMENT_ACK_TOKEN_SECRET',
  'VENUE_INVITE_SECRET',
  'VENDOR_INVITE_SECRET',
  'TOKEN_CRYPTO_KEY',
  'EMAIL_TOKEN_ENCRYPTION_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_PLACES_API_KEY',
] as const

const managedEnvKeys = [
  ...REQUIRED_SECRETS,
  'NODE_ENV',
] as const

const originalEnv = Object.fromEntries(
  managedEnvKeys.map((key) => [key, process.env[key]])
) as Record<(typeof managedEnvKeys)[number], string | undefined>

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
  })
}

function restoreManagedEnv() {
  for (const key of managedEnvKeys) {
    const originalValue = originalEnv[key]
    if (key === 'NODE_ENV') {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalValue,
        configurable: true,
      })
    } else if (originalValue === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalValue
    }
  }
}

function clearTokenSecrets() {
  delete process.env.VENUE_INVITE_SECRET
  delete process.env.VENDOR_INVITE_SECRET
  delete process.env.TOKEN_CRYPTO_KEY
}

function productionEnv(overrides: NodeJS.ProcessEnv = {}) {
  return {
    NODE_ENV: 'production',
    ...Object.fromEntries(REQUIRED_SECRETS.map((key) => [key, LONG_SECRET])),
    ...overrides,
  } as NodeJS.ProcessEnv
}

describe('token secret hardening', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    restoreManagedEnv()
  })

  it('uses local-only placeholders for token helpers outside production when unset', () => {
    setNodeEnv('test')
    clearTokenSecrets()

    expect(getVenueInviteSecret()).toBe(LOCAL_FALLBACK)
    expect(getVendorInviteSecret()).toBe(LOCAL_FALLBACK)
    expect(getTokenCryptoKey()).toBe(LOCAL_FALLBACK)
  })

  it('throws in production when invite or token crypto secrets are unset', () => {
    setNodeEnv('production')
    clearTokenSecrets()

    expect(() => getVenueInviteSecret()).toThrow('VENUE_INVITE_SECRET required in production')
    expect(() => getVendorInviteSecret()).toThrow('VENDOR_INVITE_SECRET required in production')
    expect(() => getTokenCryptoKey()).toThrow('TOKEN_CRYPTO_KEY required in production')
  })

  it('rejects token secrets shorter than 32 characters', () => {
    process.env.VENUE_INVITE_SECRET = 'too-short'
    process.env.VENDOR_INVITE_SECRET = 'also-too-short'
    process.env.TOKEN_CRYPTO_KEY = 'short'

    expect(() => getVenueInviteSecret()).toThrow('VENUE_INVITE_SECRET must be at least 32 chars')
    expect(() => getVendorInviteSecret()).toThrow('VENDOR_INVITE_SECRET must be at least 32 chars')
    expect(() => getTokenCryptoKey()).toThrow('TOKEN_CRYPTO_KEY must be at least 32 chars')
  })

  it('round-trips venue tokens, vendor tokens, and encrypted secrets with explicit keys', () => {
    process.env.VENUE_INVITE_SECRET = 'venue-invite-secret-with-32-plus-characters'
    process.env.VENDOR_INVITE_SECRET = 'vendor-invite-secret-with-32-plus-characters'
    process.env.TOKEN_CRYPTO_KEY = 'token-crypto-secret-with-32-plus-characters'

    const venueToken = createVenueClaimToken({
      venueId: 'venue-1',
      email: 'Host@Example.com',
      invitedAt: '2026-06-25T12:00:00.000Z',
      now: 100,
    })
    const vendorToken = createVendorClaimToken({
      vendorId: 'vendor-1',
      email: 'Vendor@Example.com',
      invitedAt: '2026-06-25T12:00:00.000Z',
      now: 100,
    })
    const encrypted = encryptSecret('oauth-token')

    expect(verifyVenueClaimToken(venueToken, 100)).toMatchObject({
      venue_id: 'venue-1',
      email: 'host@example.com',
    })
    expect(verifyVendorClaimToken(vendorToken, 100)).toMatchObject({
      vendor_id: 'vendor-1',
      email: 'vendor@example.com',
    })
    expect(decryptSecret(encrypted)).toBe('oauth-token')
  })

  it('throws in production when required deployment secrets are missing', () => {
    const env = productionEnv({
      STRIPE_SECRET_KEY: '',
      VENUE_INVITE_SECRET: undefined,
    })

    expect(listMissingRequiredProductionSecrets(env)).toEqual([
      'STRIPE_SECRET_KEY',
      'VENUE_INVITE_SECRET',
    ])
    expect(() => validateRequiredProductionSecrets(env)).toThrow(
      'Missing required production secrets: STRIPE_SECRET_KEY, VENUE_INVITE_SECRET'
    )
  })

  it('allows the Playwright production server to boot without live secrets', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      validateRequiredProductionSecrets({
        NODE_ENV: 'production',
        PLAYWRIGHT_TEST: '1',
      })
    ).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      '[required-secrets] Skipping production secret validation for Playwright test server.'
    )
  })

  it('warns but does not throw for missing production-required secrets outside production', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => validateRequiredProductionSecrets({ NODE_ENV: 'test' })).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      '[required-secrets] Missing SUPABASE_SERVICE_ROLE_KEY; required in production.'
    )
  })
})
