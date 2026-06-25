import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

/**
 * Builds a deterministic 32-byte encryption key from server-only environment variables.
 */
function getEncryptionKey(): Buffer {
  return createHash('sha256').update(getTokenCryptoKey()).digest()
}

export function getTokenCryptoKey(): string {
  const key = process.env.TOKEN_CRYPTO_KEY
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOKEN_CRYPTO_KEY required in production')
    }
    return 'local-dev-only-do-not-use-in-prod'
  }
  if (key.length < 32) {
    throw new Error('TOKEN_CRYPTO_KEY must be at least 32 chars')
  }
  return key
}

/**
 * Encrypts a token value using AES-256-GCM and returns a compact transport string.
 */
export function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
}

/**
 * Decrypts a token value previously encrypted with {@link encryptSecret}.
 */
export function decryptSecret(value: string): string {
  const [ivBase64, tagBase64, encryptedBase64] = value.split('.')

  if (!ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted secret format')
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
