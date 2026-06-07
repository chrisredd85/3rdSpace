import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

function getEmailTokenKey() {
  const material = process.env.EMAIL_TOKEN_ENCRYPTION_KEY

  if (!material) {
    throw new Error('EMAIL_TOKEN_ENCRYPTION_KEY is required to encrypt creator email tokens')
  }

  return createHash('sha256').update(material).digest()
}

/**
 * Encrypts a creator OAuth token with AES-256-GCM.
 */
export function encryptEmailToken(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getEmailTokenKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
}

/**
 * Decrypts a creator OAuth token encrypted by {@link encryptEmailToken}.
 */
export function decryptEmailToken(value: string): string {
  const [ivBase64, tagBase64, encryptedBase64] = value.split('.')
  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted email token format')
  }

  const decipher = createDecipheriv(ALGORITHM, getEmailTokenKey(), Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
