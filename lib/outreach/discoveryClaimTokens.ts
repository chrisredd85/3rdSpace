import 'server-only'

import crypto from 'crypto'

export interface DiscoveryVenueClaimTokenPayload {
  discovery_venue_id: string
  exp: number
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

export function createDiscoveryVenueClaimToken(input: {
  discoveryVenueId: string
  now?: number
}) {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000)
  const payload: DiscoveryVenueClaimTokenPayload = {
    discovery_venue_id: input.discoveryVenueId,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  }
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyDiscoveryVenueClaimToken(
  token: string,
  now = Math.floor(Date.now() / 1000)
): DiscoveryVenueClaimTokenPayload | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = sign(body)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as DiscoveryVenueClaimTokenPayload
    if (!payload.discovery_venue_id || typeof payload.exp !== 'number') return null
    if (payload.exp < now) return null
    return payload
  } catch {
    return null
  }
}

export function buildDiscoveryVenueClaimUrl(input: {
  discoveryVenueId: string
  token?: string
}) {
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/$/, '')
  const token = input.token ?? createDiscoveryVenueClaimToken({
    discoveryVenueId: input.discoveryVenueId,
  })
  const url = new URL(`/v/${input.discoveryVenueId}/claim`, baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function sign(value: string) {
  return crypto
    .createHmac('sha256', getClaimSecret())
    .update(value)
    .digest('base64url')
}

function getClaimSecret() {
  const secret =
    process.env.DISCOVERY_CLAIM_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!secret) {
    throw new Error('DISCOVERY_CLAIM_TOKEN_SECRET or another server secret is required for discovery claim links')
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
