import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import {
  findKeyByVersion,
  getActiveKey,
  getTokenCryptoKey,
  isActiveKeyVersion,
} from '@/lib/server/token-crypto-keys'

const ALGORITHM = 'aes-256-gcm'

export { getTokenCryptoKey, isActiveKeyVersion }

/**
 * Encrypts a token value using AES-256-GCM and returns a compact transport string.
 */
export function encryptSecret(value: string): string {
  const active = getActiveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, active.key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [active.version, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
}

/**
 * Decrypts a token value previously encrypted with {@link encryptSecret}.
 */
export function decryptSecret(value: string): string {
  const parsed = parseEncryptedSecret(value)
  const keyEntry = parsed.version === 'legacy'
    ? getActiveKey()
    : findKeyByVersion(parsed.version)

  if (!keyEntry) {
    throw new Error(`Unknown token crypto key version: ${parsed.version}`)
  }

  const decipher = createDecipheriv(ALGORITHM, keyEntry.key, Buffer.from(parsed.ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(parsed.tagBase64, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.encryptedBase64, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

export function getEncryptedSecretVersion(value: string): string {
  return parseEncryptedSecret(value).version
}

type ParsedEncryptedSecret = {
  version: string
  ivBase64: string
  tagBase64: string
  encryptedBase64: string
}

function parseEncryptedSecret(value: string): ParsedEncryptedSecret {
  const versionedParts = value.split(':')
  if (versionedParts.length === 4) {
    const [version, ivBase64, tagBase64, encryptedBase64] = versionedParts
    if (!version || !ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new Error('Invalid encrypted secret format')
    }
    return { version, ivBase64, tagBase64, encryptedBase64 }
  }

  const legacyDotParts = value.split('.')
  if (legacyDotParts.length === 3) {
    const [ivBase64, tagBase64, encryptedBase64] = legacyDotParts
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new Error('Invalid encrypted secret format')
    }
    return { version: 'legacy', ivBase64, tagBase64, encryptedBase64 }
  }

  if (versionedParts.length === 3) {
    const [ivBase64, tagBase64, encryptedBase64] = versionedParts
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new Error('Invalid encrypted secret format')
    }
    return { version: 'legacy', ivBase64, tagBase64, encryptedBase64 }
  }

  throw new Error('Invalid encrypted secret format')
}
