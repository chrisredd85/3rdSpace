import 'server-only'

import crypto from 'crypto'

export interface VendorClaimTokenPayload {
  vendor_id: string
  email: string
  invited_at: string
  exp: number
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14

export function createVendorClaimToken(input: {
  vendorId: string
  email: string
  invitedAt: string
  now?: number
}) {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000)
  const payload: VendorClaimTokenPayload = {
    vendor_id: input.vendorId,
    email: input.email.toLowerCase(),
    invited_at: input.invitedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(body)
  return `${body}.${signature}`
}

export function verifyVendorClaimToken(token: string, now = Math.floor(Date.now() / 1000)): VendorClaimTokenPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = sign(body)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as VendorClaimTokenPayload
    if (!payload.vendor_id || !payload.email || !payload.invited_at || typeof payload.exp !== 'number') {
      return null
    }
    if (payload.exp < now) return null
    return {
      ...payload,
      email: payload.email.toLowerCase(),
    }
  } catch {
    return null
  }
}

function sign(value: string) {
  return crypto
    .createHmac('sha256', getVendorInviteSecret())
    .update(value)
    .digest('base64url')
}

export function getVendorInviteSecret(): string {
  const secret = process.env.VENDOR_INVITE_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('VENDOR_INVITE_SECRET required in production')
    }
    return 'local-dev-only-do-not-use-in-prod'
  }
  if (secret.length < 32) {
    throw new Error('VENDOR_INVITE_SECRET must be at least 32 chars')
  }
  return secret
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function timingSafeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)
  if (firstBuffer.length !== secondBuffer.length) return false
  return crypto.timingSafeEqual(firstBuffer, secondBuffer)
}
