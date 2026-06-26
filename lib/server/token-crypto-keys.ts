import { createHash } from 'crypto'

const LOCAL_TOKEN_CRYPTO_KEY = 'local-dev-only-do-not-use-in-prod'
const MIN_TOKEN_CRYPTO_KEY_LENGTH = 32
const DEFAULT_TOKEN_CRYPTO_VERSION = 'v1'
const LEGACY_KEY_PREFIX = 'TOKEN_CRYPTO_KEY_LEGACY_'

export type TokenCryptoKeyEntry = {
  version: string
  key: Buffer
  secret: string
  source: 'active' | 'legacy'
}

export function getTokenCryptoKey(env: NodeJS.ProcessEnv = process.env): string {
  return getActiveKey(env).secret
}

export function getActiveKey(env: NodeJS.ProcessEnv = process.env): TokenCryptoKeyEntry {
  const secret = readActiveSecret(env)
  const version = normalizeKeyVersion(env.TOKEN_CRYPTO_KEY_VERSION)
  return {
    version,
    secret,
    key: deriveAesKey(secret),
    source: 'active',
  }
}

export function findKeyByVersion(
  version: string,
  env: NodeJS.ProcessEnv = process.env
): TokenCryptoKeyEntry | null {
  const normalized = normalizeKeyVersion(version)
  const active = getActiveKey(env)
  if (active.version === normalized) return active
  return loadLegacyKeys(env).find((entry) => entry.version === normalized) ?? null
}

export function listTokenCryptoKeys(env: NodeJS.ProcessEnv = process.env): TokenCryptoKeyEntry[] {
  const active = getActiveKey(env)
  const legacy = loadLegacyKeys(env).filter((entry) => entry.version !== active.version)
  return [active, ...legacy]
}

export function isActiveKeyVersion(version: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeKeyVersion(version) === getActiveKey(env).version
}

export function normalizeKeyVersion(value: string | undefined): string {
  const version = (value ?? DEFAULT_TOKEN_CRYPTO_VERSION).trim()
  if (!version) return DEFAULT_TOKEN_CRYPTO_VERSION
  if (!/^[A-Za-z0-9_-]+$/.test(version)) {
    throw new Error(`Invalid TOKEN_CRYPTO_KEY_VERSION: ${version}`)
  }
  return version.toLowerCase()
}

function readActiveSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.TOKEN_CRYPTO_KEY
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error('TOKEN_CRYPTO_KEY required in production')
    }
    return LOCAL_TOKEN_CRYPTO_KEY
  }
  validateSecret('TOKEN_CRYPTO_KEY', secret)
  return secret
}

function loadLegacyKeys(env: NodeJS.ProcessEnv): TokenCryptoKeyEntry[] {
  return Object.entries(env)
    .filter(([name, secret]) => name.startsWith(LEGACY_KEY_PREFIX) && Boolean(secret))
    .map(([name, secret]) => {
      const suffix = name.slice(LEGACY_KEY_PREFIX.length)
      const version = normalizeLegacyVersion(suffix)
      validateSecret(name, secret as string)
      return {
        version,
        secret: secret as string,
        key: deriveAesKey(secret as string),
        source: 'legacy' as const,
      }
    })
}

function normalizeLegacyVersion(suffix: string): string {
  const trimmed = suffix.trim()
  if (!trimmed) {
    throw new Error('TOKEN_CRYPTO_KEY_LEGACY_* requires a version suffix')
  }
  return normalizeKeyVersion(trimmed)
}

function validateSecret(name: string, secret: string): void {
  if (secret.length < MIN_TOKEN_CRYPTO_KEY_LENGTH) {
    throw new Error(`${name} must be at least 32 chars`)
  }
}

function deriveAesKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

