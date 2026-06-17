import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  claimInvitedVendor,
  getVendorClaimDetails,
  markVendorStripeSkippedForAuthenticatedUser,
} from '@/lib/vendors/vendorClaims'

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
    if (body.action === 'skip_stripe') {
      const supabase = createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error || !user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
      }

      if (user.user_metadata?.user_type !== 'vendor') {
        return NextResponse.json({ error: 'Vendor access required' }, { status: 403 })
      }

      const result = await markVendorStripeSkippedForAuthenticatedUser(user.id)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }

      return NextResponse.json({ success: true, redirectTo: '/vendor?claim_complete=1&stripe_skipped=1' })
    }

    const rawPublicBaseRateAmount = body.publicBaseRateAmount
    const publicBaseRateAmount =
      rawPublicBaseRateAmount === null ||
      rawPublicBaseRateAmount === undefined ||
      String(rawPublicBaseRateAmount).trim() === ''
        ? null
        : Number(rawPublicBaseRateAmount)

    const result = await claimInvitedVendor({
      token: String(body.token || ''),
      email: String(body.email || ''),
      password: String(body.password || ''),
      rateDecision: body.rateDecision === 'counter' ? 'counter' : 'accept',
      counterAmount: body.counterAmount === null || body.counterAmount === undefined || body.counterAmount === ''
        ? null
        : Number(body.counterAmount),
      publicBaseRateAmount,
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
