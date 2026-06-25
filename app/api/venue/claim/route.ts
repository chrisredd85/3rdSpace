import { NextRequest, NextResponse } from 'next/server'
import { claimInvitedVenue, getVenueClaimDetails } from '@/lib/venues/venueClaims'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing venue invite token.' }, { status: 400 })
  }

  const result = await getVenueClaimDetails(token)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ details: result.details })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rawCounterAmountCents = body.counterAmountCents
    const counterAmountCents =
      rawCounterAmountCents === null ||
      rawCounterAmountCents === undefined ||
      String(rawCounterAmountCents).trim() === ''
        ? null
        : Number(rawCounterAmountCents)

    const result = await claimInvitedVenue({
      token: String(body.token || ''),
      email: String(body.email || ''),
      password: String(body.password || ''),
      termDecision: body.termDecision === 'counter' ? 'counter' : 'accept',
      counterAmountCents,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, redirectTo: result.redirectTo })
  } catch (error) {
    console.error('Unexpected venue claim error:', error)
    return NextResponse.json({ error: 'Could not claim venue invite.' }, { status: 500 })
  }
}
