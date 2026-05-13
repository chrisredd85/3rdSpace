import { NextRequest, NextResponse } from 'next/server'
import { claimInvitedVendor, getVendorClaimDetails } from '@/lib/vendors/vendorClaims'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing vendor invite token.' }, { status: 400 })
  }

  const result = await getVendorClaimDetails(token)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ details: result.details })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await claimInvitedVendor({
      token: String(body.token || ''),
      email: String(body.email || ''),
      password: String(body.password || ''),
      rateDecision: body.rateDecision === 'counter' ? 'counter' : 'accept',
      counterAmount: body.counterAmount === null || body.counterAmount === undefined || body.counterAmount === ''
        ? null
        : Number(body.counterAmount),
      publicBaseRateAmount: Number(body.publicBaseRateAmount || 0),
      publicRateType: body.publicRateType === 'hourly' || body.publicRateType === 'per_person'
        ? body.publicRateType
        : 'flat',
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, redirectTo: result.redirectTo })
  } catch (error) {
    console.error('Unexpected vendor claim error:', error)
    return NextResponse.json({ error: 'Could not claim vendor invite.' }, { status: 500 })
  }
}
