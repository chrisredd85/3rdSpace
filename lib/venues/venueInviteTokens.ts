import 'server-only'

import crypto from 'crypto'

export interface VenueClaimTokenPayload {
  venue_id: string
  email: string
  invited_at: string
  exp: number
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14

export function createVenueClaimToken(input: {
  venueId: string
  email: string
  invitedAt: string
  now?: number
}) {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000)
  const payload: VenueClaimTokenPayload = {
    venue_id: input.venueId,
    email: input.email.toLowerCase(),
    invited_at: input.invitedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(body)
  return `${body}.${signature}`
}

export function verifyVenueClaimToken(token: string, now = Math.floor(Date.now() / 1000)): VenueClaimTokenPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = sign(body)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as VenueClaimTokenPayload
    if (!payload.venue_id || !payload.email || !payload.invited_at || typeof payload.exp !== 'number') {
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
    .createHmac('sha256', getInviteSecret())
    .update(value)
    .digest('base64url')
}

function getInviteSecret() {
  const secret =
    process.env.VENUE_INVITE_SECRET ||
    process.env.VENDOR_INVITE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!secret) {
    throw new Error('VENUE_INVITE_SECRET or another server secret is required for venue invite links')
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
