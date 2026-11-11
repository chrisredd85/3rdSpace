jest.mock('server-only', () => ({}))

import { createCipheriv, createHash, randomBytes } from 'crypto'
import {
  decryptSecret,
  encryptSecret,
  getEncryptedSecretVersion,
  getTokenCryptoKey,
} from '@/lib/server/token-crypto'
import { getActiveKey, listTokenCryptoKeys } from '@/lib/server/token-crypto-keys'
import { reencryptCredentialValue } from '@/scripts/admin/reencrypt-with-active-key'

const ACTIVE_SECRET = 'active-token-crypto-secret-with-32-plus-chars'
const LEGACY_SECRET = 'legacy-token-crypto-secret-with-32-plus-chars'

const originalEnv = { ...process.env }

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    configurable: true,
  })
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
  Object.defineProperty(process.env, 'NODE_ENV', {
    value: originalEnv.NODE_ENV,
    configurable: true,
  })
}

function configureActive(version = 'v2') {
  process.env.TOKEN_CRYPTO_KEY = ACTIVE_SECRET
  process.env.TOKEN_CRYPTO_KEY_VERSION = version
}

function encryptWithSecret(value: string, secret: string, separator: ':' | '.', version?: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const parts = [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ]
  return version
    ? [version, ...parts].join(':')
    : parts.join(separator)
}

describe('versioned token crypto', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('encryptSecret writes the active key version prefix and round-trips', () => {
    configureActive('v2')

    const encrypted = encryptSecret('oauth-token')

    expect(encrypted.startsWith('v2:')).toBe(true)
    expect(getEncryptedSecretVersion(encrypted)).toBe('v2')
    expect(decryptSecret(encrypted)).toBe('oauth-token')
  })

  it('decrypts versioned ciphertext with the matching legacy key', () => {
    configureActive('v2')
    process.env.TOKEN_CRYPTO_KEY_LEGACY_V1 = LEGACY_SECRET
    const encrypted = encryptWithSecret('old-oauth-token', LEGACY_SECRET, ':', 'v1')

    expect(decryptSecret(encrypted)).toBe('old-oauth-token')
  })

  it('keeps unversioned legacy ciphertext on the active key only', () => {
    configureActive('v2')
    const dotLegacy = encryptWithSecret('dot-legacy-token', ACTIVE_SECRET, '.')
    const colonLegacy = encryptWithSecret('colon-legacy-token', ACTIVE_SECRET, ':')

    expect(getEncryptedSecretVersion(dotLegacy)).toBe('legacy')
    expect(getEncryptedSecretVersion(colonLegacy)).toBe('legacy')
    expect(decryptSecret(dotLegacy)).toBe('dot-legacy-token')
    expect(decryptSecret(colonLegacy)).toBe('colon-legacy-token')
  })

  it('throws clearly when ciphertext references an unknown key version', () => {
    configureActive('v2')
    const encrypted = encryptWithSecret('missing-version-token', LEGACY_SECRET, ':', 'v9')

    expect(() => decryptSecret(encrypted)).toThrow('Unknown token crypto key version: v9')
  })

  it('loads active and legacy keys without treating legacy keys as active', () => {
    configureActive('v2')
    process.env.TOKEN_CRYPTO_KEY_LEGACY_V1 = LEGACY_SECRET

    expect(getActiveKey()).toMatchObject({ version: 'v2', source: 'active' })
    expect(listTokenCryptoKeys().map((entry) => ({
      version: entry.version,
      source: entry.source,
    }))).toEqual([
      { version: 'v2', source: 'active' },
      { version: 'v1', source: 'legacy' },
    ])
  })

  it('throws in production without TOKEN_CRYPTO_KEY', () => {
    setNodeEnv('production')
    delete process.env.TOKEN_CRYPTO_KEY

    expect(() => getTokenCryptoKey()).toThrow('TOKEN_CRYPTO_KEY required in production')
    expect(() => encryptSecret('token')).toThrow('TOKEN_CRYPTO_KEY required in production')
  })

  it('defaults the active version to v1 when TOKEN_CRYPTO_KEY_VERSION is unset', () => {
    process.env.TOKEN_CRYPTO_KEY = ACTIVE_SECRET
    delete process.env.TOKEN_CRYPTO_KEY_VERSION

    const encrypted = encryptSecret('default-version-token')

    expect(encrypted.startsWith('v1:')).toBe(true)
    expect(decryptSecret(encrypted)).toBe('default-version-token')
  })

  it('reencrypt helper skips active-version values and migrates legacy values once', () => {
    configureActive('v2')
    process.env.TOKEN_CRYPTO_KEY_LEGACY_V1 = LEGACY_SECRET
    const legacy = encryptWithSecret('rotate-me', LEGACY_SECRET, ':', 'v1')

    const first = reencryptCredentialValue({ token: legacy })
    expect(first.changed).toBe(true)
    const firstValue = first.value as { token: string }
    expect(getEncryptedSecretVersion(firstValue.token)).toBe('v2')
    expect(decryptSecret(firstValue.token)).toBe('rotate-me')

    const second = reencryptCredentialValue(first.value)
    expect(second.changed).toBe(false)
    expect(second.value).toEqual(first.value)
  })
})

