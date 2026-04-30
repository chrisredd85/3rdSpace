import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

/**
 * Builds a deterministic 32-byte encryption key from server-only environment variables.
 */
function getEncryptionKey(): Buffer {
  const material =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EVENTBRITE_CLIENT_SECRET ||
    process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!material) {
    throw new Error('Missing server encryption material for integration tokens')
  }

  return createHash('sha256').update(material).digest()
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
